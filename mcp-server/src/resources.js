import fs from "node:fs/promises";
import path from "node:path";

import { STAGE_PROMPTS } from "./prompts.js";

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
];

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

  if (parsed.hostname === "contracts") {
    const contractsText = await fs.readFile(path.join(skillRoot, "references", "contracts.md"), "utf8");
    return textResource(uri, contractsText, "text/markdown");
  }

  if (parsed.hostname === "prompts") {
    const stage = parsed.pathname.slice(1);
    const promptFile = STAGE_PROMPTS.find(([name]) => name === `pipeline/${stage}`)?.[1];
    if (!promptFile) {
      throw new Error(`Unknown prompt resource: ${uri}`);
    }

    const text = await fs.readFile(path.join(skillRoot, "agents", promptFile), "utf8");
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
