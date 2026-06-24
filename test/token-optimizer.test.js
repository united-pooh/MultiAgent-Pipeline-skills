import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  buildOptimizedContextArtifacts,
  buildTokenOptimizationReport,
  estimatePromptSavings,
  recommendToolSubset,
} from "../src/runtime/token-optimizer.js";

function block(overrides) {
  return {
    id: "token-optimizer-runtime",
    version: "1.0.0",
    source: "skills/multi-agent-pipeline/src/runtime/token-optimizer.js",
    priority: 10,
    tenant_scope: "local",
    cacheable: true,
    evictable: true,
    requires_approval: false,
    ...overrides,
  };
}

const candidateBlocks = [
  block({
    id: "billing-skill",
    source: "skills/billing/runtime.md",
    priority: 100,
    tags: ["billing"],
    description: "Invoice workflow, payment state, and subscription reconciliation.",
    text: "A long unrelated billing prompt block that should not enter cache reports.",
  }),
  block({
    id: "cache-observatory",
    source: "skills/multi-agent-pipeline/src/runtime/cache-observatory.js",
    priority: 30,
    tags: ["cache", "observability"],
    description: "Build cache observability reports for prompt components.",
    text: "Cache observability report helpers and stable prefix linting.",
  }),
  block({
    id: "context-compiler",
    source: "skills/multi-agent-pipeline/src/runtime/context-compiler.js",
    priority: 20,
    tags: ["context", "compiler"],
    description: "Compile deterministic context manifests for selected blocks.",
    text: "Context compiler selection and manifest generation.",
  }),
];

test("optimized context excludes unrelated high-priority block and validates artifacts", () => {
  const result = buildOptimizedContextArtifacts({
    taskId: "TASK-token-optimizer-001",
    compiledAt: "2026-06-08T09:00:00Z",
    query: "context compiler cache observability",
    candidateBlocks,
    providerMetrics: {
      provider: "openai",
      cached_tokens: 8,
    },
  });

  assert.deepEqual(result.selectedBlockIds, ["cache-observatory", "context-compiler"]);
  assert.deepEqual(result.excludedBlockIds, ["billing-skill"]);
  assert.equal(validateArtifact("context-manifest", result.manifest), result.manifest);
  assert.equal(
    validateArtifact("cache-observability-report", result.cacheReport),
    result.cacheReport,
  );
  assert.equal(result.lint.status, "passed");
});

test("savings are positive when optimized blocks are shorter than baseline", () => {
  const savings = estimatePromptSavings({
    baselineBlocks: [
      block({
        id: "long-block",
        text: "This baseline prompt contains a lot of extra context and duplicate instructions.",
      }),
      block({
        id: "short-block",
        text: "Keep this.",
      }),
    ],
    optimizedBlocks: [
      block({
        id: "short-block",
        text: "Keep this.",
      }),
    ],
  });

  assert.ok(savings.baselineTokenCount > savings.optimizedTokenCount);
  assert.ok(savings.savedTokenCount > 0);
  assert.ok(savings.savedTokenRatio > 0);
});

test("tool subset keeps core tools and excludes unrelated schemas", () => {
  const subset = recommendToolSubset({
    objective: "optimize cache observability and context manifest prompts",
    toolDefinitions: [
      {
        name: "pipeline.start_run",
        description: "Start a durable pipeline run.",
        input_schema: { type: "object", properties: { task: { type: "string" } } },
      },
      {
        name: "pipeline.run_stage",
        description: "Run a pipeline stage.",
        input_schema: { type: "object", properties: { stage: { type: "string" } } },
      },
      {
        name: "pipeline.validate_artifact",
        description: "Validate artifact contracts.",
      },
      {
        name: "pipeline.research",
        description: "Record research findings.",
      },
      {
        name: "pipeline.export_summary",
        description: "Export run summary.",
      },
      {
        name: "pipeline.cache_report",
        title: "Cache report",
        description: "Inspect cache observability and prompt token metrics.",
      },
      {
        name: "pipeline.deploy_server",
        title: "Deploy server",
        description: "Publish production server deployment settings.",
        input_schema: {
          type: "object",
          properties: {
            host: { type: "string" },
            port: { type: "number" },
            region: { type: "string" },
          },
        },
      },
    ],
  });
  const selectedNames = subset.selectedTools.map((tool) => tool.name);
  const excludedNames = subset.excludedTools.map((tool) => tool.name);

  assert.deepEqual(selectedNames.slice(0, 5), [
    "pipeline.start_run",
    "pipeline.run_stage",
    "pipeline.validate_artifact",
    "pipeline.research",
    "pipeline.export_summary",
  ]);
  assert.ok(selectedNames.includes("pipeline.cache_report"));
  assert.deepEqual(excludedNames, ["pipeline.deploy_server"]);
  assert.ok(subset.estimatedSchemaTokenSavings > 0);
});

test("repeated input order produces identical selected ids and manifest JSON", () => {
  const first = buildOptimizedContextArtifacts({
    taskId: "TASK-token-optimizer-002",
    compiledAt: "2026-06-08T09:05:00Z",
    query: "context compiler cache observability",
    candidateBlocks,
  });
  const second = buildOptimizedContextArtifacts({
    taskId: "TASK-token-optimizer-002",
    compiledAt: "2026-06-08T09:05:00Z",
    query: "context compiler cache observability",
    candidateBlocks: [candidateBlocks[2], candidateBlocks[0], candidateBlocks[1]],
  });

  assert.deepEqual(first.selectedBlockIds, second.selectedBlockIds);
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
});

test("buildTokenOptimizationReport composes context and tool outputs", () => {
  const report = buildTokenOptimizationReport({
    taskId: "TASK-token-optimizer-003",
    compiledAt: "2026-06-08T09:10:00Z",
    query: "context compiler cache observability",
    candidateBlocks,
    toolDefinitions: [
      { name: "pipeline.start_run", description: "Start a durable run." },
      { name: "pipeline.deploy_server", description: "Deploy unrelated server settings." },
    ],
  });

  assert.equal(validateArtifact("context-manifest", report.manifest), report.manifest);
  assert.equal(
    validateArtifact("cache-observability-report", report.cacheReport),
    report.cacheReport,
  );
  assert.ok(report.savings.prompt.savedTokenCount > 0);
  assert.ok(report.savings.estimatedSchemaTokenSavings > 0);
});
