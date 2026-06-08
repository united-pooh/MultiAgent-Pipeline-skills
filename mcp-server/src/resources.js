import fs from "node:fs/promises";
import path from "node:path";

import { METHODOLOGY_PROMPTS, STAGE_PROMPTS } from "./prompts.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const CONTRACT_RESOURCE_TYPES = [
  "spec",
  "plan",
  "architecture",
  "dispatch",
  "execution-report",
  "validation-report",
  "tree-classification",
  "tree-rubrics",
  "tree-rubric-verification",
  "tree-rubrics-refined",
  "tree-grading-individual",
  "tree-grading-feedback",
  "qa-report",
  "doc-report",
  "final-assessment",
  "research-harness-state",
  "context-manifest",
  "agent-trace",
  "state-store-snapshot",
  "cache-observability-report",
  "governance-report",
  "protocol-dag",
  "serving-profile",
  "latent-communication-experiment",
];

const TOOL_CATEGORY_BY_NAME = new Map([
  ["pipeline.start_run", "run"],
  ["pipeline.get_run", "run"],
  ["pipeline.list_runs", "run"],
  ["pipeline.cancel_run", "control"],
  ["pipeline.resume_run", "control"],
  ["pipeline.submit_human_input", "human-input"],
  ["pipeline.run_stage", "stage"],
  ["pipeline.validate_artifact", "validation"],
  ["pipeline.inspect_workspace", "workspace"],
  ["pipeline.export_summary", "run"],
  ["pipeline.commit_checkpoint", "git"],
  ["pipeline.research", "research"],
  ["pipeline.install_codex_adapter", "adapter"],
]);

function textResource(uri, text, mimeType = "application/json") {
  return {
    contents: [
      {
        uri,
        mimeType,
        text: typeof text === "string" ? text : JSON.stringify(text, null, 2),
      },
    ],
  };
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function compactToolCategory(name) {
  return TOOL_CATEGORY_BY_NAME.get(name) ?? "other";
}

function compactToolsResource() {
  return {
    version: "1.0",
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      category: compactToolCategory(tool.name),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function methodologyIndexResource() {
  return `# Internal Methodologies

The Multi-Agent Pipeline MCP server owns these methodology references. Use them
through resources or prompts without depending on separate host skill packages.

- pipeline://methodologies/superpowers
- pipeline://methodologies/brainstorming
- pipeline://methodologies/frontend-design

Prompts:

- pipeline/methodology/superpowers
- pipeline/methodology/brainstorming
- pipeline/methodology/frontend-design
`;
}

export async function listResources({ store }) {
  const runs = await store.listRuns();
  const runResources = runs.flatMap((run) => [
    {
      uri: `pipeline://runs/${run.runId}/state`,
      name: `${run.runId} state`,
      title: `${run.runId} State`,
      description: "Durable pipeline run state.",
      mimeType: "application/json",
    },
    {
      uri: `pipeline://runs/${run.runId}/events`,
      name: `${run.runId} events`,
      title: `${run.runId} Events`,
      description: "Durable pipeline run event stream.",
      mimeType: "application/jsonl",
    },
    {
      uri: `pipeline://runs/${run.runId}/research`,
      name: `${run.runId} research`,
      title: `${run.runId} Research`,
      description: "Research records for the run.",
      mimeType: "application/json",
    },
  ]);

  return [
    {
      uri: "pipeline://runs",
      name: "runs",
      title: "Pipeline Runs",
      description: "List of durable pipeline runs.",
      mimeType: "application/json",
    },
    {
      uri: "pipeline://workspace/summary",
      name: "workspace-summary",
      title: "Workspace Summary",
      description: "Pipeline workspace and installation summary.",
      mimeType: "application/json",
    },
    {
      uri: "pipeline://tools/compact",
      name: "tools-compact",
      title: "Compact Tool Surface",
      description: "Compact tool metadata without schemas or long descriptions.",
      mimeType: "application/json",
    },
    {
      uri: "pipeline://methodologies",
      name: "methodologies",
      title: "Internal Methodologies",
      description: "Repo-owned methodology index for pipeline stages.",
      mimeType: "text/markdown",
    },
    {
      uri: "pipeline://methodologies/superpowers",
      name: "methodology-superpowers",
      title: "Superpowers Methodology",
      description: "Repo-owned Superpowers methodology reference.",
      mimeType: "text/markdown",
    },
    {
      uri: "pipeline://methodologies/brainstorming",
      name: "methodology-brainstorming",
      title: "Brainstorming Methodology",
      description: "Repo-owned Brainstorming methodology reference.",
      mimeType: "text/markdown",
    },
    {
      uri: "pipeline://methodologies/frontend-design",
      name: "methodology-frontend-design",
      title: "Frontend Design Methodology",
      description: "Repo-owned frontend design capability reference.",
      mimeType: "text/markdown",
    },
    ...CONTRACT_RESOURCE_TYPES.map((artifactType) => ({
      uri: `pipeline://contracts/${artifactType}`,
      name: `contract-${artifactType}`,
      title: `${artifactType} Contract`,
      description: "Pipeline artifact contract reference.",
      mimeType: "text/markdown",
    })),
    ...STAGE_PROMPTS.map(([name]) => ({
      uri: `pipeline://prompts/${name.slice("pipeline/".length)}`,
      name: `prompt-${name.slice("pipeline/".length)}`,
      title: `${name} Prompt`,
      description: "Pipeline stage prompt source.",
      mimeType: "text/markdown",
    })),
    ...METHODOLOGY_PROMPTS.map(([name]) => ({
      uri: `pipeline://prompts/${name.slice("pipeline/".length)}`,
      name: `prompt-${name.slice("pipeline/".length).replaceAll("/", "-")}`,
      title: `${name} Prompt`,
      description: "Pipeline methodology prompt source.",
      mimeType: "text/markdown",
    })),
    ...runResources,
  ].sort((left, right) => left.uri.localeCompare(right.uri));
}

export function listResourceTemplates() {
  return [
    {
      uriTemplate: "pipeline://runs/{runId}/state",
      name: "run-state",
      title: "Run State",
      description: "Durable state for one pipeline run.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "pipeline://runs/{runId}/artifacts/{name}",
      name: "run-artifact",
      title: "Run Artifact",
      description: "Artifact file stored under one durable run.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "pipeline://contracts/{artifactType}",
      name: "artifact-contract",
      title: "Artifact Contract",
      description: "Contract documentation for one artifact type.",
      mimeType: "text/markdown",
    },
  ];
}

export async function readResource(uri, { store, skillRoot }) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "pipeline:") {
    throw new Error(`Unsupported resource URI: ${uri}`);
  }

  if (parsed.hostname === "runs" && parsed.pathname === "") {
    return textResource(uri, { runs: await store.listRuns() });
  }

  if (parsed.hostname === "workspace" && parsed.pathname === "/summary") {
    return textResource(uri, await store.inspectWorkspace());
  }

  if (parsed.hostname === "tools" && parsed.pathname === "/compact") {
    return textResource(uri, compactToolsResource());
  }

  if (parsed.hostname === "methodologies") {
    if (parsed.pathname === "") {
      return textResource(uri, methodologyIndexResource(), "text/markdown");
    }

    const methodology = parsed.pathname.slice(1);
    const promptFile = METHODOLOGY_PROMPTS.find(([name]) => name === `pipeline/methodology/${methodology}`)?.[1];
    if (!promptFile) {
      throw new Error(`Unknown methodology resource: ${uri}`);
    }

    const text = await fs.readFile(path.join(skillRoot, "references", "methodologies", promptFile), "utf8");
    return textResource(uri, text, "text/markdown");
  }

  if (parsed.hostname === "contracts") {
    const contractsText = await fs.readFile(path.join(skillRoot, "references", "contracts.md"), "utf8");
    return textResource(uri, contractsText, "text/markdown");
  }

  if (parsed.hostname === "prompts") {
    const stage = parsed.pathname.slice(1);
    const promptFile =
      STAGE_PROMPTS.find(([name]) => name === `pipeline/${stage}`)?.[1]
      ?? METHODOLOGY_PROMPTS.find(([name]) => name === `pipeline/${stage}`)?.[1];
    if (!promptFile) {
      throw new Error(`Unknown prompt resource: ${uri}`);
    }

    const promptPath = stage.startsWith("methodology/")
      ? path.join(skillRoot, "references", "methodologies", promptFile)
      : path.join(skillRoot, "agents", promptFile);
    const text = await fs.readFile(promptPath, "utf8");
    return textResource(uri, text, "text/markdown");
  }

  if (parsed.hostname === "runs") {
    const [runId, section, artifactName] = parsed.pathname.split("/").filter(Boolean);
    if (!runId) {
      return textResource(uri, { runs: await store.listRuns() });
    }

    if (section === "state") {
      return textResource(uri, await store.getRun(runId));
    }

    if (section === "events") {
      return textResource(uri, (await store.readEvents(runId)).map((entry) => JSON.stringify(entry)).join("\n"), "application/jsonl");
    }

    if (section === "research") {
      const runDir = store.runDir(runId);
      const state = await store.readState(runId);
      const records = [];
      for (const recordRef of state.researchRecords ?? []) {
        records.push(await readJsonIfExists(path.join(runDir, recordRef), null));
      }

      return textResource(uri, { records: records.filter(Boolean) });
    }

    if (section === "artifacts" && artifactName) {
      if (!/^[a-zA-Z0-9._-]+$/.test(artifactName)) {
        throw new Error(`Invalid artifact resource name: ${artifactName}`);
      }

      const artifactPath = path.join(store.runDir(runId), "artifacts", artifactName);
      const text = await fs.readFile(artifactPath, "utf8");
      return textResource(uri, text);
    }
  }

  throw new Error(`Resource not found: ${uri}`);
}
