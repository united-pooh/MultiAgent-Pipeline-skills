import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ArtifactStore,
  CODEX_PET_STATES,
  MergeEngine,
  PipelineOrchestrator,
  aggregateReviewFeedback,
  createCodexPetEvent,
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
    applied_skills: ["superpowers"],
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
    applied_skills: ["superpowers"],
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

function makeQaArtifact(groupId, iteration) {
  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    status: "pass",
    test_infrastructure: "configured",
    test_results: [
      {
        kind: "scenario",
        requirement_ids: ["REQ-001"],
        command: "manual scenario",
        status: "passed",
        details: "Pipeline runtime behavior validated via mocked run.",
      },
    ],
    blocking_issues: [],
    notes: [],
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
    skill_usage_summary: overrides.skill_usage_summary ?? [
      {
        scope: "spec",
        required_skills: ["superpowers"],
        applied_skills: ["superpowers"],
        issues: [],
      },
    ],
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

test("default stage profiles pin GPT-5.5 xhigh priority subagents", async () => {
  const catalog = loadStageCatalog(fixtureSourceRoot);
  const stages = [
    "spec",
    "plan",
    "architecture",
    "dispatch",
    "execution",
    "validation",
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

  assert.deepEqual(
    catalog.resolveStageProfile("review", { reviewMode: "PRE", reviewerId: 1 }),
    catalog.stageProfiles.review,
  );

  for (const reviewerId of [1, 2, 3]) {
    const profile = catalog.resolveStageProfile("review", { reviewMode: "EME", reviewerId });
    assert.equal(profile.model, "gpt-5.5", `reviewer-${reviewerId}`);
    assert.equal(profile.reasoningEffort, "xhigh", `reviewer-${reviewerId}`);
    assert.equal(profile.serviceTier, "priority", `reviewer-${reviewerId}`);
  }
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
    "review:GROUP-1:iteration-1:reviewer-1": (request) => {
      assert.equal(request.context.complexityReport.readability_conclusion, "high");
      return { rawOutput: jsonBlock(makeReviewArtifact(1)) };
    },
    "review:GROUP-1:iteration-1:reviewer-2": (request) => {
      assert.equal(request.context.complexityReport.status, "completed");
      return { rawOutput: jsonBlock(makeReviewArtifact(2)) };
    },
    "review:GROUP-1:iteration-1:reviewer-3": (request) => {
      assert.equal(request.context.complexityReport.function_count, 1);
      return { rawOutput: jsonBlock(makeReviewArtifact(3)) };
    },
    "qa:GROUP-1:iteration-1": (request) => {
      assert.equal(request.context.complexityReport.status, "completed");
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
    "review:GROUP-1:iteration-1:reviewer-1": {
      rawOutput: jsonBlock(makeReviewArtifact(1, { failingCriterion: "Code Quality" })),
    },
    "review:GROUP-1:iteration-2:reviewer-1": {
      rawOutput: jsonBlock(makeReviewArtifact(1)),
    },
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
    "review:GROUP-1:iteration-1:reviewer-1": { rawOutput: jsonBlock(makeReviewArtifact(1)) },
    "review:GROUP-2:iteration-1:reviewer-1": { rawOutput: jsonBlock(makeReviewArtifact(1)) },
    "qa:GROUP-1:iteration-1": async () => {
      qaTracker.active += 1;
      qaTracker.maxActive = Math.max(qaTracker.maxActive, qaTracker.active);
      try {
        await sleep(20);
        return { rawOutput: jsonBlock(makeQaArtifact("GROUP-1", 1)) };
      } finally {
        qaTracker.active -= 1;
      }
    },
    "qa:GROUP-2:iteration-1": async () => {
      qaTracker.active += 1;
      qaTracker.maxActive = Math.max(qaTracker.maxActive, qaTracker.active);
      try {
        await sleep(20);
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
    "review:GROUP-1:iteration-1:reviewer-1": { rawOutput: jsonBlock(makeReviewArtifact(1)) },
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
