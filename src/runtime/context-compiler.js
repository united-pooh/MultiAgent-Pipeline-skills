import crypto from "node:crypto";

import { validateArtifact } from "./contracts.js";

const MANIFEST_VERSION = "1.0";
const BLOCK_FIELDS = [
  "id",
  "version",
  "source",
  "priority",
  "tenant_scope",
  "cacheable",
  "evictable",
  "requires_approval",
  "hash",
];

function normalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : normalizeJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
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

function sha256Digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareStrings(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function blockSort(left, right) {
  const priorityDiff = right.priority - left.priority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return compareStrings(String(left.id), String(right.id));
}

function normalizeBlock(block) {
  const blockWithoutHash = { ...block };
  delete blockWithoutHash.hash;

  const hash = typeof block.hash === "string" && block.hash.trim() !== ""
    ? block.hash
    : `sha256:${sha256Digest(stableJsonStringify(blockWithoutHash))}`;

  const normalized = {};
  for (const field of BLOCK_FIELDS) {
    normalized[field] = field === "hash" ? hash : block[field];
  }

  const extraFields = Object.keys(block)
    .filter((field) => !BLOCK_FIELDS.includes(field))
    .sort();
  for (const field of extraFields) {
    normalized[field] = block[field];
  }

  return normalized;
}

function blockIds(blocks) {
  return new Set((blocks ?? []).map((block) => block.id));
}

export function diffContextBlocks(previousBlocks = [], nextBlocks = []) {
  const previousIds = blockIds(previousBlocks);
  const nextIds = blockIds(nextBlocks);
  const addedBlocks = [...nextIds]
    .filter((id) => !previousIds.has(id))
    .sort(compareStrings);
  const removedBlocks = [...previousIds]
    .filter((id) => !nextIds.has(id))
    .sort(compareStrings);

  const summary = addedBlocks.length === 0 && removedBlocks.length === 0
    ? "No context block changes."
    : `Added ${addedBlocks.length} block(s), removed ${removedBlocks.length} block(s).`;

  return {
    summary,
    added_blocks: addedBlocks,
    removed_blocks: removedBlocks,
  };
}

export function compileContextManifest({
  taskId,
  compiledAt,
  blocks,
  previousManifest = null,
}) {
  const normalizedBlocks = (blocks ?? [])
    .map((block) => normalizeBlock(block))
    .sort(blockSort);

  const manifest = {
    version: MANIFEST_VERSION,
    task_id: taskId,
    compiled_at: compiledAt,
    blocks: normalizedBlocks,
    prompt_diff: diffContextBlocks(previousManifest?.blocks ?? [], normalizedBlocks),
  };

  return validateArtifact("context-manifest", manifest);
}

function queryTerms(query) {
  if (typeof query !== "string") {
    return [];
  }

  return query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter(Boolean)
    .sort();
}

function blockSearchText(block) {
  const tags = Array.isArray(block.tags) ? block.tags.join(" ") : "";
  return [
    block.id,
    block.source,
    tags,
    block.description,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function selectRelevantBlocks(blocks, query, { limit } = {}) {
  const terms = queryTerms(query);
  const filteredBlocks = terms.length === 0
    ? [...(blocks ?? [])]
    : (blocks ?? []).filter((block) => {
        const text = blockSearchText(block);
        return terms.some((term) => text.includes(term));
      });

  const sortedBlocks = filteredBlocks.sort(blockSort);
  if (limit === undefined) {
    return sortedBlocks;
  }

  return sortedBlocks.slice(0, Math.max(0, limit));
}
