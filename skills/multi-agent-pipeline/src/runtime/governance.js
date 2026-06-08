const TRUSTED_SOURCE_TYPES = new Set([
  "user",
  "local-file",
  "first-party-paper",
  "official-doc",
]);

const UNTRUSTED_SOURCE_TYPES = new Set(["unknown", "web-index"]);
const QUARANTINED_SOURCE_TYPES = new Set(["ai-inference", "tool-output"]);
const TRUST_LEVELS = new Set(["trusted", "untrusted", "quarantined"]);
const GATE_STATUSES = new Set(["approved", "pending", "rejected"]);
const MEMORY_STATUSES = new Set(["passed", "warning", "failed"]);
const HIGH_RISK_VALUES = new Set(["high", "critical"]);

function normalizeString(value, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return fallback;
}

function normalizeSourceType(source) {
  if (typeof source === "string") {
    return source;
  }

  if (!source || typeof source !== "object") {
    return "unknown";
  }

  return normalizeString(
    source.type ?? source.source_type ?? source.kind ?? source.trust_source,
    "unknown",
  );
}

function normalizeSourceId(source, index) {
  if (source && typeof source === "object") {
    return normalizeString(source.node_id ?? source.id, `SRC-${String(index + 1).padStart(3, "0")}`);
  }

  return `SRC-${String(index + 1).padStart(3, "0")}`;
}

function normalizeSourceLabel(source, index) {
  if (typeof source === "string") {
    return source;
  }

  if (source && typeof source === "object") {
    return normalizeString(
      source.source ?? source.path ?? source.url ?? source.name ?? source.title,
      `source-${String(index + 1).padStart(3, "0")}`,
    );
  }

  return `source-${String(index + 1).padStart(3, "0")}`;
}

function normalizeSourceGraph(sourceGraph) {
  const nodes = Array.isArray(sourceGraph) && sourceGraph.length > 0 ? sourceGraph : ["user"];

  return nodes.map((source, index) => {
    const explicitTrust =
      source && typeof source === "object" && TRUST_LEVELS.has(source.trust_level)
        ? source.trust_level
        : null;

    return {
      node_id: normalizeSourceId(source, index),
      source: normalizeSourceLabel(source, index),
      trust_level: explicitTrust ?? classifySourceTrust(source),
    };
  });
}

function normalizeQuarantinedItems(quarantinedItems, sourceGraph) {
  const providedItems = Array.isArray(quarantinedItems) ? quarantinedItems : [];
  const items = providedItems.map((item, index) => {
    if (typeof item === "string") {
      return {
        item_id: item,
        reason: "Marked for governance quarantine.",
      };
    }

    return {
      item_id: normalizeString(
        item?.item_id ?? item?.id,
        `QUAR-${String(index + 1).padStart(3, "0")}`,
      ),
      reason: normalizeString(item?.reason, "Marked for governance quarantine."),
    };
  });

  const existingIds = new Set(items.map((item) => item.item_id));
  for (const source of sourceGraph) {
    if (source.trust_level !== "quarantined" || existingIds.has(source.node_id)) {
      continue;
    }

    items.push({
      item_id: source.node_id,
      reason: "Source requires confirmation before governance use.",
    });
    existingIds.add(source.node_id);
  }

  return items;
}

function normalizeApprovalGates(approvalGates) {
  const gates =
    Array.isArray(approvalGates) && approvalGates.length > 0
      ? approvalGates
      : [{ gateId: "GATE-governance", risk: "low", approved: true }];

  return gates.map((gate, index) => {
    const gateId = normalizeString(
      gate?.gate_id ?? gate?.gateId,
      `GATE-${String(index + 1).padStart(3, "0")}`,
    );

    if (GATE_STATUSES.has(gate?.status)) {
      return {
        gate_id: gateId,
        status: gate.status,
      };
    }

    return requireApprovalGate({
      gateId,
      risk: gate?.risk,
      approved: gate?.approved,
    });
  });
}

function normalizeMemoryInjectionChecks(memoryInjectionChecks) {
  const checks =
    Array.isArray(memoryInjectionChecks) && memoryInjectionChecks.length > 0
      ? memoryInjectionChecks
      : [{ checkId: "MEM-001", readBack: true }];

  return checks.map((check, index) => {
    const checkId = normalizeString(
      check?.check_id ?? check?.checkId,
      `MEM-${String(index + 1).padStart(3, "0")}`,
    );

    if (MEMORY_STATUSES.has(check?.status)) {
      return {
        check_id: checkId,
        status: check.status,
      };
    }

    return confirmMemoryInjection({
      checkId,
      readBack: check?.readBack ?? check?.read_back,
    });
  });
}

function conclusionText(conclusion, index) {
  if (typeof conclusion === "string") {
    return normalizeString(conclusion, `Conclusion ${index + 1}`);
  }

  return normalizeString(
    conclusion?.text ?? conclusion?.conclusion ?? conclusion?.summary,
    `Conclusion ${index + 1}`,
  );
}

function normalizeConclusion(conclusion, index) {
  const sourceIds =
    conclusion && typeof conclusion === "object"
      ? conclusion.source_ids ?? conclusion.sourceIds ?? conclusion.sources ?? []
      : [];

  return {
    text: conclusionText(conclusion, index),
    source_ids: Array.isArray(sourceIds) ? sourceIds.filter((value) => typeof value === "string") : [],
    type:
      conclusion && typeof conclusion === "object"
        ? normalizeString(conclusion.type, "strong")
        : "strong",
  };
}

function isInferenceConclusion(conclusion) {
  return /\b(ai[-_ ]?inference|inference)\b/i.test(conclusion.type);
}

function isStrongConclusion(conclusion) {
  return !isInferenceConclusion(conclusion);
}

function exactReadBackPassed(readBack) {
  if (readBack === true) {
    return true;
  }

  if (!readBack || typeof readBack !== "object") {
    return false;
  }

  if (readBack.confirmed === true) {
    return true;
  }

  if ("expected" in readBack && "actual" in readBack) {
    return Object.is(readBack.expected, readBack.actual);
  }

  if ("expected" in readBack && "readBack" in readBack) {
    return Object.is(readBack.expected, readBack.readBack);
  }

  return false;
}

export function classifySourceTrust(source) {
  const sourceType = normalizeSourceType(source);

  if (TRUSTED_SOURCE_TYPES.has(sourceType)) {
    return "trusted";
  }

  if (QUARANTINED_SOURCE_TYPES.has(sourceType)) {
    return source?.confirmed === true ? "trusted" : "quarantined";
  }

  if (UNTRUSTED_SOURCE_TYPES.has(sourceType)) {
    return "untrusted";
  }

  return "untrusted";
}

export function requireApprovalGate({ gateId, risk, approved } = {}) {
  const normalizedRisk = normalizeString(risk, "low").toLowerCase();
  const isHighRisk = HIGH_RISK_VALUES.has(normalizedRisk);
  let status = "pending";

  if (approved === true) {
    status = "approved";
  } else if (approved === false && !isHighRisk) {
    status = "rejected";
  }

  return {
    gate_id: normalizeString(gateId, "GATE-governance"),
    status,
  };
}

export function checkStrongConclusionSources({ conclusions, sourceGraph } = {}) {
  const sourceNodes = normalizeSourceGraph(sourceGraph);
  const trustedNodeIds = new Set(
    sourceNodes.filter((node) => node.trust_level === "trusted").map((node) => node.node_id),
  );
  const conclusionEntries = Array.isArray(conclusions) ? conclusions : [];
  const inferenceConclusions = [];
  const unsupportedConclusions = [];

  conclusionEntries.map(normalizeConclusion).forEach((conclusion) => {
    if (isInferenceConclusion(conclusion)) {
      inferenceConclusions.push({
        text: conclusion.text,
        source_ids: conclusion.source_ids,
      });
      return;
    }

    if (!isStrongConclusion(conclusion)) {
      return;
    }

    const hasTrustedSource = conclusion.source_ids.some((sourceId) => trustedNodeIds.has(sourceId));
    if (!hasTrustedSource) {
      unsupportedConclusions.push({
        text: conclusion.text,
        source_ids: conclusion.source_ids,
        reason: "Strong conclusion must cite at least one trusted source node.",
      });
    }
  });

  const status =
    unsupportedConclusions.length > 0
      ? "failed"
      : inferenceConclusions.length > 0
        ? "warning"
        : "passed";
  const summary =
    status === "failed"
      ? `${unsupportedConclusions.length} strong conclusion(s) lack trusted sources.`
      : `${inferenceConclusions.length} inference conclusion(s) reported separately.`;

  return {
    status,
    inferenceConclusions,
    unsupportedConclusions,
    summary,
  };
}

export function confirmMemoryInjection({ checkId, readBack } = {}) {
  let status = "warning";

  if (readBack === false) {
    status = "failed";
  } else if (exactReadBackPassed(readBack)) {
    status = "passed";
  } else if (readBack !== null && readBack !== undefined) {
    status = "failed";
  }

  return {
    check_id: normalizeString(checkId, "MEM-001"),
    status,
  };
}

export function buildGovernanceReport({
  taskId,
  sourceGraph,
  quarantinedItems,
  approvalGates,
  tenantScope,
  memoryInjectionChecks,
  conclusions,
} = {}) {
  const normalizedSourceGraph = normalizeSourceGraph(sourceGraph);
  const normalizedConclusions =
    Array.isArray(conclusions) && conclusions.length > 0
      ? conclusions.map(conclusionText)
      : ["Governance checks completed."];

  return {
    version: "1.0",
    task_id: normalizeString(taskId, "TASK-governance-001"),
    source_graph: normalizedSourceGraph,
    quarantined_items: normalizeQuarantinedItems(quarantinedItems, normalizedSourceGraph),
    approval_gates: normalizeApprovalGates(approvalGates),
    tenant_scope: normalizeString(tenantScope, "local"),
    memory_injection_checks: normalizeMemoryInjectionChecks(memoryInjectionChecks),
    conclusions: normalizedConclusions,
  };
}
