import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  buildGovernanceReport,
  checkStrongConclusionSources,
  classifySourceTrust,
  confirmMemoryInjection,
} from "../src/runtime/governance.js";

test("buildGovernanceReport returns a valid governance-report artifact", () => {
  const report = buildGovernanceReport({
    taskId: "TASK-governance-001",
    sourceGraph: [
      {
        node_id: "SRC-user",
        source: "user request",
        type: "user",
      },
    ],
    approvalGates: [{ gateId: "GATE-low-risk", risk: "low", approved: true }],
    tenantScope: "local",
    memoryInjectionChecks: [{ checkId: "MEM-readback", readBack: true }],
    conclusions: [
      {
        text: "Only trusted local context was used.",
        source_ids: ["SRC-user"],
        type: "strong",
      },
    ],
  });

  assert.equal(validateArtifact("governance-report", report), report);
});

test("AI inference without confirmation is quarantined", () => {
  assert.equal(classifySourceTrust({ type: "ai-inference" }), "quarantined");

  const report = buildGovernanceReport({
    taskId: "TASK-ai-quarantine",
    sourceGraph: [
      {
        node_id: "SRC-ai",
        source: "model generated note",
        type: "ai-inference",
      },
    ],
    approvalGates: [{ gateId: "GATE-ai", risk: "high", approved: true }],
    memoryInjectionChecks: [{ checkId: "MEM-ai", readBack: true }],
    conclusions: ["AI inference source was quarantined."],
  });

  assert.equal(report.source_graph[0].trust_level, "quarantined");
  assert.deepEqual(report.quarantined_items, [
    {
      item_id: "SRC-ai",
      reason: "Source requires confirmation before governance use.",
    },
  ]);
});

test("strong conclusion from untrusted source fails", () => {
  const result = checkStrongConclusionSources({
    sourceGraph: [
      {
        node_id: "SRC-web",
        source: "search result index",
        type: "web-index",
      },
    ],
    conclusions: [
      {
        text: "The indexed claim is certain.",
        source_ids: ["SRC-web"],
        type: "strong",
      },
    ],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.unsupportedConclusions.length, 1);
  assert.match(result.summary, /lack trusted sources/);
});

test("memory read-back false produces failed check", () => {
  assert.deepEqual(confirmMemoryInjection({ checkId: "MEM-false", readBack: false }), {
    check_id: "MEM-false",
    status: "failed",
  });
});
