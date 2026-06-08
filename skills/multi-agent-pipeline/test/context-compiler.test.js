import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  compileContextManifest,
  diffContextBlocks,
  selectRelevantBlocks,
} from "../src/runtime/context-compiler.js";

function block(overrides) {
  return {
    id: "context-runtime",
    version: "1.0.0",
    source: "skills/multi-agent-pipeline/src/runtime/context-compiler.js",
    priority: 10,
    tenant_scope: "local",
    cacheable: true,
    evictable: true,
    requires_approval: false,
    ...overrides,
  };
}

test("compileContextManifest is byte deterministic for shuffled block input", () => {
  const firstBlocks = [
    block({
      id: "skill-registry",
      source: "skills/multi-agent-pipeline/skills/registry.md",
      priority: 20,
      tags: ["skills", "registry"],
      description: "Skill registry block for runtime selection.",
    }),
    block({
      id: "context-contracts",
      source: "skills/multi-agent-pipeline/references/contracts.md",
      priority: 30,
      tags: ["context", "contracts"],
      description: "Context manifest validator contract.",
    }),
    block({
      id: "runtime-guide",
      source: "skills/multi-agent-pipeline/src/runtime",
      priority: 20,
      tags: ["runtime"],
      description: "Runtime implementation guidance.",
    }),
  ];
  const secondBlocks = [firstBlocks[2], firstBlocks[0], firstBlocks[1]];

  const firstManifest = compileContextManifest({
    taskId: "TASK-context-compiler",
    compiledAt: "2026-06-08T08:00:00Z",
    blocks: firstBlocks,
  });
  const secondManifest = compileContextManifest({
    taskId: "TASK-context-compiler",
    compiledAt: "2026-06-08T08:00:00Z",
    blocks: secondBlocks,
  });

  assert.deepEqual(firstManifest.blocks.map((entry) => entry.id), [
    "context-contracts",
    "runtime-guide",
    "skill-registry",
  ]);
  assert.equal(Buffer.compare(
    Buffer.from(JSON.stringify(firstManifest)),
    Buffer.from(JSON.stringify(secondManifest)),
  ), 0);
  assert.equal(validateArtifact("context-manifest", firstManifest), firstManifest);
  assert.match(firstManifest.blocks[0].hash, /^sha256:[a-f0-9]{64}$/);
});

test("selectRelevantBlocks excludes unrelated skill blocks", () => {
  const blocks = [
    block({
      id: "billing-skill",
      source: "skills/billing/runtime.md",
      priority: 100,
      tags: ["billing"],
      description: "Payment and invoice routing.",
    }),
    block({
      id: "context-compiler",
      source: "skills/multi-agent-pipeline/src/runtime/context-compiler.js",
      priority: 20,
      tags: ["context", "compiler"],
      description: "Compile context manifest blocks for pipeline prompts.",
    }),
    block({
      id: "skill-registry",
      source: "skills/multi-agent-pipeline/references/skill-registry.md",
      priority: 30,
      tags: ["skills", "registry"],
      description: "Select runtime skill blocks for context.",
    }),
  ];

  const selected = selectRelevantBlocks(blocks, "context compiler");

  assert.deepEqual(selected.map((entry) => entry.id), [
    "skill-registry",
    "context-compiler",
  ]);
});

test("prompt_diff records added and removed blocks", () => {
  const previousManifest = {
    blocks: [
      block({ id: "kept-block", priority: 5, hash: "sha256:kept" }),
      block({ id: "removed-block", priority: 10, hash: "sha256:removed" }),
    ],
  };
  const manifest = compileContextManifest({
    taskId: "TASK-context-diff",
    compiledAt: "2026-06-08T08:05:00Z",
    previousManifest,
    blocks: [
      block({ id: "kept-block", priority: 5 }),
      block({ id: "added-block", priority: 15 }),
    ],
  });

  assert.deepEqual(manifest.prompt_diff, {
    summary: "Added 1 block(s), removed 1 block(s).",
    added_blocks: ["added-block"],
    removed_blocks: ["removed-block"],
  });
});

test("diffContextBlocks reports no changes when block ids match", () => {
  const diff = diffContextBlocks(
    [block({ id: "same-block", priority: 1 })],
    [block({ id: "same-block", priority: 9 })],
  );

  assert.deepEqual(diff, {
    summary: "No context block changes.",
    added_blocks: [],
    removed_blocks: [],
  });
});
