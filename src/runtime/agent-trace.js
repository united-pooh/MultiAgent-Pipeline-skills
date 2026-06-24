import { validateArtifact } from "./contracts.js";
import { uniqueStrings } from "./utils.js";

const SUPPORTED_EVENT_TYPES = new Set([
  "message",
  "tool_call",
  "tool_result",
  "file_diff",
  "validation",
  "retry",
  "failure",
  "cost",
]);

const SUPPORTED_STATUSES = new Set(["completed", "blocked", "failed"]);
const FAILURE_NEEDLES = ["failed", "failure", "error", "no-op"];

function normalizeText(value, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  return fallback;
}

function normalizeKey(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePath(value) {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[:),;]+$/g, "")
    .replace(/^\.\//, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .toLowerCase();
}

function normalizeSummary(value) {
  if (typeof value === "string") {
    return normalizeText(value, "Trace event recorded.");
  }

  if (value === null || value === undefined) {
    return "Trace event recorded.";
  }

  return JSON.stringify(value);
}

function normalizeEvent(event, startedAt) {
  const input = event && typeof event === "object" ? event : {};
  const type = normalizeText(input.type, "");

  if (!SUPPORTED_EVENT_TYPES.has(type)) {
    return null;
  }

  return {
    type,
    at: normalizeText(input.at, startedAt),
    summary: normalizeSummary(input.summary ?? input.message ?? input.details),
  };
}

function normalizeSummaryBlock(summary, events) {
  const input = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  const hasFailure = events.some((event) => event.type === "failure");
  const status = SUPPORTED_STATUSES.has(input.status)
    ? input.status
    : hasFailure
      ? "failed"
      : "completed";

  return {
    status,
    outcome: normalizeText(
      typeof summary === "string" ? summary : input.outcome,
      "Agent trace recorded.",
    ),
  };
}

export function buildAgentTrace({ taskId, startedAt, events = [], summary = {} }) {
  const normalizedStartedAt = normalizeText(startedAt, new Date(0).toISOString());
  const normalizedEvents = (Array.isArray(events) ? events : [])
    .map((event) => normalizeEvent(event, normalizedStartedAt))
    .filter(Boolean);

  if (normalizedEvents.length === 0) {
    normalizedEvents.push({
      type: "message",
      at: normalizedStartedAt,
      summary: "Trace started.",
    });
  }

  const trace = {
    version: "1.0",
    task_id: normalizeText(taskId, "TASK-unknown"),
    started_at: normalizedStartedAt,
    events: normalizedEvents,
    summary: normalizeSummaryBlock(summary, normalizedEvents),
  };

  return validateArtifact("agent-trace", trace);
}

function extractSearchQuery(summary) {
  const queryMatch = summary.match(
    /\b(?:search(?:ed|ing)?(?:\s+(?:query|for))?|query)\s*[:=]?\s*["'`]([^"'`\n]+)["'`]/i,
  );

  if (queryMatch) {
    return normalizeKey(queryMatch[1]);
  }

  const unquotedQueryMatch = summary.match(
    /\b(?:search(?:ed|ing)?(?:\s+(?:query|for))?|query)\s*[:=]\s*([^\n]+)/i,
  );

  if (unquotedQueryMatch) {
    return normalizeKey(unquotedQueryMatch[1]);
  }

  const shellSearchMatch = summary.match(/\b(?:rg|grep)\b(?:\s+-[A-Za-z0-9-]+)*\s+["'`]([^"'`]+)["'`]/i);

  if (shellSearchMatch) {
    return normalizeKey(shellSearchMatch[1]);
  }

  return null;
}

function extractPathCandidates(summary) {
  const matches = [];
  const pathPattern =
    /(?:^|\s)([./~]?[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)+|[A-Za-z0-9_.@+-]+\.[A-Za-z0-9]+)(?=$|\s|[:,;])/g;

  let match = pathPattern.exec(summary);
  while (match) {
    matches.push(normalizePath(match[1]));
    match = pathPattern.exec(summary);
  }

  return matches.filter((item) => item !== "");
}

function extractReadPath(summary) {
  const commandMatch = summary.match(/\b(read|cat|sed|rg)\b/i);

  if (!commandMatch) {
    return null;
  }

  const afterCommand = summary.slice(commandMatch.index + commandMatch[0].length);
  const candidates = extractPathCandidates(afterCommand);

  if (candidates.length === 0) {
    return null;
  }

  if (commandMatch[1].toLowerCase() === "read" || commandMatch[1].toLowerCase() === "cat") {
    return candidates[0];
  }

  return candidates[candidates.length - 1];
}

function countRepeatedKeys(events, extractor) {
  const seen = new Set();
  let repeatCount = 0;

  for (const event of events) {
    if (event.type !== "tool_call") {
      continue;
    }

    const key = extractor(event.summary);
    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      repeatCount += 1;
      continue;
    }

    seen.add(key);
  }

  return repeatCount;
}

function isIneffectiveToolResult(event) {
  if (event.type !== "tool_result") {
    return false;
  }

  const summary = normalizeKey(event.summary);
  return FAILURE_NEEDLES.some((needle) => summary.includes(needle));
}

function collectEvidenceIds(events, types) {
  const ids = [];
  const evidencePattern = /\bevidence:([A-Za-z0-9_.-]+)/g;

  for (const event of events) {
    if (!types.has(event.type)) {
      continue;
    }

    let match = evidencePattern.exec(event.summary);
    while (match) {
      ids.push(match[1]);
      match = evidencePattern.exec(event.summary);
    }
  }

  return ids;
}

function countUnreferencedEvidence(events) {
  const evidenceIds = collectEvidenceIds(events, new Set(["message", "tool_result"]));
  const referenceSummaries = events
    .filter((event) => event.type === "validation" || event.type === "file_diff")
    .map((event) => normalizeKey(event.summary));

  return evidenceIds.filter((id) => {
    const normalizedId = normalizeKey(id);
    return !referenceSummaries.some((summary) => summary.includes(normalizedId));
  }).length;
}

function classifyFailure(summary) {
  const text = normalizeKey(summary);

  if (/\b(timeout|timed out|deadline)\b/.test(text)) {
    return "timeout";
  }

  if (/\b(permission|access denied|eacces|forbidden)\b/.test(text)) {
    return "permission";
  }

  if (/\b(validation|test failed|lint failed|assertion)\b/.test(text)) {
    return "validation";
  }

  if (/\b(merge conflict|conflict)\b/.test(text)) {
    return "merge_conflict";
  }

  if (/\b(missing|not found|enoent|cannot find|module not found|dependency)\b/.test(text)) {
    return "missing_dependency";
  }

  if (/\b(error|exception|failed|failure)\b/.test(text)) {
    return "runtime_error";
  }

  return "unspecified_failure";
}

export function analyzeAgentTrace(trace) {
  const normalizedTrace = validateArtifact("agent-trace", trace);
  const { events } = normalizedTrace;
  const failureModes = uniqueStrings(
    events.filter((event) => event.type === "failure").map((event) => classifyFailure(event.summary)),
  );

  return {
    status: normalizedTrace.summary.status,
    redundantSearchCount: countRepeatedKeys(events, extractSearchQuery),
    repeatedFileReadCount: countRepeatedKeys(events, extractReadPath),
    ineffectiveToolCallCount: events.filter(isIneffectiveToolResult).length,
    unreferencedEvidenceCount: countUnreferencedEvidence(events),
    failureModes,
    summary: normalizedTrace.summary.outcome,
  };
}
