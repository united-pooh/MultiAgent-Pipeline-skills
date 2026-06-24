import { validateArtifact } from "./contracts.js";

const VERSION = "1.0";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return fallback;
}

function finiteNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeScore(value) {
  if (value && typeof value === "object") {
    return finiteNumber(value.score ?? value.value ?? value.metric, 0);
  }

  return finiteNumber(value, 0);
}

function normalizeDescription(value, fallback) {
  if (value && typeof value === "object") {
    return nonEmptyString(value.description ?? value.summary ?? value.label, fallback);
  }

  return nonEmptyString(value, fallback);
}

function normalizeComparisonResult(id, label, value) {
  return {
    id,
    label,
    score: normalizeScore(value),
    summary: normalizeDescription(value, `${label} result.`),
    sandbox: false,
    is_true_kv_handoff: false,
  };
}

function normalizeLatentMock(latentMock) {
  const mock = latentMock && typeof latentMock === "object" ? latentMock : {};
  const kind = nonEmptyString(mock.kind, "mock");
  const supported = mock.supported === true;
  const isTrueKvHandoff = kind === "kv" && supported;
  const label = isTrueKvHandoff ? "verified-kv-handoff" : `${kind}-sandbox-mock`;

  return {
    id: "latent-mock",
    label,
    kind,
    supported,
    score: normalizeScore(mock),
    summary: normalizeDescription(
      mock,
      isTrueKvHandoff
        ? "Verified KV handoff result."
        : "Sandbox mock result with no verified KV transfer.",
    ),
    sandbox: !isTrueKvHandoff,
    is_true_kv_handoff: isTrueKvHandoff,
  };
}

function bestByScore(results) {
  return results.reduce((best, result) => (result.score > best.score ? result : best), results[0]);
}

export function buildProtocolDag({
  taskId,
  singleAgentAnchor,
  nodes,
  edges,
  stateMachine,
  acceptance,
}) {
  const artifact = {
    version: VERSION,
    task_id: taskId,
    single_agent_anchor: singleAgentAnchor,
    nodes: asArray(nodes),
    edges: asArray(edges),
    state_machine: stateMachine,
    acceptance,
  };

  return validateArtifact("protocol-dag", artifact);
}

export function compareAgainstSingleAgentAnchor({
  singleAgentScore,
  multiAgentScore,
  singleAgentCost,
  multiAgentCost,
}) {
  const qualityDelta = finiteNumber(multiAgentScore) - finiteNumber(singleAgentScore);
  const costDelta = finiteNumber(multiAgentCost) - finiteNumber(singleAgentCost);
  const qualityImproves = qualityDelta > 0;
  const costDropsWithoutQualityRegression = costDelta < 0 && qualityDelta >= 0;
  const useful = qualityImproves || costDropsWithoutQualityRegression;
  const status = useful ? "useful" : "not-useful";
  const summary = useful
    ? `Multi-agent result is useful: quality delta ${qualityDelta}, cost delta ${costDelta}.`
    : `Multi-agent result is not useful: quality delta ${qualityDelta}, cost delta ${costDelta}.`;

  return {
    status,
    qualityDelta,
    costDelta,
    useful,
    summary,
  };
}

export function buildServingProfile({
  taskId,
  backend,
  calls,
  capacityModel,
  replaySummary,
  tradeoffs,
}) {
  const artifact = {
    version: VERSION,
    task_id: taskId,
    backend,
    calls: asArray(calls),
    capacity_model: capacityModel,
    replay_summary: replaySummary,
    tradeoffs: asArray(tradeoffs),
  };

  return validateArtifact("serving-profile", artifact);
}

export function profileServingCall({ callId, operation, startedAtMs, endedAtMs, status }) {
  const latencyMs = Math.max(0, Math.round(finiteNumber(endedAtMs) - finiteNumber(startedAtMs)));

  return {
    call_id: callId,
    operation,
    latency_ms: latencyMs,
    status,
  };
}

export function buildLatentCommunicationExperiment({
  taskId,
  baselines,
  experiments,
  compatibility,
  safety,
  conclusion,
}) {
  const artifact = {
    version: VERSION,
    task_id: taskId,
    baselines: asArray(baselines),
    experiments: asArray(experiments),
    compatibility,
    safety,
    conclusion,
  };

  return validateArtifact("latent-communication-experiment", artifact);
}

export function createLatentSandboxComparison({
  textBaseline,
  structuredStateBaseline,
  latentMock,
}) {
  const results = [
    normalizeComparisonResult("text-baseline", "text-baseline", textBaseline),
    normalizeComparisonResult(
      "structured-state-baseline",
      "structured-state-baseline",
      structuredStateBaseline,
    ),
    normalizeLatentMock(latentMock),
  ];
  const best = bestByScore(results);
  const latentResult = results[2];
  const latentSummary = latentResult.is_true_kv_handoff
    ? "latent channel uses verified KV handoff"
    : "latent channel remains a sandbox/mock with no verified KV transfer";

  return {
    best,
    results,
    summary: `Best result is ${best.id}; ${latentSummary}.`,
  };
}
