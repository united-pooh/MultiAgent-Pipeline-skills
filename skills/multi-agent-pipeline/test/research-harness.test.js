import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  buildResearchHarnessState,
  dedupeCandidates,
  validateResearchHarnessCoverage,
} from "../src/runtime/research-harness.js";

function makeHarnessState(overrides = {}) {
  return buildResearchHarnessState({
    reportPath: "research-reports/2026-W23/agent-engineering-landing.md",
    generatedForDate: "2026-06-08",
    sourcesSeen: [
      {
        source_id: "SRC-001",
        source_type: "paper",
        title: "Agent engineering benchmark notes",
        locator: "https://example.com/agent-engineering",
      },
    ],
    candidates: [
      {
        candidate_id: "CAND-001",
        title: "Runtime artifact validation",
        status: "selected",
      },
    ],
    evidenceMap: [
      {
        candidate_id: "CAND-001",
        source_ids: ["SRC-001"],
        summary: "The report should bind selected candidates to cited evidence.",
      },
    ],
    rubric: {
      criteria: ["contract coverage", "fixture quality"],
      minimum_evidence_count: 1,
    },
    ...overrides,
  });
}

test("valid research harness state builds and passes artifact validation", () => {
  const state = makeHarnessState();

  assert.equal(validateArtifact("research-harness-state", state), state);
  assert.deepEqual(validateResearchHarnessCoverage(state), {
    status: "passed",
    missingEvidenceCandidateIds: [],
    duplicateCandidateTitles: [],
    missingSourceIds: [],
    summary: "Research harness coverage passed.",
  });
});

test("selected candidate with no evidence is reported failed", () => {
  const state = makeHarnessState({
    candidates: [
      {
        candidate_id: "CAND-001",
        title: "Runtime artifact validation",
        status: "selected",
      },
      {
        candidate_id: "CAND-002",
        title: "Queued harness follow-up",
        status: "queued",
      },
    ],
    evidenceMap: [
      {
        candidate_id: "CAND-002",
        source_ids: ["SRC-001"],
        summary: "Queued follow-up has evidence but selected candidate does not.",
      },
    ],
  });

  assert.equal(validateArtifact("research-harness-state", state), state);
  const coverage = validateResearchHarnessCoverage(state);

  assert.equal(coverage.status, "failed");
  assert.deepEqual(coverage.missingEvidenceCandidateIds, ["CAND-001"]);
  assert.deepEqual(coverage.missingSourceIds, []);
  assert.deepEqual(coverage.duplicateCandidateTitles, []);
});

test("duplicate title dedupe keeps first occurrence", () => {
  const firstCandidate = {
    candidate_id: "CAND-001",
    title: "Runtime artifact validation",
    status: "selected",
  };
  const secondCandidate = {
    candidate_id: "CAND-002",
    title: " runtime   artifact validation ",
    status: "queued",
  };
  const thirdCandidate = {
    candidate_id: "CAND-003",
    title: "Source coverage",
    status: "queued",
  };

  const deduped = dedupeCandidates([firstCandidate, secondCandidate, thirdCandidate]);

  assert.deepEqual(
    deduped.map((candidate) => candidate.candidate_id),
    ["CAND-001", "CAND-003"],
  );
  assert.equal(deduped[0], firstCandidate);
});
