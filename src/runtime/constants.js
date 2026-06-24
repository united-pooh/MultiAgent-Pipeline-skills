import os from "node:os";
import path from "node:path";

export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;
export const DEFAULT_REVIEW_MODE = "EME";
export const DEFAULT_GRADER_COUNT = 3;
export const DEFAULT_GRADING_THRESHOLD = 0.8;
export const DEFAULT_REQUIRE_DEPTH_ONE_PASS = true;
export const DEFAULT_SUBAGENT_MODEL = "gpt-5.5";
export const DEFAULT_SUBAGENT_REASONING_EFFORT = "xhigh";
export const DEFAULT_SUBAGENT_SERVICE_TIER = "priority";

const DEFAULT_SUBAGENT_PROFILE = Object.freeze({
  model: DEFAULT_SUBAGENT_MODEL,
  reasoningEffort: DEFAULT_SUBAGENT_REASONING_EFFORT,
  serviceTier: DEFAULT_SUBAGENT_SERVICE_TIER,
});

const STAGE_FILES = Object.freeze({
  spec: {
    promptFile: "agents/spec.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/spec.json",
  },
  plan: {
    promptFile: "agents/plan.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/plan.json",
  },
  architecture: {
    promptFile: "agents/architecture.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/architecture.json",
  },
  dispatch: {
    promptFile: "agents/dispatch.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/dispatch.json",
  },
  execution: {
    promptFile: "agents/execution.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/execution-report.json",
  },
  validation: {
    promptFile: "agents/validation.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/validation-report.json",
  },
  "tree-classification": {
    promptFile: "agents/tree-classification.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/tree-classification.json",
  },
  "tree-rubric-generation": {
    promptFile: "agents/tree-rubric-generation.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/tree-rubrics.json",
  },
  "tree-rubric-verification": {
    promptFile: "agents/tree-rubric-verification.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/tree-rubric-verification.json",
  },
  "tree-rubric-refinement": {
    promptFile: "agents/tree-rubric-refinement.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/tree-rubrics-refined.json",
  },
  "tree-grading": {
    promptFile: "agents/tree-grading.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/tree-grading-individual.json",
  },
  review: {
    promptFile: "agents/review.md",
    referenceFiles: ["references/contracts.md", "references/pre-rubric.md"],
    artifactTemplateFile: "templates/artifacts/review-individual.json",
  },
  qa: {
    promptFile: "agents/qa.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/qa-report.json",
  },
  doc: {
    promptFile: "agents/doc.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/doc-report.json",
  },
  "final-assessment": {
    promptFile: "agents/final-assessment.md",
    referenceFiles: ["references/contracts.md"],
    artifactTemplateFile: "templates/artifacts/final-assessment.json",
  },
});

const CODEX_STAGE_AGENT_TYPES = Object.freeze({
  spec: "default",
  plan: "default",
  architecture: "default",
  dispatch: "default",
  execution: "worker",
  validation: "worker",
  "tree-classification": "default",
  "tree-rubric-generation": "default",
  "tree-rubric-verification": "default",
  "tree-rubric-refinement": "default",
  "tree-grading": "default",
  review: "default",
  qa: "worker",
  doc: "worker",
  "final-assessment": "default",
});

const EXECUTION_WRITE_AUTHORITY = Object.freeze({
  repoFileMutationsAllowed: true,
  codeFileMutationsAllowed: true,
  mutationOwner: "execution-worker",
  repairRouting: "Execution owns implementation and retry repairs.",
});

const READ_ONLY_STAGE_WRITE_AUTHORITY = Object.freeze({
  repoFileMutationsAllowed: false,
  codeFileMutationsAllowed: false,
  mutationOwner: "execution-worker",
  repairRouting: "Read-only stages send failures and feedback back to Execution for repair.",
});

export const DEFAULT_ORCHESTRATOR_WRITE_AUTHORITY = Object.freeze({
  canModifyRepoFilesDirectly: false,
  allowedWrites: Object.freeze([
    "pipeline-workspace-bookkeeping",
    "pipeline-artifacts",
    "validation-results",
    "reports",
  ]),
  rule: "orchestrator/main agent must never modify code or repo files directly; file/code mutations are only allowed in Execution-stage worker subagents.",
});

function buildStageWriteAuthority() {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(STAGE_FILES).map((stage) => [
        stage,
        stage === "execution" ? EXECUTION_WRITE_AUTHORITY : READ_ONLY_STAGE_WRITE_AUTHORITY,
      ]),
    ),
  );
}

export const DEFAULT_STAGE_WRITE_AUTHORITY = buildStageWriteAuthority();

function buildCodexStageProfiles() {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(STAGE_FILES).map(([stage, files]) => [
        stage,
        {
          ...DEFAULT_SUBAGENT_PROFILE,
          ...files,
          agentType: CODEX_STAGE_AGENT_TYPES[stage],
          writeAuthority: DEFAULT_STAGE_WRITE_AUTHORITY[stage],
          waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
        },
      ]),
    ),
  );
}

function buildOpenCodeExpertStageProfiles() {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(STAGE_FILES).map(([stage, files]) => [
        stage,
        {
          host: "opencode",
          primaryAgent: "multi-agent-pipeline-expert",
          invocation: "task",
          agentMode: "subagent",
          reasoningEffort: "high",
          ...files,
          writeAuthority: DEFAULT_STAGE_WRITE_AUTHORITY[stage],
          waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
        },
      ]),
    ),
  );
}

export const PRE_CRITERIA = [
  "Correctness",
  "Security",
  "Performance",
  "Error Handling",
  "Code Quality",
  "Architecture Compliance",
  "Test Coverage",
  "Backward Compatibility",
];

export const TREE_RUBRIC_VALIDATION_DIMENSIONS = [
  "Core Criteria Preservation",
  "Added Criteria Justification",
  "Breadth And Depth Correctness",
  "Depth Discrimination",
  "Node Count And Coverage",
  "End-To-End Compliance",
  "Depth Enhancement Quality",
];

export const FINAL_ASSESSMENT_DIMENSIONS = [
  "Requirement Completeness",
  "Implementation Quality",
  "Architectural Soundness",
  "Test Confidence",
  "Documentation Accuracy",
  "Overall Cohesion",
];

export const INTEGRATION_STRATEGY = Object.freeze({
  merge_mode: "three_way",
  conflict_policy: "pause_for_human",
  base_strategy: "wave_start_snapshot",
});

export const ROOT_ARTIFACT_FILES = Object.freeze({
  spec: "spec.json",
  plan: "plan.json",
  architecture: "architecture.json",
  dispatch: "dispatch.json",
  "doc-report": "doc-report.json",
  "final-assessment": "final-assessment.json",
});

export const DEFAULT_CODEX_STAGE_PROFILES = buildCodexStageProfiles();
export const DEFAULT_OPENCODE_EXPERT_STAGE_PROFILES = buildOpenCodeExpertStageProfiles();
export const DEFAULT_STAGE_PROFILES = DEFAULT_CODEX_STAGE_PROFILES;

export const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export const BINARY_EXTENSIONS = new Set([
  ".ai",
  ".avif",
  ".bmp",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".sqlite",
  ".tif",
  ".tiff",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

export function defaultCodexHome() {
  if (process.env.CODEX_HOME) {
    return process.env.CODEX_HOME;
  }

  return path.join(os.homedir(), ".codex");
}
