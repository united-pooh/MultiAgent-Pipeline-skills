import path from "node:path";

import { ArtifactStore } from "./artifact-store.js";
import { DEFAULT_REVIEW_MODE } from "./constants.js";
import { extractSingleJsonBlock, validateArtifact } from "./contracts.js";
import {
  ContractValidationError,
  PipelinePauseForHumanError,
  PipelineRejectedError,
  StageExecutionError,
} from "./errors.js";
import { MergeEngine } from "./merge-engine.js";
import { aggregateReviewFeedback } from "./review-feedback.js";
import { loadStageCatalog } from "./stage-catalog.js";
import { nowIso, sanitizeForPath, uniqueStrings } from "./utils.js";

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
    mergeHistory: [],
    validationHistory: [],
    reviewFeedbackHistory: [],
    reviewerArtifacts: [],
    finalExecution: null,
    finalMerge: null,
    finalValidation: null,
    finalReviewFeedback: null,
    qaResult: null,
  };
}

function latestEntry(entries) {
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function latestMergeEntry(state) {
  return state.finalMerge ?? latestEntry(state.mergeHistory);
}

function latestReviewEntry(state) {
  return state.finalReviewFeedback ?? latestEntry(state.reviewFeedbackHistory);
}

function hasReviewPass(state) {
  return latestReviewEntry(state)?.artifact?.verdict === "pass";
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

function latestFailedReviewFeedback(state) {
  const latestFeedback = latestReviewEntry(state)?.artifact ?? null;
  return latestFeedback?.verdict === "fail" ? latestFeedback : null;
}

function latestFailedValidationReport(state) {
  const latestValidation = latestValidationEntry(state)?.artifact ?? null;
  return ["failed", "error"].includes(latestValidation?.status) ? latestValidation : null;
}

function nextExecutionIteration(state) {
  const latestExecutionIteration = latestEntry(state.executionHistory)?.artifact?.iteration ?? 0;
  const latestMergeIteration = latestEntry(state.mergeHistory)?.artifact?.iteration ?? 0;
  const latestValidationIteration = latestEntry(state.validationHistory)?.artifact?.iteration ?? 0;
  const latestReviewIteration = latestEntry(state.reviewFeedbackHistory)?.artifact?.iteration ?? 0;
  return Math.max(
    latestExecutionIteration,
    latestMergeIteration,
    latestValidationIteration,
    latestReviewIteration,
  ) + 1;
}

function findReviewFeedbackForIteration(state, iteration) {
  for (let index = state.reviewFeedbackHistory.length - 1; index >= 0; index -= 1) {
    const entry = state.reviewFeedbackHistory[index];
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

function buildSkillUsageSummary({ spec, plan, dispatch, groupStates, finalAssessment }) {
  if (finalAssessment?.skill_usage_summary) {
    return finalAssessment.skill_usage_summary;
  }

  const summary = [];

  if (spec) {
    summary.push({
      scope: "spec",
      required_skills: ["superpowers"],
      applied_skills: spec.applied_skills,
      issues: skillIssues(["superpowers"], spec.applied_skills),
    });
  }

  if (plan) {
    summary.push({
      scope: "plan",
      required_skills: ["superpowers"],
      applied_skills: plan.applied_skills,
      issues: skillIssues(["superpowers"], plan.applied_skills),
    });
  }

  if (!dispatch) {
    return summary;
  }

  dispatch.worker_groups.forEach((group) => {
    if ((group.required_skills ?? []).length === 0) {
      return;
    }

    const state = groupStates.get(group.group_id);
    const executionSkills = state?.finalExecution?.artifact?.applied_skills ?? [];
    const reviewSkills = uniqueStrings(
      (state?.reviewerArtifacts ?? []).flatMap((artifact) => artifact.applied_skills ?? []),
    );

    summary.push({
      scope: `${group.group_id}/execution`,
      required_skills: group.required_skills,
      applied_skills: executionSkills,
      issues: skillIssues(group.required_skills, executionSkills),
    });
    summary.push({
      scope: `${group.group_id}/review`,
      required_skills: group.required_skills,
      applied_skills: reviewSkills,
      issues: skillIssues(group.required_skills, reviewSkills),
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
    cleanup_summary: {
      deleted_workspace: deletedWorkspace,
      deleted_paths: deletedWorkspace ? [".pipeline-workspace"] : [],
      retained_file: ".pipeline-last-run-summary.json",
    },
  };
}

export class PipelineOrchestrator {
  constructor({
    repoRoot,
    stageRunner,
    reviewMode = DEFAULT_REVIEW_MODE,
    maxStageRetries = 2,
    clock = () => new Date(),
    artifactStore = null,
    stageCatalog = null,
    mergeEngine = null,
  }) {
    if (!repoRoot) {
      throw new Error("PipelineOrchestrator requires repoRoot");
    }

    if (!stageRunner?.runStage) {
      throw new Error("PipelineOrchestrator requires a stageRunner with runStage(request)");
    }

    this.repoRoot = repoRoot;
    this.stageRunner = stageRunner;
    this.reviewMode = reviewMode;
    this.maxStageRetries = maxStageRetries;
    this.clock = clock;
    this.artifactStore = artifactStore ?? new ArtifactStore({ repoRoot, clock });
    this.stageCatalog = stageCatalog ?? loadStageCatalog(repoRoot);
    this.mergeEngine = mergeEngine ?? new MergeEngine({ repoRoot, artifactStore: this.artifactStore });
  }

  async run({ request, runId = `RUN-${nowIso(this.clock).replace(/[-:.TZ]/g, "").slice(0, 14)}` }) {
    if (typeof request !== "string" || request.trim() === "") {
      throw new Error("run() requires a non-empty request string");
    }

    await this.artifactStore.initializeRun();
    await this.artifactStore.appendLog(`run ${runId} started`);

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
      state.mergeHistory = await this.artifactStore.readGroupMergeHistory(workerGroup.group_id);
      state.validationHistory = await this.artifactStore.readGroupValidationReports(workerGroup.group_id);
      state.reviewFeedbackHistory = await this.artifactStore.readGroupReviewFeedbackHistory(
        workerGroup.group_id,
      );
      state.finalExecution = latestEntry(state.executionHistory);
      state.finalMerge = latestEntry(state.mergeHistory);
      state.finalValidation = latestEntry(state.validationHistory);
      state.finalReviewFeedback = latestEntry(state.reviewFeedbackHistory);
      state.qaResult = latestEntry(await this.artifactStore.readGroupQaReports(workerGroup.group_id));

      const latestReviewIteration = state.finalReviewFeedback?.artifact?.iteration ?? null;
      state.reviewerArtifacts = latestReviewIteration === null
        ? []
        : (await this.artifactStore.readGroupReviewerOutputs(workerGroup.group_id, {
            iteration: latestReviewIteration,
          })).map((entry) => entry.artifact);

      groupStates.set(workerGroup.group_id, state);
    }

    return groupStates;
  }

  async continueFromDispatch({ spec, plan, architecture, dispatch, groupStates }) {
    for (const wave of dispatch.execution_waves) {
      await this.artifactStore.appendLog(`wave ${wave.wave} processing ${wave.groups.join(", ")}`);
      const waveStates = wave.groups.map((groupId) => {
        const state = groupStates.get(groupId);
        if (!state) {
          throw new Error(`Missing group state for ${groupId}`);
        }

        return state;
      });

      while (waveStates.some((state) => !hasReviewPass(state))) {
        const executionRuns = await Promise.all(
          waveStates
            .filter((state) => !hasReviewPass(state))
            .map((state) =>
              this.runExecutionPass({
                spec,
                plan,
                architecture,
                groupState: state,
                wave,
              }),
            ),
        );
        const executionByGroup = new Map(
          executionRuns.map((executionRun) => [
            executionRun.groupState.workerGroup.group_id,
            executionRun,
          ]),
        );

        for (const groupId of wave.groups) {
          const executionRun = executionByGroup.get(groupId);
          if (!executionRun) {
            continue;
          }

          await this.integrateAndReviewExecutionPass({
            spec,
            architecture,
            groupState: executionRun.groupState,
            executionRun,
          });
        }
      }

      const qaStates = waveStates.filter((state) => !hasQaPass(state));
      if (qaStates.length > 0) {
        const qaRuns = await Promise.allSettled(
          qaStates.map((state) =>
            this.runQaStage({
              spec,
              architecture,
              workerGroup: state.workerGroup,
              executionResult: state.finalExecution,
              validationResult: state.finalValidation,
              mergeResult: state.finalMerge,
              reviewFeedback: state.finalReviewFeedback,
            }),
          ),
        );

        let firstQaError = null;
        qaRuns.forEach((qaRun, index) => {
          if (qaRun.status === "fulfilled") {
            qaStates[index].qaResult = qaRun.value;
            return;
          }

          if (!firstQaError) {
            firstQaError = qaRun.reason;
          }
        });

        if (firstQaError) {
          throw firstQaError;
        }
      }
    }

    const docReport = await this.runDocStage({
      spec,
      architecture,
      executionResults: [...groupStates.values()].map((state) => state.finalExecution.artifact),
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
      conflictResolutions,
      reviewFeedbacks: [...groupStates.values()].flatMap((state) =>
        state.reviewFeedbackHistory.map((entry) => entry.artifact),
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

  async finishRun({ runId, spec, plan, dispatch, groupStates, finalAssessment }) {
    const skillUsageSummary = buildSkillUsageSummary({
      spec,
      plan,
      dispatch,
      groupStates,
      finalAssessment,
    });
    const shouldDeleteWorkspace = finalAssessment.verdict === "accept";
    const summary = buildRunSummary({
      runId,
      verdict: finalAssessment.verdict,
      restartFrom: finalAssessment.restart_from,
      skillUsageSummary,
      groupStates,
      deletedWorkspace: shouldDeleteWorkspace,
      clock: this.clock,
    });
    await this.artifactStore.writeRunSummary(summary);

    if (shouldDeleteWorkspace) {
      await this.artifactStore.cleanupWorkspace();
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
    const summary = buildRunSummary({
      runId,
      verdict,
      restartFrom: error.restartFrom,
      skillUsageSummary,
      groupStates,
      deletedWorkspace: false,
      clock: this.clock,
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

  async runRootStage(stage, context, validationContext = {}) {
    const result = await this.runStage(stage, context, validationContext);
    await this.artifactStore.writeRootArtifact(stage === "doc" ? "doc-report" : stage, result.artifact);
    return result.artifact;
  }

  async runStage(stage, context, validationContext = {}) {
    const artifactType = artifactTypeForStage(stage);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxStageRetries + 1; attempt += 1) {
      try {
        const request = await this.stageCatalog.buildStageRequest(stage, {
          ...context,
          reviewMode: context.reviewMode ?? this.reviewMode,
          attempt,
        });
        const stageExecution = await this.stageRunner.runStage(request);
        const artifact = this.normalizeStageArtifact(stageExecution, artifactType, validationContext);
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

  normalizeStageArtifact(stageExecution, artifactType, validationContext) {
    if (!stageExecution || typeof stageExecution !== "object") {
      throw new ContractValidationError(artifactType, "stage execution result must be an object");
    }

    const payload =
      stageExecution.artifact !== undefined
        ? stageExecution.artifact
        : extractSingleJsonBlock(stageExecution.rawOutput);
    return validateArtifact(artifactType, payload, validationContext);
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

  async runExecutionPass({ spec, plan, architecture, groupState, wave }) {
    const iteration = nextExecutionIteration(groupState);
    const baseRef = await this.createBaseRef({
      wave: wave.wave,
      groupId: groupState.workerGroup.group_id,
      iteration,
    });
    const executionResult = await this.runStage(
      "execution",
      {
        spec,
        plan,
        architecture,
        workerGroup: groupState.workerGroup,
        baseRef,
        iteration,
        reviewFeedback: latestFailedReviewFeedback(groupState),
        validationReport: latestFailedValidationReport(groupState),
      },
      {
        requiredSkills: groupState.workerGroup.required_skills,
      },
    );

    if (executionResult.artifact.status === "blocked") {
      throw new PipelineRejectedError(
        `Execution blocked for ${groupState.workerGroup.group_id}: ${executionResult.artifact.blockers.join("; ")}`,
        { restartFrom: "execution" },
      );
    }

    if (!executionResult.stageExecution.proposal) {
      throw new StageExecutionError(
        "execution",
        `${groupState.workerGroup.group_id} execution returned no merge proposal metadata`,
      );
    }

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

    return {
      groupState,
      iteration,
      baseRef,
      executionResult: persistedExecution,
    };
  }

  async integrateAndReviewExecutionPass({ spec, architecture, groupState, executionRun }) {
    const mergeOutcome = await this.mergeEngine.mergeProposal({
      groupId: groupState.workerGroup.group_id,
      iteration: executionRun.iteration,
      baseRef: executionRun.baseRef,
      proposal: executionRun.executionResult.stageExecution.proposal,
      changedFiles: executionRun.executionResult.artifact.changed_files,
    });
    const mergeRef = await this.artifactStore.writeMergeReport(
      groupState.workerGroup.group_id,
      executionRun.iteration,
      mergeOutcome.report,
    );
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

    const validationResult = await this.runValidationStage({
      workerGroup: groupState.workerGroup,
      executionResult: executionRun.executionResult,
      mergeReport: mergeOutcome.report,
      iteration: executionRun.iteration,
    });
    groupState.validationHistory.push(validationResult);
    groupState.finalValidation = validationResult;

    if (!hasValidationPass(groupState)) {
      await this.artifactStore.appendLog(
        `validation ${validationResult.artifact.status} for ${groupState.workerGroup.group_id} iteration ${executionRun.iteration}`,
      );
      return;
    }

    const reviewResult = await this.runReviewStage({
      spec,
      architecture,
      workerGroup: groupState.workerGroup,
      executionResult: executionRun.executionResult,
      mergeReport: mergeOutcome.report,
      validationReport: validationResult.artifact,
      iteration: executionRun.iteration,
    });
    groupState.reviewFeedbackHistory.push(reviewResult.feedback);
    groupState.finalReviewFeedback = reviewResult.feedback;
    groupState.reviewerArtifacts = reviewResult.reviewerArtifacts;
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
    const existingReview = findReviewFeedbackForIteration(groupState, mergeReport.iteration);
    if (existingReview) {
      groupState.finalReviewFeedback = existingReview;
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
    let validationEntry = findValidationForIteration(groupState, mergeReport.iteration);
    if (!validationEntry) {
      validationEntry = await this.runValidationStage({
        workerGroup: groupState.workerGroup,
        executionResult: executionEntry,
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
      return;
    }

    const reviewResult = await this.runReviewStage({
      spec,
      architecture,
      workerGroup: groupState.workerGroup,
      executionResult: executionEntry,
      mergeReport: resolvedMergeEntry.artifact,
      validationReport: validationEntry.artifact,
      iteration: mergeReport.iteration,
      conflictResolution: conflictResolution.artifact,
    });
    groupState.reviewFeedbackHistory.push(reviewResult.feedback);
    groupState.finalReviewFeedback = reviewResult.feedback;
    groupState.reviewerArtifacts = reviewResult.reviewerArtifacts;
  }

  async runReviewStage({
    spec,
    architecture,
    workerGroup,
    executionResult,
    mergeReport,
    validationReport,
    iteration,
    conflictResolution = null,
  }) {
    const reviewerCount = this.reviewMode === "PRE" ? 1 : 3;
    const reviewRuns = await Promise.all(
      Array.from({ length: reviewerCount }, (_, index) =>
        this.runStage(
          "review",
          {
            spec,
            architecture,
            workerGroup,
            executionReport: executionResult.artifact,
            mergeReport,
            validationReport,
            conflictResolution,
            reviewerId: index + 1,
            iteration,
            reviewMode: this.reviewMode,
          },
          {
            requiredSkills: workerGroup.required_skills,
          },
        ),
      ),
    );

    const reviewerArtifacts = [];
    for (const reviewRun of reviewRuns) {
      const reviewerRef = await this.artifactStore.writeReviewerOutput(
        workerGroup.group_id,
        iteration,
        reviewRun.artifact.reviewer_id,
        reviewRun.artifact,
      );
      reviewerArtifacts.push({
        ...reviewRun.artifact,
        ref: reviewerRef,
      });
    }

    const feedbackArtifact = aggregateReviewFeedback({
      mode: this.reviewMode,
      iteration,
      reviews: reviewRuns.map((reviewRun) => reviewRun.artifact),
    });
    const feedbackRef = await this.artifactStore.writeReviewFeedback(
      workerGroup.group_id,
      iteration,
      feedbackArtifact,
    );

    return {
      reviewerArtifacts,
      feedback: {
        artifact: feedbackArtifact,
        ref: feedbackRef,
      },
    };
  }

  async runValidationStage({
    workerGroup,
    executionResult,
    mergeReport,
    iteration,
    conflictResolution = null,
  }) {
    const validationResult = await this.runStage(
      "validation",
      {
        workerGroup,
        executionReport: executionResult.artifact,
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
    reviewFeedback,
  }) {
    const qaResult = await this.runStage("qa", {
      spec,
      architecture,
      workerGroup,
      executionReport: executionResult.artifact,
      validationReport: validationResult.artifact,
      mergeReport: mergeResult.artifact,
      reviewFeedback: reviewFeedback.artifact,
      iteration: executionResult.artifact.iteration,
    });
    const ref = await this.artifactStore.writeQaReport(
      workerGroup.group_id,
      executionResult.artifact.iteration,
      qaResult.artifact,
    );

    if (qaResult.artifact.status === "fail") {
      throw new PipelineRejectedError(
        `QA failed for ${workerGroup.group_id}: ${qaResult.artifact.blocking_issues.join("; ")}`,
        { restartFrom: "execution" },
      );
    }

    return {
      ...qaResult,
      ref,
      workerGroup,
    };
  }

  async runDocStage({ spec, architecture, executionResults }) {
    const docResult = await this.runStage("doc", {
      spec,
      architecture,
      executionReports: executionResults,
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
    conflictResolutions,
    reviewFeedbacks,
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
      conflictResolutions,
      reviewFeedbacks,
      qaReports,
      docReport,
      previousAssessments,
    });
    await this.artifactStore.writeRootArtifact("final-assessment", result.artifact);
    await this.artifactStore.writeAssessmentHistory(result.artifact.iteration, result.artifact);
    return result.artifact;
  }
}
