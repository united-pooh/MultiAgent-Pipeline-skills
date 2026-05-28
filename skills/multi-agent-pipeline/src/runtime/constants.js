import os from "node:os";
import path from "node:path";

export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;
export const DEFAULT_REVIEW_MODE = "EME";
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
  },
  plan: {
    promptFile: "agents/plan.md",
    referenceFiles: ["references/contracts.md"],
  },
  architecture: {
    promptFile: "agents/architecture.md",
    referenceFiles: ["references/contracts.md"],
  },
  dispatch: {
    promptFile: "agents/dispatch.md",
    referenceFiles: ["references/contracts.md"],
  },
  execution: {
    promptFile: "agents/execution.md",
    referenceFiles: ["references/contracts.md"],
  },
  validation: {
    promptFile: "agents/validation.md",
    referenceFiles: ["references/contracts.md"],
  },
  review: {
    promptFile: "agents/review.md",
    referenceFiles: ["references/contracts.md", "references/pre-rubric.md"],
  },
  qa: {
    promptFile: "agents/qa.md",
    referenceFiles: ["references/contracts.md"],
  },
  doc: {
    promptFile: "agents/doc.md",
    referenceFiles: ["references/contracts.md"],
  },
  "final-assessment": {
    promptFile: "agents/final-assessment.md",
    referenceFiles: ["references/contracts.md"],
  },
});

const CODEX_STAGE_AGENT_TYPES = Object.freeze({
  spec: "default",
  plan: "default",
  architecture: "default",
  dispatch: "default",
  execution: "worker",
  validation: "worker",
  review: "default",
  qa: "worker",
  doc: "worker",
  "final-assessment": "default",
});

function buildCodexStageProfiles() {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(STAGE_FILES).map(([stage, files]) => [
        stage,
        {
          ...DEFAULT_SUBAGENT_PROFILE,
          ...files,
          agentType: CODEX_STAGE_AGENT_TYPES[stage],
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
