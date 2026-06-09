import { validateArtifact } from "./contracts.js";
import { sha256 } from "./utils.js";

const REPORT_VERSION = "1.0";
const ALLOWED_CACHE_POLICIES = new Set(["stable", "volatile", "bypass"]);

function nonEmptyString(value, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return fallback;
}

function normalizeInteger(value, fallback = 0) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  return fallback;
}

function normalizePromptText(text) {
  if (text === null || text === undefined) {
    return "";
  }

  return String(text);
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function inferRole(component) {
  const label = [
    component.componentId,
    component.component_id,
    component.label,
    component.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(system|developer|contract|instruction|skill|policy)\b/.test(label)) {
    return "system";
  }

  if (/\b(user|task|request|input|goal)\b/.test(label)) {
    return "user";
  }

  if (/\b(assistant|model|response|answer|output)\b/.test(label)) {
    return "assistant";
  }

  if (/\b(tool|workspace|retrieval|context|evidence|file)\b/.test(label)) {
    return "tool";
  }

  return "other";
}

function inferCachePolicy(component) {
  const explicitPolicy = component.cachePolicy ?? component.cache_policy;
  if (ALLOWED_CACHE_POLICIES.has(explicitPolicy)) {
    return explicitPolicy;
  }

  const label = [
    component.componentId,
    component.component_id,
    component.label,
    component.name,
    component.cachePolicy,
    component.cache_policy,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(bypass|uncached|no-cache)\b/.test(label)) {
    return "bypass";
  }

  if (/\b(volatile|dynamic|runtime|timestamp|generated|diff|metrics|cursor)\b/.test(label)) {
    return "volatile";
  }

  return "stable";
}

function normalizeComponentInput(component, index) {
  const value = component && typeof component === "object" ? component : {};

  return {
    componentId: nonEmptyString(
      value.componentId ?? value.component_id,
      `component-${String(index + 1).padStart(3, "0")}`,
    ),
    role: nonEmptyString(value.role, inferRole(value)),
    text: normalizePromptText(value.text ?? value.content ?? value.prompt),
    cachePolicy: inferCachePolicy(value),
  };
}

function hashPromptComponent(component) {
  return `sha256:${sha256(stableJsonStringify(component))}`;
}

function firstStablePrefixText(promptComponents) {
  const stableTexts = [];

  for (const component of promptComponents) {
    if (component.cachePolicy !== "stable") {
      break;
    }

    stableTexts.push(component.text);
  }

  return stableTexts.join("\n");
}

function stablePrefixFromInput(stablePrefix, promptComponents) {
  if (stablePrefix && typeof stablePrefix === "object" && !Array.isArray(stablePrefix)) {
    const text = normalizePromptText(stablePrefix.text ?? stablePrefix.content);

    return {
      hash: nonEmptyString(
        stablePrefix.hash,
        `sha256:${sha256(text || firstStablePrefixText(promptComponents))}`,
      ),
      token_count: normalizeInteger(
        stablePrefix.token_count ?? stablePrefix.tokenCount,
        estimateTokenCount(text || firstStablePrefixText(promptComponents)),
      ),
    };
  }

  const text = typeof stablePrefix === "string"
    ? stablePrefix
    : firstStablePrefixText(promptComponents);

  return {
    hash: `sha256:${sha256(text)}`,
    token_count: estimateTokenCount(text),
  };
}

function normalizeFindings(findings) {
  return (Array.isArray(findings) ? findings : []).map((finding) => ({
    severity: ["info", "warning", "error"].includes(finding?.severity)
      ? finding.severity
      : "info",
    summary: nonEmptyString(finding?.summary, "Cache observability finding."),
  }));
}

function normalizeProviderMetrics(providerMetrics, promptComponents) {
  const metrics = providerMetrics && typeof providerMetrics === "object" ? providerMetrics : {};
  const promptText = promptComponents.map((component) => component.text).join("\n");

  return {
    provider: nonEmptyString(metrics.provider, "unknown"),
    prompt_tokens: normalizeInteger(
      metrics.prompt_tokens ?? metrics.promptTokens,
      estimateTokenCount(promptText),
    ),
    cached_tokens: normalizeInteger(metrics.cached_tokens ?? metrics.cachedTokens, 0),
  };
}

export function estimateTokenCount(text) {
  const length = normalizePromptText(text).length;
  return Math.max(0, Math.ceil(length / 4));
}

export function classifyPromptComponent(component) {
  const normalized = normalizeComponentInput(component, 0);

  return {
    component_id: normalized.componentId,
    role: normalized.role,
    hash: hashPromptComponent(normalized),
    cache_policy: normalized.cachePolicy,
  };
}

export function lintStablePrefix(promptComponents) {
  const normalizedComponents = (Array.isArray(promptComponents) ? promptComponents : [])
    .map((component, index) => normalizeComponentInput(component, index));
  const dynamicComponents = [];
  const dynamicBeforeStable = [];
  const reportedDynamicIds = new Set();
  let stablePrefixTokenCount = 0;
  let inStablePrefix = true;

  for (const component of normalizedComponents) {
    if (component.cachePolicy === "stable") {
      if (inStablePrefix) {
        stablePrefixTokenCount += estimateTokenCount(component.text);
      }

      for (const dynamicComponent of dynamicComponents) {
        if (reportedDynamicIds.has(dynamicComponent.componentId)) {
          continue;
        }

        reportedDynamicIds.add(dynamicComponent.componentId);
        dynamicBeforeStable.push({
          component_id: dynamicComponent.componentId,
          cache_policy: dynamicComponent.cachePolicy,
          before_stable_component_id: component.componentId,
        });
      }

      continue;
    }

    inStablePrefix = false;
    dynamicComponents.push(component);
  }

  const hasBypassBeforeStable = dynamicBeforeStable.some(
    (component) => component.cache_policy === "bypass",
  );
  const status = dynamicBeforeStable.length === 0
    ? "passed"
    : hasBypassBeforeStable
      ? "failed"
      : "warning";
  const summary = dynamicBeforeStable.length === 0
    ? "Stable prefix ordering is cache-friendly."
    : `${dynamicBeforeStable.length} volatile or bypass component(s) appear before later stable content.`;

  return {
    status,
    dynamicBeforeStable,
    stablePrefixTokenCount,
    summary,
  };
}

export function buildCacheObservabilityReport({
  taskId,
  generatedAt,
  promptComponents,
  stablePrefix = null,
  providerMetrics = {},
  findings = [],
}) {
  const rawComponents = Array.isArray(promptComponents) && promptComponents.length > 0
    ? promptComponents
    : [{ componentId: "prompt", role: "other", text: "", cachePolicy: "stable" }];
  const normalizedComponents = rawComponents.map((component, index) =>
    normalizeComponentInput(component, index));
  const classifiedComponents = normalizedComponents.map((component) => ({
    component_id: component.componentId,
    role: component.role,
    hash: hashPromptComponent(component),
    cache_policy: component.cachePolicy,
  }));
  const report = {
    version: REPORT_VERSION,
    task_id: taskId,
    generated_at: generatedAt,
    prompt_components: classifiedComponents,
    stable_prefix: stablePrefixFromInput(stablePrefix, normalizedComponents),
    provider_metrics: normalizeProviderMetrics(providerMetrics, normalizedComponents),
    findings: normalizeFindings(findings),
  };

  return validateArtifact("cache-observability-report", report);
}

export function summarizeCacheMetrics(report) {
  const metrics = report?.provider_metrics ?? {};
  const promptTokens = normalizeInteger(metrics.prompt_tokens, 0);
  const cachedTokens = normalizeInteger(metrics.cached_tokens, 0);
  const cachedTokenRatio = promptTokens === 0 ? 0 : cachedTokens / promptTokens;

  return {
    provider: nonEmptyString(metrics.provider, "unknown"),
    promptTokens,
    cachedTokens,
    cachedTokenRatio,
    cached_token_ratio: cachedTokenRatio,
    summary: `${cachedTokens}/${promptTokens} prompt token(s) were served from cache.`,
  };
}
