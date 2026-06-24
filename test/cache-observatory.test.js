import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  buildCacheObservabilityReport,
  classifyPromptComponent,
  estimateTokenCount,
  lintStablePrefix,
  summarizeCacheMetrics,
} from "../src/runtime/cache-observatory.js";

test("buildCacheObservabilityReport returns a valid artifact", () => {
  const report = buildCacheObservabilityReport({
    taskId: "TASK-cache-observatory-001",
    generatedAt: "2026-06-08T08:00:00Z",
    promptComponents: [
      {
        componentId: "system-contract-prefix",
        text: "Stable contract and execution instructions.",
        cachePolicy: "stable",
      },
      {
        componentId: "user-task-request",
        text: "Implement prompt cache observability helpers.",
        cachePolicy: "volatile",
      },
    ],
    providerMetrics: {
      provider: "openai",
      prompt_tokens: 24,
      cached_tokens: 10,
    },
    findings: [
      {
        severity: "info",
        summary: "Provider returned cached token metadata.",
      },
    ],
  });

  assert.equal(validateArtifact("cache-observability-report", report), report);
  assert.equal(report.prompt_components[0].role, "system");
  assert.equal(report.provider_metrics.cached_tokens, 10);
});

test("lintStablePrefix catches volatile components before stable content", () => {
  const lint = lintStablePrefix([
    {
      componentId: "dynamic-runtime-state",
      text: "Workspace state at runtime.",
      cachePolicy: "volatile",
    },
    {
      componentId: "stable-contract-prefix",
      text: "Reusable contract text.",
      cachePolicy: "stable",
    },
  ]);

  assert.equal(lint.status, "warning");
  assert.equal(lint.dynamicBeforeStable.length, 1);
  assert.equal(lint.dynamicBeforeStable[0].component_id, "dynamic-runtime-state");
  assert.equal(lint.stablePrefixTokenCount, 0);
});

test("token estimates and component hashes are deterministic", () => {
  assert.equal(estimateTokenCount(""), 0);
  assert.equal(estimateTokenCount("abcde"), 2);

  const first = classifyPromptComponent({
    componentId: "system-instructions",
    text: "Keep execution reports stable.",
  });
  const second = classifyPromptComponent({
    componentId: "system-instructions",
    text: "Keep execution reports stable.",
  });

  assert.deepEqual(first, second);
  assert.equal(first.role, "system");
  assert.equal(first.cache_policy, "stable");
  assert.match(first.hash, /^sha256:[a-f0-9]{64}$/);
});

test("unavailable cached metadata is represented as zero with a warning finding", () => {
  const report = buildCacheObservabilityReport({
    taskId: "TASK-cache-observatory-002",
    generatedAt: "2026-06-08T08:05:00Z",
    promptComponents: [
      {
        componentId: "stable-system-prefix",
        text: "Stable prefix.",
        cachePolicy: "stable",
      },
    ],
    providerMetrics: {
      provider: "openai",
      prompt_tokens: 16,
      cached_tokens: 0,
    },
    findings: [
      {
        severity: "warning",
        summary: "Provider did not expose cached token metadata.",
      },
    ],
  });
  const summary = summarizeCacheMetrics(report);

  assert.equal(validateArtifact("cache-observability-report", report), report);
  assert.equal(report.provider_metrics.cached_tokens, 0);
  assert.equal(report.findings[0].severity, "warning");
  assert.equal(summary.cachedTokenRatio, 0);
  assert.equal(summary.cached_token_ratio, 0);
});
