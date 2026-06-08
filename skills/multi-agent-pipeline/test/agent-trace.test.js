import assert from "node:assert/strict";
import test from "node:test";

import { analyzeAgentTrace, buildAgentTrace } from "../src/runtime/agent-trace.js";
import { validateArtifact } from "../src/index.js";

test("buildAgentTrace returns a valid agent-trace artifact", () => {
  const trace = buildAgentTrace({
    taskId: "TASK-001",
    startedAt: "2026-06-08T08:00:00Z",
    events: [
      {
        type: "message",
        at: "2026-06-08T08:00:01Z",
        summary: "Worker F started the trace runtime.",
        extra: "ignored",
      },
      {
        type: "unsupported",
        at: "2026-06-08T08:00:02Z",
        summary: "Unsupported events are dropped.",
      },
      {
        type: "validation",
        at: "2026-06-08T08:00:03Z",
        summary: "Artifact schema validation passed.",
      },
    ],
    summary: {
      status: "completed",
      outcome: "Trace runtime created a valid artifact.",
      ignored: true,
    },
  });

  assert.equal(validateArtifact("agent-trace", trace), trace);
  assert.deepEqual(trace, {
    version: "1.0",
    task_id: "TASK-001",
    started_at: "2026-06-08T08:00:00Z",
    events: [
      {
        type: "message",
        at: "2026-06-08T08:00:01Z",
        summary: "Worker F started the trace runtime.",
      },
      {
        type: "validation",
        at: "2026-06-08T08:00:03Z",
        summary: "Artifact schema validation passed.",
      },
    ],
    summary: {
      status: "completed",
      outcome: "Trace runtime created a valid artifact.",
    },
  });
});

test("analyzeAgentTrace detects redundant searches, repeated reads, and weak evidence", () => {
  const trace = buildAgentTrace({
    taskId: "TASK-002",
    startedAt: "2026-06-08T09:00:00Z",
    events: [
      {
        type: "tool_call",
        at: "2026-06-08T09:00:01Z",
        summary: "search query: \"agent trace runtime\"",
      },
      {
        type: "tool_call",
        at: "2026-06-08T09:00:02Z",
        summary: "search query: \"agent  trace runtime\"",
      },
      {
        type: "tool_call",
        at: "2026-06-08T09:00:03Z",
        summary: "cat ./src/runtime/agent-trace.js",
      },
      {
        type: "tool_call",
        at: "2026-06-08T09:00:04Z",
        summary: "sed -n '1,120p' src/runtime/agent-trace.js",
      },
      {
        type: "tool_result",
        at: "2026-06-08T09:00:05Z",
        summary: "failed: command returned error while checking evidence:E-1",
      },
      {
        type: "message",
        at: "2026-06-08T09:00:06Z",
        summary: "Captured evidence:E-2 during implementation.",
      },
      {
        type: "validation",
        at: "2026-06-08T09:00:07Z",
        summary: "Validation referenced evidence:E-1.",
      },
    ],
    summary: {
      status: "completed",
      outcome: "Trace analysis finished.",
    },
  });

  assert.deepEqual(analyzeAgentTrace(trace), {
    status: "completed",
    redundantSearchCount: 1,
    repeatedFileReadCount: 1,
    ineffectiveToolCallCount: 1,
    unreferencedEvidenceCount: 1,
    failureModes: [],
    summary: "Trace analysis finished.",
  });
});

test("analyzeAgentTrace classifies failure events", () => {
  const trace = buildAgentTrace({
    taskId: "TASK-003",
    startedAt: "2026-06-08T10:00:00Z",
    events: [
      {
        type: "failure",
        at: "2026-06-08T10:00:01Z",
        summary: "Validation failed after npm test.",
      },
      {
        type: "failure",
        at: "2026-06-08T10:00:02Z",
        summary: "Tool timed out before producing output.",
      },
      {
        type: "failure",
        at: "2026-06-08T10:00:03Z",
        summary: "Permission denied while reading workspace file.",
      },
    ],
    summary: "Trace captured worker failures.",
  });

  assert.deepEqual(analyzeAgentTrace(trace).failureModes, [
    "validation",
    "timeout",
    "permission",
  ]);
  assert.equal(analyzeAgentTrace(trace).status, "failed");
});
