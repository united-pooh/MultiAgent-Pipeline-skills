const CANDIDATE_STATUSES = new Set(["active", "parked", "rejected"]);
const MEMORY_CHANNEL_STATUSES = new Set(["passed", "warning", "failed"]);

function clone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }

  return value;
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function expectStatus(status, allowedStatuses, fieldName) {
  if (!allowedStatuses.has(status)) {
    throw new Error(`${fieldName} must be one of: ${[...allowedStatuses].join(", ")}`);
  }

  return status;
}

function normalizeActivePath(activePath) {
  const path = activePath && typeof activePath === "object" ? activePath : {};

  return {
    path_id: requireNonEmptyString(path.path_id ?? path.pathId, "active_path.path_id"),
    current_stage: requireNonEmptyString(
      path.current_stage ?? path.currentStage,
      "active_path.current_stage",
    ),
  };
}

function normalizeCandidate(candidate) {
  const entry = candidate && typeof candidate === "object" ? candidate : {};

  return {
    candidate_id: requireNonEmptyString(
      entry.candidate_id ?? entry.candidateId,
      "candidate_pool[].candidate_id",
    ),
    status: expectStatus(entry.status ?? "active", CANDIDATE_STATUSES, "candidate_pool[].status"),
  };
}

function normalizeEvidenceLink(link) {
  const entry = link && typeof link === "object" ? link : {};

  return {
    evidence_id: requireNonEmptyString(
      entry.evidence_id ?? entry.evidenceId,
      "evidence_links[].evidence_id",
    ),
    source: requireNonEmptyString(entry.source, "evidence_links[].source"),
    target: requireNonEmptyString(entry.target, "evidence_links[].target"),
  };
}

function normalizeFailedBranch(branch) {
  const entry = branch && typeof branch === "object" ? branch : {};

  return {
    branch_id: requireNonEmptyString(
      entry.branch_id ?? entry.branchId,
      "failed_branches[].branch_id",
    ),
    reason: requireNonEmptyString(entry.reason, "failed_branches[].reason"),
  };
}

function normalizeRollbackBoundary(boundary) {
  const entry = boundary && typeof boundary === "object" ? boundary : {};

  return {
    boundary_id: requireNonEmptyString(
      entry.boundary_id ?? entry.boundaryId,
      "rollback_boundaries[].boundary_id",
    ),
    restore_ref: requireNonEmptyString(
      entry.restore_ref ?? entry.restoreRef,
      "rollback_boundaries[].restore_ref",
    ),
  };
}

function normalizeMemoryChannelCheck(check) {
  const entry = check && typeof check === "object" ? check : {};

  return {
    channel: requireNonEmptyString(entry.channel, "memory_channel_checks[].channel"),
    status: expectStatus(
      entry.status ?? "passed",
      MEMORY_CHANNEL_STATUSES,
      "memory_channel_checks[].status",
    ),
  };
}

export function buildStateStoreSnapshot({
  taskId,
  activePath,
  candidatePool,
  evidenceLinks = [],
  failedBranches = [],
  rollbackBoundaries,
  memoryChannelChecks,
}) {
  return {
    version: "1.0",
    task_id: requireNonEmptyString(taskId, "task_id"),
    active_path: normalizeActivePath(activePath),
    candidate_pool: normalizeArray(candidatePool).map(normalizeCandidate),
    evidence_links: normalizeArray(evidenceLinks).map(normalizeEvidenceLink),
    failed_branches: normalizeArray(failedBranches).map(normalizeFailedBranch),
    rollback_boundaries: normalizeArray(rollbackBoundaries).map(normalizeRollbackBoundary),
    memory_channel_checks: normalizeArray(memoryChannelChecks).map(normalizeMemoryChannelCheck),
  };
}

export function markCandidateStatus(snapshot, candidateId, status) {
  const normalizedStatus = expectStatus(status, CANDIDATE_STATUSES, "status");
  const normalizedCandidateId = requireNonEmptyString(candidateId, "candidateId");
  let found = false;

  const nextSnapshot = clone(snapshot);
  nextSnapshot.candidate_pool = normalizeArray(snapshot.candidate_pool).map((candidate) => {
    if (candidate.candidate_id !== normalizedCandidateId) {
      return clone(candidate);
    }

    found = true;
    return {
      ...clone(candidate),
      status: normalizedStatus,
    };
  });

  if (!found) {
    throw new Error(`candidate ${normalizedCandidateId} was not found`);
  }

  return nextSnapshot;
}

export function recordFailedBranch(snapshot, { branchId, branch_id: branchIdSnake, reason }) {
  const failedBranch = normalizeFailedBranch({
    branch_id: branchIdSnake ?? branchId,
    reason,
  });
  const nextSnapshot = clone(snapshot);
  const failedBranches = normalizeArray(snapshot.failed_branches).map(normalizeFailedBranch);

  if (!failedBranches.some((branch) => branch.branch_id === failedBranch.branch_id)) {
    failedBranches.push(failedBranch);
  }

  nextSnapshot.failed_branches = failedBranches;
  return nextSnapshot;
}

export function confirmMemoryChannel(snapshot, { channel, status }) {
  const normalizedCheck = normalizeMemoryChannelCheck({ channel, status });
  const nextSnapshot = clone(snapshot);
  const checks = normalizeArray(snapshot.memory_channel_checks).map(normalizeMemoryChannelCheck);
  const index = checks.findIndex((check) => check.channel === normalizedCheck.channel);

  if (index === -1) {
    checks.push(normalizedCheck);
  } else {
    checks[index] = {
      ...checks[index],
      status: normalizedCheck.status,
    };
  }

  nextSnapshot.memory_channel_checks = checks;
  return nextSnapshot;
}

export function summarizeResumeState(snapshot) {
  const taskId = snapshot.task_id;
  const currentStage = snapshot.active_path?.current_stage;
  const activeCandidateIds = normalizeArray(snapshot.candidate_pool)
    .filter((candidate) => candidate.status === "active")
    .map((candidate) => candidate.candidate_id);
  const failedBranchCount = normalizeArray(snapshot.failed_branches).length;
  const rollbackBoundaryCount = normalizeArray(snapshot.rollback_boundaries).length;
  const memoryChecks = normalizeArray(snapshot.memory_channel_checks);
  const memoryChecksPassed =
    memoryChecks.length > 0 && memoryChecks.every((check) => check.status === "passed");
  const candidateSummary = activeCandidateIds.length > 0 ? activeCandidateIds.join(", ") : "none";

  return {
    taskId,
    currentStage,
    activeCandidateIds,
    failedBranchCount,
    rollbackBoundaryCount,
    memoryChecksPassed,
    summary: `Task ${taskId} resumes at ${currentStage} with active candidates ${candidateSummary}; ${failedBranchCount} failed branch(es), ${rollbackBoundaryCount} rollback boundary(ies), memory checks ${memoryChecksPassed ? "passed" : "not passed"}.`,
  };
}
