const VERSION = "1.0";

function padOrdinal(index) {
  return String(index + 1).padStart(3, "0");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const compacted = compactString(value);
    if (compacted) {
      return compacted;
    }
  }

  return "";
}

function normalizeCandidateTitle(title) {
  return compactString(title).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function normalizeSourcesSeen(sourcesSeen) {
  return asArray(sourcesSeen).map((source, index) => {
    const sourceId = firstNonEmptyString(source?.source_id, source?.sourceId, `SRC-${padOrdinal(index)}`);

    return {
      source_id: sourceId,
      source_type: firstNonEmptyString(source?.source_type, source?.sourceType, "unknown"),
      title: firstNonEmptyString(source?.title, source?.name, `Source ${padOrdinal(index)}`),
      locator: firstNonEmptyString(source?.locator, source?.url, source?.path, sourceId),
    };
  });
}

function normalizeCandidates(candidates) {
  return asArray(candidates).map((candidate, index) => {
    const candidateId = firstNonEmptyString(
      candidate?.candidate_id,
      candidate?.candidateId,
      `CAND-${padOrdinal(index)}`,
    );

    return {
      candidate_id: candidateId,
      title: firstNonEmptyString(candidate?.title, `Candidate ${padOrdinal(index)}`),
      status: firstNonEmptyString(candidate?.status, candidate?.selected ? "selected" : "queued"),
    };
  });
}

function normalizeSourceIds(sourceIds) {
  return asArray(sourceIds)
    .map((sourceId) => compactString(sourceId))
    .filter(Boolean);
}

function normalizeEvidenceEntries(evidenceMap) {
  if (Array.isArray(evidenceMap)) {
    return evidenceMap.map((evidence) => ({ ...evidence }));
  }

  if (!evidenceMap || typeof evidenceMap !== "object") {
    return [];
  }

  return Object.entries(evidenceMap).map(([candidateId, evidence]) => {
    if (Array.isArray(evidence)) {
      return {
        candidate_id: candidateId,
        source_ids: evidence,
      };
    }

    return {
      candidate_id: candidateId,
      ...evidence,
    };
  });
}

function normalizeEvidenceMap(evidenceMap) {
  return normalizeEvidenceEntries(evidenceMap).map((evidence) => {
    const candidateId = firstNonEmptyString(evidence?.candidate_id, evidence?.candidateId);
    const sourceIds = normalizeSourceIds(evidence?.source_ids ?? evidence?.sourceIds);

    return {
      candidate_id: candidateId,
      source_ids: sourceIds,
      summary: firstNonEmptyString(evidence?.summary, `Evidence recorded for ${candidateId}.`),
    };
  });
}

function normalizeRubric(rubric) {
  const criteria = asArray(rubric?.criteria)
    .map((criterion) => compactString(criterion))
    .filter(Boolean);

  return {
    criteria: criteria.length > 0 ? criteria : ["evidence coverage"],
    minimum_evidence_count: Number.isInteger(rubric?.minimum_evidence_count)
      ? rubric.minimum_evidence_count
      : Number.isInteger(rubric?.minimumEvidenceCount)
        ? rubric.minimumEvidenceCount
        : 1,
  };
}

function normalizeOutputValidation(outputValidation, fallback) {
  const status = firstNonEmptyString(outputValidation?.status, fallback.status);
  const checks = asArray(outputValidation?.checks)
    .map((check) => compactString(check))
    .filter(Boolean);

  return {
    status,
    checks: checks.length > 0 ? checks : [fallback.summary],
  };
}

function uniqueInEncounterOrder(values) {
  const seen = new Set();
  const uniqueValues = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      uniqueValues.push(value);
    }
  }

  return uniqueValues;
}

export function dedupeCandidates(candidates) {
  const seenTitles = new Set();
  const deduped = [];

  for (const candidate of asArray(candidates)) {
    const titleKey = normalizeCandidateTitle(candidate?.title);
    if (seenTitles.has(titleKey)) {
      continue;
    }

    seenTitles.add(titleKey);
    deduped.push(candidate);
  }

  return deduped;
}

export function validateResearchHarnessCoverage(state) {
  const sourcesSeen = asArray(state?.sources_seen);
  const candidates = asArray(state?.candidate_index);
  const evidenceMap = asArray(state?.evidence_map);
  const sourceIds = new Set(sourcesSeen.map((source) => source?.source_id).filter(Boolean));
  const evidenceByCandidateId = new Map();

  for (const evidence of evidenceMap) {
    const candidateId = compactString(evidence?.candidate_id);
    if (!candidateId) {
      continue;
    }

    const existing = evidenceByCandidateId.get(candidateId) ?? [];
    evidenceByCandidateId.set(candidateId, existing.concat(normalizeSourceIds(evidence?.source_ids)));
  }

  const missingEvidenceCandidateIds = candidates
    .filter((candidate) => candidate?.status === "selected")
    .filter((candidate) => normalizeSourceIds(evidenceByCandidateId.get(candidate?.candidate_id)).length === 0)
    .map((candidate) => candidate.candidate_id);

  const missingSourceIds = uniqueInEncounterOrder(
    evidenceMap.flatMap((evidence) =>
      normalizeSourceIds(evidence?.source_ids).filter((sourceId) => !sourceIds.has(sourceId)),
    ),
  );

  const firstTitleByKey = new Map();
  const duplicateCandidateTitles = [];
  const duplicateTitleKeys = new Set();

  for (const candidate of candidates) {
    const title = compactString(candidate?.title);
    const titleKey = normalizeCandidateTitle(title);
    if (!titleKey) {
      continue;
    }

    if (firstTitleByKey.has(titleKey)) {
      if (!duplicateTitleKeys.has(titleKey)) {
        duplicateTitleKeys.add(titleKey);
        duplicateCandidateTitles.push(firstTitleByKey.get(titleKey));
      }
      continue;
    }

    firstTitleByKey.set(titleKey, title);
  }

  const failed =
    missingEvidenceCandidateIds.length > 0 ||
    duplicateCandidateTitles.length > 0 ||
    missingSourceIds.length > 0;
  const summary = failed
    ? [
        `${missingEvidenceCandidateIds.length} selected candidate(s) missing evidence`,
        `${missingSourceIds.length} missing source reference(s)`,
        `${duplicateCandidateTitles.length} duplicate candidate title(s)`,
      ].join("; ")
    : "Research harness coverage passed.";

  return {
    status: failed ? "failed" : "passed",
    missingEvidenceCandidateIds,
    duplicateCandidateTitles,
    missingSourceIds,
    summary,
  };
}

export function buildResearchHarnessState({
  reportPath,
  generatedForDate,
  sourcesSeen,
  candidates,
  evidenceMap,
  rubric,
  outputValidation,
} = {}) {
  const state = {
    version: VERSION,
    report_path: firstNonEmptyString(reportPath, "research-report.md"),
    generated_for_date: firstNonEmptyString(generatedForDate, new Date().toISOString().slice(0, 10)),
    sources_seen: normalizeSourcesSeen(sourcesSeen),
    candidate_index: normalizeCandidates(candidates),
    evidence_map: normalizeEvidenceMap(evidenceMap),
    rubric: normalizeRubric(rubric),
    output_validation: {
      status: "passed",
      checks: ["Research harness coverage pending."],
    },
  };

  const coverage = validateResearchHarnessCoverage(state);
  state.output_validation = normalizeOutputValidation(outputValidation, coverage);

  return state;
}
