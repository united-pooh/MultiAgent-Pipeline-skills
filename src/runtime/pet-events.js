export const CODEX_PET_STATES = Object.freeze([
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
]);

const CODEX_PET_STATE_SET = new Set(CODEX_PET_STATES);

function escapeDirectiveValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildCodexPetDirective({ state, duration_ms: durationMs, scope }) {
  return `::codex-pet{state="${escapeDirectiveValue(state)}" durationMs=${durationMs} scope="${escapeDirectiveValue(scope)}"}`;
}

export function createCodexPetEvent({
  state,
  reason,
  scope,
  durationMs = 1800,
  createdAt,
}) {
  if (!CODEX_PET_STATE_SET.has(state)) {
    throw new Error(`Unsupported Codex pet state: ${state}`);
  }

  if (!Number.isInteger(durationMs) || durationMs < 0) {
    throw new Error("Codex pet event durationMs must be a non-negative integer");
  }

  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("Codex pet event reason must be a non-empty string");
  }

  if (typeof scope !== "string" || scope.trim() === "") {
    throw new Error("Codex pet event scope must be a non-empty string");
  }

  const event = {
    state,
    reason,
    scope,
    duration_ms: durationMs,
    created_at: createdAt,
  };

  return {
    ...event,
    directive: buildCodexPetDirective(event),
  };
}
