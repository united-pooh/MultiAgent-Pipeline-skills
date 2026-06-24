import assert from "node:assert/strict";
import test from "node:test";

import { ContractValidationError, validateArtifact } from "../src/index.js";
import {
  buildLatentCommunicationExperiment,
  buildProtocolDag,
  buildServingProfile,
  compareAgainstSingleAgentAnchor,
  createLatentSandboxComparison,
  profileServingCall,
} from "../src/runtime/protocol-sandbox.js";

function sampleProtocolDag() {
  return buildProtocolDag({
    taskId: "TASK-protocol-sandbox-001",
    singleAgentAnchor: {
      role: "orchestrator",
      responsibilities: ["own stage ordering", "write final artifact"],
    },
    nodes: [
      {
        id: "spec",
        type: "stage",
        label: "Spec",
      },
      {
        id: "execution",
        type: "stage",
        label: "Execution",
      },
    ],
    edges: [
      {
        from: "spec",
        to: "execution",
      },
    ],
    stateMachine: {
      states: ["spec", "execution"],
      initial_state: "spec",
    },
    acceptance: {
      criteria: ["every edge references known nodes"],
    },
  });
}

test("valid protocol DAG passes validation and bad edge is rejected", () => {
  const dag = sampleProtocolDag();

  assert.equal(validateArtifact("protocol-dag", dag), dag);

  const badDag = structuredClone(dag);
  badDag.edges[0].to = "missing-node";

  assert.throws(
    () => validateArtifact("protocol-dag", badDag),
    (error) => error instanceof ContractValidationError,
  );
});

test("single-agent anchor comparison requires quality or cost benefit", () => {
  const qualityWin = compareAgainstSingleAgentAnchor({
    singleAgentScore: 0.7,
    multiAgentScore: 0.8,
    singleAgentCost: 10,
    multiAgentCost: 14,
  });
  assert.equal(qualityWin.status, "useful");
  assert.equal(qualityWin.useful, true);
  assert.equal(qualityWin.qualityDelta, 0.10000000000000009);

  const costWin = compareAgainstSingleAgentAnchor({
    singleAgentScore: 0.7,
    multiAgentScore: 0.7,
    singleAgentCost: 10,
    multiAgentCost: 8,
  });
  assert.equal(costWin.useful, true);
  assert.equal(costWin.costDelta, -2);

  const cheaperRegression = compareAgainstSingleAgentAnchor({
    singleAgentScore: 0.7,
    multiAgentScore: 0.69,
    singleAgentCost: 10,
    multiAgentCost: 8,
  });
  assert.equal(cheaperRegression.status, "not-useful");
  assert.equal(cheaperRegression.useful, false);

  const neutral = compareAgainstSingleAgentAnchor({
    singleAgentScore: 0.7,
    multiAgentScore: 0.7,
    singleAgentCost: 10,
    multiAgentCost: 10,
  });
  assert.equal(neutral.useful, false);
});

test("serving profile call computes latency and artifact validates", () => {
  const call = profileServingCall({
    callId: "CALL-001",
    operation: "validateArtifact",
    startedAtMs: 100,
    endedAtMs: 143.6,
    status: "succeeded",
  });
  const clippedCall = profileServingCall({
    callId: "CALL-002",
    operation: "skipReplay",
    startedAtMs: 200,
    endedAtMs: 150,
    status: "skipped",
  });

  assert.equal(call.latency_ms, 44);
  assert.equal(clippedCall.latency_ms, 0);

  const profile = buildServingProfile({
    taskId: "TASK-protocol-sandbox-002",
    backend: "local-node-runtime",
    calls: [call, clippedCall],
    capacityModel: {
      max_concurrency: 2,
      throughput_per_minute: 60,
    },
    replaySummary: {
      status: "passed",
      sample_count: 2,
    },
    tradeoffs: ["local replay is deterministic but does not measure provider queuing"],
  });

  assert.equal(validateArtifact("serving-profile", profile), profile);
});

test("latent sandbox labels embedding and summary mocks without KV handoff claims", () => {
  const embeddingComparison = createLatentSandboxComparison({
    textBaseline: {
      score: 0.6,
      description: "Text prompt baseline.",
    },
    structuredStateBaseline: {
      score: 0.75,
      description: "Explicit state baseline.",
    },
    latentMock: {
      kind: "embedding",
      supported: false,
      score: 0.8,
      description: "Embedding-style sandbox signal.",
    },
  });
  const embeddingLatent = embeddingComparison.results.find((result) => result.id === "latent-mock");

  assert.equal(embeddingLatent.label, "embedding-sandbox-mock");
  assert.equal(embeddingLatent.sandbox, true);
  assert.equal(embeddingLatent.is_true_kv_handoff, false);
  assert.match(embeddingComparison.summary, /sandbox\/mock/);
  assert.doesNotMatch(embeddingComparison.summary, /verified KV handoff/);
  assert.equal(embeddingComparison.best.id, "latent-mock");

  const summaryComparison = createLatentSandboxComparison({
    textBaseline: {
      score: 0.7,
    },
    structuredStateBaseline: {
      score: 0.72,
    },
    latentMock: {
      kind: "summary",
      supported: true,
      score: 0.73,
    },
  });
  const summaryLatent = summaryComparison.results.find((result) => result.id === "latent-mock");

  assert.equal(summaryLatent.label, "summary-sandbox-mock");
  assert.equal(summaryLatent.sandbox, true);
  assert.equal(summaryLatent.is_true_kv_handoff, false);
});

test("latent communication experiment artifact validates", () => {
  const experiment = buildLatentCommunicationExperiment({
    taskId: "TASK-protocol-sandbox-003",
    baselines: [
      {
        baseline_id: "BASE-001",
        description: "Single visible artifact contract per stage",
        metric: "replay correctness",
      },
    ],
    experiments: [
      {
        experiment_id: "EXP-001",
        description: "Compare explicit state snapshots against latent mocks",
        result: "Explicit state snapshots preserved replayability.",
      },
    ],
    compatibility: {
      status: "compatible",
      notes: "Sandbox helpers keep experiment metadata visible.",
    },
    safety: {
      status: "passed",
      checks: ["no hidden coordination channel is required"],
    },
    conclusion: "Latent communication experiments remain observable through explicit artifacts.",
  });

  assert.equal(validateArtifact("latent-communication-experiment", experiment), experiment);
});
