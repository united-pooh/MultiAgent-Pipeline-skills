import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { RunStore } from "../src/run-store.js";
import { createTempRepo, fixedClock } from "./helpers.js";

test("RunStore creates idempotent durable runs and event logs", async () => {
  const repoRoot = await createTempRepo();
  const store = new RunStore({ repoRoot, clock: fixedClock });

  const first = await store.createRun({
    objective: "Migrate pipeline to MCP",
    idempotencyKey: "mcp-migration",
    thresholds: {
      maxIterations: 12,
      maxRuntimeMs: 86_400_000,
    },
  });
  const second = await store.createRun({
    objective: "Migrate pipeline to MCP",
    idempotencyKey: "mcp-migration",
    thresholds: {
      maxIterations: 12,
      maxRuntimeMs: 86_400_000,
    },
  });

  assert.equal(second.run.runId, first.run.runId);
  assert.equal(second.idempotent, true);
  assert.equal((await store.listRuns()).length, 1);
  assert.equal(first.config.thresholds.maxIterations, 12);
  assert.ok(first.events.some((event) => event.type === "run.created"));
  await fs.access(path.join(repoRoot, ".pipeline-runs", first.run.runId, "state.json"));
});

test("RunStore records stage output, research, checkpoint metadata, and cancellation", async () => {
  const repoRoot = await createTempRepo();
  const store = new RunStore({ repoRoot, clock: fixedClock });
  const created = await store.createRun({
    objective: "Keep durable state",
  });
  const runId = created.run.runId;

  const stage = await store.recordStage({
    runId,
    stage: "spec",
    artifactType: "spec",
    payload: { version: "1.0", iteration: 1 },
  });
  const research = await store.recordResearch({
    runId,
    query: "MCP durable tasks",
    sources: ["https://modelcontextprotocol.io/extensions/tasks/overview"],
    notes: ["Use durable run IDs even when MCP Tasks support is absent."],
  });
  const checkpoint = await store.commitCheckpoint({
    runId,
    message: "feat(pipeline): :sparkles: checkpoint",
    dryRun: true,
  });
  const cancelled = await store.cancelRun({ runId, reason: "test cancellation" });

  assert.equal(stage.stage, "spec");
  assert.equal(research.query, "MCP durable tasks");
  assert.equal(checkpoint.status, "recorded");
  assert.equal(cancelled.state.status, "cancelled");
  assert.equal((await store.exportSummary(runId)).checkpointCount, 1);
});
