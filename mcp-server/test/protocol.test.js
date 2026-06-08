import assert from "node:assert/strict";
import test from "node:test";

import { createMcpProtocol } from "../src/protocol.js";
import { createTempRepo, fixedClock, skillRoot } from "./helpers.js";

const NEW_AGENT_ENGINEERING_CONTRACT_TYPES = [
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

test("protocol exposes internal methodology resources and prompts", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const resources = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/list",
  });
  const resourceUris = new Set(resources.result.resources.map((resource) => resource.uri));

  for (const uri of [
    "pipeline://methodologies",
    "pipeline://methodologies/superpowers",
    "pipeline://methodologies/brainstorming",
    "pipeline://methodologies/frontend-design",
  ]) {
    assert.ok(resourceUris.has(uri), `missing methodology resource ${uri}`);
  }

  const methodologyIndex = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: {
      uri: "pipeline://methodologies",
    },
  });
  const superpowers = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: {
      uri: "pipeline://methodologies/superpowers",
    },
  });
  const brainstorming = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: {
      uri: "pipeline://methodologies/brainstorming",
    },
  });
  const frontendDesign = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: {
      uri: "pipeline://methodologies/frontend-design",
    },
  });

  assert.equal(methodologyIndex.result.contents[0].mimeType, "text/markdown");
  assert.ok(methodologyIndex.result.contents[0].text.includes("pipeline://methodologies/superpowers"));
  assert.ok(superpowers.result.contents[0].text.includes("## Pipeline Shape"));
  assert.ok(brainstorming.result.contents[0].text.includes("## Clarify One Point At A Time"));
  assert.ok(frontendDesign.result.contents[0].text.includes("pipeline-internal capability label"));

  const prompts = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "prompts/list",
  });
  const promptNames = new Set(prompts.result.prompts.map((prompt) => prompt.name));
  assert.ok(promptNames.has("pipeline/methodology/superpowers"));
  assert.ok(promptNames.has("pipeline/methodology/brainstorming"));
  assert.ok(promptNames.has("pipeline/methodology/frontend-design"));

  const methodologyPrompt = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "prompts/get",
    params: {
      name: "pipeline/methodology/superpowers",
    },
  });

  assert.ok(methodologyPrompt.result.messages[0].content.text.includes("Evidence First"));
});

test("protocol prompts do not require external skill attachment", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const prompts = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/list",
  });
  const forbiddenExternalSkillReferences = [
    /attach.*skill/i,
    /attach(?:ed)? the `superpowers` skill/i,
    /must explicitly attach the `superpowers`/i,
    /ce-frontend-design.*attach/i,
    /attach.*ce-frontend-design/i,
    /absolute_superpowers_skill_path/,
    /current-environment path/,
    /~\/\.codex\/skills\/superpowers/,
    /~\/\.codex\/skills\/brainstorming/,
    /playwright_skill_path/,
    /"type": "skill", "name": "superpowers"/,
  ];

  for (const promptInfo of prompts.result.prompts) {
    const prompt = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: promptInfo.name,
      method: "prompts/get",
      params: {
        name: promptInfo.name,
      },
    });
    const text = prompt.result.messages[0].content.text;

    for (const forbidden of forbiddenExternalSkillReferences) {
      assert.doesNotMatch(text, forbidden, `${promptInfo.name} still references ${forbidden}`);
    }
  }
});

test("protocol exposes compact tool metadata resource", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const tools = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  const resources = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
  });
  const compact = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: {
      uri: "pipeline://tools/compact",
    },
  });

  assert.equal(tools.result.tools.some((tool) => tool.name === "pipeline.tools.compact"), false);
  assert.ok(resources.result.resources.some((resource) => resource.uri === "pipeline://tools/compact"));

  const payload = JSON.parse(compact.result.contents[0].text);
  assert.equal(payload.version, "1.0");
  assert.ok(!compact.result.contents[0].text.includes("inputSchema"));
  assert.equal(payload.tools.some((tool) => Object.hasOwn(tool, "inputSchema")), false);

  const compactToolNames = new Set(payload.tools.map((tool) => tool.name));
  for (const toolName of [
    "pipeline.start_run",
    "pipeline.run_stage",
    "pipeline.validate_artifact",
    "pipeline.research",
    "pipeline.export_summary",
  ]) {
    assert.ok(compactToolNames.has(toolName), `missing compact tool metadata for ${toolName}`);
  }

  for (const tool of payload.tools) {
    assert.deepEqual(Object.keys(tool).sort(), ["category", "name", "title"]);
    assert.equal(typeof tool.category, "string");
  }
});

test("protocol exposes new agent engineering contract resources", async () => {
  const repoRoot = await createTempRepo();
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock: fixedClock });

  const resources = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/list",
  });
  const resourceUris = new Set(resources.result.resources.map((resource) => resource.uri));

  for (const artifactType of NEW_AGENT_ENGINEERING_CONTRACT_TYPES) {
    assert.ok(
      resourceUris.has(`pipeline://contracts/${artifactType}`),
      `missing contract resource for ${artifactType}`,
    );
  }

  const contract = await protocol.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: {
      uri: "pipeline://contracts/research-harness-state",
    },
  });

  assert.equal(contract.result.contents[0].mimeType, "text/markdown");
  assert.ok(contract.result.contents[0].text.includes("## research-harness-state.json"));
  assert.ok(contract.result.contents[0].text.includes("## latent-communication-experiment.json"));
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
