import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ArtifactStore,
  CODEX_PET_STATES,
  DEFAULT_ORCHESTRATOR_WRITE_AUTHORITY,
  DEFAULT_OPENCODE_EXPERT_STAGE_PROFILES,
  DEFAULT_STAGE_WRITE_AUTHORITY,
  MergeEngine,
  PipelineOrchestrator,
  aggregateReviewFeedback,
  aggregateTreeGradingFeedback,
  createCodexPetEvent,
  formatConventionalGitmojiCommitMessage,
  loadStageCatalog,
  runComplexityHook,
  validateArtifact,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureSourceRoot = path.resolve(__dirname, "..");

const PRE_CRITERIA = [
  "Correctness",
  "Security",
  "Performance",
  "Error Handling",
  "Code Quality",
  "Architecture Compliance",
  "Test Coverage",
  "Backward Compatibility",
];

function jsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSpecArtifact() {
  return {
    version: "1.0",
    applied_skills: [],
    feature_name: "Add orchestrator runtime",
    objective: "Implement the orchestrator runtime skeleton for the multi-agent pipeline.",
    requirements: [
      {
        id: "REQ-001",
        description: "Add runtime orchestration code for the documented pipeline.",
        priority: "must-have",
        acceptance_criteria: [
          "Pipeline stages can be scheduled end-to-end by runtime code.",
        ],
      },
    ],
    constraints: ["Keep prompt strategy in docs rather than hardcoding it in runtime logic."],
    out_of_scope: ["Implementing actual Codex tool calls inside the runtime library."],
    assumptions: ["A stage runner adapter will provide proposal metadata for mergeable stages."],
    input_type: "natural_language",
    original_input_summary: "补上 orchestrator skeleton 的runtime 代码",
  };
}

function makePlanArtifact(taskIds = ["TASK-001"], targetFiles = ["src/app.txt"]) {
  return {
    version: "1.0",
    applied_skills: [],
    spec_ref: "spec.json",
    phases: [
      {
        id: "PHASE-1",
        name: "Runtime implementation",
        tasks: taskIds.map((taskId, index) => ({
          id: taskId,
          description: `Implement ${taskId}.`,
          depends_on: index === 0 ? [] : [taskIds[index - 1]],
          estimated_complexity: "medium",
          target_files: [targetFiles[index] ?? targetFiles[0]],
        })),
      },
    ],
    execution_order: taskIds,
    risk_items: ["Merge behavior must stay conservative when worker proposals diverge."],
  };
}

function makeArchitectureArtifact(proposedChanges = [
  {
    target: "src/app.txt",
    change_type: "create",
    description: "Add the orchestrator state machine.",
    concerns: [],
  },
]) {
  return {
    version: "1.0",
    spec_ref: "spec.json",
    plan_ref: "plan.json",
    codebase_analysis: {
      relevant_modules: ["src/runtime", "agents", "references"],
      current_patterns: ["markdown-driven stage instructions", "artifact-based contracts"],
      tech_debt: ["runtime implementation is missing"],
    },
    decision: "incremental",
    decision_rationale: "The repo already defines contracts and prompts, so runtime can layer on top.",
    proposed_changes: proposedChanges,
    dependency_changes: [],
    feasibility: "feasible",
    infeasibility_reason: null,
    rollback_notes: null,
  };
}

function makeDispatchArtifact(workerGroups, executionWaves = [{ wave: 1, groups: workerGroups.map((group) => group.group_id) }]) {
  return {
    version: "1.0",
    spec_ref: "spec.json",
    plan_ref: "plan.json",
    architecture_ref: "architecture.json",
    worker_groups: workerGroups,
    execution_waves: executionWaves,
    integration_strategy: {
      merge_mode: "three_way",
      conflict_policy: "pause_for_human",
      base_strategy: "wave_start_snapshot",
    },
    rationale: "Grouping is deterministic for the test fixture.",
  };
}

function makeExecutionArtifact({ groupId, iteration, baseRef, changedFiles, proposalRef, followUpNotes = [] }) {
  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    base_ref: baseRef,
    proposal_ref: proposalRef,
    applied_skills: [],
    status: "implemented",
    changed_files: changedFiles,
    requirements_covered: ["REQ-001"],
    frontend_design_summary: null,
    tests_run: [
      {
        command: "node --test",
        status: "passed",
        details: "Mocked worker verification passed.",
      },
    ],
    follow_up_notes: followUpNotes,
    blockers: [],
  };
}

function makePreResults({ failingCriterion = null, warningCriterion = null, evidence = "src/app.txt:1" } = {}) {
  return PRE_CRITERIA.map((criterion) => {
    if (criterion === failingCriterion) {
      return {
        criterion,
        score: "fail",
        evidence,
        suggestion: `Fix ${criterion}.`,
      };
    }

    if (criterion === warningCriterion) {
      return {
        criterion,
        score: "warning",
        evidence,
        suggestion: `Review ${criterion}.`,
      };
    }

    return {
      criterion,
      score: "pass",
      evidence,
      suggestion: null,
    };
  });
}

function makeReviewArtifact(reviewerId, options = {}) {
  return {
    version: "1.0",
    reviewer_id: reviewerId,
    applied_skills: [],
    pre_results: makePreResults(options),
    frontend_design_assessment: null,
  };
}

function makeTreeClassification(groupId = "GROUP-1") {
  return {
    version: "1.0",
    task_id: `${groupId}-task`,
    group_id: groupId,
    task_type: "code_implementation",
    depth_enhancement_applicable: true,
    recommended_branches: [
      {
        name: "功能正确性",
        name_en: "Correctness",
        rationale: "The final output must implement the requested behavior.",
      },
      {
        name: "可维护性",
        name_en: "Maintainability",
        rationale: "The final output should stay understandable.",
      },
    ],
    summary: "Code implementation task with two independent grading branches.",
  };
}

function makeTreeRubrics(groupId = "GROUP-1", outputFile = "src/app.txt") {
  return {
    version: "1.0",
    task_id: `${groupId}-task`,
    group_id: groupId,
    task_type: "code_implementation",
    branches: [
      {
        name: "功能正确性",
        name_en: "Correctness",
        nodes: [
          {
            depth: 1,
            id: "B1-D1-01",
            content: "最终输出文件包含实现所需功能的代码或文本。",
            source: "KEEP_01",
            requirement_ids: ["REQ-001"],
            output_file_hints: [outputFile],
          },
          {
            depth: 2,
            id: "B1-D2-01",
            content: "最终输出以可复用方式表达该功能，而不是只留下占位内容。",
            source: "DEEPEN",
            requirement_ids: ["REQ-001"],
            output_file_hints: [outputFile],
          },
        ],
      },
      {
        name: "可维护性",
        name_en: "Maintainability",
        nodes: [
          {
            depth: 1,
            id: "B2-D1-01",
            content: "最终输出文件保持清晰、可读、没有明显破坏性内容。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: [outputFile],
          },
        ],
      },
    ],
  };
}

function makeTreeVerification(groupId = "GROUP-1") {
  return {
    version: "1.0",
    task_id: `${groupId}-task`,
    group_id: groupId,
    status: "pass",
    dimension_results: [
      "Core Criteria Preservation",
      "Added Criteria Justification",
      "Breadth And Depth Correctness",
      "Depth Discrimination",
      "Node Count And Coverage",
      "End-To-End Compliance",
      "Depth Enhancement Quality",
    ].map((dimension) => ({
      dimension,
      status: "pass",
      evidence: `${dimension} verified from task requirements.`,
      suggestion: null,
    })),
    required_changes: [],
    summary: "Rubric is ready for refinement without changes.",
  };
}

function makeTreeGradingArtifact({
  graderId,
  groupId = "GROUP-1",
  iteration = 1,
  rubric = makeTreeRubrics(groupId),
  failingNodeIds = [],
  evidenceFile = "src/app.txt",
}) {
  const failing = new Set(failingNodeIds);
  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    grader_id: graderId,
    task_id: rubric.task_id,
    node_results: rubric.branches.flatMap((branch) =>
      branch.nodes.map((node) => ({
        node_id: node.id,
        raw_score: failing.has(node.id) ? 0 : 1,
        evidence: `${evidenceFile}:1 shows the final output content used for grading.`,
        failure_reason: failing.has(node.id) ? `${node.id} is not satisfied.` : null,
        suggestion: failing.has(node.id) ? `Update ${evidenceFile} to satisfy ${node.id}.` : null,
      })),
    ),
  };
}

function makeTreeStageResponses({
  groupId = "GROUP-1",
  iteration = 1,
  outputFile = "src/app.txt",
  failingNodeIds = [],
} = {}) {
  const rubric = makeTreeRubrics(groupId, outputFile);
  return {
    [`tree-classification:${groupId}:iteration-${iteration}`]: {
      rawOutput: jsonBlock(makeTreeClassification(groupId)),
    },
    [`tree-rubric-generation:${groupId}:iteration-${iteration}`]: {
      rawOutput: jsonBlock(rubric),
    },
    [`tree-rubric-verification:${groupId}:iteration-${iteration}`]: {
      rawOutput: jsonBlock(makeTreeVerification(groupId)),
    },
    [`tree-rubric-refinement:${groupId}:iteration-${iteration}`]: {
      rawOutput: jsonBlock(rubric),
    },
    [`tree-grading:${groupId}:iteration-${iteration}:grader-1`]: (request) => {
      assert.equal(request.context.finalOutputFiles.files[0].path, outputFile);
      assert.equal(request.context.executionReport, undefined);
      assert.equal(request.context.validationReport, undefined);
      assert.equal(request.context.complexityReport, undefined);
      return {
        rawOutput: jsonBlock(
          makeTreeGradingArtifact({
            graderId: 1,
            groupId,
            iteration,
            rubric,
            failingNodeIds,
            evidenceFile: outputFile,
          }),
        ),
      };
    },
    [`tree-grading:${groupId}:iteration-${iteration}:grader-2`]: {
      rawOutput: jsonBlock(
        makeTreeGradingArtifact({
          graderId: 2,
          groupId,
          iteration,
          rubric,
          failingNodeIds,
          evidenceFile: outputFile,
        }),
      ),
    },
    [`tree-grading:${groupId}:iteration-${iteration}:grader-3`]: {
      rawOutput: jsonBlock(
        makeTreeGradingArtifact({
          graderId: 3,
          groupId,
          iteration,
          rubric,
          failingNodeIds,
          evidenceFile: outputFile,
        }),
      ),
    },
  };
}

function makeQaArtifact(groupId, iteration, overrides = {}) {
  const status = overrides.status ?? "pass";
  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    status,
    test_infrastructure: "configured",
    test_results: overrides.test_results ?? [
      {
        kind: "scenario",
        requirement_ids: ["REQ-001"],
        command: "manual scenario",
        status: status === "pass" ? "passed" : "failed",
        details: status === "pass"
          ? "Pipeline runtime behavior validated via mocked run."
          : "Scenario exposed a retryable QA issue.",
      },
    ],
    blocking_issues: overrides.blocking_issues ?? (
      status === "pass" ? [] : ["Scenario failed and needs same-group rework."]
    ),
    notes: overrides.notes ?? [],
  };
}

function makeValidationArtifact(groupId, iteration, overrides = {}) {
  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    detected_language: overrides.detected_language ?? "javascript",
    status: overrides.status ?? "passed",
    commands_run: overrides.commands_run ?? [
      {
        command: "node --test",
        type: "check",
        exit_code: 0,
        output: "mock validation passed",
      },
    ],
    test_summary: overrides.test_summary ?? {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
    },
    blocking_failures: overrides.blocking_failures ?? [],
  };
}

function makeDocArtifact(status = "no_changes_needed") {
  return {
    version: "1.0",
    status,
    updated_files: status === "updated" ? ["CHANGELOG.md"] : [],
    summary: status === "updated"
      ? "Documented the runtime skeleton landing."
      : "No documentation changes were required.",
    notes: [],
  };
}

function makeFinalAssessmentArtifact(overrides = {}) {
  const verdict = overrides.verdict ?? "accept";
  const dimensionScores = overrides.dimension_scores ?? [
    { dimension: "Requirement Completeness", score: "strong", evidence: "Requirements were satisfied." },
    { dimension: "Implementation Quality", score: "strong", evidence: "Implementation is coherent." },
    { dimension: "Architectural Soundness", score: "strong", evidence: "Architecture remains aligned." },
    { dimension: "Test Confidence", score: "adequate", evidence: "Tests cover the critical flow." },
    { dimension: "Documentation Accuracy", score: "strong", evidence: "Documentation matches behavior." },
    { dimension: "Overall Cohesion", score: "strong", evidence: "The pipeline remains internally consistent." },
  ];

  return {
    version: "1.0",
    iteration: overrides.iteration ?? 1,
    verdict,
    dimension_scores: dimensionScores,
    improvement_areas: overrides.improvement_areas ?? [],
    restart_from: verdict === "accept" ? null : (overrides.restart_from ?? "merge"),
    restart_rationale: verdict === "accept" ? null : (overrides.restart_rationale ?? "Resume after merge correction."),
    skill_usage_summary: overrides.skill_usage_summary ?? [],
    readability_conclusion: overrides.readability_conclusion ?? "high",
    complexity_conclusion: overrides.complexity_conclusion ?? "low",
    complexity_summary: overrides.complexity_summary ?? "Readability high; complexity low based on execution complexity reports.",
    summary: overrides.summary ?? "The runtime skeleton satisfies the requested orchestration scope.",
  };
}

class ScriptedStageRunner {
  constructor(responses) {
    this.responses = new Map(Object.entries(responses));
    this.calls = [];
  }

  async runStage(request) {
    this.calls.push(request.requestKey);
    const responder =
      this.responses.get(request.requestKey) ??
      this.responses.get(request.stage);

    if (!responder) {
      throw new Error(`No scripted response for ${request.requestKey}`);
    }

    return typeof responder === "function" ? responder(request) : responder;
  }
}

async function copyTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function createRepoFixture() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-repo-"));
  await copyTree(path.join(fixtureSourceRoot, "agents"), path.join(repoRoot, "agents"));
  await copyTree(path.join(fixtureSourceRoot, "references"), path.join(repoRoot, "references"));
  await copyTree(path.join(fixtureSourceRoot, "templates"), path.join(repoRoot, "templates"));
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "app.txt"), "base\n", "utf8");
  await fs.writeFile(
    path.join(repoRoot, "src", "app.py"),
    "def existing():\n    return 'base'\n",
    "utf8",
  );
  await fs.writeFile(path.join(repoRoot, "src", "group-a.txt"), "base-a\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "src", "group-b.txt"), "base-b\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "CHANGELOG.md"), "## Unreleased\n", "utf8");
  return repoRoot;
}

async function createProposalDir(files) {
  const proposalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-proposal-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(proposalRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, "utf8");
  }

  return proposalRoot;
}

async function listRelativeFiles(rootDir) {
  const result = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      result.push(path.relative(rootDir, absolutePath).split(path.sep).join("/"));
    }
  }

  await walk(rootDir);
  result.sort();
  return result;
}

async function applyProposalFiles(targetRoot, proposalRoot, changedFiles = []) {
  const files = changedFiles.length > 0 ? changedFiles : await listRelativeFiles(proposalRoot);
  for (const relativePath of files) {
    const sourcePath = path.join(proposalRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

class SerialAssertingMergeEngine {
  constructor({ repoRoot, artifactStore, delayMs = 10 }) {
    this.repoRoot = repoRoot;
    this.artifactStore = artifactStore;
    this.delayMs = delayMs;
    this.active = 0;
    this.maxActive = 0;
  }

  async mergeProposal({ groupId, iteration, baseRef, proposal, changedFiles = [] }) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.active > 1) {
      throw new Error("merge overlap detected");
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      await applyProposalFiles(this.repoRoot, proposal.path, changedFiles);
      const resultRef = await this.artifactStore.createWorkspaceSnapshot({
        refPath: path.posix.join("merge", groupId, `iteration-${iteration}-result.json`),
        snapshotName: `${groupId}-iteration-${iteration}-result`,
      });

      return {
        report: {
          version: "1.0",
          group_id: groupId,
          iteration,
          base_ref: baseRef,
          mainline_ref: `workspace://${groupId}-before`,
          proposal_ref: proposal.ref,
          result_ref: resultRef,
          status: "merged",
          conflicts: [],
        },
      };
    } finally {
      this.active -= 1;
    }
  }
}

class ConflictOnceMergeEngine {
  constructor({ repoRoot, artifactStore }) {
    this.repoRoot = repoRoot;
    this.artifactStore = artifactStore;
    this.didConflict = false;
  }

  async mergeProposal({ groupId, iteration, baseRef, proposal, changedFiles = [] }) {
    if (!this.didConflict && groupId === "GROUP-1") {
      this.didConflict = true;
      return {
        report: {
          version: "1.0",
          group_id: groupId,
          iteration,
          base_ref: baseRef,
          mainline_ref: `workspace://${groupId}-before`,
          proposal_ref: proposal.ref,
          result_ref: "workspace://conflict-bundle",
          status: "conflicted",
          conflicts: [
            {
              file: changedFiles[0] ?? "src/app.txt",
              format: "text",
              conflict_type: "same_hunk",
              summary: "Synthetic conflict for resume testing.",
              left_ref: `${proposal.ref}:${changedFiles[0] ?? "src/app.txt"}`,
              right_ref: `workspace://${groupId}-before:${changedFiles[0] ?? "src/app.txt"}`,
              base_ref: `${baseRef}:${changedFiles[0] ?? "src/app.txt"}`,
            },
          ],
        },
      };
    }

    await applyProposalFiles(this.repoRoot, proposal.path, changedFiles);
    const resultRef = await this.artifactStore.createWorkspaceSnapshot({
      refPath: path.posix.join("merge", groupId, `iteration-${iteration}-result.json`),
      snapshotName: `${groupId}-iteration-${iteration}-result`,
    });

    return {
      report: {
        version: "1.0",
        group_id: groupId,
        iteration,
        base_ref: baseRef,
        mainline_ref: `workspace://${groupId}-before`,
        proposal_ref: proposal.ref,
        result_ref: resultRef,
        status: "merged",
        conflicts: [],
      },
    };
  }
}

class RecordingGitAutomation {
  constructor() {
    this.calls = [];
  }

  async commitAndMaybePush(options) {
    this.calls.push(options);
    return {
      status: "committed",
      pushed: options.push === true,
      remote: options.remote,
      branch: options.branch ?? "codex/test",
    };
  }
}

test("aggregateReviewFeedback preserves warnings and majority voting", async () => {
  const feedback = aggregateReviewFeedback({
    mode: "EME",
    iteration: 1,
    reviews: [
      {
        version: "1.0",
        reviewer_id: 1,
        applied_skills: [],
        pre_results: makePreResults({ warningCriterion: "Security", evidence: "src/app.txt:1" }),
        frontend_design_assessment: null,
      },
      {
        version: "1.0",
        reviewer_id: 2,
        applied_skills: [],
        pre_results: makePreResults({ evidence: "src/app.txt:2" }),
        frontend_design_assessment: null,
      },
      {
        version: "1.0",
        reviewer_id: 3,
        applied_skills: [],
        pre_results: makePreResults({ evidence: "src/app.txt:3" }),
        frontend_design_assessment: null,
      },
    ],
  });

  assert.equal(feedback.verdict, "pass");
  assert.equal(feedback.warnings.length, 1);
  assert.equal(feedback.eme_votes[1].final_score, "pass");
});

test("aggregateTreeGradingFeedback applies depth weights, dependency chains, and gates", async () => {
  const rubric = makeTreeRubrics("GROUP-1", "src/app.txt");
  const depthOneFailure = aggregateTreeGradingFeedback({
    threshold: 0.8,
    requireDepthOnePass: true,
    rubric,
    graderResults: [1, 2, 3].map((graderId) =>
      makeTreeGradingArtifact({
        graderId,
        rubric,
        failingNodeIds: ["B1-D1-01"],
        evidenceFile: "src/app.txt",
      }),
    ),
  });
  assert.equal(depthOneFailure.verdict, "fail");
  assert.equal(depthOneFailure.weighted_score, 0.25);
  assert.deepEqual(depthOneFailure.blocking_nodes.sort(), ["B1-D1-01", "B1-D2-01"].sort());
  assert.equal(
    depthOneFailure.node_results.find((result) => result.node_id === "B1-D2-01")
      .dependency_blocked_by,
    "B1-D1-01",
  );

  const thresholdFailure = aggregateTreeGradingFeedback({
    threshold: 0.8,
    requireDepthOnePass: true,
    rubric,
    graderResults: [1, 2, 3].map((graderId) =>
      makeTreeGradingArtifact({
        graderId,
        rubric,
        failingNodeIds: ["B1-D2-01"],
        evidenceFile: "src/app.txt",
      }),
    ),
  });
  assert.equal(thresholdFailure.verdict, "fail");
  assert.equal(thresholdFailure.weighted_score, 0.5);

  const wideRubric = {
    ...rubric,
    branches: [
      ...rubric.branches,
      {
        name: "额外质量",
        name_en: "Additional Quality",
        nodes: [
          {
            depth: 1,
            id: "B3-D1-01",
            content: "额外基础质量达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-02",
            content: "额外基础兼容性达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-03",
            content: "额外基础可读性达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-04",
            content: "额外基础测试信号达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-05",
            content: "额外基础文档信号达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-06",
            content: "额外基础集成信号达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
          {
            depth: 1,
            id: "B3-D1-07",
            content: "额外基础回归信号达标。",
            source: "ADD",
            requirement_ids: ["REQ-001"],
            output_file_hints: ["src/app.txt"],
          },
        ],
      },
    ],
  };
  const nonBlockingDeepFailure = aggregateTreeGradingFeedback({
    threshold: 0.8,
    requireDepthOnePass: true,
    rubric: wideRubric,
    graderResults: [1, 2, 3].map((graderId) =>
      makeTreeGradingArtifact({
        graderId,
        rubric: wideRubric,
        failingNodeIds: ["B1-D2-01"],
        evidenceFile: "src/app.txt",
      }),
    ),
  });
  assert.equal(nonBlockingDeepFailure.verdict, "pass");
  assert.ok(nonBlockingDeepFailure.weighted_score >= 0.8);
  assert.deepEqual(nonBlockingDeepFailure.non_blocking_nodes, ["B1-D2-01"]);
});

test("merge engine pauses on conflicting text changes", async () => {
  const repoRoot = await createRepoFixture();
  const store = new ArtifactStore({ repoRoot });
  await store.initializeRun();

  const baseRef = await store.createWorkspaceSnapshot({
    refPath: "bases/wave-1-group-1-base.json",
    snapshotName: "wave-1-group-1-base",
  });
  await fs.writeFile(path.join(repoRoot, "src", "app.txt"), "mainline change\n", "utf8");

  const proposalDir = await createProposalDir({
    "src/app.txt": "proposal change\n",
  });
  const mergeEngine = new MergeEngine({ repoRoot, artifactStore: store });
  const outcome = await mergeEngine.mergeProposal({
    groupId: "GROUP-1",
    iteration: 1,
    baseRef,
    proposal: {
      ref: "worker://GROUP-1/iteration-1",
      path: proposalDir,
    },
    changedFiles: ["src/app.txt"],
  });

  assert.equal(outcome.report.status, "conflicted");
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "app.txt"), "utf8"), "mainline change\n");
});

test("dispatch validation enforces architecture-derived required skills", async () => {
  const plan = makePlanArtifact(["TASK-001"], ["src/app.txt"]);
  const architecture = makeArchitectureArtifact([
    {
      target: "src/app.txt",
      change_type: "modify",
      description: "Frontend-facing file change.",
      concerns: ["frontend_design"],
    },
  ]);
  const dispatch = makeDispatchArtifact([
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/app.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ]);

  assert.throws(
    () => validateArtifact("dispatch", dispatch, { plan, architecture }),
    /required_skills must match architecture-derived routing/,
  );
});

test("spec and plan require internal methodology markers to stay empty", () => {
  assert.deepEqual(validateArtifact("spec", makeSpecArtifact()).applied_skills, []);
  assert.deepEqual(validateArtifact("plan", makePlanArtifact()).applied_skills, []);

  assert.throws(
    () =>
      validateArtifact("spec", {
        ...makeSpecArtifact(),
        applied_skills: ["superpowers"],
      }),
    /applied_skills must be \[\]/,
  );
  assert.throws(
    () =>
      validateArtifact("plan", {
        ...makePlanArtifact(),
        applied_skills: ["superpowers"],
      }),
    /applied_skills must be \[\]/,
  );
});

test("execution report requires REPLAN_REQUIRED as the first blocker when present", () => {
  const report = {
    ...makeExecutionArtifact({
      groupId: "GROUP-1",
      iteration: 1,
      baseRef: "bases/wave-1-group-1-base.json",
      changedFiles: [],
      proposalRef: "worker://GROUP-1/iteration-1",
    }),
    status: "blocked",
    blockers: [
      "Same-group retry cannot continue.",
      "REPLAN_REQUIRED: retry needs files outside worker_group.owned_files",
    ],
  };

  assert.throws(
    () => validateArtifact("execution-report", report, { requiredSkills: [] }),
    /REPLAN_REQUIRED must be the first blocker/,
  );
});

test("validation reports reject fix commands because Execution owns repairs", () => {
  const report = makeValidationArtifact("GROUP-1", 1, {
    commands_run: [
      {
        command: "eslint --fix",
        type: "fix",
        exit_code: 0,
        output: "mutating validation command should be rejected",
      },
    ],
  });

  assert.throws(
    () => validateArtifact("validation-report", report),
    /commands_run\[0\]\.type/,
  );
});

test("doc reports can request Execution-owned documentation repair", () => {
  const report = {
    version: "1.0",
    status: "changes_required",
    updated_files: ["README.md"],
    summary: "README needs an Execution-owned update for the new behavior.",
    notes: ["Doc is read-only and sends this path back to Execution."],
  };

  assert.deepEqual(validateArtifact("doc-report", report), report);
});

test("pipeline orchestrator defaults to a six-slot subagent pool", async () => {
  const repoRoot = await createRepoFixture();
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: new ScriptedStageRunner({}),
  });

  assert.equal(orchestrator.maxConcurrentSubagents, 6);
});

test("default write authority reserves repo mutations for Execution workers", () => {
  assert.equal(DEFAULT_ORCHESTRATOR_WRITE_AUTHORITY.canModifyRepoFilesDirectly, false);
  assert.match(
    DEFAULT_ORCHESTRATOR_WRITE_AUTHORITY.rule,
    /orchestrator\/main agent must never modify code or repo files directly/,
  );
  assert.match(DEFAULT_ORCHESTRATOR_WRITE_AUTHORITY.rule, /Execution-stage worker subagents/);

  const executionAuthority = DEFAULT_STAGE_WRITE_AUTHORITY.execution;
  assert.equal(executionAuthority.repoFileMutationsAllowed, true);
  assert.equal(executionAuthority.codeFileMutationsAllowed, true);
  assert.equal(executionAuthority.mutationOwner, "execution-worker");

  for (const [stage, authority] of Object.entries(DEFAULT_STAGE_WRITE_AUTHORITY)) {
    const profile = loadStageCatalog(fixtureSourceRoot).resolveStageProfile(stage);
    assert.deepEqual(profile.writeAuthority, authority, stage);

    if (stage === "execution") {
      continue;
    }

    assert.equal(authority.repoFileMutationsAllowed, false, stage);
    assert.equal(authority.codeFileMutationsAllowed, false, stage);
    assert.match(authority.repairRouting, /Execution/, stage);
  }
});

test("default stage profiles pin GPT-5.5 xhigh priority subagents", async () => {
  const catalog = loadStageCatalog(fixtureSourceRoot);
  const stages = [
    "spec",
    "plan",
    "architecture",
    "dispatch",
    "execution",
    "validation",
    "tree-classification",
    "tree-rubric-generation",
    "tree-rubric-verification",
    "tree-rubric-refinement",
    "tree-grading",
    "qa",
    "doc",
    "final-assessment",
  ];

  for (const stage of stages) {
    const profile = catalog.resolveStageProfile(stage);
    assert.equal(profile.model, "gpt-5.5", stage);
    assert.equal(profile.reasoningEffort, "xhigh", stage);
    assert.equal(profile.serviceTier, "priority", stage);
  }

  for (const graderId of [1, 2, 3]) {
    const profile = catalog.resolveStageProfile("tree-grading", { graderId });
    assert.equal(profile.model, "gpt-5.5", `grader-${graderId}`);
    assert.equal(profile.reasoningEffort, "xhigh", `grader-${graderId}`);
    assert.equal(profile.serviceTier, "priority", `grader-${graderId}`);
  }
});

test("stage docs document Execution-only file mutation authority", async () => {
  const readFixture = (relativePath) =>
    fs.readFile(path.resolve(fixtureSourceRoot, relativePath), "utf8");

  const [
    codexModel,
    orchestratorPrompts,
    executionPrompt,
    validationPrompt,
    qaPrompt,
    docPrompt,
  ] = await Promise.all([
    readFixture("references/codex-execution-model.md"),
    readFixture("references/orchestrator-prompts.md"),
    readFixture("agents/execution.md"),
    readFixture("agents/validation.md"),
    readFixture("agents/qa.md"),
    readFixture("agents/doc.md"),
  ]);

  assert.match(
    codexModel,
    /The orchestrator\/main agent must never modify code or repo files directly\./,
  );
  assert.match(orchestratorPrompts, /File\/code mutations are only allowed in Execution-stage worker subagents\./);
  assert.match(executionPrompt, /only pipeline stage with repo file write authority/);
  assert.match(validationPrompt, /Validation is read-only/);
  assert.doesNotMatch(validationPrompt, /Fix-layer commands have write permission/);
  assert.match(qaPrompt, /QA is read-only/);
  assert.match(docPrompt, /Doc is read-only/);
  assert.match(docPrompt, /changes_required/);
});

test("git commit formatter keeps conventional commits with gitmoji and Chinese text", async () => {
  const message = formatConventionalGitmojiCommitMessage({
    type: "feat",
    scope: "pipeline",
    gitmoji: ":sparkles:",
    description: "完成流水线交付",
    body: ["阶段: Cleanup", "运行: RUN-TEST-GIT"],
  });

  assert.match(message, /^feat\(pipeline\): :sparkles: 完成流水线交付\n\n/);
  assert.match(message, /阶段: Cleanup/);
  assert.match(message, /运行: RUN-TEST-GIT/);
});

test("git publication is opt-in and publishes doc plus cleanup checkpoints", async () => {
  const repoRoot = await createRepoFixture();
  const store = new ArtifactStore({ repoRoot });
  await store.initializeRun();

  const docProposalDir = await createProposalDir({
    "CHANGELOG.md": "## Unreleased\n- Added git publication rules.\n",
  });
  const runner = new ScriptedStageRunner({
    doc: {
      rawOutput: jsonBlock(makeDocArtifact("updated")),
      proposal: {
        ref: "worker://DOCS/iteration-1",
        path: docProposalDir,
      },
    },
  });
  const disabledGit = new RecordingGitAutomation();
  const disabledOrchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    gitAutomation: disabledGit,
  });

  assert.deepEqual(await disabledOrchestrator.runGitPublication("cleanup"), {
    status: "disabled",
  });
  assert.equal(disabledGit.calls.length, 0);

  const enabledGit = new RecordingGitAutomation();
  const mergeEngine = new SerialAssertingMergeEngine({ repoRoot, artifactStore: store });
  const enabledOrchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine,
    gitAutomation: enabledGit,
    gitPolicy: {
      enabled: true,
      doc: { push: true },
      cleanup: { push: true },
    },
  });

  await enabledOrchestrator.runDocStage({
    runId: "RUN-TEST-GIT",
    spec: makeSpecArtifact(),
    architecture: makeArchitectureArtifact(),
    executionResults: [],
    complexityReports: [],
  });
  await enabledOrchestrator.finishRun({
    runId: "RUN-TEST-GIT",
    spec: makeSpecArtifact(),
    plan: makePlanArtifact(),
    dispatch: makeDispatchArtifact([]),
    groupStates: new Map(),
    finalAssessment: makeFinalAssessmentArtifact(),
  });

  assert.equal(enabledGit.calls.length, 2);
  assert.match(enabledGit.calls[0].message, /^docs\(pipeline\): :memo: 更新流水线交付文档/);
  assert.deepEqual(enabledGit.calls[0].paths, ["CHANGELOG.md"]);
  assert.equal(enabledGit.calls[0].push, true);
  assert.match(enabledGit.calls[1].message, /^feat\(pipeline\): :sparkles: 完成流水线交付/);
  assert.deepEqual(enabledGit.calls[1].paths, []);
  assert.equal(enabledGit.calls[1].push, true);
  await assert.rejects(fs.access(path.join(repoRoot, ".pipeline-workspace")));
});

test("stage catalog exposes artifact templates for every stage profile", async () => {
  const catalog = loadStageCatalog(fixtureSourceRoot);
  const stages = [
    "spec",
    "plan",
    "architecture",
    "dispatch",
    "execution",
    "validation",
    "tree-classification",
    "tree-rubric-generation",
    "tree-rubric-verification",
    "tree-rubric-refinement",
    "tree-grading",
    "review",
    "qa",
    "doc",
    "final-assessment",
  ];

  for (const stage of stages) {
    const request = await catalog.buildStageRequest(stage, {
      workerGroup: {
        group_id: "GROUP-1",
        required_skills: [],
      },
      iteration: 1,
      graderId: 1,
      reviewerId: 1,
    });

    assert.ok(request.artifactTemplate, `${stage} should include an artifact template`);
    assert.match(request.artifactTemplate.relativePath, /^templates\/artifacts\/.+\.json$/);
    assert.equal(typeof request.artifactTemplate.artifact, "object", stage);
    await fs.access(path.resolve(fixtureSourceRoot, request.artifactTemplate.relativePath));
  }
});

test("stage catalog treats methodology as pipeline-internal capability", async () => {
  const catalog = loadStageCatalog(fixtureSourceRoot);

  assert.deepEqual(catalog.resolveRequiredSkills("spec"), []);
  assert.deepEqual(catalog.resolveRequiredSkills("plan"), []);
  assert.deepEqual((await catalog.buildStageRequest("spec")).requiredSkills, []);
  assert.deepEqual((await catalog.buildStageRequest("plan")).requiredSkills, []);

  const workerGroup = {
    group_id: "GROUP-UI",
    required_skills: ["ce-frontend-design"],
  };
  const expectedSkillLabels = [
      {
        name: "ce-frontend-design",
        source: "skill-internal-capability",
      },
  ];

  assert.deepEqual(catalog.resolveRequiredSkills("execution", { workerGroup }), expectedSkillLabels);
  assert.deepEqual(catalog.resolveRequiredSkills("review", { workerGroup }), expectedSkillLabels);
});

test("artifact templates materialize deterministic execution fields before validation", async () => {
  const repoRoot = await createRepoFixture();
  const proposalDir = await createProposalDir({
    "src/app.txt": "implemented\n",
  });
  const workerGroup = {
    group_id: "GROUP-LOW-CONTEXT",
    tasks: ["TASK-001"],
    owned_files: ["src/app.txt"],
    depends_on_groups: [],
    required_skills: [],
  };
  const runner = new ScriptedStageRunner({
    "execution:GROUP-LOW-CONTEXT:iteration-2": {
      proposal: {
        ref: "worker://GROUP-LOW-CONTEXT/iteration-2",
        path: proposalDir,
      },
      rawOutput: jsonBlock({
        status: "implemented",
        applied_skills: [],
        changed_files: ["src/app.txt"],
        requirements_covered: ["REQ-001"],
        frontend_design_summary: null,
        tests_run: [],
        follow_up_notes: [],
        blockers: [],
      }),
    },
  });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    maxStageRetries: 0,
  });

  const result = await orchestrator.runStage(
    "execution",
    {
      workerGroup,
      baseRef: "bases/wave-1-group-low-context-base.json",
      iteration: 2,
    },
    {
      requiredSkills: [],
    },
  );

  assert.equal(result.artifact.version, "1.0");
  assert.equal(result.artifact.group_id, "GROUP-LOW-CONTEXT");
  assert.equal(result.artifact.iteration, 2);
  assert.equal(result.artifact.base_ref, "bases/wave-1-group-low-context-base.json");
  assert.equal(result.artifact.proposal_ref, "worker://GROUP-LOW-CONTEXT/iteration-2");
});

test("artifact templates fill fixed dimension labels but still require semantic values", async () => {
  const repoRoot = await createRepoFixture();
  const runner = new ScriptedStageRunner({
    "final-assessment": {
      rawOutput: jsonBlock({
        verdict: "accept",
        dimension_scores: [
          { score: "strong", evidence: "Requirements are complete." },
          { score: "strong", evidence: "Implementation is clear." },
          { score: "adequate", evidence: "Architecture is aligned." },
          { score: "adequate", evidence: "Tests cover the main flow." },
          { score: "strong", evidence: "Documentation is accurate." },
          { score: "strong", evidence: "The result is cohesive." },
        ],
        improvement_areas: [],
        restart_from: null,
        restart_rationale: null,
        skill_usage_summary: [],
        readability_conclusion: "high",
        complexity_conclusion: "low",
        complexity_summary: "Complexity reports show low complexity.",
        summary: "Accepted.",
      }),
    },
  });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    maxStageRetries: 0,
  });

  const result = await orchestrator.runStage("final-assessment", {
    previousAssessments: [],
  });

  assert.equal(result.artifact.iteration, 1);
  assert.deepEqual(
    result.artifact.dimension_scores.map((entry) => entry.dimension),
    [
      "Requirement Completeness",
      "Implementation Quality",
      "Architectural Soundness",
      "Test Confidence",
      "Documentation Accuracy",
      "Overall Cohesion",
    ],
  );

  const failingRunner = new ScriptedStageRunner({
    plan: {
      rawOutput: jsonBlock({
        risk_items: ["The model omitted semantic planning arrays."],
      }),
    },
  });
  const failingOrchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: failingRunner,
    maxStageRetries: 0,
  });

  await assert.rejects(
    () => failingOrchestrator.runStage("plan", {}),
    /phases must contain at least 1 item/,
  );
});

test("OpenCode expert profiles use task invocation without Codex-only spawn fields", async () => {
  const catalog = loadStageCatalog(fixtureSourceRoot, {
    stageProfiles: DEFAULT_OPENCODE_EXPERT_STAGE_PROFILES,
  });
  const stages = [
    "spec",
    "plan",
    "architecture",
    "dispatch",
    "execution",
    "validation",
    "review",
    "qa",
    "doc",
    "final-assessment",
  ];

  for (const stage of stages) {
    const profile = catalog.resolveStageProfile(stage);
    assert.equal(profile.host, "opencode", stage);
    assert.equal(profile.primaryAgent, "multi-agent-pipeline-expert", stage);
    assert.equal(profile.invocation, "task", stage);
    assert.equal(profile.agentMode, "subagent", stage);
    assert.equal(profile.reasoningEffort, "high", stage);
    assert.equal(profile.waitTimeoutMs, 600_000, stage);
    assert.equal(profile.agentType, undefined, stage);
    assert.equal(profile.serviceTier, undefined, stage);
    assert.equal(profile.forkContext, undefined, stage);
    assert.deepEqual(profile.writeAuthority, DEFAULT_STAGE_WRITE_AUTHORITY[stage], stage);
    assert.ok(profile.promptFile.startsWith("agents/"), stage);
  }
});

test("skill entrypoint stays progressive-disclosure oriented", async () => {
  const skillPath = path.resolve(fixtureSourceRoot, "SKILL.md");
  const skillText = await fs.readFile(skillPath, "utf8");
  const lineCount = skillText.trimEnd().split("\n").length;
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n/.exec(skillText);

  assert.ok(frontmatterMatch, "SKILL.md should start with YAML frontmatter");
  assert.ok(lineCount <= 220, `SKILL.md should stay lightweight, found ${lineCount} lines`);

  const frontmatter = frontmatterMatch[1];
  const descriptionMatch = /description:\s*>\n([\s\S]*?)\ncompatibility:/m.exec(frontmatter);
  assert.match(frontmatter, /^name: multi-agent-pipeline$/m);
  assert.match(frontmatter, /^compatibility: .*opencode/m);
  assert.ok(descriptionMatch, "description should use folded YAML text");

  const description = descriptionMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  assert.ok(description.length >= 1, "description should not be empty");
  assert.ok(description.length <= 1024, "OpenCode description limit is 1024 characters");
  assert.match(frontmatter, /^  disclosure: progressive$/m);
  assert.match(frontmatter, /^  opencode_agent: multi-agent-pipeline-expert$/m);
  assert.match(skillText, /references\/pipeline-stages\.md/);
  assert.match(skillText, /templates\/artifacts\/<artifact>\.json/);
  assert.match(skillText, /agents\/<stage>\.md/);
  assert.match(skillText, /src\/runtime\//);
  await fs.access(path.resolve(fixtureSourceRoot, "src", "runtime", "pipeline-orchestrator.js"));
  await fs.access(path.resolve(fixtureSourceRoot, "agents", "execution.md"));
});

test("Codex pet event helper validates states and builds directive strings", async () => {
  assert.ok(CODEX_PET_STATES.includes("review"));

  const event = createCodexPetEvent({
    state: "review",
    reason: "Review stage started.",
    scope: "pipeline.review.group-group-1.iteration-1",
    durationMs: 2400,
    createdAt: "2026-05-26T00:00:00.000Z",
  });

  assert.equal(event.duration_ms, 2400);
  assert.equal(
    event.directive,
    '::codex-pet{state="review" durationMs=2400 scope="pipeline.review.group-group-1.iteration-1"}',
  );
  assert.throws(
    () =>
      createCodexPetEvent({
        state: "sleeping",
        reason: "Unsupported state.",
        scope: "pipeline.test",
        createdAt: "2026-05-26T00:00:00.000Z",
      }),
    /Unsupported Codex pet state/,
  );
});

test("complexity hook analyzes changed Python proposal files", async () => {
  const repoRoot = await createRepoFixture();
  const proposalDir = await createProposalDir({
    "src/app.py": [
      "def branchy(value):",
      "    if value:",
      "        for item in value:",
      "            if item and value:",
      "                return item",
      "    return None",
      "",
    ].join("\n"),
    "src/notes.md": "not analyzed\n",
  });

  const report = await runComplexityHook({
    repoRoot,
    groupId: "GROUP-1",
    iteration: 1,
    changedFiles: ["src/app.py", "src/notes.md"],
    proposalPath: proposalDir,
    thresholds: {
      medium: 1,
      high: 3,
    },
    clock: () => new Date("2026-05-28T00:00:00.000Z"),
  });

  assert.equal(report.status, "completed");
  assert.equal(report.analyzed_files.length, 1);
  assert.equal(report.skipped_files[0].reason, "not_python");
  assert.equal(report.function_count, 1);
  assert.equal(report.complexity_conclusion, "high");
  assert.equal(report.readability_conclusion, "low");
  assert.doesNotThrow(() => validateArtifact("complexity-report", report));
});

test("pipeline orchestrator runs happy path and cleans workspace on accept", async () => {
  const repoRoot = await createRepoFixture();
  const executionProposalDir = await createProposalDir({
    "src/app.py": "def feature_complete():\n    return 'feature complete'\n",
  });
  const docProposalDir = await createProposalDir({
    "CHANGELOG.md": "## Unreleased\n- Added orchestrator runtime skeleton.\n",
  });

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: { rawOutput: jsonBlock(makePlanArtifact(["TASK-001"], ["src/app.py"])) },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/app.py",
            change_type: "modify",
            description: "Add the orchestrator state machine entrypoint.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(
        makeDispatchArtifact([
          {
            group_id: "GROUP-1",
            tasks: ["TASK-001"],
            owned_files: ["src/app.py"],
            depends_on_groups: [],
            required_skills: [],
          },
        ]),
      ),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/app.py"],
          proposalRef: "worker://GROUP-1/iteration-1",
          followUpNotes: [
            "Runtime is adapter-driven so Codex-specific tool calls stay outside the library.",
          ],
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: executionProposalDir,
      },
    }),
    "validation:GROUP-1:iteration-1": (request) => {
      assert.equal(request.context.complexityReport.status, "completed");
      assert.equal(request.context.complexityReport.complexity_conclusion, "low");
      return {
        rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
      };
    },
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 1, outputFile: "src/app.py" }),
    "qa:GROUP-1:iteration-1": (request) => {
      assert.equal(request.context.complexityReport.status, "completed");
      assert.equal(request.context.treeGradingFeedback.verdict, "pass");
      return { rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1)) };
    },
    doc: {
      rawOutput: jsonBlock(makeDocArtifact("updated")),
      proposal: {
        ref: "worker://DOCS/iteration-1",
        path: docProposalDir,
      },
    },
    "final-assessment": (request) => {
      assert.equal(request.context.complexityReports.length, 1);
      assert.equal(request.context.complexityReports[0].readability_conclusion, "high");
      assert.equal(request.context.complexityReports[0].complexity_conclusion, "low");
      assert.equal(request.context.treeGradingFeedbacks.length, 1);
      assert.equal(request.context.treeGradingFeedbacks[0].weighted_score, 1);
      return {
        rawOutput: jsonBlock(makeFinalAssessmentArtifact()),
      };
    },
  };

  const runner = new ScriptedStageRunner(responses);
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-001",
  });

  assert.equal(result.verdict, "accept");
  assert.equal(
    await fs.readFile(path.join(repoRoot, "src", "app.py"), "utf8"),
    "def feature_complete():\n    return 'feature complete'\n",
  );
  assert.match(
    await fs.readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
    /Added orchestrator runtime skeleton/,
  );

  const summary = JSON.parse(await fs.readFile(path.join(repoRoot, ".pipeline-last-run-summary.json"), "utf8"));
  assert.equal(summary.verdict, "accept");
  assert.equal(summary.complexity_summary.length, 1);
  assert.equal(summary.complexity_summary[0].status, "completed");
  assert.equal(summary.tree_grading_summary.length, 1);
  assert.equal(summary.tree_grading_summary[0].weighted_score, 1);
  assert.ok(summary.codex_pet_events.some((event) => event.state === "review"));
  assert.equal(summary.codex_pet_events.at(-1).state, "waving");
  assert.match(summary.codex_pet_events.at(-1).directive, /^::codex-pet\{state="waving"/);

  await assert.rejects(fs.access(path.join(repoRoot, ".pipeline-workspace")));
});

test("retry iterations use a fresh base snapshot before each execution pass", async () => {
  const repoRoot = await createRepoFixture();
  const baseRefs = [];
  const iterationOneProposalDir = await createProposalDir({
    "src/app.txt": "iteration one\n",
  });
  const iterationTwoProposalDir = await createProposalDir({
    "src/app.txt": "iteration two\n",
  });

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: { rawOutput: jsonBlock(makePlanArtifact()) },
    architecture: { rawOutput: jsonBlock(makeArchitectureArtifact()) },
    dispatch: {
      rawOutput: jsonBlock(
        makeDispatchArtifact([
          {
            group_id: "GROUP-1",
            tasks: ["TASK-001"],
            owned_files: ["src/app.txt"],
            depends_on_groups: [],
            required_skills: [],
          },
        ]),
      ),
    },
    "execution:GROUP-1:iteration-1": (request) => {
      baseRefs.push(request.context.baseRef);
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-1",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/app.txt"],
            proposalRef: "worker://GROUP-1/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-1/iteration-1",
          path: iterationOneProposalDir,
        },
      };
    },
    "execution:GROUP-1:iteration-2": (request) => {
      baseRefs.push(request.context.baseRef);
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-1",
            iteration: 2,
            baseRef: request.context.baseRef,
            changedFiles: ["src/app.txt"],
            proposalRef: "worker://GROUP-1/iteration-2",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-1/iteration-2",
          path: iterationTwoProposalDir,
        },
      };
    },
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    "validation:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 2)),
    },
    ...makeTreeStageResponses({
      groupId: "GROUP-1",
      iteration: 1,
      outputFile: "src/app.txt",
      failingNodeIds: ["B1-D1-01"],
    }),
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 2, outputFile: "src/app.txt" }),
    "qa:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 2)),
    },
    doc: {
      rawOutput: jsonBlock(makeDocArtifact()),
    },
    "final-assessment": {
      rawOutput: jsonBlock(makeFinalAssessmentArtifact()),
    },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const mergeEngine = new SerialAssertingMergeEngine({ repoRoot, artifactStore: store });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    reviewMode: "PRE",
    artifactStore: store,
    mergeEngine,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-RETRY",
  });

  assert.equal(result.verdict, "accept");
  assert.equal(baseRefs.length, 2);
  assert.notEqual(baseRefs[0], baseRefs[1]);
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "app.txt"), "utf8"), "iteration two\n");
});

test("same-wave groups keep execution and QA parallelizable while merge integration stays serialized", async () => {
  const repoRoot = await createRepoFixture();
  const proposalADir = await createProposalDir({
    "src/group-a.txt": "updated-a\n",
  });
  const proposalBDir = await createProposalDir({
    "src/group-b.txt": "updated-b\n",
  });
  const qaTracker = {
    active: 0,
    maxActive: 0,
  };

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(["TASK-001", "TASK-002"], ["src/group-a.txt", "src/group-b.txt"]),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/group-a.txt",
            change_type: "modify",
            description: "Update group A file.",
            concerns: [],
          },
          {
            target: "src/group-b.txt",
            change_type: "modify",
            description: "Update group B file.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(
        makeDispatchArtifact([
          {
            group_id: "GROUP-1",
            tasks: ["TASK-001"],
            owned_files: ["src/group-a.txt"],
            depends_on_groups: [],
            required_skills: [],
          },
          {
            group_id: "GROUP-2",
            tasks: ["TASK-002"],
            owned_files: ["src/group-b.txt"],
            depends_on_groups: [],
            required_skills: [],
          },
        ]),
      ),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/group-a.txt"],
          proposalRef: "worker://GROUP-1/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: proposalADir,
      },
    }),
    "execution:GROUP-2:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-2",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/group-b.txt"],
          proposalRef: "worker://GROUP-2/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-2/iteration-1",
        path: proposalBDir,
      },
    }),
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    "validation:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-2", 1)),
    },
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 1, outputFile: "src/group-a.txt" }),
    ...makeTreeStageResponses({ groupId: "GROUP-2", iteration: 1, outputFile: "src/group-b.txt" }),
    "qa:GROUP-1:iteration-1": async () => {
      qaTracker.active += 1;
      qaTracker.maxActive = Math.max(qaTracker.maxActive, qaTracker.active);
      try {
        await sleep(150);
        return { rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1)) };
      } finally {
        qaTracker.active -= 1;
      }
    },
    "qa:GROUP-2:iteration-1": async () => {
      qaTracker.active += 1;
      qaTracker.maxActive = Math.max(qaTracker.maxActive, qaTracker.active);
      try {
        await sleep(150);
        return { rawOutput: jsonBlock(makeQaArtifact("GROUP-2", 1)) };
      } finally {
        qaTracker.active -= 1;
      }
    },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": { rawOutput: jsonBlock(makeFinalAssessmentArtifact()) },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const mergeEngine = new SerialAssertingMergeEngine({ repoRoot, artifactStore: store, delayMs: 20 });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    reviewMode: "PRE",
    artifactStore: store,
    mergeEngine,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-WAVE",
  });

  assert.equal(result.verdict, "accept");
  assert.equal(mergeEngine.maxActive, 1);
  assert.equal(qaTracker.maxActive, 2);
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "group-a.txt"), "utf8"), "updated-a\n");
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "group-b.txt"), "utf8"), "updated-b\n");
});

test("completed same-wave groups advance to review and QA before slower executions finish", async () => {
  const repoRoot = await createRepoFixture();
  const events = [];
  const proposalADir = await createProposalDir({
    "src/group-a.txt": "fast-a\n",
  });
  const proposalBDir = await createProposalDir({
    "src/group-b.txt": "slow-b\n",
  });
  const workerGroups = [
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/group-a.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
    {
      group_id: "GROUP-2",
      tasks: ["TASK-002"],
      owned_files: ["src/group-b.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ];

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(["TASK-001", "TASK-002"], ["src/group-a.txt", "src/group-b.txt"]),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/group-a.txt",
            change_type: "modify",
            description: "Update group A file.",
            concerns: [],
          },
          {
            target: "src/group-b.txt",
            change_type: "modify",
            description: "Update group B file.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    "execution:GROUP-1:iteration-1": (request) => {
      events.push("group-1-execution-finished");
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-1",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-a.txt"],
            proposalRef: "worker://GROUP-1/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-1/iteration-1",
          path: proposalADir,
        },
      };
    },
    "execution:GROUP-2:iteration-1": async (request) => {
      events.push("group-2-execution-started");
      await sleep(150);
      events.push("group-2-execution-finished");
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-2",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-b.txt"],
            proposalRef: "worker://GROUP-2/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-2/iteration-1",
          path: proposalBDir,
        },
      };
    },
    "validation:GROUP-1:iteration-1": () => {
      events.push("group-1-validation-started");
      return { rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)) };
    },
    "validation:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-2", 1)),
    },
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 1, outputFile: "src/group-a.txt" }),
    ...makeTreeStageResponses({ groupId: "GROUP-2", iteration: 1, outputFile: "src/group-b.txt" }),
    "tree-rubric-generation:GROUP-1:iteration-1": () => {
      events.push("group-1-tree-rubrics-started");
      return { rawOutput: jsonBlock(makeTreeRubrics("GROUP-1", "src/group-a.txt")) };
    },
    "tree-grading:GROUP-1:iteration-1:grader-1": (request) => {
      const rubric = makeTreeRubrics("GROUP-1", "src/group-a.txt");
      events.push("group-1-tree-grading-started");
      assert.equal(request.context.finalOutputFiles.files[0].path, "src/group-a.txt");
      return {
        rawOutput: jsonBlock(
          makeTreeGradingArtifact({
            graderId: 1,
            groupId: "GROUP-1",
            iteration: 1,
            rubric,
            evidenceFile: "src/group-a.txt",
          }),
        ),
      };
    },
    "qa:GROUP-1:iteration-1": () => {
      events.push("group-1-qa-started");
      return { rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1)) };
    },
    "qa:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-2", 1)),
    },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": { rawOutput: jsonBlock(makeFinalAssessmentArtifact()) },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine: new SerialAssertingMergeEngine({ repoRoot, artifactStore: store }),
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-EARLY-REVIEW",
  });

  assert.equal(result.verdict, "accept");
  assert.ok(
    events.indexOf("group-1-validation-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
  assert.ok(
    events.indexOf("group-1-tree-rubrics-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
  assert.ok(
    events.indexOf("group-1-tree-grading-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
  assert.ok(
    events.indexOf("group-1-qa-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
});

test("failed tree grading immediately schedules retry before slower same-wave executions finish", async () => {
  const repoRoot = await createRepoFixture();
  const events = [];
  const proposalAOneDir = await createProposalDir({
    "src/group-a.txt": "needs retry\n",
  });
  const proposalATwoDir = await createProposalDir({
    "src/group-a.txt": "retry fixed\n",
  });
  const proposalBDir = await createProposalDir({
    "src/group-b.txt": "slow-b\n",
  });
  const workerGroups = [
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/group-a.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
    {
      group_id: "GROUP-2",
      tasks: ["TASK-002"],
      owned_files: ["src/group-b.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ];

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(["TASK-001", "TASK-002"], ["src/group-a.txt", "src/group-b.txt"]),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/group-a.txt",
            change_type: "modify",
            description: "Update group A file.",
            concerns: [],
          },
          {
            target: "src/group-b.txt",
            change_type: "modify",
            description: "Update group B file.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/group-a.txt"],
          proposalRef: "worker://GROUP-1/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: proposalAOneDir,
      },
    }),
    "execution:GROUP-1:iteration-2": (request) => {
      events.push("group-1-iteration-2-started");
      assert.equal(request.context.treeGradingFeedback.verdict, "fail");
      assert.equal(request.context.iterationPolicy.replan_blocker_prefix, "REPLAN_REQUIRED:");
      assert.deepEqual(request.context.iterationPolicy.allowed_files, ["src/group-a.txt"]);
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-1",
            iteration: 2,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-a.txt"],
            proposalRef: "worker://GROUP-1/iteration-2",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-1/iteration-2",
          path: proposalATwoDir,
        },
      };
    },
    "execution:GROUP-2:iteration-1": async (request) => {
      events.push("group-2-execution-started");
      await sleep(175);
      events.push("group-2-execution-finished");
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-2",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-b.txt"],
            proposalRef: "worker://GROUP-2/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-2/iteration-1",
          path: proposalBDir,
        },
      };
    },
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    "validation:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 2)),
    },
    "validation:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-2", 1)),
    },
    ...makeTreeStageResponses({
      groupId: "GROUP-1",
      iteration: 1,
      outputFile: "src/group-a.txt",
      failingNodeIds: ["B1-D1-01"],
    }),
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 2, outputFile: "src/group-a.txt" }),
    ...makeTreeStageResponses({ groupId: "GROUP-2", iteration: 1, outputFile: "src/group-b.txt" }),
    "qa:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 2)),
    },
    "qa:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-2", 1)),
    },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": { rawOutput: jsonBlock(makeFinalAssessmentArtifact()) },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine: new SerialAssertingMergeEngine({ repoRoot, artifactStore: store }),
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-EARLY-RETRY",
  });

  assert.equal(result.verdict, "accept");
  assert.ok(
    events.indexOf("group-1-iteration-2-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "group-a.txt"), "utf8"), "retry fixed\n");
});

test("failed QA schedules same-group retry with QA feedback before slower executions finish", async () => {
  const repoRoot = await createRepoFixture();
  const events = [];
  const proposalAOneDir = await createProposalDir({
    "src/group-a.txt": "qa issue\n",
  });
  const proposalATwoDir = await createProposalDir({
    "src/group-a.txt": "qa fixed\n",
  });
  const proposalBDir = await createProposalDir({
    "src/group-b.txt": "slow-b\n",
  });
  const workerGroups = [
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/group-a.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
    {
      group_id: "GROUP-2",
      tasks: ["TASK-002"],
      owned_files: ["src/group-b.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ];

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(["TASK-001", "TASK-002"], ["src/group-a.txt", "src/group-b.txt"]),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/group-a.txt",
            change_type: "modify",
            description: "Update group A file.",
            concerns: [],
          },
          {
            target: "src/group-b.txt",
            change_type: "modify",
            description: "Update group B file.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/group-a.txt"],
          proposalRef: "worker://GROUP-1/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: proposalAOneDir,
      },
    }),
    "execution:GROUP-1:iteration-2": (request) => {
      events.push("group-1-iteration-2-started");
      assert.equal(request.context.qaReport.status, "fail");
      assert.equal(request.context.qaReport.blocking_issues[0], "Scenario failed and needs same-group rework.");
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-1",
            iteration: 2,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-a.txt"],
            proposalRef: "worker://GROUP-1/iteration-2",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-1/iteration-2",
          path: proposalATwoDir,
        },
      };
    },
    "execution:GROUP-2:iteration-1": async (request) => {
      events.push("group-2-execution-started");
      await sleep(175);
      events.push("group-2-execution-finished");
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-2",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-b.txt"],
            proposalRef: "worker://GROUP-2/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-2/iteration-1",
          path: proposalBDir,
        },
      };
    },
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    "validation:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 2)),
    },
    "validation:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-2", 1)),
    },
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 1, outputFile: "src/group-a.txt" }),
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 2, outputFile: "src/group-a.txt" }),
    ...makeTreeStageResponses({ groupId: "GROUP-2", iteration: 1, outputFile: "src/group-b.txt" }),
    "qa:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1, { status: "fail" })),
    },
    "qa:GROUP-1:iteration-2": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 2)),
    },
    "qa:GROUP-2:iteration-1": {
      rawOutput: jsonBlock(makeQaArtifact("GROUP-2", 1)),
    },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": { rawOutput: jsonBlock(makeFinalAssessmentArtifact()) },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine: new SerialAssertingMergeEngine({ repoRoot, artifactStore: store }),
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-EARLY-QA-RETRY",
  });

  assert.equal(result.verdict, "accept");
  assert.ok(
    events.indexOf("group-1-iteration-2-started") < events.indexOf("group-2-execution-finished"),
    events.join(" -> "),
  );
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "group-a.txt"), "utf8"), "qa fixed\n");
});

test("tree grading waits for all graders to settle before surfacing a grader failure", async () => {
  const repoRoot = await createRepoFixture();
  const events = [];
  const proposalDir = await createProposalDir({
    "src/app.txt": "ready for grading\n",
  });
  const rubric = makeTreeRubrics("GROUP-1", "src/app.txt");
  const workerGroups = [
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/app.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ];

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: { rawOutput: jsonBlock(makePlanArtifact()) },
    architecture: { rawOutput: jsonBlock(makeArchitectureArtifact()) },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/app.txt"],
          proposalRef: "worker://GROUP-1/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: proposalDir,
      },
    }),
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    "tree-classification:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeTreeClassification("GROUP-1")),
    },
    "tree-rubric-generation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(rubric),
    },
    "tree-rubric-verification:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeTreeVerification("GROUP-1")),
    },
    "tree-rubric-refinement:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(rubric),
    },
    "tree-grading:GROUP-1:iteration-1:grader-1": async () => {
      events.push("grader-1-started");
      await sleep(5);
      events.push("grader-1-failed");
      throw new Error("synthetic grader failure");
    },
    "tree-grading:GROUP-1:iteration-1:grader-2": async () => {
      events.push("grader-2-started");
      await sleep(40);
      events.push("grader-2-finished");
      return {
        rawOutput: jsonBlock(
          makeTreeGradingArtifact({
            graderId: 2,
            groupId: "GROUP-1",
            iteration: 1,
            rubric,
          }),
        ),
      };
    },
    "tree-grading:GROUP-1:iteration-1:grader-3": async () => {
      events.push("grader-3-started");
      await sleep(45);
      events.push("grader-3-finished");
      return {
        rawOutput: jsonBlock(
          makeTreeGradingArtifact({
            graderId: 3,
            groupId: "GROUP-1",
            iteration: 1,
            rubric,
          }),
        ),
      };
    },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine: new SerialAssertingMergeEngine({ repoRoot, artifactStore: store }),
    maxStageRetries: 0,
  });

  await assert.rejects(
    () =>
      orchestrator.run({
        request: "补上 orchestrator skeleton 的runtime 代码",
        runId: "RUN-TEST-GRADER-SETTLED",
    }),
    /tree-grading stage failed: synthetic grader failure/,
  );
  assert.ok(events.includes("grader-1-started"), events.join(" -> "));
  assert.ok(events.includes("grader-2-started"), events.join(" -> "));
  assert.ok(events.includes("grader-3-started"), events.join(" -> "));
  assert.ok(
    events.indexOf("grader-1-failed") < events.indexOf("grader-2-finished"),
    events.join(" -> "),
  );
  assert.ok(
    events.indexOf("grader-1-failed") < events.indexOf("grader-3-finished"),
    events.join(" -> "),
  );
});

test("terminal execution reject stops same-wave groups before merge", async () => {
  const repoRoot = await createRepoFixture();
  const mergeCalls = [];
  const proposalBDir = await createProposalDir({
    "src/group-b.txt": "should not merge\n",
  });
  const workerGroups = [
    {
      group_id: "GROUP-1",
      tasks: ["TASK-001"],
      owned_files: ["src/group-a.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
    {
      group_id: "GROUP-2",
      tasks: ["TASK-002"],
      owned_files: ["src/group-b.txt"],
      depends_on_groups: [],
      required_skills: [],
    },
  ];
  const mergeEngine = {
    async mergeProposal({ groupId, iteration, baseRef, proposal, changedFiles = [] }) {
      mergeCalls.push(groupId);
      await applyProposalFiles(repoRoot, proposal.path, changedFiles);
      return {
        report: {
          version: "1.0",
          group_id: groupId,
          iteration,
          base_ref: baseRef,
          mainline_ref: `workspace://${groupId}-before`,
          proposal_ref: proposal.ref,
          result_ref: `workspace://${groupId}-merged`,
          status: "merged",
          conflicts: [],
        },
      };
    },
  };

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(["TASK-001", "TASK-002"], ["src/group-a.txt", "src/group-b.txt"]),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact([
          {
            target: "src/group-a.txt",
            change_type: "modify",
            description: "Update group A file.",
            concerns: [],
          },
          {
            target: "src/group-b.txt",
            change_type: "modify",
            description: "Update group B file.",
            concerns: [],
          },
        ]),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock({
        version: "1.0",
        group_id: "GROUP-1",
        iteration: 1,
        base_ref: request.context.baseRef,
        proposal_ref: "worker://GROUP-1/iteration-1",
        applied_skills: [],
        status: "blocked",
        changed_files: [],
        requirements_covered: [],
        frontend_design_summary: null,
        tests_run: [],
        follow_up_notes: [],
        blockers: [
          "REPLAN_REQUIRED: retry needs files outside worker_group.owned_files",
        ],
      }),
    }),
    "execution:GROUP-2:iteration-1": async (request) => {
      await sleep(50);
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: "GROUP-2",
            iteration: 1,
            baseRef: request.context.baseRef,
            changedFiles: ["src/group-b.txt"],
            proposalRef: "worker://GROUP-2/iteration-1",
          }),
        ),
        proposal: {
          ref: "worker://GROUP-2/iteration-1",
          path: proposalBDir,
        },
      };
    },
  };

  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: new ScriptedStageRunner(responses),
    mergeEngine,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-TERMINAL-STOP",
  });

  assert.equal(result.verdict, "reject");
  assert.equal(result.restartFrom, "dispatch");
  assert.deepEqual(mergeCalls, []);
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "group-b.txt"), "utf8"), "base-b\n");
});

test("subagent stages respect the configured concurrent slot limit", async () => {
  const repoRoot = await createRepoFixture();
  const files = ["src/group-a.txt", "src/group-b.txt", "src/group-c.txt", "src/group-d.txt"];
  await Promise.all(
    files.slice(2).map((file, index) =>
      fs.writeFile(path.join(repoRoot, file), `base-${index + 3}\n`, "utf8"),
    ),
  );
  const proposalDirs = await Promise.all(
    files.map((file, index) => createProposalDir({ [file]: `updated-${index + 1}\n` })),
  );
  const workerGroups = files.map((file, index) => ({
    group_id: `GROUP-${index + 1}`,
    tasks: [`TASK-${String(index + 1).padStart(3, "0")}`],
    owned_files: [file],
    depends_on_groups: [],
    required_skills: [],
  }));
  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: {
      rawOutput: jsonBlock(
        makePlanArtifact(
          workerGroups.map((group) => group.tasks[0]),
          files,
        ),
      ),
    },
    architecture: {
      rawOutput: jsonBlock(
        makeArchitectureArtifact(
          files.map((file) => ({
            target: file,
            change_type: "modify",
            description: `Update ${file}.`,
            concerns: [],
          })),
        ),
      ),
    },
    dispatch: {
      rawOutput: jsonBlock(makeDispatchArtifact(workerGroups)),
    },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": { rawOutput: jsonBlock(makeFinalAssessmentArtifact()) },
  };

  workerGroups.forEach((group, index) => {
    const iteration = 1;
    responses[`execution:${group.group_id}:iteration-${iteration}`] = async (request) => {
      await sleep(15);
      return {
        rawOutput: jsonBlock(
          makeExecutionArtifact({
            groupId: group.group_id,
            iteration,
            baseRef: request.context.baseRef,
            changedFiles: group.owned_files,
            proposalRef: `worker://${group.group_id}/iteration-${iteration}`,
          }),
        ),
        proposal: {
          ref: `worker://${group.group_id}/iteration-${iteration}`,
          path: proposalDirs[index],
        },
      };
    };
    responses[`validation:${group.group_id}:iteration-${iteration}`] = {
      rawOutput: jsonBlock(makeValidationArtifact(group.group_id, iteration)),
    };
    Object.assign(
      responses,
      makeTreeStageResponses({
        groupId: group.group_id,
        iteration,
        outputFile: group.owned_files[0],
      }),
    );
    responses[`qa:${group.group_id}:iteration-${iteration}`] = {
      rawOutput: jsonBlock(makeQaArtifact(group.group_id, iteration)),
    };
  });

  const runner = new ScriptedStageRunner(responses);
  const originalRunStage = runner.runStage.bind(runner);
  let active = 0;
  let maxActive = 0;
  runner.runStage = async (request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await sleep(5);
      return await originalRunStage(request);
    } finally {
      active -= 1;
    }
  };
  const store = new ArtifactStore({ repoRoot });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    artifactStore: store,
    mergeEngine: new SerialAssertingMergeEngine({ repoRoot, artifactStore: store }),
    maxConcurrentSubagents: 3,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-SLOT-LIMIT",
  });

  assert.equal(result.verdict, "accept");
  assert.ok(maxActive <= 3, `expected max active stages <= 3, got ${maxActive}`);
});

test("execution can request re-dispatch when retry expansion exceeds ownership", async () => {
  const repoRoot = await createRepoFixture();
  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: { rawOutput: jsonBlock(makePlanArtifact()) },
    architecture: { rawOutput: jsonBlock(makeArchitectureArtifact()) },
    dispatch: {
      rawOutput: jsonBlock(
        makeDispatchArtifact([
          {
            group_id: "GROUP-1",
            tasks: ["TASK-001"],
            owned_files: ["src/app.txt"],
            depends_on_groups: [],
            required_skills: [],
          },
        ]),
      ),
    },
    "execution:GROUP-1:iteration-1": (request) => {
      assert.equal(request.context.iterationPolicy.replan_blocker_prefix, "REPLAN_REQUIRED:");
      return {
        rawOutput: jsonBlock({
          version: "1.0",
          group_id: "GROUP-1",
          iteration: 1,
          base_ref: request.context.baseRef,
          proposal_ref: "worker://GROUP-1/iteration-1",
          applied_skills: [],
          status: "blocked",
          changed_files: [],
          requirements_covered: [],
          frontend_design_summary: null,
          tests_run: [],
          follow_up_notes: [],
          blockers: [
            "REPLAN_REQUIRED: retry needs files outside worker_group.owned_files",
          ],
        }),
      };
    },
  };

  const runner = new ScriptedStageRunner(responses);
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
  });

  const result = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-REPLAN-REQUIRED",
  });

  assert.equal(result.verdict, "reject");
  assert.equal(result.restartFrom, "dispatch");
});

test("resumeAfterConflict consumes conflict-resolution artifacts and passes recovery context to final assessment", async () => {
  const repoRoot = await createRepoFixture();
  const proposalDir = await createProposalDir({
    "src/app.txt": "worker proposal\n",
  });

  const responses = {
    spec: { rawOutput: jsonBlock(makeSpecArtifact()) },
    plan: { rawOutput: jsonBlock(makePlanArtifact()) },
    architecture: { rawOutput: jsonBlock(makeArchitectureArtifact()) },
    dispatch: {
      rawOutput: jsonBlock(
        makeDispatchArtifact([
          {
            group_id: "GROUP-1",
            tasks: ["TASK-001"],
            owned_files: ["src/app.txt"],
            depends_on_groups: [],
            required_skills: [],
          },
        ]),
      ),
    },
    "execution:GROUP-1:iteration-1": (request) => ({
      rawOutput: jsonBlock(
        makeExecutionArtifact({
          groupId: "GROUP-1",
          iteration: 1,
          baseRef: request.context.baseRef,
          changedFiles: ["src/app.txt"],
          proposalRef: "worker://GROUP-1/iteration-1",
        }),
      ),
      proposal: {
        ref: "worker://GROUP-1/iteration-1",
        path: proposalDir,
      },
    }),
    "validation:GROUP-1:iteration-1": {
      rawOutput: jsonBlock(makeValidationArtifact("GROUP-1", 1)),
    },
    ...makeTreeStageResponses({ groupId: "GROUP-1", iteration: 1, outputFile: "src/app.txt" }),
    "qa:GROUP-1:iteration-1": { rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1)) },
    doc: { rawOutput: jsonBlock(makeDocArtifact()) },
    "final-assessment": (request) => {
      assert.equal(request.context.conflictResolutions.length, 1);
      assert.equal(request.context.previousAssessments.length, 1);
      return {
        rawOutput: jsonBlock(
          makeFinalAssessmentArtifact({
            iteration: 2,
            summary: "Resume path accepted after manual merge resolution.",
          }),
        ),
      };
    },
  };

  const runner = new ScriptedStageRunner(responses);
  const store = new ArtifactStore({ repoRoot });
  const mergeEngine = new ConflictOnceMergeEngine({ repoRoot, artifactStore: store });
  const orchestrator = new PipelineOrchestrator({
    repoRoot,
    stageRunner: runner,
    reviewMode: "PRE",
    artifactStore: store,
    mergeEngine,
  });

  const paused = await orchestrator.run({
    request: "补上 orchestrator skeleton 的runtime 代码",
    runId: "RUN-TEST-PAUSE",
  });
  assert.equal(paused.verdict, "pause_for_human");
  const pausedSummary = JSON.parse(
    await fs.readFile(path.join(repoRoot, ".pipeline-last-run-summary.json"), "utf8"),
  );
  assert.equal(pausedSummary.codex_pet_events.at(-1).state, "waiting");
  assert.match(
    await fs.readFile(
      path.join(repoRoot, ".pipeline-workspace", "logs", "codex-pet-events.jsonl"),
      "utf8",
    ),
    /"state":"waiting"/,
  );

  await fs.writeFile(path.join(repoRoot, "src", "app.txt"), "resolved manually\n", "utf8");
  await store.writeAssessmentHistory(
    1,
    makeFinalAssessmentArtifact({
      iteration: 1,
      verdict: "reject",
      dimension_scores: [
        { dimension: "Requirement Completeness", score: "weak", evidence: "Previous delivery stopped at merge." },
        { dimension: "Implementation Quality", score: "adequate", evidence: "Implementation itself was mostly sound." },
        { dimension: "Architectural Soundness", score: "adequate", evidence: "Architecture stayed valid." },
        { dimension: "Test Confidence", score: "weak", evidence: "QA did not run before the pause." },
        { dimension: "Documentation Accuracy", score: "adequate", evidence: "Docs were not evaluated yet." },
        { dimension: "Overall Cohesion", score: "adequate", evidence: "Run paused before cohesion could be judged." },
      ],
      improvement_areas: [
        {
          dimension: "Requirement Completeness",
          issue: "Delivery paused at merge conflict.",
          recommendation: "Resume from merge after human resolution.",
        },
      ],
      restart_from: "merge",
      restart_rationale: "Manual conflict resolution is required before the run can continue.",
      summary: "Previous run was rejected until the merge conflict was resolved.",
    }),
  );

  const resumed = await orchestrator.resumeAfterConflict({
    runId: "RUN-TEST-RESUME",
    conflictResolution: {
      version: "1.0",
      merge_report_ref: "merge/GROUP-1/iteration-1-merge-report.json",
      resolver: "human",
      resolution_summary: "Applied the desired result directly in the main workspace.",
      resolved_files: ["src/app.txt"],
      validation_run: [
        {
          command: "manual review",
          status: "passed",
          details: "Conflict was resolved and the final file contents were verified.",
        },
      ],
    },
  });

  assert.equal(resumed.verdict, "accept");
  assert.equal(await fs.readFile(path.join(repoRoot, "src", "app.txt"), "utf8"), "resolved manually\n");
  const summary = JSON.parse(
    await fs.readFile(path.join(repoRoot, ".pipeline-last-run-summary.json"), "utf8"),
  );
  assert.equal(summary.verdict, "accept");
});
