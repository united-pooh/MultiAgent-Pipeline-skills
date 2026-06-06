import assert from "node:assert/strict";
import test from "node:test";

import { createMcpProtocol } from "../src/protocol.js";
import { createTempRepo, fixedClock, skillRoot } from "./helpers.js";

test("protocol exposes MCP capabilities, tools, resources, and prompts", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const initialized = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test", version: "0.0.0" },
    },
  });
  const tools = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  const prompts = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "prompts/list",
  });

  assert.equal(initialized.result.serverInfo.name, "multi-agent-pipeline-mcp");
  assert.equal(initialized.result.capabilities.tools.listChanged, false);
  assert.ok(tools.result.tools.some((tool) => tool.name === "pipeline.start_run"));
  assert.ok(prompts.result.prompts.some((prompt) => prompt.name === "pipeline/execution"));
});

test("protocol does not respond to JSON-RPC notifications", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const initialized = await protocol.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const listNotification = await protocol.handleMessage({
    jsonrpc: "2.0",
    method: "tools/list",
  });

  assert.equal(initialized, null);
  assert.equal(listNotification, null);
});

test("protocol starts a durable run and reads it through a resource", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const started = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "pipeline.start_run",
      arguments: {
        objective: "Build MCP server",
        idempotencyKey: "server",
      },
    },
  });
  const runId = started.result.structuredContent.run.runId;
  const resource = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: {
      uri: `pipeline://runs/${runId}/state`,
    },
  });

  assert.equal(started.result.structuredContent.run.objective, "Build MCP server");
  assert.equal(JSON.parse(resource.result.contents[0].text).run.runId, runId);
});

test("protocol lists resources and returns stage prompts with durable run context", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });
  const started = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "pipeline.start_run",
      arguments: {
        objective: "Prompt and resource smoke",
      },
    },
  });
  const runId = started.result.structuredContent.run.runId;

  const resources = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
  });
  const runs = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: {
      uri: "pipeline://runs",
    },
  });
  const prompt = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "prompts/get",
    params: {
      name: "pipeline/execution",
      arguments: { runId },
    },
  });

  assert.ok(resources.result.resources.some((resource) => resource.uri === "pipeline://runs"));
  assert.equal(JSON.parse(runs.result.contents[0].text).runs.length, 1);
  assert.ok(prompt.result.messages[0].content.text.includes(runId));
});

test("protocol validates artifacts with existing pipeline contracts", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const result = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "pipeline.validate_artifact",
      arguments: {
        artifactType: "execution-report",
        artifact: {
          version: "1.0",
          group_id: "GROUP-1",
          iteration: 1,
          base_ref: "bases/group-1.json",
          proposal_ref: "worker://GROUP-1/1",
          applied_skills: [],
          status: "blocked",
          changed_files: [],
          requirements_covered: [],
          frontend_design_summary: null,
          tests_run: [],
          follow_up_notes: [],
          blockers: ["REPLAN_REQUIRED: retry requires a different worker split"],
        },
        context: { requiredSkills: [] },
      },
    },
  });

  assert.equal(result.result.structuredContent.artifact.status, "blocked");
});
