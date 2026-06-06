import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateArtifact } from "../../skills/multi-agent-pipeline/src/index.js";

function jsonSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export const TOOL_DEFINITIONS = [
  {
    name: "pipeline.start_run",
    title: "Start Durable Pipeline Run",
    description: "Create or return an idempotent durable pipeline run under .pipeline-runs.",
    inputSchema: jsonSchema(
      {
        objective: { type: "string" },
        input: { type: "object", additionalProperties: true },
        thresholds: { type: "object", additionalProperties: true },
        metadata: { type: "object", additionalProperties: true },
        idempotencyKey: { type: ["string", "null"] },
        mode: { type: "string", enum: ["client_orchestrated", "dry_run", "runtime"] },
      },
      ["objective"],
    ),
  },
  {
    name: "pipeline.get_run",
    title: "Get Pipeline Run",
    description: "Read durable state, config, and events for a run.",
    inputSchema: jsonSchema({ runId: { type: "string" } }, ["runId"]),
  },
  {
    name: "pipeline.list_runs",
    title: "List Pipeline Runs",
    description: "List durable pipeline runs in deterministic order.",
    inputSchema: jsonSchema({}),
  },
  {
    name: "pipeline.cancel_run",
    title: "Cancel Pipeline Run",
    description: "Cooperatively cancel a durable run.",
    inputSchema: jsonSchema(
      {
        runId: { type: "string" },
        reason: { type: "string" },
      },
      ["runId"],
    ),
  },
  {
    name: "pipeline.resume_run",
    title: "Resume Pipeline Run",
    description: "Resume a paused or cancelled durable run.",
    inputSchema: jsonSchema(
      {
        runId: { type: "string" },
        reason: { type: "string" },
      },
      ["runId"],
    ),
  },
  {
    name: "pipeline.submit_human_input",
    title: "Submit Human Input",
    description: "Persist human input for a run that needs clarification or conflict resolution.",
    inputSchema: jsonSchema(
      {
        runId: { type: "string" },
        input: { type: "object", additionalProperties: true },
        note: { type: "string" },
      },
      ["runId", "input"],
    ),
  },
  {
    name: "pipeline.run_stage",
    title: "Record Pipeline Stage",
    description: "Persist one stage handoff or result inside a durable run.",
    inputSchema: jsonSchema(
      {
        runId: { type: "string" },
        stage: { type: "string" },
        status: { type: "string" },
        artifactType: { type: ["string", "null"] },
        payload: { type: "object", additionalProperties: true },
      },
      ["runId", "stage"],
    ),
  },
  {
    name: "pipeline.validate_artifact",
    title: "Validate Pipeline Artifact",
    description: "Validate a pipeline artifact against the existing runtime contracts.",
    inputSchema: jsonSchema(
      {
        artifactType: { type: "string" },
        artifact: { type: "object", additionalProperties: true },
        context: { type: "object", additionalProperties: true },
      },
      ["artifactType", "artifact"],
    ),
  },
  {
    name: "pipeline.inspect_workspace",
    title: "Inspect Workspace",
    description: "Inspect pipeline workspace, run ledger, and installed adapter paths.",
    inputSchema: jsonSchema({}),
  },
  {
    name: "pipeline.export_summary",
    title: "Export Run Summary",
    description: "Return a compact structured summary for a durable run.",
    inputSchema: jsonSchema({ runId: { type: "string" } }, ["runId"]),
  },
  {
    name: "pipeline.commit_checkpoint",
    title: "Commit Checkpoint",
    description: "Record or create an orchestrator-owned git checkpoint for a run.",
    inputSchema: jsonSchema(
      {
        runId: { type: "string" },
        message: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean" },
        allowEmpty: { type: "boolean" },
      },
      ["runId", "message"],
    ),
  },
  {
    name: "pipeline.research",
    title: "Record Research",
    description: "Persist structured research queries, source URLs, excerpts, and notes.",
    inputSchema: jsonSchema(
      {
        runId: { type: ["string", "null"] },
        query: { type: "string" },
        sources: { type: "array", items: { type: ["string", "object"] } },
        fetchSources: { type: "boolean" },
        notes: { type: "array", items: { type: "string" } },
      },
      ["query"],
    ),
  },
  {
    name: "pipeline.install_codex_adapter",
    title: "Install Codex Adapter",
    description: "Report or sync the thin Codex adapter into ~/.codex/skills/multi-agent-pipeline.",
    inputSchema: jsonSchema({
      apply: { type: "boolean" },
      destination: { type: "string" },
    }),
  },
];

export function toToolResult(structuredContent) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
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

export async function callTool(name, args = {}, context) {
  const { store, repoRoot, skillRoot } = context;

  switch (name) {
    case "pipeline.start_run":
      return toToolResult(await store.createRun(args));
    case "pipeline.get_run":
      return toToolResult(await store.getRun(args.runId));
    case "pipeline.list_runs":
      return toToolResult({ runs: await store.listRuns() });
    case "pipeline.cancel_run":
      return toToolResult(await store.cancelRun(args));
    case "pipeline.resume_run":
      return toToolResult(await store.resumeRun(args));
    case "pipeline.submit_human_input":
      return toToolResult(await store.submitHumanInput(args));
    case "pipeline.run_stage":
      return toToolResult(await store.recordStage(args));
    case "pipeline.validate_artifact":
      return toToolResult({
        artifactType: args.artifactType,
        artifact: validateArtifact(args.artifactType, args.artifact, args.context ?? {}),
      });
    case "pipeline.inspect_workspace":
      return toToolResult(await store.inspectWorkspace());
    case "pipeline.export_summary":
      return toToolResult(await store.exportSummary(args.runId));
    case "pipeline.commit_checkpoint":
      return toToolResult(await store.commitCheckpoint(args));
    case "pipeline.research":
      return toToolResult(await store.recordResearch(args));
    case "pipeline.install_codex_adapter": {
      const destination = path.resolve(
        args.destination ?? path.join(os.homedir(), ".codex", "skills", "multi-agent-pipeline"),
      );
      const source = skillRoot;
      const result = {
        source,
        destination,
        applied: args.apply === true,
      };
      if (args.apply === true) {
        await fs.rm(destination, { recursive: true, force: true });
        await copyTree(source, destination);
      }

      return toToolResult(result);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function listTools() {
  return TOOL_DEFINITIONS.slice().sort((left, right) => left.name.localeCompare(right.name));
}
