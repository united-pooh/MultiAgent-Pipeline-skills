import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../src/index.js";
import {
  buildStateStoreSnapshot,
  confirmMemoryChannel,
  markCandidateStatus,
  recordFailedBranch,
  summarizeResumeState,
} from "../src/runtime/state-store.js";

function makeSnapshot() {
  return buildStateStoreSnapshot({
    taskId: "TASK-state-store-001",
    activePath: {
      pathId: "PATH-main",
      currentStage: "execution",
    },
    candidatePool: [
      {
        candidateId: "CAND-001",
        status: "active",
      },
      {
        candidateId: "CAND-002",
        status: "parked",
      },
    ],
    evidenceLinks: [
      {
        evidenceId: "EVID-001",
        source: "dispatch.json",
        target: "CAND-001",
      },
    ],
    rollbackBoundaries: [
      {
        boundaryId: "RB-001",
        restoreRef: "git:HEAD",
      },
    ],
    memoryChannelChecks: [
      {
        channel: "local-artifacts",
        status: "passed",
      },
    ],
  });
}

test("buildStateStoreSnapshot creates a valid state-store-snapshot artifact", () => {
  const snapshot = makeSnapshot();

  assert.equal(validateArtifact("state-store-snapshot", snapshot), snapshot);
  assert.equal(snapshot.version, "1.0");
  assert.deepEqual(snapshot.active_path, {
    path_id: "PATH-main",
    current_stage: "execution",
  });
});

test("markCandidateStatus returns a new snapshot without mutating the input", () => {
  const snapshot = makeSnapshot();
  const updated = markCandidateStatus(snapshot, "CAND-002", "rejected");

  assert.notEqual(updated, snapshot);
  assert.equal(snapshot.candidate_pool[1].status, "parked");
  assert.equal(updated.candidate_pool[1].status, "rejected");
  assert.equal(validateArtifact("state-store-snapshot", updated), updated);
});

test("recordFailedBranch does not append duplicate failed branches", () => {
  const snapshot = makeSnapshot();
  const firstUpdate = recordFailedBranch(snapshot, {
    branchId: "BRANCH-001",
    reason: "Validation failed after retry.",
  });
  const secondUpdate = recordFailedBranch(firstUpdate, {
    branchId: "BRANCH-001",
    reason: "Validation failed after retry.",
  });

  assert.equal(firstUpdate.failed_branches.length, 1);
  assert.equal(secondUpdate.failed_branches.length, 1);
  assert.equal(secondUpdate.failed_branches[0].branch_id, "BRANCH-001");
  assert.equal(validateArtifact("state-store-snapshot", secondUpdate), secondUpdate);
});

test("summarizeResumeState reports stage, active candidates, and memory check status", () => {
  const snapshot = confirmMemoryChannel(makeSnapshot(), {
    channel: "external-memory",
    status: "warning",
  });
  const summary = summarizeResumeState(snapshot);

  assert.equal(summary.taskId, "TASK-state-store-001");
  assert.equal(summary.currentStage, "execution");
  assert.deepEqual(summary.activeCandidateIds, ["CAND-001"]);
  assert.equal(summary.failedBranchCount, 0);
  assert.equal(summary.rollbackBoundaryCount, 1);
  assert.equal(summary.memoryChecksPassed, false);
  assert.match(summary.summary, /execution/);
});
