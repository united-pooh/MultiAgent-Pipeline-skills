import fs from "node:fs/promises";
import path from "node:path";

import { materializeArtifactFromTemplate } from "./artifact-templates.js";
import { ArtifactStore } from "./artifact-store.js";
import { runComplexityHook } from "./complexity-hook.js";
import {
  DEFAULT_GRADER_COUNT,
  DEFAULT_GRADING_THRESHOLD,
  DEFAULT_REQUIRE_DEPTH_ONE_PASS,
  DEFAULT_REVIEW_MODE,
} from "./constants.js";
import { extractSingleJsonBlock, validateArtifact } from "./contracts.js";
import {
  ContractValidationError,
  PipelinePauseForHumanError,
  PipelineRejectedError,
  StageExecutionError,
} from "./errors.js";
import {
  formatConventionalGitmojiCommitMessage,
  GitAutomation,
  normalizeGitPublicationPolicy,
} from "./git-automation.js";
import { MergeEngine } from "./merge-engine.js";
import { createCodexPetEvent } from "./pet-events.js";
import { loadStageCatalog } from "./stage-catalog.js";
import { aggregateTreeGradingFeedback } from "./tree-grading.js";
import { nowIso, sanitizeForPath, uniqueStrings } from "./utils.js";

const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 6;
const REPLAN_REQUIRED_PREFIX = "REPLAN_REQUIRED:";

class AsyncSlotPool {
  constructor(maxSlots) {
    if (!Number.isInteger(maxSlots) || maxSlots < 1) {
      throw new Error("AsyncSlotPool requires maxSlots to be a positive integer");
    }

    this.maxSlots = maxSlots;
    this.availableSlots = maxSlots;
    this.queue = [];
  }

  async run(slotCount, task) {
    const release = await this.acquire(slotCount);
    try {
      return await task();
    } finally {
      release();
    }
  }

  acquire(slotCount) {
    if (!Number.isInteger(slotCount) || slotCount < 0) {
      throw new Error("slotCount must be a non-negative integer");
    }

    if (slotCount === 0) {
      return Promise.resolve(() => {});
    }

    if (slotCount > this.maxSlots) {
      throw new Error(`Cannot acquire ${slotCount} slot(s) from a ${this.maxSlots}-slot pool`);
    }

    return new Promise((resolve) => {
      this.queue.push({ slotCount, resolve });
      this.drain();
    });
  }

  drain() {
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      if (entry.slotCount > this.availableSlots) {
        return;
      }

      this.queue.shift();
      this.availableSlots -= entry.slotCount;
      let released = false;
      entry.resolve(() => {
        if (released) {
          return;
        }

        released = true;
        this.availableSlots += entry.slotCount;
        this.drain();
      });
    }
  }
}

function recordWaveStop(stopSignal, error) {
  if (stopSignal && !stopSignal.error) {
    stopSignal.error = error;
  }
}

function throwIfWaveStopped(stopSignal) {
  if (stopSignal?.error) {
    throw stopSignal.error;
  }
}

function artifactTypeForStage(stage) {
  switch (stage) {
    case "spec":
    case "plan":
    case "architecture":
    case "dispatch":
    case "doc":
      return stage === "doc" ? "doc-report" : stage;
    case "final-assessment":
      return "final-assessment";
    case "tree-classification":
      return "tree-classification";
    case "tree-rubric-generation":
      return "tree-rubrics";
    case "tree-rubric-verification":
      return "tree-rubric-verification";
    case "tree-rubric-refinement":
      return "tree-rubrics-refined";
    case "tree-grading":
      return "tree-grading-individual";
    case "review":
      return "review-individual";
    case "execution":
      return "execution-report";
    case "validation":
      return "validation-report";
    case "qa":
      return "qa-report";
    default:
      throw new Error(`No artifact type mapping for stage ${stage}`);
  }
}

function petStateForStage(stage) {
  if (stage === "review" || stage === "tree-grading" || stage === "final-assessment") {
    return "review";
  }

  return "running";
}

function petScopeForStage(stage, context) {
  const groupId = context.workerGroup?.group_id;
  const iteration = context.iteration;
  const suffix = [
    groupId ? `group-${sanitizeForPath(groupId)}` : null,
    Number.isInteger(iteration) ? `iteration-${iteration}` : null,
  ].filter(Boolean);

  return ["pipeline", stage, ...suffix].join(".");
}

function skillIssues(requiredSkills, appliedSkills) {
  const missing = requiredSkills.filter((skill) => !appliedSkills.includes(skill));
  const extra = appliedSkills.filter((skill) => !requiredSkills.includes(skill));
  const issues = [];

  if (missing.length > 0) {
    issues.push(`missing required skills: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    issues.push(`unexpected applied skills: ${extra.join(", ")}`);
  }

  return issues;
}

function buildEmptyGroupState(workerGroup) {
  return {
    workerGroup,
    executionHistory: [],
    complexityHistory: [],
    mergeHistory: [],
    validationHistory: [],
    treeGradingFeedbackHistory: [],
    treeGraderArtifacts: [],
    finalExecution: null,
    finalComplexity: null,
    finalMerge: null,
    finalValidation: null,
    finalTreeGradingFeedback: null,
    finalOutputFiles: null,
    qaResult: null,
  };
}

function latestEntry(entries) {
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function latestMergeEntry(state) {
  return state.finalMerge ?? latestEntry(state.mergeHistory);
}

function latestComplexityEntry(state) {
  return state.finalComplexity ?? latestEntry(state.complexityHistory);
}

function latestTreeGradingEntry(state) {
  return state.finalTreeGradingFeedback ?? latestEntry(state.treeGradingFeedbackHistory);
}

function hasTreeGradingPass(state) {
  return latestTreeGradingEntry(state)?.artifact?.verdict === "pass";
}

function latestValidationEntry(state) {
  return state.finalValidation ?? latestEntry(state.validationHistory);
}

function hasValidationPass(state) {
  return ["passed", "skipped"].includes(latestValidationEntry(state)?.artifact?.status);
}

function hasQaPass(state) {
  return state.qaResult?.artifact?.status === "pass";
}

function hasQaFailure(state) {
  return state.qaResult?.artifact?.status === "fail";
}

function latestFailedTreeGradingFeedback(state) {
  const latestFeedback = latestTreeGradingEntry(state)?.artifact ?? null;
  return latestFeedback?.verdict === "fail" ? latestFeedback : null;
}

function latestFailedValidationReport(state) {
  const latestValidation = latestValidationEntry(state)?.artifact ?? null;
  return ["failed", "error"].includes(latestValidation?.status) ? latestValidation : null;
}

function latestFailedQaReport(state) {
  const latestQa = state.qaResult?.artifact ?? null;
  return latestQa?.status === "fail" ? latestQa : null;
}

function executionBlockerRequiresReplan(executionArtifact) {
  const firstBlocker = executionArtifact.blockers?.[0] ?? "";
  return firstBlocker.trimStart().startsWith(REPLAN_REQUIRED_PREFIX);
}

function buildIterationPolicy(workerGroup) {
  return {
    goal_expansion: "related_same_group",
    allowed_files: workerGroup.owned_files ?? [],
    replan_blocker_prefix: REPLAN_REQUIRED_PREFIX,
    replan_required_when: [
      "the retry needs files outside worker_group.owned_files",
      "the retry changes cross-group dependencies",
      "the retry changes task ownership or dispatch grouping",
    ],
  };
}

function nextExecutionIteration(state) {
  const latestExecutionIteration = latestEntry(state.executionHistory)?.artifact?.iteration ?? 0;
  const latestComplexityIteration = latestEntry(state.complexityHistory)?.artifact?.iteration ?? 0;
  const latestMergeIteration = latestEntry(state.mergeHistory)?.artifact?.iteration ?? 0;
  const latestValidationIteration = latestEntry(state.validationHistory)?.artifact?.iteration ?? 0;
  const latestTreeGradingIteration =
    latestEntry(state.treeGradingFeedbackHistory)?.artifact?.iteration ?? 0;
  return Math.max(
    latestExecutionIteration,
    latestComplexityIteration,
    latestMergeIteration,
    latestValidationIteration,
    latestTreeGradingIteration,
  ) + 1;
}

function findComplexityForIteration(state, iteration) {
  for (let index = state.complexityHistory.length - 1; index >= 0; index -= 1) {
    const entry = state.complexityHistory[index];
    if (entry.artifact.iteration === iteration) {
      return entry;
    }
  }

  return null;
}

function findTreeGradingFeedbackForIteration(state, iteration) {
  for (let index = state.treeGradingFeedbackHistory.length - 1; index >= 0; index -= 1) {
    const entry = state.treeGradingFeedbackHistory[index];
    if (entry.artifact.iteration === iteration) {
      return entry;
    }
  }

  return null;
}

function findValidationForIteration(state, iteration) {
  for (let index = state.validationHistory.length - 1; index >= 0; index -= 1) {
    const entry = state.validationHistory[index];
    if (entry.artifact.iteration === iteration) {
      return entry;
    }
  }

  return null;
}

function buildSkillUsageSummary({ dispatch, groupStates, finalAssessment }) {
  if (finalAssessment?.skill_usage_summary) {
    return finalAssessment.skill_usage_summary;
  }

  const summary = [];

  if (!dispatch) {
    return summary;
  }

  dispatch.worker_groups.forEach((group) => {
    if ((group.required_skills ?? []).length === 0) {
      return;
    }

    const state = groupStates.get(group.group_id);
    const executionSkills = state?.finalExecution?.artifact?.applied_skills ?? [];
    summary.push({
      scope: `${group.group_id}/execution`,
      required_skills: group.required_skills,
      applied_skills: executionSkills,
      issues: skillIssues(group.required_skills, executionSkills),
    });
  });

  return summary;
}

function buildRunSummary({
  runId,
  verdict,
  restartFrom,
  skillUsageSummary,
  groupStates,
  deletedWorkspace,
  clock,
  codexPetEvents,
}) {
  const states = [...groupStates.values()];
  return {
    version: "1.0",
    run_id: runId,
    completed_at: nowIso(clock),
    verdict,
    restart_from: restartFrom,
    skill_usage_summary: skillUsageSummary,
    merge_summary: {
      merged_groups: states
        .filter((state) => latestMergeEntry(state)?.artifact?.status === "merged")
        .map((state) => state.workerGroup.group_id)
        .sort(),
      conflicted_groups: states
        .filter((state) => latestMergeEntry(state)?.artifact?.status === "conflicted")
        .map((state) => state.workerGroup.group_id)
        .sort(),
      noop_groups: states
        .filter((state) => latestMergeEntry(state)?.artifact?.status === "noop")
        .map((state) => state.workerGroup.group_id)
        .sort(),
    },
    qa_summary: states
      .filter((state) => state.qaResult)
      .map((state) => ({
        group_id: state.workerGroup.group_id,
        status: state.qaResult.artifact.status,
      })),
    validation_summary: states
      .filter((state) => latestValidationEntry(state))
      .map((state) => ({
        group_id: state.workerGroup.group_id,
        status: latestValidationEntry(state).artifact.status,
      })),
    complexity_summary: states
      .filter((state) => latestComplexityEntry(state))
      .map((state) => {
        const entry = latestComplexityEntry(state);
        return {
          group_id: state.workerGroup.group_id,
          ref: entry.ref,
          status: entry.artifact.status,
          readability_conclusion: entry.artifact.readability_conclusion,
          complexity_conclusion: entry.artifact.complexity_conclusion,
          function_count: entry.artifact.function_count,
          max_total_points: entry.artifact.max_total_points,
        };
      }),
    tree_grading_summary: states
      .filter((state) => latestTreeGradingEntry(state))
      .map((state) => {
        const entry = latestTreeGradingEntry(state);
        return {
          group_id: state.workerGroup.group_id,
          verdict: entry.artifact.verdict,
          weighted_score: entry.artifact.weighted_score,
          nodes_failed: entry.artifact.nodes_failed,
        };
      }),
    cleanup_summary: {
      deleted_workspace: deletedWorkspace,
      deleted_paths: deletedWorkspace ? [".pipeline-workspace"] : [],
      retained_file: ".pipeline-last-run-summary.json",
    },
    codex_pet_events: codexPetEvents,
  };
}

function stageLabelForGitPublication(phase) {
  return phase === "doc" ? "Documentation" : "Cleanup";
}

function pathsForGitPublication(phasePolicy, context) {
  if (Array.isArray(phasePolicy.paths)) {
    return uniqueStrings(phasePolicy.paths.filter(Boolean));
  }

  if (phasePolicy.paths === "updated_files") {
    return uniqueStrings((context.updatedFiles ?? []).filter(Boolean));
  }

  if (phasePolicy.paths === "all") {
    return [];
  }

  return [];
}

function buildGitPublicationMessage(phase, phasePolicy, context) {
  if (phasePolicy.message) {
    return `${String(phasePolicy.message).trimEnd()}\n`;
  }

  const body = [
    `阶段: ${stageLabelForGitPublication(phase)}`,
    context.runId ? `运行: ${context.runId}` : null,
    context.finalAssessment?.verdict ? `最终评估: ${context.finalAssessment.verdict}` : null,
    (context.updatedFiles ?? []).length > 0
      ? `文件: ${uniqueStrings(context.updatedFiles).join(", ")}`
      : null,
    ...(phasePolicy.body ?? []),
  ].filter(Boolean);

  return formatConventionalGitmojiCommitMessage({
    type: phasePolicy.type,
    scope: phasePolicy.scope,
    gitmoji: phasePolicy.gitmoji,
    description: phasePolicy.description,
    body,
    footers: phasePolicy.footers ?? [],
  });
}

export class PipelineOrchestrator {
  constructor({
    repoRoot,
    stageRunner,
    reviewMode = DEFAULT_REVIEW_MODE,
    graderCount = DEFAULT_GRADER_COUNT,
    gradingThreshold = DEFAULT_GRADING_THRESHOLD,
    requireDepthOnePass = DEFAULT_REQUIRE_DEPTH_ONE_PASS,
    maxStageRetries = 2,
    clock = () => new Date(),
    artifactStore = null,
    stageCatalog = null,
    mergeEngine = null,
    complexityHook = runComplexityHook,
    gitPolicy = null,
    gitAutomation = null,
    maxConcurrentSubagents = DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  }) {
    if (!repoRoot) {
      throw new Error("PipelineOrchestrator requires repoRoot");
    }

    if (!stageRunner?.runStage) {
      throw new Error("PipelineOrchestrator requires a stageRunner with runStage(request)");
    }

    if (!Number.isInteger(graderCount) || graderCount < 1) {
      throw new Error("graderCount must be a positive integer");
    }

    if (!Number.isInteger(maxConcurrentSubagents) || maxConcurrentSubagents < 1) {
      throw new Error("maxConcurrentSubagents must be a positive integer");
    }

    if (graderCount > maxConcurrentSubagents) {
      throw new Error("maxConcurrentSubagents must be greater than or equal to graderCount");
    }

    this.repoRoot = repoRoot;
    this.stageRunner = stageRunner;
    this.reviewMode = reviewMode;
    this.graderCount = graderCount;
    this.maxConcurrentSubagents = maxConcurrentSubagents;
    this.gradingThreshold = gradingThreshold;
    this.requireDepthOnePass = requireDepthOnePass;
    this.maxStageRetries = maxStageRetries;
    this.clock = clock;
    this.artifactStore = artifactStore ?? new ArtifactStore({ repoRoot, clock });
    this.stageCatalog = stageCatalog ?? loadStageCatalog(repoRoot);
    this.mergeEngine = mergeEngine ?? new MergeEngine({ repoRoot, artifactStore: this.artifactStore });
    this.complexityHook = complexityHook;
    this.gitPublicationPolicy = normalizeGitPublicationPolicy(gitPolicy);
    this.gitAutomation = gitAutomation ?? (
      this.gitPublicationPolicy.enabled ? new GitAutomation({ repoRoot }) : null
    );
    this.subagentSlots = new AsyncSlotPool(maxConcurrentSubagents);
    this.mergeSlots = new AsyncSlotPool(1);
    this.codexPetEvents = [];
  }

  async emitPetEvent({ state, reason, scope, durationMs = 1800 }) {
    const event = createCodexPetEvent({
      state,
      reason,
      scope,
      durationMs,
      createdAt: nowIso(this.clock),
    });
    this.codexPetEvents.push(event);
    await this.artifactStore.appendPetEvent(event);
    return event;
  }

  async run({ request, runId = `RUN-${nowIso(this.clock).replace(/[-:.TZ]/g, "").slice(0, 14)}` }) {
    if (typeof request !== "string" || request.trim() === "") {
      throw new Error("run() requires a non-empty request string");
    }

    this.codexPetEvents = [];
    await this.artifactStore.initializeRun();
    await this.artifactStore.appendLog(`run ${runId} started`);
    await this.emitPetEvent({
      state: "running",
      reason: `Pipeline run ${runId} started.`,
      scope: "pipeline.start",
      durationMs: 1800,
    });

    const groupStates = new Map();
    let spec;
    let plan;
    let architecture;
    let dispatch;
    let finalAssessment;

    try {
      spec = await this.runRootStage("spec", { userRequest: request });
      plan = await this.runRootStage("plan", { spec });
      architecture = await this.runRootStage("architecture", { spec, plan });

      if (architecture.feasibility === "infeasible") {
        throw new PipelineRejectedError(
          architecture.infeasibility_reason ?? "Architecture marked the request infeasible.",
          {
            restartFrom: "architecture",
            details: architecture.rollback_notes,
          },
        );
      }

      dispatch = await this.runRootStage(
        "dispatch",
        { spec, plan, architecture },
        { plan, architecture },
      );

      this.initializeGroupStates(dispatch, groupStates);
      ({ finalAssessment } = await this.continueFromDispatch({
        runId,
        spec,
        plan,
        architecture,
        dispatch,
        groupStates,
      }));

      return this.finishRun({
        runId,
        spec,
        plan,
        dispatch,
        groupStates,
        finalAssessment,
      });
    } catch (error) {
      return this.handleTerminalError({
        runId,
        spec,
        plan,
        dispatch,
        groupStates,
        finalAssessment,
        error,
      });
    }
  }

  async resumeAfterConflict({
    conflictResolution = null,
    runId = `RUN-${nowIso(this.clock).replace(/[-:.TZ]/g, "").slice(0, 14)}`,
  } = {}) {
    if (!(await this.artifactStore.workspaceExists())) {
      throw new Error("No persisted pipeline workspace was found to resume");
    }

    await this.artifactStore.appendLog(`resume ${runId} started`);
    this.codexPetEvents = [];
    await this.emitPetEvent({
      state: "running",
      reason: `Pipeline resume ${runId} started.`,
      scope: "pipeline.resume",
      durationMs: 1800,
    });

    const spec = await this.artifactStore.readRootArtifact("spec");
    const plan = await this.artifactStore.readRootArtifact("plan");
    const architecture = await this.artifactStore.readRootArtifact("architecture");
    const dispatch = await this.artifactStore.readRootArtifact("dispatch");
    const groupStates = await this.loadGroupStates(dispatch);
    let finalAssessment;

    try {
      const conflictResolutionEntry = await this.resolveConflictResolutionEntry(conflictResolution);
      const mergeReport = await this.artifactStore.readArtifactRef(
        conflictResolutionEntry.artifact.merge_report_ref,
      );

      if (mergeReport.status !== "conflicted") {
        throw new Error("resumeAfterConflict requires a conflicted merge report");
      }

      const groupState = groupStates.get(mergeReport.group_id);
      if (!groupState) {
        throw new Error(`No group state found for conflicted merge ${mergeReport.group_id}`);
      }

      await this.resumeResolvedConflictGroup({
        spec,
        architecture,
        groupState,
        mergeReport,
        conflictResolution: conflictResolutionEntry,
      });

      ({ finalAssessment } = await this.continueFromDispatch({
        runId,
        spec,
        plan,
        architecture,
        dispatch,
        groupStates,
      }));

      return this.finishRun({
        runId,
        spec,
        plan,
        dispatch,
        groupStates,
        finalAssessment,
      });
    } catch (error) {
      return this.handleTerminalError({
        runId,
        spec,
        plan,
        dispatch,
        groupStates,
        finalAssessment,
        error,
      });
    }
  }

  initializeGroupStates(dispatch, groupStates) {
    dispatch.worker_groups.forEach((workerGroup) => {
      groupStates.set(workerGroup.group_id, buildEmptyGroupState(workerGroup));
    });
  }

  async loadGroupStates(dispatch) {
    const groupStates = new Map();

    for (const workerGroup of dispatch.worker_groups) {
      const state = buildEmptyGroupState(workerGroup);
      state.executionHistory = await this.artifactStore.readGroupExecutionHistory(workerGroup.group_id);
      state.complexityHistory = await this.artifactStore.readGroupComplexityReports(workerGroup.group_id);
      state.mergeHistory = await this.artifactStore.readGroupMergeHistory(workerGroup.group_id);
      state.validationHistory = await this.artifactStore.readGroupValidationReports(workerGroup.group_id);
      state.treeGradingFeedbackHistory = await this.artifactStore.readGroupTreeGradingFeedbackHistory(
        workerGroup.group_id,
      );
      state.finalExecution = latestEntry(state.executionHistory);
      state.finalComplexity = latestEntry(state.complexityHistory);
      state.finalMerge = latestEntry(state.mergeHistory);
      state.finalValidation = latestEntry(state.validationHistory);
      state.finalTreeGradingFeedback = latestEntry(state.treeGradingFeedbackHistory);
      state.qaResult = latestEntry(await this.artifactStore.readGroupQaReports(workerGroup.group_id));

      const latestTreeGradingIteration = state.finalTreeGradingFeedback?.artifact?.iteration ?? null;
      state.treeGraderArtifacts = latestTreeGradingIteration === null
        ? []
        : (await this.artifactStore.readGroupTreeGraderOutputs(workerGroup.group_id, {
            iteration: latestTreeGradingIteration,
          })).map((entry) => entry.artifact);

      groupStates.set(workerGroup.group_id, state);
    }

    return groupStates;
  }

  async continueFromDispatch({ runId, spec, plan, architecture, dispatch, groupStates }) {
    for (const wave of dispatch.execution_waves) {
      await this.artifactStore.appendLog(`wave ${wave.wave} processing ${wave.groups.join(", ")}`);
      const waveStates = wave.groups.map((groupId) => {
        const state = groupStates.get(groupId);
        if (!state) {
          throw new Error(`Missing group state for ${groupId}`);
        }

        return state;
      });

      await this.runWaveWorkerPool({
        spec,
        plan,
        architecture,
        wave,
        waveStates,
      });
    }

    const docReport = await this.runDocStage({
      runId,
      spec,
      architecture,
      executionResults: [...groupStates.values()].map((state) => state.finalExecution.artifact),
      complexityReports: [...groupStates.values()]
        .filter((state) => state.finalComplexity)
        .map((state) => state.finalComplexity.artifact),
    });
    const previousAssessments = (await this.artifactStore.readAssessmentHistory()).map(
      (entry) => entry.artifact,
    );
    const conflictResolutions = (await this.artifactStore.readConflictResolutions()).map(
      (entry) => entry.artifact,
    );
    const finalAssessment = await this.runFinalAssessmentStage({
      spec,
      plan,
      architecture,
      dispatch,
      executionReports: [...groupStates.values()].flatMap((state) =>
        state.executionHistory.map((entry) => entry.artifact),
      ),
      mergeReports: [...groupStates.values()].flatMap((state) =>
        state.mergeHistory.map((entry) => entry.artifact),
      ),
      validationReports: [...groupStates.values()].flatMap((state) =>
        state.validationHistory.map((entry) => entry.artifact),
      ),
      complexityReports: [...groupStates.values()].flatMap((state) =>
        state.complexityHistory.map((entry) => entry.artifact),
      ),
      conflictResolutions,
      treeGradingFeedbacks: [...groupStates.values()].flatMap((state) =>
        state.treeGradingFeedbackHistory.map((entry) => entry.artifact),
      ),
      qaReports: [...groupStates.values()]
        .filter((state) => state.qaResult)
        .map((state) => state.qaResult.artifact),
      docReport,
      previousAssessments,
    });

    return {
      docReport,
      finalAssessment,
    };
  }

  async runWaveWorkerPool({ spec, plan, architecture, wave, waveStates }) {
    const stopSignal = { error: null };
    const groupRuns = await Promise.allSettled(
      waveStates.map((groupState) =>
        this.runGroupUntilQaPass({
          spec,
          plan,
          architecture,
          wave,
          groupState,
          stopSignal,
        }).catch((error) => {
          recordWaveStop(stopSignal, error);
          throw error;
        }),
      ),
    );
    const firstError =
      stopSignal.error ?? groupRuns.find((result) => result.status === "rejected")?.reason;

    if (firstError) {
      throw firstError;
    }
  }

  async runGroupUntilQaPass({ spec, plan, architecture, wave, groupState, stopSignal = null }) {
    while (!hasQaPass(groupState)) {
      throwIfWaveStopped(stopSignal);
      if (!hasTreeGradingPass(groupState) || hasQaFailure(groupState)) {
        const executionRun = await this.runExecutionPass({
          spec,
          plan,
          architecture,
          groupState,
          wave,
          stopSignal,
        });
        throwIfWaveStopped(stopSignal);
        await this.integrateAndGradeExecutionPass({
          spec,
          architecture,
          groupState,
          executionRun,
          stopSignal,
        });
        continue;
      }

      throwIfWaveStopped(stopSignal);
      groupState.qaResult = await this.runQaStage({
        spec,
        architecture,
        workerGroup: groupState.workerGroup,
        executionResult: groupState.finalExecution,
        validationResult: groupState.finalValidation,
        mergeResult: groupState.finalMerge,
        treeGradingFeedback: groupState.finalTreeGradingFeedback,
        complexityResult: groupState.finalComplexity,
      });
    }
  }

  async finishRun({ runId, spec, plan, dispatch, groupStates, finalAssessment }) {
    const skillUsageSummary = buildSkillUsageSummary({
      spec,
      plan,
      dispatch,
      groupStates,
      finalAssessment,
    });
    const shouldDeleteWorkspace = finalAssessment.verdict === "accept";
    await this.emitPetEvent({
      state: finalAssessment.verdict === "accept" ? "waving" : "failed",
      reason: `Pipeline run ${runId} finished with verdict ${finalAssessment.verdict}.`,
      scope: "pipeline.finish",
      durationMs: finalAssessment.verdict === "accept" ? 2400 : 3200,
    });
    const summary = buildRunSummary({
      runId,
      verdict: finalAssessment.verdict,
      restartFrom: finalAssessment.restart_from,
      skillUsageSummary,
      groupStates,
      deletedWorkspace: shouldDeleteWorkspace,
      clock: this.clock,
      codexPetEvents: this.codexPetEvents,
    });
    await this.artifactStore.writeRunSummary(summary);

    if (shouldDeleteWorkspace) {
      await this.artifactStore.cleanupWorkspace();
      await this.runGitPublication("cleanup", {
        runId,
        spec,
        finalAssessment,
      });
    }

    return {
      runId,
      verdict: finalAssessment.verdict,
      restartFrom: finalAssessment.restart_from,
      summaryPath: this.artifactStore.summaryPath,
    };
  }

  async handleTerminalError({
    runId,
    spec,
    plan,
    dispatch,
    groupStates,
    finalAssessment,
    error,
  }) {
    if (
      !(error instanceof PipelineRejectedError) &&
      !(error instanceof PipelinePauseForHumanError)
    ) {
      throw error;
    }

    const skillUsageSummary = buildSkillUsageSummary({
      spec,
      plan,
      dispatch,
      groupStates,
      finalAssessment,
    });
    const verdict = error instanceof PipelinePauseForHumanError ? "pause_for_human" : "reject";
    await this.emitPetEvent({
      state: verdict === "pause_for_human" ? "waiting" : "failed",
      reason: `Pipeline run ${runId} ended with ${verdict} at ${error.restartFrom}.`,
      scope: `pipeline.${error.restartFrom}`,
      durationMs: verdict === "pause_for_human" ? 3600 : 3200,
    });
    const summary = buildRunSummary({
      runId,
      verdict,
      restartFrom: error.restartFrom,
      skillUsageSummary,
      groupStates,
      deletedWorkspace: false,
      clock: this.clock,
      codexPetEvents: this.codexPetEvents,
    });
    await this.artifactStore.writeRunSummary(summary);
    await this.artifactStore.appendLog(`${verdict} at ${error.restartFrom}: ${error.message}`);

    return {
      runId,
      verdict,
      restartFrom: error.restartFrom,
      summaryPath: this.artifactStore.summaryPath,
    };
  }

  async runGitPublication(phase, context = {}) {
    if (!this.gitPublicationPolicy.enabled) {
      return {
        status: "disabled",
      };
    }

    const phasePolicy = this.gitPublicationPolicy[phase];
    if (!phasePolicy?.enabled || phasePolicy.commit === false) {
      return {
        status: "disabled",
      };
    }

    if (!this.gitAutomation) {
      throw new Error("Git publication is enabled but no GitAutomation adapter is configured");
    }

    const message = buildGitPublicationMessage(phase, phasePolicy, context);
    const paths = pathsForGitPublication(phasePolicy, context);

    try {
      const result = await this.gitAutomation.commitAndMaybePush({
        message,
        paths,
        push: phasePolicy.push === true,
        remote: phasePolicy.remote ?? this.gitPublicationPolicy.remote,
        branch: phasePolicy.branch,
      });
      if (await this.artifactStore.workspaceExists()) {
        await this.artifactStore.appendLog(
          `git ${phase} publication ${result.status}${result.pushed ? " and pushed" : ""}`,
        );
      }
      return result;
    } catch (error) {
      if (await this.artifactStore.workspaceExists()) {
        await this.artifactStore.appendLog(`git ${phase} publication failed: ${error.message}`);
      }

      const failureMode = phasePolicy.failureMode ?? this.gitPublicationPolicy.failureMode;
      if (failureMode === "log") {
        return {
          status: "failed",
          error: error.message,
        };
      }

      throw error;
    }
  }

  async runRootStage(stage, context, validationContext = {}) {
    const result = await this.runStage(stage, context, validationContext);
    await this.artifactStore.writeRootArtifact(stage === "doc" ? "doc-report" : stage, result.artifact);
    return result.artifact;
  }

  async runSubagentStage(stage, context, validationContext = {}, { slotCost = 1 } = {}) {
    return this.subagentSlots.run(slotCost, () =>
      this.runStage(stage, context, validationContext),
    );
  }

  async runStage(stage, context, validationContext = {}) {
    const artifactType = artifactTypeForStage(stage);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxStageRetries + 1; attempt += 1) {
      try {
        await this.emitPetEvent({
          state: petStateForStage(stage),
          reason: `${stage} stage started${attempt > 1 ? ` retry ${attempt}` : ""}.`,
          scope: petScopeForStage(stage, context),
          durationMs:
            stage === "review" || stage === "tree-grading" || stage === "final-assessment"
              ? 2400
              : 1800,
        });
        const request = await this.stageCatalog.buildStageRequest(stage, {
          ...context,
          reviewMode: context.reviewMode ?? this.reviewMode,
          attempt,
        });
        const stageExecution = await this.stageRunner.runStage(request);
        const artifact = this.normalizeStageArtifact(
          stageExecution,
          artifactType,
          validationContext,
          {
            artifactTemplate: request.artifactTemplate?.artifact ?? null,
            context,
          },
        );
        await this.artifactStore.appendLog(`${stage} succeeded on attempt ${attempt}`);
        return {
          request,
          stageExecution,
          artifact,
        };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ContractValidationError) || attempt > this.maxStageRetries) {
          throw new StageExecutionError(stage, error.message, { cause: error });
        }

        await this.artifactStore.appendLog(
          `${stage} returned invalid artifact on attempt ${attempt}: ${error.message}`,
        );
      }
    }

    throw new StageExecutionError(stage, lastError?.message ?? "unknown stage failure");
  }

  normalizeStageArtifact(
    stageExecution,
    artifactType,
    validationContext,
    { artifactTemplate = null, context = {} } = {},
  ) {
    if (!stageExecution || typeof stageExecution !== "object") {
      throw new ContractValidationError(artifactType, "stage execution result must be an object");
    }

    const payload =
      stageExecution.artifact !== undefined
        ? stageExecution.artifact
        : extractSingleJsonBlock(stageExecution.rawOutput);
    const materialized = materializeArtifactFromTemplate({
      artifactType,
      template: artifactTemplate,
      values: stageExecution.artifactPatch ?? payload,
      context: {
        ...context,
        ...validationContext,
      },
      stageExecution,
    });
    return validateArtifact(artifactType, materialized, validationContext);
  }

  async createBaseRef({ wave, groupId, iteration }) {
    return this.artifactStore.createWorkspaceSnapshot({
      refPath: path.posix.join(
        "bases",
        `wave-${wave}-${sanitizeForPath(groupId)}-iteration-${iteration}-base.json`,
      ),
      snapshotName: `wave-${wave}-${groupId}-iteration-${iteration}-base`,
      metadata: {
        group_id: groupId,
        wave,
        iteration,
      },
    });
  }

  async runExecutionPass({ spec, plan, architecture, groupState, wave, stopSignal = null }) {
    throwIfWaveStopped(stopSignal);
    const iteration = nextExecutionIteration(groupState);
    const baseRef = await this.createBaseRef({
      wave: wave.wave,
      groupId: groupState.workerGroup.group_id,
      iteration,
    });
    throwIfWaveStopped(stopSignal);
    const executionResult = await this.runSubagentStage(
      "execution",
      {
        spec,
        plan,
        architecture,
        workerGroup: groupState.workerGroup,
        baseRef,
        iteration,
        treeGradingFeedback: latestFailedTreeGradingFeedback(groupState),
        validationReport: latestFailedValidationReport(groupState),
        qaReport: latestFailedQaReport(groupState),
        iterationPolicy: buildIterationPolicy(groupState.workerGroup),
      },
      {
        requiredSkills: groupState.workerGroup.required_skills,
      },
    );
    throwIfWaveStopped(stopSignal);

    if (executionResult.artifact.status === "blocked") {
      const restartFrom = executionBlockerRequiresReplan(executionResult.artifact)
        ? "dispatch"
        : "execution";
      throw new PipelineRejectedError(
        `Execution blocked for ${groupState.workerGroup.group_id}: ${executionResult.artifact.blockers.join("; ")}`,
        { restartFrom },
      );
    }

    if (!executionResult.stageExecution.proposal) {
      throw new StageExecutionError(
        "execution",
        `${groupState.workerGroup.group_id} execution returned no merge proposal metadata`,
      );
    }

    const complexityResult = await this.runExecutionComplexityHook({
      groupState,
      iteration,
      executionResult,
    });
    const executionRef = await this.artifactStore.writeExecutionReport(
      groupState.workerGroup.group_id,
      iteration,
      executionResult.artifact,
    );
    const persistedExecution = {
      ...executionResult,
      ref: executionRef,
    };
    groupState.executionHistory.push(persistedExecution);
    groupState.finalExecution = persistedExecution;
    groupState.complexityHistory.push(complexityResult);
    groupState.finalComplexity = complexityResult;
    groupState.qaResult = null;

    return {
      groupState,
      iteration,
      baseRef,
      executionResult: persistedExecution,
      complexityResult,
    };
  }

  async runExecutionComplexityHook({ groupState, iteration, executionResult }) {
    const artifact = await this.complexityHook({
      repoRoot: this.repoRoot,
      groupId: groupState.workerGroup.group_id,
      iteration,
      changedFiles: executionResult.artifact.changed_files,
      proposalPath: executionResult.stageExecution.proposal.path,
      clock: this.clock,
    });
    const ref = await this.artifactStore.writeComplexityReport(
      groupState.workerGroup.group_id,
      iteration,
      artifact,
    );
    await this.artifactStore.appendLog(
      `complexity ${artifact.status} for ${groupState.workerGroup.group_id} iteration ${iteration}: readability ${artifact.readability_conclusion}, complexity ${artifact.complexity_conclusion}`,
    );

    return {
      artifact,
      ref,
    };
  }

  async integrateAndGradeExecutionPass({
    spec,
    architecture,
    groupState,
    executionRun,
    stopSignal = null,
  }) {
    throwIfWaveStopped(stopSignal);
    const { mergeOutcome, mergeRef } = await this.mergeSlots.run(1, async () => {
      throwIfWaveStopped(stopSignal);
      const outcome = await this.mergeEngine.mergeProposal({
        groupId: groupState.workerGroup.group_id,
        iteration: executionRun.iteration,
        baseRef: executionRun.baseRef,
        proposal: executionRun.executionResult.stageExecution.proposal,
        changedFiles: executionRun.executionResult.artifact.changed_files,
      });
      const ref = await this.artifactStore.writeMergeReport(
        groupState.workerGroup.group_id,
        executionRun.iteration,
        outcome.report,
      );
      return {
        mergeOutcome: outcome,
        mergeRef: ref,
      };
    });
    const mergeEntry = {
      artifact: mergeOutcome.report,
      ref: mergeRef,
    };
    groupState.mergeHistory.push(mergeEntry);
    groupState.finalMerge = mergeEntry;

    if (mergeOutcome.report.status === "conflicted") {
      throw new PipelinePauseForHumanError(
        `Merge conflicted for ${groupState.workerGroup.group_id}`,
        {
          groupId: groupState.workerGroup.group_id,
          iteration: executionRun.iteration,
          mergeRef,
        },
      );
    }

    throwIfWaveStopped(stopSignal);
    const validationResult = await this.runValidationStage({
      workerGroup: groupState.workerGroup,
      executionResult: executionRun.executionResult,
      complexityResult: executionRun.complexityResult,
      mergeReport: mergeOutcome.report,
      iteration: executionRun.iteration,
    });
    groupState.validationHistory.push(validationResult);
    groupState.finalValidation = validationResult;

    if (!hasValidationPass(groupState)) {
      await this.artifactStore.appendLog(
        `validation ${validationResult.artifact.status} for ${groupState.workerGroup.group_id} iteration ${executionRun.iteration}`,
      );
      await this.emitPetEvent({
        state: "failed",
        reason: `Validation ${validationResult.artifact.status} for ${groupState.workerGroup.group_id} iteration ${executionRun.iteration}.`,
        scope: petScopeForStage("validation", {
          workerGroup: groupState.workerGroup,
          iteration: executionRun.iteration,
        }),
        durationMs: 3000,
      });
      return;
    }

    throwIfWaveStopped(stopSignal);
    const gradingResult = await this.runTreeRubricsAndGradingStage({
      spec,
      architecture,
      workerGroup: groupState.workerGroup,
      executionResult: executionRun.executionResult,
      iteration: executionRun.iteration,
    });
    groupState.treeGradingFeedbackHistory.push(gradingResult.feedback);
    groupState.finalTreeGradingFeedback = gradingResult.feedback;
    groupState.treeGraderArtifacts = gradingResult.graderArtifacts;
    groupState.finalOutputFiles = gradingResult.finalOutputFiles;

    if (!hasTreeGradingPass(groupState)) {
      await this.emitPetEvent({
        state: "failed",
        reason: `Tree grading failed for ${groupState.workerGroup.group_id} iteration ${executionRun.iteration}.`,
        scope: petScopeForStage("tree-grading", {
          workerGroup: groupState.workerGroup,
          iteration: executionRun.iteration,
        }),
        durationMs: 3000,
      });
    }
  }

  async resolveConflictResolutionEntry(conflictResolution) {
    if (conflictResolution) {
      const mergeReport = await this.artifactStore.readArtifactRef(conflictResolution.merge_report_ref);
      const artifact = validateArtifact("conflict-resolution", conflictResolution, { mergeReport });
      const ref = await this.artifactStore.writeConflictResolution(
        mergeReport.group_id,
        mergeReport.iteration,
        artifact,
      );
      return {
        artifact,
        ref,
      };
    }

    const persistedResolutions = await this.artifactStore.readConflictResolutions();
    if (persistedResolutions.length === 0) {
      throw new Error("No persisted conflict-resolution.json artifact was found");
    }

    return persistedResolutions[persistedResolutions.length - 1];
  }

  async resumeResolvedConflictGroup({
    spec,
    architecture,
    groupState,
    mergeReport,
    conflictResolution,
  }) {
    const existingGrading = findTreeGradingFeedbackForIteration(groupState, mergeReport.iteration);
    if (existingGrading) {
      groupState.finalTreeGradingFeedback = existingGrading;
      return;
    }

    const executionEntry = groupState.executionHistory.find(
      (entry) => entry.artifact.iteration === mergeReport.iteration,
    );
    if (!executionEntry) {
      throw new Error(
        `No execution report found for ${groupState.workerGroup.group_id} iteration ${mergeReport.iteration}`,
      );
    }

    const existingResolvedMerge = groupState.mergeHistory.find(
      (entry) => entry.ref === path.posix.join(
        "merge",
        groupState.workerGroup.group_id,
        `iteration-${mergeReport.iteration}-resolved-merge-report.json`,
      ),
    );
    let resolvedMergeEntry = existingResolvedMerge;

    if (!resolvedMergeEntry) {
      const resolvedResultRef = await this.artifactStore.createWorkspaceSnapshot({
        refPath: path.posix.join(
          "merge",
          groupState.workerGroup.group_id,
          `iteration-${mergeReport.iteration}-resolved-result.json`,
        ),
        snapshotName: `${groupState.workerGroup.group_id}-iteration-${mergeReport.iteration}-resolved-result`,
        metadata: {
          group_id: groupState.workerGroup.group_id,
          iteration: mergeReport.iteration,
          resolution_ref: conflictResolution.ref,
        },
      });
      const resolvedMergeArtifact = {
        version: "1.0",
        group_id: mergeReport.group_id,
        iteration: mergeReport.iteration,
        base_ref: mergeReport.base_ref,
        mainline_ref: mergeReport.mainline_ref,
        proposal_ref: mergeReport.proposal_ref,
        result_ref: resolvedResultRef,
        status: "merged",
        conflicts: [],
      };
      const resolvedMergeRef = await this.artifactStore.writeResolvedMergeReport(
        groupState.workerGroup.group_id,
        mergeReport.iteration,
        resolvedMergeArtifact,
      );
      resolvedMergeEntry = {
        artifact: resolvedMergeArtifact,
        ref: resolvedMergeRef,
      };
      groupState.mergeHistory.push(resolvedMergeEntry);
    }

    groupState.finalMerge = resolvedMergeEntry;
    const complexityEntry = findComplexityForIteration(groupState, mergeReport.iteration);
    groupState.finalComplexity = complexityEntry ?? groupState.finalComplexity;
    let validationEntry = findValidationForIteration(groupState, mergeReport.iteration);
    if (!validationEntry) {
      validationEntry = await this.runValidationStage({
        workerGroup: groupState.workerGroup,
        executionResult: executionEntry,
        complexityResult: complexityEntry,
        mergeReport: resolvedMergeEntry.artifact,
        iteration: mergeReport.iteration,
        conflictResolution: conflictResolution.artifact,
      });
      groupState.validationHistory.push(validationEntry);
    }

    groupState.finalValidation = validationEntry;
    if (!hasValidationPass(groupState)) {
      await this.artifactStore.appendLog(
        `validation ${validationEntry.artifact.status} for ${groupState.workerGroup.group_id} iteration ${mergeReport.iteration}`,
      );
      await this.emitPetEvent({
        state: "failed",
        reason: `Validation ${validationEntry.artifact.status} after conflict resolution for ${groupState.workerGroup.group_id}.`,
        scope: petScopeForStage("validation", {
          workerGroup: groupState.workerGroup,
          iteration: mergeReport.iteration,
        }),
        durationMs: 3000,
      });
      return;
    }

    const gradingResult = await this.runTreeRubricsAndGradingStage({
      spec,
      architecture,
      workerGroup: groupState.workerGroup,
      executionResult: executionEntry,
      iteration: mergeReport.iteration,
    });
    groupState.treeGradingFeedbackHistory.push(gradingResult.feedback);
    groupState.finalTreeGradingFeedback = gradingResult.feedback;
    groupState.treeGraderArtifacts = gradingResult.graderArtifacts;
    groupState.finalOutputFiles = gradingResult.finalOutputFiles;

    if (!hasTreeGradingPass(groupState)) {
      await this.emitPetEvent({
        state: "failed",
        reason: `Tree grading failed after conflict resolution for ${groupState.workerGroup.group_id}.`,
        scope: petScopeForStage("tree-grading", {
          workerGroup: groupState.workerGroup,
          iteration: mergeReport.iteration,
        }),
        durationMs: 3000,
      });
    }
  }

  async createFinalOutputFiles({ workerGroup, executionResult, iteration }) {
    const outputPaths = uniqueStrings([
      ...(executionResult.artifact.changed_files ?? []),
      ...(workerGroup.owned_files ?? []),
    ]).sort();
    const files = [];

    for (const filePath of outputPaths) {
      const absolutePath = path.resolve(this.repoRoot, filePath);
      const repoRootWithSeparator = `${path.resolve(this.repoRoot)}${path.sep}`;
      if (!absolutePath.startsWith(repoRootWithSeparator)) {
        files.push({
          path: filePath,
          status: "deleted",
          content: null,
        });
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        const content = stat.isDirectory()
          ? "[directory omitted from final output snapshot]"
          : await fs.readFile(absolutePath, "utf8");
        files.push({
          path: filePath,
          status: "present",
          content,
        });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }

        files.push({
          path: filePath,
          status: "deleted",
          content: null,
        });
      }
    }

    const artifact = validateArtifact("final-output-files", {
      version: "1.0",
      group_id: workerGroup.group_id,
      iteration,
      files,
    }, { workerGroup });
    const ref = await this.artifactStore.writeFinalOutputFiles(
      workerGroup.group_id,
      iteration,
      artifact,
    );

    return {
      artifact,
      ref,
    };
  }

  async runTreeRubricsAndGradingStage({ spec, architecture, workerGroup, executionResult, iteration }) {
    const classification = await this.runSubagentStage(
      "tree-classification",
      {
        spec,
        architecture,
        workerGroup,
        iteration,
      },
      { workerGroup },
    );
    const classificationRef = await this.artifactStore.writeTreeClassification(
      workerGroup.group_id,
      iteration,
      classification.artifact,
    );

    const treeRubrics = await this.runSubagentStage(
      "tree-rubric-generation",
      {
        spec,
        architecture,
        workerGroup,
        classification: classification.artifact,
        iteration,
      },
      { workerGroup },
    );
    const treeRubricsRef = await this.artifactStore.writeTreeRubrics(
      workerGroup.group_id,
      iteration,
      treeRubrics.artifact,
    );

    const verification = await this.runSubagentStage(
      "tree-rubric-verification",
      {
        spec,
        workerGroup,
        classification: classification.artifact,
        treeRubrics: treeRubrics.artifact,
        iteration,
      },
      { workerGroup },
    );
    const verificationRef = await this.artifactStore.writeTreeRubricVerification(
      workerGroup.group_id,
      iteration,
      verification.artifact,
    );

    const refinedRubrics = await this.runSubagentStage(
      "tree-rubric-refinement",
      {
        spec,
        workerGroup,
        classification: classification.artifact,
        treeRubrics: treeRubrics.artifact,
        validationResult: verification.artifact,
        iteration,
      },
      { workerGroup },
    );
    const refinedRubricsRef = await this.artifactStore.writeRefinedTreeRubrics(
      workerGroup.group_id,
      iteration,
      refinedRubrics.artifact,
    );

    const finalOutputFiles = await this.createFinalOutputFiles({
      workerGroup,
      executionResult,
      iteration,
    });

    const graderRuns = await this.subagentSlots.run(this.graderCount, async () => {
      const settledGraderRuns = await Promise.allSettled(
        Array.from({ length: this.graderCount }, (_, index) =>
          this.runStage(
            "tree-grading",
            {
              spec,
              workerGroup,
              treeRubrics: refinedRubrics.artifact,
              finalOutputFiles: finalOutputFiles.artifact,
              graderId: index + 1,
              iteration,
            },
            {
              rubric: refinedRubrics.artifact,
              finalOutputFiles: finalOutputFiles.artifact,
            },
          ),
        ),
      );
      const rejectedRun = settledGraderRuns.find((result) => result.status === "rejected");
      if (rejectedRun) {
        throw rejectedRun.reason;
      }

      return settledGraderRuns.map((result) => result.value);
    });

    const graderArtifacts = [];
    for (const graderRun of graderRuns) {
      const graderRef = await this.artifactStore.writeTreeGraderOutput(
        workerGroup.group_id,
        iteration,
        graderRun.artifact.grader_id,
        graderRun.artifact,
      );
      graderArtifacts.push({
        ...graderRun.artifact,
        ref: graderRef,
      });
    }

    const feedbackArtifact = aggregateTreeGradingFeedback({
      threshold: this.gradingThreshold,
      requireDepthOnePass: this.requireDepthOnePass,
      rubric: refinedRubrics.artifact,
      graderResults: graderRuns.map((graderRun) => graderRun.artifact),
      iteration,
    });
    const feedbackRef = await this.artifactStore.writeTreeGradingFeedback(
      workerGroup.group_id,
      iteration,
      feedbackArtifact,
    );

    return {
      classification: { ...classification, ref: classificationRef },
      treeRubrics: { ...treeRubrics, ref: treeRubricsRef },
      verification: { ...verification, ref: verificationRef },
      refinedRubrics: { ...refinedRubrics, ref: refinedRubricsRef },
      finalOutputFiles,
      graderArtifacts,
      feedback: {
        artifact: feedbackArtifact,
        ref: feedbackRef,
      },
    };
  }

  async runValidationStage({
    workerGroup,
    executionResult,
    complexityResult = null,
    mergeReport,
    iteration,
    conflictResolution = null,
  }) {
    const validationResult = await this.runSubagentStage(
      "validation",
      {
        workerGroup,
        executionReport: executionResult.artifact,
        complexityReport: complexityResult?.artifact ?? null,
        mergeReport,
        conflictResolution,
        iteration,
      },
      {
        workerGroup,
      },
    );
    const ref = await this.artifactStore.writeValidationReport(
      workerGroup.group_id,
      iteration,
      validationResult.artifact,
    );

    return {
      ...validationResult,
      ref,
      workerGroup,
    };
  }

  async runQaStage({
    spec,
    architecture,
    workerGroup,
    executionResult,
    validationResult,
    mergeResult,
    treeGradingFeedback,
    complexityResult = null,
  }) {
    const qaResult = await this.runSubagentStage("qa", {
      spec,
      architecture,
      workerGroup,
      executionReport: executionResult.artifact,
      complexityReport: complexityResult?.artifact ?? null,
      validationReport: validationResult.artifact,
      mergeReport: mergeResult.artifact,
      treeGradingFeedback: treeGradingFeedback.artifact,
      iteration: executionResult.artifact.iteration,
    });
    const ref = await this.artifactStore.writeQaReport(
      workerGroup.group_id,
      executionResult.artifact.iteration,
      qaResult.artifact,
    );

    return {
      ...qaResult,
      ref,
      workerGroup,
    };
  }

  async runDocStage({ runId, spec, architecture, executionResults, complexityReports }) {
    const docResult = await this.runStage("doc", {
      spec,
      architecture,
      executionReports: executionResults,
      complexityReports,
    });
    await this.artifactStore.writeRootArtifact("doc-report", docResult.artifact);

    if (docResult.artifact.status === "updated") {
      if (!docResult.stageExecution.proposal) {
        throw new StageExecutionError("doc", "documentation stage returned no proposal metadata");
      }

      const baseRef = await this.artifactStore.createWorkspaceSnapshot({
        refPath: path.posix.join("merge", "DOCS", "iteration-1-base.json"),
        snapshotName: "docs-iteration-1-base",
      });
      const mergeOutcome = await this.mergeEngine.mergeProposal({
        groupId: "DOCS",
        iteration: 1,
        baseRef,
        proposal: docResult.stageExecution.proposal,
        changedFiles: docResult.artifact.updated_files,
      });
      await this.artifactStore.writeMergeReport("DOCS", 1, mergeOutcome.report);

      if (mergeOutcome.report.status === "conflicted") {
        throw new PipelinePauseForHumanError("Documentation merge conflicted", {
          groupId: "DOCS",
          iteration: 1,
        });
      }

      await this.runGitPublication("doc", {
        runId,
        spec,
        updatedFiles: docResult.artifact.updated_files,
      });
    }

    return docResult.artifact;
  }

  async runFinalAssessmentStage({
    spec,
    plan,
    architecture,
    dispatch,
    executionReports,
    mergeReports,
    validationReports,
    complexityReports,
    conflictResolutions,
    treeGradingFeedbacks,
    qaReports,
    docReport,
    previousAssessments,
  }) {
    const result = await this.runStage("final-assessment", {
      spec,
      plan,
      architecture,
      dispatch,
      executionReports,
      mergeReports,
      validationReports,
      complexityReports,
      conflictResolutions,
      treeGradingFeedbacks,
      qaReports,
      docReport,
      previousAssessments,
    });
    await this.artifactStore.writeRootArtifact("final-assessment", result.artifact);
    await this.artifactStore.writeAssessmentHistory(result.artifact.iteration, result.artifact);
    return result.artifact;
  }
}
