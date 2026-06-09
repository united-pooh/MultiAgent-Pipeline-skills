import {
  buildCacheObservabilityReport,
  estimateTokenCount,
  lintStablePrefix,
} from "./cache-observatory.js";
import {
  compileContextManifest,
  selectRelevantBlocks,
} from "./context-compiler.js";

const DEFAULT_CORE_TOOL_NAMES = [
  "pipeline.start_run",
  "pipeline.run_stage",
  "pipeline.validate_artifact",
  "pipeline.research",
  "pipeline.export_summary",
];
const PROMPT_TEXT_FIELDS = ["text", "content", "prompt", "description", "source", "id"];
const TOOL_TEXT_FIELDS = ["name", "title", "description"];
const STOPWORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "into",
  "the",
  "this",
  "that",
  "use",
  "using",
  "with",
]);

function compareStrings(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) {
    return -1;
  }

  if (leftText > rightText) {
    return 1;
  }

  return 0;
}

function normalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort(compareStrings)) {
    const item = value[key];
    if (item === undefined || typeof item === "function" || typeof item === "symbol") {
      continue;
    }

    result[key] = normalizeJsonValue(item);
  }

  return result;
}

function stableJsonStringify(value) {
  return JSON.stringify(normalizeJsonValue(value));
}

function stringField(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function promptTextFromBlock(block) {
  const value = block && typeof block === "object" ? block : {};
  return PROMPT_TEXT_FIELDS
    .map((field) => stringField(value[field]).trim())
    .filter((text) => text !== "")
    .join("\n");
}

function estimateBlockTokens(blocks) {
  return (Array.isArray(blocks) ? blocks : []).reduce(
    (total, block) => total + estimateTokenCount(promptTextFromBlock(block)),
    0,
  );
}

function blockIds(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => stringField(block?.id))
    .filter((id) => id !== "");
}

function promptComponentFromBlock(block, index) {
  const id = stringField(block?.id).trim() || `context-block-${String(index + 1).padStart(3, "0")}`;
  const cachePolicy = block?.requires_approval
    ? "bypass"
    : block?.cacheable === false
      ? "volatile"
      : "stable";

  return {
    componentId: `context-${id}`,
    role: "tool",
    text: promptTextFromBlock(block),
    cachePolicy,
  };
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = stringField(value).trim();
    if (text === "" || seen.has(text)) {
      continue;
    }

    seen.add(text);
    result.push(text);
  }

  return result;
}

function keywordTerms(text) {
  return stringField(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    .sort(compareStrings);
}

function normalizeToolDefinitions(toolDefinitions) {
  if (Array.isArray(toolDefinitions)) {
    return toolDefinitions.map((definition, index) => normalizeToolDefinition(definition, index));
  }

  if (toolDefinitions && typeof toolDefinitions === "object") {
    return Object.keys(toolDefinitions)
      .sort(compareStrings)
      .map((name, index) => {
        const definition = normalizeJsonValue(toolDefinitions[name]);
        const value = definition && typeof definition === "object"
          ? { name, ...definition }
          : { name, description: stringField(definition) };

        return normalizeToolDefinition(value, index);
      });
  }

  return [];
}

function normalizeToolDefinition(definition, index) {
  if (typeof definition === "string") {
    return { name: definition };
  }

  const value = definition && typeof definition === "object" ? normalizeJsonValue(definition) : {};
  const name = stringField(value.name ?? value.id ?? `tool-${String(index + 1).padStart(3, "0")}`);

  return {
    ...value,
    name,
  };
}

function toolSearchText(tool) {
  return TOOL_TEXT_FIELDS
    .map((field) => stringField(tool?.[field]))
    .join(" ")
    .toLowerCase();
}

function toolSchemaTokenCount(tool) {
  return estimateTokenCount(stableJsonStringify(tool));
}

function buildToolSummary(selectedTools, excludedTools, estimatedSchemaTokenSavings) {
  const selectedNames = selectedTools.map((tool) => tool.name);
  const excludedNames = excludedTools.map((tool) => tool.name);

  return `Selected ${selectedNames.length} tool(s), excluded ${excludedNames.length} tool(s), saving about ${estimatedSchemaTokenSavings} schema token(s).`;
}

export function estimatePromptSavings({ baselineBlocks, optimizedBlocks }) {
  const baselineTokenCount = estimateBlockTokens(baselineBlocks);
  const optimizedTokenCount = estimateBlockTokens(optimizedBlocks);
  const savedTokenCount = baselineTokenCount - optimizedTokenCount;
  const savedTokenRatio = baselineTokenCount === 0 ? 0 : savedTokenCount / baselineTokenCount;

  return {
    baselineTokenCount,
    optimizedTokenCount,
    savedTokenCount,
    savedTokenRatio,
  };
}

export function buildOptimizedContextArtifacts({
  taskId,
  compiledAt,
  query,
  candidateBlocks,
  previousManifest = null,
  providerMetrics = {},
}) {
  const selectedBlocks = selectRelevantBlocks(candidateBlocks, query);
  const manifest = compileContextManifest({
    taskId,
    compiledAt,
    blocks: selectedBlocks,
    previousManifest,
  });
  const promptComponents = selectedBlocks.map((block, index) => promptComponentFromBlock(block, index));
  const cacheReport = buildCacheObservabilityReport({
    taskId,
    generatedAt: compiledAt,
    promptComponents,
    providerMetrics,
  });
  const lint = lintStablePrefix(promptComponents);
  const selectedBlockIds = manifest.blocks.map((block) => block.id);
  const selectedIds = new Set(selectedBlockIds);
  const excludedBlockIds = blockIds(candidateBlocks)
    .filter((id) => !selectedIds.has(id))
    .sort(compareStrings);
  const savings = estimatePromptSavings({
    baselineBlocks: candidateBlocks,
    optimizedBlocks: selectedBlocks,
  });

  return {
    manifest,
    cacheReport,
    lint,
    savings,
    selectedBlockIds,
    excludedBlockIds,
    summary: `Selected ${selectedBlockIds.length} context block(s), excluded ${excludedBlockIds.length} block(s), saving about ${savings.savedTokenCount} prompt token(s); stable prefix lint ${lint.status}.`,
  };
}

export function recommendToolSubset({
  toolDefinitions,
  objective,
  coreToolNames = DEFAULT_CORE_TOOL_NAMES,
} = {}) {
  const normalizedTools = normalizeToolDefinitions(toolDefinitions);
  const terms = keywordTerms(objective);
  const coreNames = uniqueStrings(coreToolNames);
  const coreNameSet = new Set(coreNames);
  const toolsByName = new Map(normalizedTools.map((tool) => [tool.name, tool]));
  const matchedTools = normalizedTools
    .filter((tool) => {
      if (coreNameSet.has(tool.name)) {
        return true;
      }

      const searchText = toolSearchText(tool);
      return terms.some((term) => searchText.includes(term));
    })
    .sort((left, right) => compareStrings(left.name, right.name));
  const matchedNames = new Set(matchedTools.map((tool) => tool.name));
  const selectedTools = [
    ...coreNames.map((name) => toolsByName.get(name) ?? {
      name,
      title: name,
      description: "Core pipeline tool.",
    }),
    ...matchedTools.filter((tool) => !coreNameSet.has(tool.name)),
  ];
  const selectedNames = new Set(selectedTools.map((tool) => tool.name));
  const excludedTools = normalizedTools
    .filter((tool) => !selectedNames.has(tool.name) && !matchedNames.has(tool.name))
    .sort((left, right) => compareStrings(left.name, right.name));
  const estimatedSchemaTokenSavings = excludedTools.reduce(
    (total, tool) => total + toolSchemaTokenCount(tool),
    0,
  );
  const summary = buildToolSummary(selectedTools, excludedTools, estimatedSchemaTokenSavings);

  return {
    selectedTools,
    excludedTools,
    estimatedSchemaTokenSavings,
    summary,
  };
}

export function buildTokenOptimizationReport({
  taskId,
  compiledAt,
  query,
  candidateBlocks,
  previousManifest = null,
  providerMetrics = {},
  toolDefinitions = [],
  objective = query,
  coreToolNames = DEFAULT_CORE_TOOL_NAMES,
}) {
  const contextArtifacts = buildOptimizedContextArtifacts({
    taskId,
    compiledAt,
    query,
    candidateBlocks,
    previousManifest,
    providerMetrics,
  });
  const toolSubset = recommendToolSubset({
    toolDefinitions,
    objective,
    coreToolNames,
  });

  return {
    manifest: contextArtifacts.manifest,
    cacheReport: contextArtifacts.cacheReport,
    toolSubset,
    savings: {
      prompt: contextArtifacts.savings,
      estimatedSchemaTokenSavings: toolSubset.estimatedSchemaTokenSavings,
    },
    summary: `${contextArtifacts.summary} ${toolSubset.summary}`,
  };
}
