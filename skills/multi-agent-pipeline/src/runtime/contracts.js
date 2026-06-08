import {
  FINAL_ASSESSMENT_DIMENSIONS,
  INTEGRATION_STRATEGY,
  PRE_CRITERIA,
  TREE_RUBRIC_VALIDATION_DIMENSIONS,
} from "./constants.js";
import { ContractValidationError } from "./errors.js";
import { CODEX_PET_STATES } from "./pet-events.js";
import { uniqueStrings } from "./utils.js";

const MAX_DISPATCH_GROUPS_PER_WAVE = 6;

function fail(artifactName, message) {
  throw new ContractValidationError(artifactName, message);
}

function expectObject(value, fieldName, artifactName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(artifactName, `${fieldName} must be an object`);
  }

  return value;
}

function expectString(value, fieldName, artifactName) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(artifactName, `${fieldName} must be a non-empty string`);
  }

  return value;
}

function expectStringValue(value, fieldName, artifactName) {
  if (typeof value !== "string") {
    fail(artifactName, `${fieldName} must be a string`);
  }

  return value;
}

function expectNullableString(value, fieldName, artifactName) {
  if (value !== null && (typeof value !== "string" || value.trim() === "")) {
    fail(artifactName, `${fieldName} must be null or a non-empty string`);
  }

  return value;
}

function expectInteger(value, fieldName, artifactName, { min = null } = {}) {
  if (!Number.isInteger(value)) {
    fail(artifactName, `${fieldName} must be an integer`);
  }

  if (min !== null && value < min) {
    fail(artifactName, `${fieldName} must be >= ${min}`);
  }

  return value;
}

function expectNumber(value, fieldName, artifactName, { min = null } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(artifactName, `${fieldName} must be a finite number`);
  }

  if (min !== null && value < min) {
    fail(artifactName, `${fieldName} must be >= ${min}`);
  }

  return value;
}

function expectBoolean(value, fieldName, artifactName) {
  if (typeof value !== "boolean") {
    fail(artifactName, `${fieldName} must be a boolean`);
  }

  return value;
}

function expectNullableInteger(value, fieldName, artifactName, { min = null } = {}) {
  if (value === null) {
    return value;
  }

  return expectInteger(value, fieldName, artifactName, { min });
}

function expectArray(value, fieldName, artifactName, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) {
    fail(artifactName, `${fieldName} must be an array`);
  }

  if (value.length < minLength) {
    fail(artifactName, `${fieldName} must contain at least ${minLength} item(s)`);
  }

  return value;
}

function expectEnum(value, fieldName, artifactName, allowedValues) {
  if (!allowedValues.includes(value)) {
    fail(artifactName, `${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
}

function expectStringArray(value, fieldName, artifactName, { minLength = 0 } = {}) {
  const array = expectArray(value, fieldName, artifactName, { minLength });
  array.forEach((item, index) => expectString(item, `${fieldName}[${index}]`, artifactName));
  return array;
}

function expectVersion(value, artifactName) {
  if (value !== "1.0") {
    fail(artifactName, "version must be \"1.0\"");
  }
}

function expectAppliedSkills(value, artifactName, allowedValues = null) {
  const skills = expectStringArray(value, "applied_skills", artifactName);

  if (allowedValues) {
    for (const skill of skills) {
      if (!allowedValues.includes(skill)) {
        fail(artifactName, `unexpected skill "${skill}"`);
      }
    }
  }

  return uniqueStrings(skills);
}

function validateSpec(artifact) {
  const artifactName = "spec";
  const spec = expectObject(artifact, artifactName, artifactName);
  expectVersion(spec.version, artifactName);

  const appliedSkills = expectAppliedSkills(spec.applied_skills, artifactName);
  if (appliedSkills.length !== 0) {
    fail(artifactName, "applied_skills must be []");
  }

  expectString(spec.feature_name, "feature_name", artifactName);
  expectString(spec.objective, "objective", artifactName);
  expectString(spec.original_input_summary, "original_input_summary", artifactName);
  expectEnum(spec.input_type, "input_type", artifactName, ["natural_language", "document"]);

  const requirements = expectArray(spec.requirements, "requirements", artifactName, { minLength: 1 });
  requirements.forEach((requirement, index) => {
    const entry = expectObject(requirement, `requirements[${index}]`, artifactName);
    const expectedId = `REQ-${String(index + 1).padStart(3, "0")}`;
    if (entry.id !== expectedId) {
      fail(artifactName, `requirements[${index}].id must be ${expectedId}`);
    }

    expectString(entry.description, `requirements[${index}].description`, artifactName);
    expectEnum(
      entry.priority,
      `requirements[${index}].priority`,
      artifactName,
      ["must-have", "should-have", "nice-to-have"],
    );
    expectStringArray(
      entry.acceptance_criteria,
      `requirements[${index}].acceptance_criteria`,
      artifactName,
      { minLength: 1 },
    );
  });

  expectStringArray(spec.constraints, "constraints", artifactName);
  expectStringArray(spec.out_of_scope, "out_of_scope", artifactName);
  expectStringArray(spec.assumptions, "assumptions", artifactName);
  return spec;
}

function validatePlan(artifact) {
  const artifactName = "plan";
  const plan = expectObject(artifact, artifactName, artifactName);
  expectVersion(plan.version, artifactName);

  const appliedSkills = expectAppliedSkills(plan.applied_skills, artifactName);
  if (appliedSkills.length !== 0) {
    fail(artifactName, "applied_skills must be []");
  }

  if (plan.spec_ref !== "spec.json") {
    fail(artifactName, "spec_ref must be \"spec.json\"");
  }

  const taskIds = new Set();
  const phases = expectArray(plan.phases, "phases", artifactName, { minLength: 1 });
  phases.forEach((phase, phaseIndex) => {
    const entry = expectObject(phase, `phases[${phaseIndex}]`, artifactName);
    expectString(entry.id, `phases[${phaseIndex}].id`, artifactName);
    expectString(entry.name, `phases[${phaseIndex}].name`, artifactName);

    const tasks = expectArray(entry.tasks, `phases[${phaseIndex}].tasks`, artifactName, {
      minLength: 1,
    });
    tasks.forEach((task, taskIndex) => {
      const taskEntry = expectObject(
        task,
        `phases[${phaseIndex}].tasks[${taskIndex}]`,
        artifactName,
      );
      expectString(taskEntry.id, `task ${taskIndex} id`, artifactName);
      if (taskIds.has(taskEntry.id)) {
        fail(artifactName, `duplicate task id ${taskEntry.id}`);
      }

      taskIds.add(taskEntry.id);
      expectString(taskEntry.description, `task ${taskEntry.id} description`, artifactName);
      expectEnum(
        taskEntry.estimated_complexity,
        `task ${taskEntry.id} estimated_complexity`,
        artifactName,
        ["low", "medium", "high"],
      );
      expectStringArray(taskEntry.depends_on, `task ${taskEntry.id} depends_on`, artifactName);
      expectStringArray(taskEntry.target_files, `task ${taskEntry.id} target_files`, artifactName, {
        minLength: 1,
      });
    });
  });

  const executionOrder = expectStringArray(plan.execution_order, "execution_order", artifactName, {
    minLength: 1,
  });
  if (executionOrder.length !== taskIds.size) {
    fail(artifactName, "execution_order must list every task exactly once");
  }

  const seen = new Set();
  executionOrder.forEach((taskId) => {
    if (!taskIds.has(taskId)) {
      fail(artifactName, `execution_order references unknown task ${taskId}`);
    }

    if (seen.has(taskId)) {
      fail(artifactName, `execution_order contains duplicate task ${taskId}`);
    }

    seen.add(taskId);
  });

  const positions = new Map(executionOrder.map((taskId, index) => [taskId, index]));
  phases.forEach((phase) => {
    phase.tasks.forEach((task) => {
      task.depends_on.forEach((dependencyId) => {
        if (!taskIds.has(dependencyId)) {
          fail(artifactName, `task ${task.id} depends_on unknown task ${dependencyId}`);
        }

        if (positions.get(dependencyId) >= positions.get(task.id)) {
          fail(artifactName, `execution_order violates dependency ${dependencyId} -> ${task.id}`);
        }
      });
    });
  });

  expectStringArray(plan.risk_items, "risk_items", artifactName, { minLength: 1 });
  return plan;
}

function validateArchitecture(artifact) {
  const artifactName = "architecture";
  const architecture = expectObject(artifact, artifactName, artifactName);
  expectVersion(architecture.version, artifactName);

  if (architecture.spec_ref !== "spec.json") {
    fail(artifactName, "spec_ref must be \"spec.json\"");
  }

  if (architecture.plan_ref !== "plan.json") {
    fail(artifactName, "plan_ref must be \"plan.json\"");
  }

  const analysis = expectObject(
    architecture.codebase_analysis,
    "codebase_analysis",
    artifactName,
  );
  expectStringArray(analysis.relevant_modules, "codebase_analysis.relevant_modules", artifactName);
  expectStringArray(analysis.current_patterns, "codebase_analysis.current_patterns", artifactName);
  expectStringArray(analysis.tech_debt, "codebase_analysis.tech_debt", artifactName);

  expectEnum(architecture.decision, "decision", artifactName, [
    "refactor",
    "incremental",
    "hybrid",
  ]);
  expectString(architecture.decision_rationale, "decision_rationale", artifactName);

  const proposedChanges = expectArray(
    architecture.proposed_changes,
    "proposed_changes",
    artifactName,
  );
  proposedChanges.forEach((change, index) => {
    const entry = expectObject(change, `proposed_changes[${index}]`, artifactName);
    expectString(entry.target, `proposed_changes[${index}].target`, artifactName);
    expectEnum(entry.change_type, `proposed_changes[${index}].change_type`, artifactName, [
      "modify",
      "create",
      "delete",
      "move",
    ]);
    expectString(entry.description, `proposed_changes[${index}].description`, artifactName);
    const concerns = expectStringArray(
      entry.concerns,
      `proposed_changes[${index}].concerns`,
      artifactName,
    );
    concerns.forEach((concern) => {
      if (concern !== "frontend_design") {
        fail(artifactName, `unsupported concern "${concern}"`);
      }
    });
  });

  const dependencyChanges = expectArray(
    architecture.dependency_changes,
    "dependency_changes",
    artifactName,
  );
  dependencyChanges.forEach((change, index) => {
    const entry = expectObject(change, `dependency_changes[${index}]`, artifactName);
    expectEnum(entry.action, `dependency_changes[${index}].action`, artifactName, [
      "add",
      "remove",
      "upgrade",
    ]);
    expectString(entry.package, `dependency_changes[${index}].package`, artifactName);
    expectString(entry.reason, `dependency_changes[${index}].reason`, artifactName);
  });

  expectEnum(architecture.feasibility, "feasibility", artifactName, [
    "feasible",
    "infeasible",
  ]);

  if (architecture.feasibility === "feasible") {
    if (architecture.infeasibility_reason !== null || architecture.rollback_notes !== null) {
      fail(
        artifactName,
        "infeasibility_reason and rollback_notes must be null when feasibility is feasible",
      );
    }
  } else {
    expectNullableString(architecture.infeasibility_reason, "infeasibility_reason", artifactName);
    expectNullableString(architecture.rollback_notes, "rollback_notes", artifactName);
  }

  return architecture;
}

function validateDispatch(artifact, context = {}) {
  const artifactName = "dispatch";
  const dispatch = expectObject(artifact, artifactName, artifactName);
  expectVersion(dispatch.version, artifactName);

  if (dispatch.spec_ref !== "spec.json") {
    fail(artifactName, "spec_ref must be \"spec.json\"");
  }

  if (dispatch.plan_ref !== "plan.json") {
    fail(artifactName, "plan_ref must be \"plan.json\"");
  }

  if (dispatch.architecture_ref !== "architecture.json") {
    fail(artifactName, "architecture_ref must be \"architecture.json\"");
  }

  const workerGroups = expectArray(dispatch.worker_groups, "worker_groups", artifactName, {
    minLength: 1,
  });
  const groupIds = new Set();
  const ownedFilesByGroup = new Map();
  const taskOwnership = new Map();

  workerGroups.forEach((group, index) => {
    const entry = expectObject(group, `worker_groups[${index}]`, artifactName);
    expectString(entry.group_id, `worker_groups[${index}].group_id`, artifactName);
    if (groupIds.has(entry.group_id)) {
      fail(artifactName, `duplicate group_id ${entry.group_id}`);
    }

    groupIds.add(entry.group_id);
    const tasks = expectStringArray(entry.tasks, `worker_groups[${index}].tasks`, artifactName, {
      minLength: 1,
    });
    tasks.forEach((taskId) => {
      if (taskOwnership.has(taskId)) {
        fail(artifactName, `task ${taskId} appears in multiple worker groups`);
      }

      taskOwnership.set(taskId, entry.group_id);
    });

    const ownedFiles = expectStringArray(
      entry.owned_files,
      `worker_groups[${index}].owned_files`,
      artifactName,
      { minLength: 1 },
    );
    ownedFilesByGroup.set(entry.group_id, new Set(ownedFiles));
    const dependsOnGroups = expectStringArray(
      entry.depends_on_groups,
      `worker_groups[${index}].depends_on_groups`,
      artifactName,
    );
    dependsOnGroups.forEach((groupId) => {
      if (groupId === entry.group_id) {
        fail(artifactName, `${entry.group_id} cannot depend on itself`);
      }
    });

    const requiredSkills = expectStringArray(
      entry.required_skills,
      `worker_groups[${index}].required_skills`,
      artifactName,
    );
    requiredSkills.forEach((skill) => {
      if (skill !== "ce-frontend-design") {
        fail(artifactName, `unsupported required skill "${skill}"`);
      }
    });
  });

  const executionWaves = expectArray(
    dispatch.execution_waves,
    "execution_waves",
    artifactName,
    { minLength: 1 },
  );
  const waveByGroup = new Map();
  executionWaves.forEach((waveEntry, index) => {
    const entry = expectObject(waveEntry, `execution_waves[${index}]`, artifactName);
    expectInteger(entry.wave, `execution_waves[${index}].wave`, artifactName, { min: 1 });
    const groups = expectStringArray(entry.groups, `execution_waves[${index}].groups`, artifactName, {
      minLength: 1,
    });
    if (groups.length > MAX_DISPATCH_GROUPS_PER_WAVE) {
      fail(
        artifactName,
        `execution_waves[${index}].groups exceeds max of ${MAX_DISPATCH_GROUPS_PER_WAVE} groups per wave`,
      );
    }

    const seenFiles = new Set();
    for (const groupId of groups) {
      if (!groupIds.has(groupId)) {
        fail(artifactName, `execution_waves references unknown group ${groupId}`);
      }

      if (waveByGroup.has(groupId)) {
        fail(artifactName, `group ${groupId} appears in multiple execution waves`);
      }

      waveByGroup.set(groupId, entry.wave);
      for (const file of ownedFilesByGroup.get(groupId) ?? []) {
        if (seenFiles.has(file)) {
          fail(artifactName, `file overlap detected within wave ${entry.wave}: ${file}`);
        }

        seenFiles.add(file);
      }
    }
  });

  workerGroups.forEach((group) => {
    group.depends_on_groups.forEach((dependencyGroupId) => {
      if (!groupIds.has(dependencyGroupId)) {
        fail(artifactName, `${group.group_id} depends on unknown group ${dependencyGroupId}`);
      }

      if ((waveByGroup.get(dependencyGroupId) ?? 0) >= (waveByGroup.get(group.group_id) ?? 0)) {
        fail(
          artifactName,
          `${group.group_id} must be scheduled after dependency ${dependencyGroupId}`,
        );
      }
    });
  });

  const integrationStrategy = expectObject(
    dispatch.integration_strategy,
    "integration_strategy",
    artifactName,
  );
  for (const [key, expectedValue] of Object.entries(INTEGRATION_STRATEGY)) {
    if (integrationStrategy[key] !== expectedValue) {
      fail(artifactName, `integration_strategy.${key} must be "${expectedValue}"`);
    }
  }

  expectString(dispatch.rationale, "rationale", artifactName);

  if (context.plan) {
    const expectedTasks = [];
    context.plan.phases.forEach((phase) => {
      phase.tasks.forEach((task) => expectedTasks.push(task.id));
    });

    if (expectedTasks.length !== taskOwnership.size) {
      fail(artifactName, "worker groups must cover every plan task exactly once");
    }

    for (const taskId of expectedTasks) {
      if (!taskOwnership.has(taskId)) {
        fail(artifactName, `missing worker group ownership for task ${taskId}`);
      }
    }
  }

  if (context.architecture) {
    const proposedChangesByTarget = new Map(
      context.architecture.proposed_changes.map((change) => [change.target, change]),
    );
    const expectedTargets = context.architecture.proposed_changes.map((change) => change.target);

    for (const target of expectedTargets) {
      const owned = workerGroups.some((group) => group.owned_files.includes(target));
      if (!owned) {
        fail(artifactName, `no worker group owns architecture target ${target}`);
      }
    }

    workerGroups.forEach((group) => {
      const expectedSkills = uniqueStrings(
        group.owned_files.flatMap((ownedFile) => {
          const concerns = proposedChangesByTarget.get(ownedFile)?.concerns ?? [];
          return concerns.map((concern) =>
            concern === "frontend_design" ? "ce-frontend-design" : concern,
          );
        }),
      ).sort();
      const actualSkills = uniqueStrings(group.required_skills).sort();

      if (expectedSkills.length !== actualSkills.length) {
        fail(
          artifactName,
          `${group.group_id} required_skills must match architecture-derived routing`,
        );
      }

      expectedSkills.forEach((skillName, index) => {
        if (skillName !== actualSkills[index]) {
          fail(
            artifactName,
            `${group.group_id} required_skills must match architecture-derived routing`,
          );
        }
      });
    });
  }

  return dispatch;
}

function validateFrontendDesignSummary(value, artifactName) {
  const summary = expectObject(value, "frontend_design_summary", artifactName);
  expectEnum(summary.system_mode, "frontend_design_summary.system_mode", artifactName, [
    "existing_system",
    "partial_system",
    "greenfield",
    "ambiguous",
  ]);
  expectString(summary.visual_thesis, "frontend_design_summary.visual_thesis", artifactName);
  expectString(summary.content_plan, "frontend_design_summary.content_plan", artifactName);
  expectStringArray(
    summary.interaction_plan,
    "frontend_design_summary.interaction_plan",
    artifactName,
    { minLength: 1 },
  );
  expectString(
    summary.visual_verification_method,
    "frontend_design_summary.visual_verification_method",
    artifactName,
  );
  expectString(
    summary.visual_verification_result,
    "frontend_design_summary.visual_verification_result",
    artifactName,
  );
}

function validateExecutionReport(artifact, context = {}) {
  const artifactName = "execution-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.group_id, "group_id", artifactName);
  expectInteger(report.iteration, "iteration", artifactName, { min: 1 });
  expectString(report.base_ref, "base_ref", artifactName);
  expectString(report.proposal_ref, "proposal_ref", artifactName);
  expectEnum(report.status, "status", artifactName, ["implemented", "blocked"]);
  expectStringArray(report.changed_files, "changed_files", artifactName);
  expectStringArray(report.requirements_covered, "requirements_covered", artifactName);
  expectStringArray(report.follow_up_notes, "follow_up_notes", artifactName);
  const blockers = expectStringArray(report.blockers, "blockers", artifactName);

  const testsRun = expectArray(report.tests_run, "tests_run", artifactName);
  testsRun.forEach((testEntry, index) => {
    const entry = expectObject(testEntry, `tests_run[${index}]`, artifactName);
    expectString(entry.command, `tests_run[${index}].command`, artifactName);
    expectEnum(entry.status, `tests_run[${index}].status`, artifactName, [
      "passed",
      "failed",
      "not_run",
    ]);
    expectString(entry.details, `tests_run[${index}].details`, artifactName);
  });

  const appliedSkills = expectAppliedSkills(report.applied_skills, artifactName, [
    "ce-frontend-design",
  ]);
  const requiredSkills = context.requiredSkills ?? [];
  const needsFrontendDesign = requiredSkills.includes("ce-frontend-design");
  if (needsFrontendDesign) {
    if (!appliedSkills.includes("ce-frontend-design")) {
      fail(artifactName, "applied_skills must include ce-frontend-design");
    }

    validateFrontendDesignSummary(report.frontend_design_summary, artifactName);
  } else if (report.frontend_design_summary !== null) {
    fail(artifactName, "frontend_design_summary must be null when no frontend skill is required");
  }

  if (report.status === "implemented" && blockers.length > 0) {
    fail(artifactName, "blockers must be empty when status is implemented");
  }

  if (report.status === "blocked" && blockers.length === 0) {
    fail(artifactName, "blockers must be non-empty when status is blocked");
  }

  const replanBlockerIndex = blockers.findIndex((blocker) =>
    blocker.trimStart().startsWith("REPLAN_REQUIRED:"),
  );
  if (replanBlockerIndex > 0) {
    fail(artifactName, "REPLAN_REQUIRED must be the first blocker when present");
  }

  return report;
}

function validateMergeReport(artifact) {
  const artifactName = "merge-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.group_id, "group_id", artifactName);
  expectInteger(report.iteration, "iteration", artifactName, { min: 1 });
  expectString(report.base_ref, "base_ref", artifactName);
  expectString(report.mainline_ref, "mainline_ref", artifactName);
  expectString(report.proposal_ref, "proposal_ref", artifactName);
  expectString(report.result_ref, "result_ref", artifactName);
  expectEnum(report.status, "status", artifactName, ["merged", "conflicted", "noop"]);

  const conflicts = expectArray(report.conflicts, "conflicts", artifactName);
  if (report.status === "conflicted" && conflicts.length === 0) {
    fail(artifactName, "conflicts must be non-empty when status is conflicted");
  }

  if (report.status !== "conflicted" && conflicts.length > 0) {
    fail(artifactName, "conflicts must be empty unless status is conflicted");
  }

  conflicts.forEach((conflict, index) => {
    const entry = expectObject(conflict, `conflicts[${index}]`, artifactName);
    expectString(entry.file, `conflicts[${index}].file`, artifactName);
    expectEnum(entry.format, `conflicts[${index}].format`, artifactName, [
      "text",
      "json",
      "yaml",
      "binary",
      "spreadsheet",
      "presentation",
      "image",
      "other",
    ]);
    expectEnum(entry.conflict_type, `conflicts[${index}].conflict_type`, artifactName, [
      "same_hunk",
      "same_key",
      "array_conflict",
      "binary_conflict",
      "manual_only",
      "other",
    ]);
    expectString(entry.summary, `conflicts[${index}].summary`, artifactName);
    expectString(entry.left_ref, `conflicts[${index}].left_ref`, artifactName);
    expectString(entry.right_ref, `conflicts[${index}].right_ref`, artifactName);
    expectString(entry.base_ref, `conflicts[${index}].base_ref`, artifactName);
  });

  return report;
}

function validateComplexityReport(artifact) {
  const artifactName = "complexity-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.group_id, "group_id", artifactName);
  expectInteger(report.iteration, "iteration", artifactName, { min: 1 });
  expectString(report.created_at, "created_at", artifactName);

  const analyzer = expectObject(report.analyzer, "analyzer", artifactName);
  expectString(analyzer.name, "analyzer.name", artifactName);
  expectString(analyzer.path, "analyzer.path", artifactName);
  expectString(analyzer.metric, "analyzer.metric", artifactName);
  expectInteger(analyzer.medium_threshold, "analyzer.medium_threshold", artifactName, { min: 0 });
  expectInteger(analyzer.high_threshold, "analyzer.high_threshold", artifactName, { min: 0 });

  const source = expectObject(report.source, "source", artifactName);
  expectNullableString(source.proposal_path, "source.proposal_path", artifactName);
  expectStringArray(source.changed_files, "source.changed_files", artifactName);

  expectEnum(report.status, "status", artifactName, ["completed", "skipped", "error"]);

  const analyzedFiles = expectArray(report.analyzed_files, "analyzed_files", artifactName);
  analyzedFiles.forEach((file, index) => {
    const entry = expectObject(file, `analyzed_files[${index}]`, artifactName);
    expectString(entry.file, `analyzed_files[${index}].file`, artifactName);
    expectString(entry.source_path, `analyzed_files[${index}].source_path`, artifactName);
    expectInteger(entry.function_count, `analyzed_files[${index}].function_count`, artifactName, {
      min: 0,
    });
  });

  const skippedFiles = expectArray(report.skipped_files, "skipped_files", artifactName);
  skippedFiles.forEach((file, index) => {
    const entry = expectObject(file, `skipped_files[${index}]`, artifactName);
    expectString(entry.file, `skipped_files[${index}].file`, artifactName);
    expectEnum(entry.reason, `skipped_files[${index}].reason`, artifactName, [
      "not_python",
      "invalid_path",
      "missing_in_proposal",
      "missing_in_repo",
    ]);
  });

  const errors = expectArray(report.errors, "errors", artifactName);
  errors.forEach((error, index) => {
    const entry = expectObject(error, `errors[${index}]`, artifactName);
    expectString(entry.file, `errors[${index}].file`, artifactName);
    expectString(entry.message, `errors[${index}].message`, artifactName);
    expectNullableInteger(entry.exit_code, `errors[${index}].exit_code`, artifactName, {
      min: 0,
    });
    expectStringValue(entry.stdout, `errors[${index}].stdout`, artifactName);
    expectStringValue(entry.stderr, `errors[${index}].stderr`, artifactName);
  });

  expectInteger(report.function_count, "function_count", artifactName, { min: 0 });
  expectInteger(report.max_total_points, "max_total_points", artifactName, { min: 0 });
  expectNumber(report.average_total_points, "average_total_points", artifactName, { min: 0 });
  expectInteger(report.medium_complexity_functions, "medium_complexity_functions", artifactName, {
    min: 0,
  });
  expectInteger(report.high_complexity_functions, "high_complexity_functions", artifactName, {
    min: 0,
  });
  expectEnum(report.readability_conclusion, "readability_conclusion", artifactName, [
    "high",
    "low",
  ]);
  expectEnum(report.complexity_conclusion, "complexity_conclusion", artifactName, [
    "high",
    "low",
  ]);
  expectString(report.summary, "summary", artifactName);

  const functions = expectArray(report.functions, "functions", artifactName);
  functions.forEach((item, index) => {
    const entry = expectObject(item, `functions[${index}]`, artifactName);
    expectString(entry.file, `functions[${index}].file`, artifactName);
    expectString(entry.function, `functions[${index}].function`, artifactName);
    expectString(entry.analyzer_function, `functions[${index}].analyzer_function`, artifactName);
    expectInteger(entry.loop_points, `functions[${index}].loop_points`, artifactName, { min: 0 });
    expectInteger(entry.if_points, `functions[${index}].if_points`, artifactName, { min: 0 });
    expectInteger(entry.logical_points, `functions[${index}].logical_points`, artifactName, {
      min: 0,
    });
    expectInteger(entry.other_points, `functions[${index}].other_points`, artifactName, { min: 0 });
    expectInteger(entry.total_points, `functions[${index}].total_points`, artifactName, {
      min: 0,
    });
    expectEnum(entry.level, `functions[${index}].level`, artifactName, [
      "low",
      "medium",
      "high",
    ]);
  });

  if (report.status === "error" && errors.length === 0) {
    fail(artifactName, "errors must be non-empty when status is error");
  }

  if (report.status === "completed" && analyzedFiles.length === 0) {
    fail(artifactName, "analyzed_files must be non-empty when status is completed");
  }

  return report;
}

function validateConflictResolution(artifact, context = {}) {
  const artifactName = "conflict-resolution";
  const resolution = expectObject(artifact, artifactName, artifactName);
  expectVersion(resolution.version, artifactName);
  expectString(resolution.merge_report_ref, "merge_report_ref", artifactName);
  expectString(resolution.resolver, "resolver", artifactName);
  expectString(resolution.resolution_summary, "resolution_summary", artifactName);
  expectStringArray(resolution.resolved_files, "resolved_files", artifactName, { minLength: 1 });

  const validationRun = expectArray(resolution.validation_run, "validation_run", artifactName, {
    minLength: 1,
  });
  validationRun.forEach((step, index) => {
    const entry = expectObject(step, `validation_run[${index}]`, artifactName);
    expectString(entry.command, `validation_run[${index}].command`, artifactName);
    expectEnum(entry.status, `validation_run[${index}].status`, artifactName, [
      "passed",
      "failed",
      "not_run",
    ]);
    expectString(entry.details, `validation_run[${index}].details`, artifactName);
  });

  if (context.mergeReport && context.mergeReport.status !== "conflicted") {
    fail(artifactName, "merge_report_ref must point to a conflicted merge-report");
  }

  return resolution;
}

function validateTreeClassification(artifact, context = {}) {
  const artifactName = "tree-classification";
  const classification = expectObject(artifact, artifactName, artifactName);
  expectVersion(classification.version, artifactName);
  expectString(classification.task_id, "task_id", artifactName);
  expectString(classification.group_id, "group_id", artifactName);
  expectString(classification.task_type, "task_type", artifactName);
  expectBoolean(
    classification.depth_enhancement_applicable,
    "depth_enhancement_applicable",
    artifactName,
  );

  const branches = expectArray(
    classification.recommended_branches,
    "recommended_branches",
    artifactName,
    { minLength: 1 },
  );
  branches.forEach((branch, index) => {
    const entry = expectObject(branch, `recommended_branches[${index}]`, artifactName);
    expectString(entry.name, `recommended_branches[${index}].name`, artifactName);
    expectString(entry.name_en, `recommended_branches[${index}].name_en`, artifactName);
    expectString(entry.rationale, `recommended_branches[${index}].rationale`, artifactName);
  });

  expectString(classification.summary, "summary", artifactName);
  if (context.workerGroup && classification.group_id !== context.workerGroup.group_id) {
    fail(artifactName, "group_id must match worker group");
  }

  return classification;
}

function validateTreeNodeSource(source, fieldName, artifactName) {
  expectString(source, fieldName, artifactName);
  if (
    !/^(KEEP_\d+|MERGE_\d+(?:_\d+)+|ADD|DECOMPOSE_from_\d+|DEEPEN)$/.test(source)
  ) {
    fail(artifactName, `${fieldName} has unsupported source marker`);
  }
}

function validateTreeRubrics(artifact, artifactName = "tree-rubrics", context = {}) {
  const rubric = expectObject(artifact, artifactName, artifactName);
  expectVersion(rubric.version, artifactName);
  expectString(rubric.task_id, "task_id", artifactName);
  expectString(rubric.group_id, "group_id", artifactName);
  expectString(rubric.task_type, "task_type", artifactName);

  const branches = expectArray(rubric.branches, "branches", artifactName, { minLength: 1 });
  const seenNodeIds = new Set();
  branches.forEach((branch, branchIndex) => {
    const branchNumber = branchIndex + 1;
    const entry = expectObject(branch, `branches[${branchIndex}]`, artifactName);
    expectString(entry.name, `branches[${branchIndex}].name`, artifactName);
    expectString(entry.name_en, `branches[${branchIndex}].name_en`, artifactName);
    const nodes = expectArray(entry.nodes, `branches[${branchIndex}].nodes`, artifactName, {
      minLength: 1,
    });
    nodes.forEach((node, nodeIndex) => {
      const nodeEntry = expectObject(
        node,
        `branches[${branchIndex}].nodes[${nodeIndex}]`,
        artifactName,
      );
      expectInteger(
        nodeEntry.depth,
        `branches[${branchIndex}].nodes[${nodeIndex}].depth`,
        artifactName,
        { min: 1 },
      );
      expectString(nodeEntry.id, `branches[${branchIndex}].nodes[${nodeIndex}].id`, artifactName);
      const match = nodeEntry.id.match(/^B(\d+)-D(\d+)-(\d{2})$/);
      if (!match) {
        fail(artifactName, `${nodeEntry.id} must match B{branch}-D{depth}-{seq}`);
      }

      if (Number(match[1]) !== branchNumber) {
        fail(artifactName, `${nodeEntry.id} branch number does not match branch index`);
      }

      if (Number(match[2]) !== nodeEntry.depth) {
        fail(artifactName, `${nodeEntry.id} depth does not match node.depth`);
      }

      if (seenNodeIds.has(nodeEntry.id)) {
        fail(artifactName, `duplicate node id ${nodeEntry.id}`);
      }

      seenNodeIds.add(nodeEntry.id);
      expectString(
        nodeEntry.content,
        `branches[${branchIndex}].nodes[${nodeIndex}].content`,
        artifactName,
      );
      validateTreeNodeSource(
        nodeEntry.source,
        `branches[${branchIndex}].nodes[${nodeIndex}].source`,
        artifactName,
      );
      expectStringArray(
        nodeEntry.requirement_ids,
        `branches[${branchIndex}].nodes[${nodeIndex}].requirement_ids`,
        artifactName,
      );
      expectStringArray(
        nodeEntry.output_file_hints,
        `branches[${branchIndex}].nodes[${nodeIndex}].output_file_hints`,
        artifactName,
      );
    });
  });

  if (context.workerGroup && rubric.group_id !== context.workerGroup.group_id) {
    fail(artifactName, "group_id must match worker group");
  }

  return rubric;
}

function validateTreeRubricVerification(artifact, context = {}) {
  const artifactName = "tree-rubric-verification";
  const verification = expectObject(artifact, artifactName, artifactName);
  expectVersion(verification.version, artifactName);
  expectString(verification.task_id, "task_id", artifactName);
  expectString(verification.group_id, "group_id", artifactName);
  expectEnum(verification.status, "status", artifactName, ["pass", "fail"]);

  const dimensions = expectArray(
    verification.dimension_results,
    "dimension_results",
    artifactName,
    { minLength: TREE_RUBRIC_VALIDATION_DIMENSIONS.length },
  );
  if (dimensions.length !== TREE_RUBRIC_VALIDATION_DIMENSIONS.length) {
    fail(
      artifactName,
      `dimension_results must contain exactly ${TREE_RUBRIC_VALIDATION_DIMENSIONS.length} entries`,
    );
  }

  dimensions.forEach((dimension, index) => {
    const entry = expectObject(dimension, `dimension_results[${index}]`, artifactName);
    if (entry.dimension !== TREE_RUBRIC_VALIDATION_DIMENSIONS[index]) {
      fail(
        artifactName,
        `dimension_results[${index}].dimension must be ${TREE_RUBRIC_VALIDATION_DIMENSIONS[index]}`,
      );
    }

    expectEnum(entry.status, `dimension_results[${index}].status`, artifactName, [
      "pass",
      "fail",
      "warning",
    ]);
    expectString(entry.evidence, `dimension_results[${index}].evidence`, artifactName);
    if (entry.status === "pass") {
      if (entry.suggestion !== null) {
        fail(artifactName, `dimension_results[${index}].suggestion must be null for pass`);
      }
    } else {
      expectString(entry.suggestion, `dimension_results[${index}].suggestion`, artifactName);
    }
  });

  expectStringArray(verification.required_changes, "required_changes", artifactName);
  expectString(verification.summary, "summary", artifactName);
  if (context.workerGroup && verification.group_id !== context.workerGroup.group_id) {
    fail(artifactName, "group_id must match worker group");
  }

  return verification;
}

function validateFinalOutputFiles(artifact, context = {}) {
  const artifactName = "final-output-files";
  const snapshot = expectObject(artifact, artifactName, artifactName);
  expectVersion(snapshot.version, artifactName);
  expectString(snapshot.group_id, "group_id", artifactName);
  expectInteger(snapshot.iteration, "iteration", artifactName, { min: 1 });
  const files = expectArray(snapshot.files, "files", artifactName, { minLength: 1 });
  const seenPaths = new Set();
  files.forEach((file, index) => {
    const entry = expectObject(file, `files[${index}]`, artifactName);
    expectString(entry.path, `files[${index}].path`, artifactName);
    if (seenPaths.has(entry.path)) {
      fail(artifactName, `duplicate output file path ${entry.path}`);
    }

    seenPaths.add(entry.path);
    expectEnum(entry.status, `files[${index}].status`, artifactName, ["present", "deleted"]);
    if (entry.status === "present") {
      expectStringValue(entry.content, `files[${index}].content`, artifactName);
    } else if (entry.content !== null) {
      fail(artifactName, `files[${index}].content must be null for deleted files`);
    }
  });

  if (context.workerGroup && snapshot.group_id !== context.workerGroup.group_id) {
    fail(artifactName, "group_id must match worker group");
  }

  return snapshot;
}

function collectTreeNodeIds(rubric) {
  return rubric.branches.flatMap((branch) => branch.nodes.map((node) => node.id));
}

function validateTreeGradingIndividual(artifact, context = {}) {
  const artifactName = "tree-grading-individual";
  const grading = expectObject(artifact, artifactName, artifactName);
  expectVersion(grading.version, artifactName);
  expectString(grading.group_id, "group_id", artifactName);
  expectInteger(grading.iteration, "iteration", artifactName, { min: 1 });
  expectInteger(grading.grader_id, "grader_id", artifactName, { min: 1 });
  expectString(grading.task_id, "task_id", artifactName);

  const nodeResults = expectArray(grading.node_results, "node_results", artifactName, {
    minLength: 1,
  });
  const seenNodeIds = new Set();
  const outputPaths = new Set((context.finalOutputFiles?.files ?? []).map((file) => file.path));
  const forbiddenEvidenceMarkers = [
    "execution-report",
    "validation-report",
    "merge-report",
    "complexity-report",
    "tool log",
    ".pipeline-workspace",
  ];

  nodeResults.forEach((result, index) => {
    const entry = expectObject(result, `node_results[${index}]`, artifactName);
    expectString(entry.node_id, `node_results[${index}].node_id`, artifactName);
    if (seenNodeIds.has(entry.node_id)) {
      fail(artifactName, `duplicate node result ${entry.node_id}`);
    }

    seenNodeIds.add(entry.node_id);
    expectEnum(entry.raw_score, `node_results[${index}].raw_score`, artifactName, [0, 1]);
    expectString(entry.evidence, `node_results[${index}].evidence`, artifactName);
    const evidenceLower = entry.evidence.toLowerCase();
    forbiddenEvidenceMarkers.forEach((marker) => {
      if (evidenceLower.includes(marker)) {
        fail(artifactName, `node_results[${index}].evidence references forbidden process artifact`);
      }
    });

    if (outputPaths.size > 0 && ![...outputPaths].some((filePath) => entry.evidence.includes(filePath))) {
      fail(artifactName, `node_results[${index}].evidence must cite a final output file path`);
    }

    if (entry.raw_score === 1) {
      if (entry.failure_reason !== null || entry.suggestion !== null) {
        fail(
          artifactName,
          `node_results[${index}].failure_reason and suggestion must be null for passing nodes`,
        );
      }
    } else {
      expectString(entry.failure_reason, `node_results[${index}].failure_reason`, artifactName);
      expectString(entry.suggestion, `node_results[${index}].suggestion`, artifactName);
    }
  });

  if (context.rubric) {
    const expectedNodeIds = collectTreeNodeIds(context.rubric);
    if (nodeResults.length !== expectedNodeIds.length) {
      fail(artifactName, "node_results must score every rubric node exactly once");
    }

    expectedNodeIds.forEach((nodeId) => {
      if (!seenNodeIds.has(nodeId)) {
        fail(artifactName, `missing node result ${nodeId}`);
      }
    });
  }

  return grading;
}

function validateTreeGradingFeedback(artifact, context = {}) {
  const artifactName = "tree-grading-feedback";
  const feedback = expectObject(artifact, artifactName, artifactName);
  expectVersion(feedback.version, artifactName);
  expectString(feedback.group_id, "group_id", artifactName);
  expectInteger(feedback.iteration, "iteration", artifactName, { min: 1 });
  expectString(feedback.task_id, "task_id", artifactName);
  expectNumber(feedback.threshold, "threshold", artifactName, { min: 0 });
  if (feedback.threshold > 1) {
    fail(artifactName, "threshold must be <= 1");
  }

  expectBoolean(feedback.require_depth_one_pass, "require_depth_one_pass", artifactName);
  expectEnum(feedback.verdict, "verdict", artifactName, ["pass", "fail"]);
  expectNumber(feedback.weighted_score, "weighted_score", artifactName, { min: 0 });
  expectNumber(feedback.pass_rate, "pass_rate", artifactName, { min: 0 });
  if (feedback.weighted_score > 1 || feedback.pass_rate > 1) {
    fail(artifactName, "weighted_score and pass_rate must be <= 1");
  }

  expectInteger(feedback.num_branches, "num_branches", artifactName, { min: 1 });
  expectInteger(feedback.max_depth, "max_depth", artifactName, { min: 1 });
  const nodesPassed = expectStringArray(feedback.nodes_passed, "nodes_passed", artifactName);
  const nodesFailed = expectStringArray(feedback.nodes_failed, "nodes_failed", artifactName);
  expectStringArray(feedback.blocking_nodes, "blocking_nodes", artifactName);
  expectStringArray(feedback.non_blocking_nodes, "non_blocking_nodes", artifactName);

  const nodeResults = expectArray(feedback.node_results, "node_results", artifactName, {
    minLength: 1,
  });
  let failedCount = 0;
  nodeResults.forEach((result, index) => {
    const entry = expectObject(result, `node_results[${index}]`, artifactName);
    expectString(entry.node_id, `node_results[${index}].node_id`, artifactName);
    expectString(entry.branch, `node_results[${index}].branch`, artifactName);
    expectInteger(entry.depth, `node_results[${index}].depth`, artifactName, { min: 1 });
    expectInteger(entry.weight, `node_results[${index}].weight`, artifactName, { min: 1 });
    expectEnum(entry.raw_score, `node_results[${index}].raw_score`, artifactName, [0, 1]);
    expectEnum(entry.effective_score, `node_results[${index}].effective_score`, artifactName, [
      0,
      1,
    ]);
    expectNullableString(
      entry.dependency_blocked_by,
      `node_results[${index}].dependency_blocked_by`,
      artifactName,
    );
    expectEnum(entry.consensus, `node_results[${index}].consensus`, artifactName, [
      "unanimous",
      "majority",
    ]);
    const graderScores = expectArray(
      entry.grader_scores,
      `node_results[${index}].grader_scores`,
      artifactName,
      { minLength: 1 },
    );
    graderScores.forEach((score, scoreIndex) => {
      const scoreEntry = expectObject(
        score,
        `node_results[${index}].grader_scores[${scoreIndex}]`,
        artifactName,
      );
      expectInteger(scoreEntry.grader_id, `grader_scores[${scoreIndex}].grader_id`, artifactName, {
        min: 1,
      });
      expectEnum(scoreEntry.raw_score, `grader_scores[${scoreIndex}].raw_score`, artifactName, [
        0,
        1,
      ]);
      expectString(scoreEntry.evidence, `grader_scores[${scoreIndex}].evidence`, artifactName);
      expectNullableString(
        scoreEntry.failure_reason,
        `grader_scores[${scoreIndex}].failure_reason`,
        artifactName,
      );
      expectNullableString(
        scoreEntry.suggestion,
        `grader_scores[${scoreIndex}].suggestion`,
        artifactName,
      );
    });
    if (entry.effective_score === 0) {
      failedCount += 1;
    }
  });

  if (nodesPassed.length + nodesFailed.length !== nodeResults.length) {
    fail(artifactName, "nodes_passed and nodes_failed must partition node_results");
  }

  if (feedback.verdict === "pass" && feedback.blocking_nodes.length > 0) {
    fail(artifactName, "blocking_nodes must be empty when verdict is pass");
  }

  if (feedback.verdict === "fail" && feedback.blocking_nodes.length === 0) {
    fail(artifactName, "blocking_nodes must be non-empty when verdict is fail");
  }

  if (feedback.verdict === "pass" && feedback.non_blocking_nodes.length !== failedCount) {
    fail(artifactName, "non_blocking_nodes must preserve failed nodes on pass");
  }

  if (context.rubric) {
    const expectedNodeIds = collectTreeNodeIds(context.rubric);
    if (nodeResults.length !== expectedNodeIds.length) {
      fail(artifactName, "node_results must include every rubric node");
    }
  }

  expectString(feedback.summary, "summary", artifactName);
  return feedback;
}

function validateReviewIndividual(artifact, context = {}) {
  const artifactName = "review-individual";
  const review = expectObject(artifact, artifactName, artifactName);
  expectVersion(review.version, artifactName);
  expectInteger(review.reviewer_id, "reviewer_id", artifactName, { min: 1 });

  const appliedSkills = expectAppliedSkills(review.applied_skills, artifactName, [
    "ce-frontend-design",
  ]);
  const requiredSkills = context.requiredSkills ?? [];
  const needsFrontendDesign = requiredSkills.includes("ce-frontend-design");

  const preResults = expectArray(review.pre_results, "pre_results", artifactName, {
    minLength: PRE_CRITERIA.length,
  });
  if (preResults.length !== PRE_CRITERIA.length) {
    fail(artifactName, `pre_results must contain exactly ${PRE_CRITERIA.length} entries`);
  }

  preResults.forEach((result, index) => {
    const entry = expectObject(result, `pre_results[${index}]`, artifactName);
    if (entry.criterion !== PRE_CRITERIA[index]) {
      fail(artifactName, `pre_results[${index}].criterion must be ${PRE_CRITERIA[index]}`);
    }

    expectEnum(entry.score, `pre_results[${index}].score`, artifactName, [
      "pass",
      "fail",
      "warning",
    ]);
    expectString(entry.evidence, `pre_results[${index}].evidence`, artifactName);

    if (entry.score === "pass") {
      if (entry.suggestion !== null) {
        fail(artifactName, `pre_results[${index}].suggestion must be null for pass`);
      }
    } else {
      expectString(entry.suggestion, `pre_results[${index}].suggestion`, artifactName);
    }
  });

  if (needsFrontendDesign) {
    if (!appliedSkills.includes("ce-frontend-design")) {
      fail(artifactName, "applied_skills must include ce-frontend-design");
    }

    const assessment = expectObject(
      review.frontend_design_assessment,
      "frontend_design_assessment",
      artifactName,
    );
    expectEnum(assessment.system_fit, "frontend_design_assessment.system_fit", artifactName, [
      "pass",
      "fail",
      "warning",
    ]);
    expectEnum(
      assessment.interaction_quality,
      "frontend_design_assessment.interaction_quality",
      artifactName,
      ["pass", "fail", "warning"],
    );
    expectEnum(
      assessment.ui_accessibility,
      "frontend_design_assessment.ui_accessibility",
      artifactName,
      ["pass", "fail", "warning"],
    );
    expectString(
      assessment.verification_method,
      "frontend_design_assessment.verification_method",
      artifactName,
    );
    expectStringArray(
      assessment.notes,
      "frontend_design_assessment.notes",
      artifactName,
    );
  } else if (review.frontend_design_assessment !== null) {
    fail(
      artifactName,
      "frontend_design_assessment must be null when frontend design skill is not required",
    );
  }

  return review;
}

function validateReviewFeedback(artifact) {
  const artifactName = "review-feedback";
  const feedback = expectObject(artifact, artifactName, artifactName);
  expectVersion(feedback.version, artifactName);
  expectInteger(feedback.iteration, "iteration", artifactName, { min: 1 });
  expectEnum(feedback.mode, "mode", artifactName, ["EME", "PRE"]);
  expectEnum(feedback.verdict, "verdict", artifactName, ["pass", "fail"]);

  const votes = expectArray(feedback.eme_votes, "eme_votes", artifactName, {
    minLength: PRE_CRITERIA.length,
  });
  if (votes.length !== PRE_CRITERIA.length) {
    fail(artifactName, `eme_votes must contain exactly ${PRE_CRITERIA.length} entries`);
  }

  let failCount = 0;
  votes.forEach((voteEntry, index) => {
    const entry = expectObject(voteEntry, `eme_votes[${index}]`, artifactName);
    if (entry.criterion !== PRE_CRITERIA[index]) {
      fail(artifactName, `eme_votes[${index}].criterion must be ${PRE_CRITERIA[index]}`);
    }

    expectArray(entry.votes, `eme_votes[${index}].votes`, artifactName, { minLength: 1 });
    entry.votes.forEach((vote, voteIndex) => {
      expectEnum(vote, `eme_votes[${index}].votes[${voteIndex}]`, artifactName, [
        "pass",
        "fail",
        "warning",
      ]);
    });
    expectEnum(entry.final_score, `eme_votes[${index}].final_score`, artifactName, [
      "pass",
      "fail",
    ]);
    if (entry.final_score === "fail") {
      failCount += 1;
    }

    expectEnum(entry.consensus, `eme_votes[${index}].consensus`, artifactName, [
      "unanimous",
      "majority",
    ]);
  });

  const mergedIssues = expectArray(feedback.merged_issues, "merged_issues", artifactName);
  mergedIssues.forEach((issue, index) => {
    const entry = expectObject(issue, `merged_issues[${index}]`, artifactName);
    expectString(entry.criterion, `merged_issues[${index}].criterion`, artifactName);
    expectString(entry.evidence, `merged_issues[${index}].evidence`, artifactName);
    expectString(entry.suggestion, `merged_issues[${index}].suggestion`, artifactName);
    const flaggedBy = expectArray(entry.flagged_by, `merged_issues[${index}].flagged_by`, artifactName, {
      minLength: 1,
    });
    flaggedBy.forEach((reviewerId, reviewerIndex) => {
      expectInteger(
        reviewerId,
        `merged_issues[${index}].flagged_by[${reviewerIndex}]`,
        artifactName,
        { min: 1 },
      );
    });
  });

  expectString(feedback.summary, "summary", artifactName);
  expectInteger(feedback.blocking_issues_count, "blocking_issues_count", artifactName, { min: 0 });
  if (feedback.blocking_issues_count !== failCount) {
    fail(artifactName, "blocking_issues_count must match fail dimensions");
  }

  if (feedback.verdict === "pass" && failCount > 0) {
    fail(artifactName, "verdict pass is inconsistent with failing dimensions");
  }

  if (feedback.verdict === "fail" && failCount === 0) {
    fail(artifactName, "verdict fail requires at least one failing dimension");
  }

  expectStringArray(feedback.warnings, "warnings", artifactName);
  return feedback;
}

function validateValidationReport(artifact, context = {}) {
  const artifactName = "validation-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.group_id, "group_id", artifactName);
  expectInteger(report.iteration, "iteration", artifactName, { min: 1 });
  expectEnum(report.detected_language, "detected_language", artifactName, [
    "go",
    "python",
    "javascript",
    "typescript",
    "rust",
    "java",
    "ruby",
    "unknown",
  ]);
  expectEnum(report.status, "status", artifactName, [
    "passed",
    "failed",
    "error",
    "skipped",
  ]);

  if (context.workerGroup && report.group_id !== context.workerGroup.group_id) {
    fail(artifactName, "group_id must match worker group");
  }

  const commandsRun = expectArray(report.commands_run, "commands_run", artifactName);
  commandsRun.forEach((commandEntry, index) => {
    const entry = expectObject(commandEntry, `commands_run[${index}]`, artifactName);
    expectString(entry.command, `commands_run[${index}].command`, artifactName);
    expectEnum(entry.type, `commands_run[${index}].type`, artifactName, ["check"]);
    expectNullableInteger(entry.exit_code, `commands_run[${index}].exit_code`, artifactName, {
      min: 0,
    });
    expectString(entry.output, `commands_run[${index}].output`, artifactName);
  });

  const testSummary = expectObject(report.test_summary, "test_summary", artifactName);
  expectInteger(testSummary.total, "test_summary.total", artifactName, { min: 0 });
  expectInteger(testSummary.passed, "test_summary.passed", artifactName, { min: 0 });
  expectInteger(testSummary.failed, "test_summary.failed", artifactName, { min: 0 });
  expectInteger(testSummary.skipped, "test_summary.skipped", artifactName, { min: 0 });

  const blockingFailures = expectStringArray(
    report.blocking_failures,
    "blocking_failures",
    artifactName,
  );

  if (report.status === "failed" && blockingFailures.length === 0) {
    fail(artifactName, "blocking_failures must be non-empty when status is failed");
  }

  if (["passed", "skipped", "error"].includes(report.status) && blockingFailures.length > 0) {
    fail(artifactName, "blocking_failures must be empty unless status is failed");
  }

  if (report.status === "skipped" && report.detected_language !== "unknown") {
    fail(artifactName, "skipped validation must use detected_language unknown");
  }

  return report;
}

function validateQaReport(artifact) {
  const artifactName = "qa-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.group_id, "group_id", artifactName);
  expectInteger(report.iteration, "iteration", artifactName, { min: 1 });
  expectEnum(report.status, "status", artifactName, ["pass", "fail"]);
  expectEnum(report.test_infrastructure, "test_infrastructure", artifactName, [
    "configured",
    "missing",
  ]);

  const testResults = expectArray(report.test_results, "test_results", artifactName, {
    minLength: 1,
  });
  testResults.forEach((result, index) => {
    const entry = expectObject(result, `test_results[${index}]`, artifactName);
    expectEnum(entry.kind, `test_results[${index}].kind`, artifactName, [
      "existing",
      "new",
      "scenario",
      "manual",
    ]);
    expectStringArray(
      entry.requirement_ids,
      `test_results[${index}].requirement_ids`,
      artifactName,
    );
    expectString(entry.command, `test_results[${index}].command`, artifactName);
    expectEnum(entry.status, `test_results[${index}].status`, artifactName, [
      "passed",
      "failed",
      "error",
      "not_run",
    ]);
    expectString(entry.details, `test_results[${index}].details`, artifactName);
  });

  const blockingIssues = expectStringArray(report.blocking_issues, "blocking_issues", artifactName);
  if (report.status === "pass" && blockingIssues.length > 0) {
    fail(artifactName, "blocking_issues must be empty when status is pass");
  }

  if (report.status === "fail" && blockingIssues.length === 0) {
    fail(artifactName, "blocking_issues must be non-empty when status is fail");
  }

  expectStringArray(report.notes, "notes", artifactName);
  return report;
}

function validateDocReport(artifact) {
  const artifactName = "doc-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectEnum(report.status, "status", artifactName, [
    "updated",
    "no_changes_needed",
    "changes_required",
  ]);
  const updatedFiles = expectStringArray(report.updated_files, "updated_files", artifactName);

  if (["updated", "changes_required"].includes(report.status) && updatedFiles.length === 0) {
    fail(
      artifactName,
      "updated_files must be non-empty when status is updated or changes_required",
    );
  }

  if (report.status === "no_changes_needed" && updatedFiles.length > 0) {
    fail(artifactName, "updated_files must be empty when status is no_changes_needed");
  }

  expectString(report.summary, "summary", artifactName);
  expectStringArray(report.notes, "notes", artifactName);
  return report;
}

function validateSkillUsageSummary(value, artifactName) {
  const items = expectArray(value, "skill_usage_summary", artifactName);
  items.forEach((item, index) => {
    const entry = expectObject(item, `skill_usage_summary[${index}]`, artifactName);
    expectString(entry.scope, `skill_usage_summary[${index}].scope`, artifactName);
    expectStringArray(
      entry.required_skills,
      `skill_usage_summary[${index}].required_skills`,
      artifactName,
    );
    expectStringArray(
      entry.applied_skills,
      `skill_usage_summary[${index}].applied_skills`,
      artifactName,
    );
    expectStringArray(entry.issues, `skill_usage_summary[${index}].issues`, artifactName);
  });
}

function validateCodexPetEvents(value, artifactName) {
  const events = expectArray(value, "codex_pet_events", artifactName);
  events.forEach((item, index) => {
    const entry = expectObject(item, `codex_pet_events[${index}]`, artifactName);
    expectEnum(
      entry.state,
      `codex_pet_events[${index}].state`,
      artifactName,
      CODEX_PET_STATES,
    );
    expectString(entry.reason, `codex_pet_events[${index}].reason`, artifactName);
    expectString(entry.scope, `codex_pet_events[${index}].scope`, artifactName);
    expectInteger(
      entry.duration_ms,
      `codex_pet_events[${index}].duration_ms`,
      artifactName,
      { min: 0 },
    );
    expectString(entry.created_at, `codex_pet_events[${index}].created_at`, artifactName);
    expectString(entry.directive, `codex_pet_events[${index}].directive`, artifactName);
  });

  return events;
}

function validateFinalAssessment(artifact) {
  const artifactName = "final-assessment";
  const assessment = expectObject(artifact, artifactName, artifactName);
  expectVersion(assessment.version, artifactName);
  expectInteger(assessment.iteration, "iteration", artifactName, { min: 1 });
  expectEnum(assessment.verdict, "verdict", artifactName, ["accept", "reject"]);

  const dimensions = expectArray(
    assessment.dimension_scores,
    "dimension_scores",
    artifactName,
    { minLength: FINAL_ASSESSMENT_DIMENSIONS.length },
  );
  if (dimensions.length !== FINAL_ASSESSMENT_DIMENSIONS.length) {
    fail(
      artifactName,
      `dimension_scores must contain exactly ${FINAL_ASSESSMENT_DIMENSIONS.length} entries`,
    );
  }

  dimensions.forEach((dimension, index) => {
    const entry = expectObject(dimension, `dimension_scores[${index}]`, artifactName);
    if (entry.dimension !== FINAL_ASSESSMENT_DIMENSIONS[index]) {
      fail(
        artifactName,
        `dimension_scores[${index}].dimension must be ${FINAL_ASSESSMENT_DIMENSIONS[index]}`,
      );
    }

    expectEnum(entry.score, `dimension_scores[${index}].score`, artifactName, [
      "strong",
      "adequate",
      "weak",
    ]);
    expectString(entry.evidence, `dimension_scores[${index}].evidence`, artifactName);
  });

  const improvementAreas = expectArray(
    assessment.improvement_areas,
    "improvement_areas",
    artifactName,
  );
  improvementAreas.forEach((area, index) => {
    const entry = expectObject(area, `improvement_areas[${index}]`, artifactName);
    expectString(entry.dimension, `improvement_areas[${index}].dimension`, artifactName);
    expectString(entry.issue, `improvement_areas[${index}].issue`, artifactName);
    expectString(
      entry.recommendation,
      `improvement_areas[${index}].recommendation`,
      artifactName,
    );
  });

  const allowedRestartStages = ["spec", "plan", "architecture", "dispatch", "merge", "execution"];
  if (assessment.verdict === "accept") {
    if (assessment.restart_from !== null || assessment.restart_rationale !== null) {
      fail(
        artifactName,
        "restart_from and restart_rationale must be null when verdict is accept",
      );
    }
  } else {
    expectEnum(assessment.restart_from, "restart_from", artifactName, allowedRestartStages);
    expectString(assessment.restart_rationale, "restart_rationale", artifactName);
  }

  validateSkillUsageSummary(assessment.skill_usage_summary, artifactName);
  expectEnum(assessment.readability_conclusion, "readability_conclusion", artifactName, [
    "high",
    "low",
  ]);
  expectEnum(assessment.complexity_conclusion, "complexity_conclusion", artifactName, [
    "high",
    "low",
  ]);
  expectString(assessment.complexity_summary, "complexity_summary", artifactName);
  expectString(assessment.summary, "summary", artifactName);
  return assessment;
}

function validateRunSummary(artifact) {
  const artifactName = "pipeline-last-run-summary";
  const summary = expectObject(artifact, artifactName, artifactName);
  expectVersion(summary.version, artifactName);
  expectString(summary.run_id, "run_id", artifactName);
  expectString(summary.completed_at, "completed_at", artifactName);
  expectEnum(summary.verdict, "verdict", artifactName, [
    "accept",
    "reject",
    "pause_for_human",
  ]);

  if (summary.verdict === "accept") {
    if (summary.restart_from !== null) {
      fail(artifactName, "restart_from must be null when verdict is accept");
    }
  } else {
    expectEnum(summary.restart_from, "restart_from", artifactName, [
      "spec",
      "plan",
      "architecture",
      "dispatch",
      "merge",
      "execution",
    ]);
  }

  validateSkillUsageSummary(summary.skill_usage_summary, artifactName);

  const mergeSummary = expectObject(summary.merge_summary, "merge_summary", artifactName);
  expectStringArray(mergeSummary.merged_groups, "merge_summary.merged_groups", artifactName);
  expectStringArray(
    mergeSummary.conflicted_groups,
    "merge_summary.conflicted_groups",
    artifactName,
  );
  expectStringArray(mergeSummary.noop_groups, "merge_summary.noop_groups", artifactName);

  const qaSummary = expectArray(summary.qa_summary, "qa_summary", artifactName);
  qaSummary.forEach((entry, index) => {
    const item = expectObject(entry, `qa_summary[${index}]`, artifactName);
    expectString(item.group_id, `qa_summary[${index}].group_id`, artifactName);
    expectEnum(item.status, `qa_summary[${index}].status`, artifactName, ["pass", "fail"]);
  });

  const validationSummary = expectArray(
    summary.validation_summary,
    "validation_summary",
    artifactName,
  );
  validationSummary.forEach((entry, index) => {
    const item = expectObject(entry, `validation_summary[${index}]`, artifactName);
    expectString(item.group_id, `validation_summary[${index}].group_id`, artifactName);
    expectEnum(item.status, `validation_summary[${index}].status`, artifactName, [
      "passed",
      "failed",
      "error",
      "skipped",
    ]);
  });

  const complexitySummary = expectArray(
    summary.complexity_summary,
    "complexity_summary",
    artifactName,
  );
  complexitySummary.forEach((entry, index) => {
    const item = expectObject(entry, `complexity_summary[${index}]`, artifactName);
    expectString(item.group_id, `complexity_summary[${index}].group_id`, artifactName);
    expectString(item.ref, `complexity_summary[${index}].ref`, artifactName);
    expectEnum(item.status, `complexity_summary[${index}].status`, artifactName, [
      "completed",
      "skipped",
      "error",
    ]);
    expectEnum(
      item.readability_conclusion,
      `complexity_summary[${index}].readability_conclusion`,
      artifactName,
      ["high", "low"],
    );
    expectEnum(
      item.complexity_conclusion,
      `complexity_summary[${index}].complexity_conclusion`,
      artifactName,
      ["high", "low"],
    );
    expectInteger(item.function_count, `complexity_summary[${index}].function_count`, artifactName, {
      min: 0,
    });
    expectInteger(
      item.max_total_points,
      `complexity_summary[${index}].max_total_points`,
      artifactName,
      { min: 0 },
    );
  });

  const treeGradingSummary = expectArray(
    summary.tree_grading_summary,
    "tree_grading_summary",
    artifactName,
  );
  treeGradingSummary.forEach((entry, index) => {
    const item = expectObject(entry, `tree_grading_summary[${index}]`, artifactName);
    expectString(item.group_id, `tree_grading_summary[${index}].group_id`, artifactName);
    expectEnum(item.verdict, `tree_grading_summary[${index}].verdict`, artifactName, [
      "pass",
      "fail",
    ]);
    expectNumber(
      item.weighted_score,
      `tree_grading_summary[${index}].weighted_score`,
      artifactName,
      { min: 0 },
    );
    if (item.weighted_score > 1) {
      fail(artifactName, `tree_grading_summary[${index}].weighted_score must be <= 1`);
    }

    expectStringArray(
      item.nodes_failed,
      `tree_grading_summary[${index}].nodes_failed`,
      artifactName,
    );
  });

  const cleanupSummary = expectObject(summary.cleanup_summary, "cleanup_summary", artifactName);
  if (typeof cleanupSummary.deleted_workspace !== "boolean") {
    fail(artifactName, "cleanup_summary.deleted_workspace must be boolean");
  }

  expectStringArray(cleanupSummary.deleted_paths, "cleanup_summary.deleted_paths", artifactName);
  if (cleanupSummary.retained_file !== ".pipeline-last-run-summary.json") {
    fail(artifactName, "cleanup_summary.retained_file must be .pipeline-last-run-summary.json");
  }

  validateCodexPetEvents(summary.codex_pet_events, artifactName);

  return summary;
}

function expectObjectArray(value, fieldName, artifactName, { minLength = 0 } = {}) {
  const items = expectArray(value, fieldName, artifactName, { minLength });
  return items.map((item, index) => expectObject(item, `${fieldName}[${index}]`, artifactName));
}

function validateResearchHarnessState(artifact) {
  const artifactName = "research-harness-state";
  const state = expectObject(artifact, artifactName, artifactName);
  expectVersion(state.version, artifactName);
  expectString(state.report_path, "report_path", artifactName);
  expectString(state.generated_for_date, "generated_for_date", artifactName);

  expectObjectArray(state.sources_seen, "sources_seen", artifactName, { minLength: 1 }).forEach(
    (source, index) => {
      expectString(source.source_id, `sources_seen[${index}].source_id`, artifactName);
      expectString(source.source_type, `sources_seen[${index}].source_type`, artifactName);
      expectString(source.title, `sources_seen[${index}].title`, artifactName);
      expectString(source.locator, `sources_seen[${index}].locator`, artifactName);
    },
  );

  expectObjectArray(state.candidate_index, "candidate_index", artifactName, {
    minLength: 1,
  }).forEach((candidate, index) => {
    expectString(candidate.candidate_id, `candidate_index[${index}].candidate_id`, artifactName);
    expectString(candidate.title, `candidate_index[${index}].title`, artifactName);
    expectEnum(candidate.status, `candidate_index[${index}].status`, artifactName, [
      "selected",
      "queued",
      "rejected",
    ]);
  });

  expectObjectArray(state.evidence_map, "evidence_map", artifactName, { minLength: 1 }).forEach(
    (evidence, index) => {
      expectString(evidence.candidate_id, `evidence_map[${index}].candidate_id`, artifactName);
      expectStringArray(evidence.source_ids, `evidence_map[${index}].source_ids`, artifactName, {
        minLength: 1,
      });
      expectString(evidence.summary, `evidence_map[${index}].summary`, artifactName);
    },
  );

  const rubric = expectObject(state.rubric, "rubric", artifactName);
  expectStringArray(rubric.criteria, "rubric.criteria", artifactName, { minLength: 1 });
  expectInteger(rubric.minimum_evidence_count, "rubric.minimum_evidence_count", artifactName, {
    min: 0,
  });

  const outputValidation = expectObject(
    state.output_validation,
    "output_validation",
    artifactName,
  );
  expectEnum(outputValidation.status, "output_validation.status", artifactName, [
    "passed",
    "warning",
    "failed",
  ]);
  expectStringArray(outputValidation.checks, "output_validation.checks", artifactName, {
    minLength: 1,
  });

  return state;
}

function validateContextManifest(artifact) {
  const artifactName = "context-manifest";
  const manifest = expectObject(artifact, artifactName, artifactName);
  expectVersion(manifest.version, artifactName);
  expectString(manifest.task_id, "task_id", artifactName);
  expectString(manifest.compiled_at, "compiled_at", artifactName);

  expectObjectArray(manifest.blocks, "blocks", artifactName, { minLength: 1 }).forEach(
    (block, index) => {
      expectString(block.id, `blocks[${index}].id`, artifactName);
      expectString(block.version, `blocks[${index}].version`, artifactName);
      expectString(block.source, `blocks[${index}].source`, artifactName);
      expectInteger(block.priority, `blocks[${index}].priority`, artifactName, { min: 0 });
      expectString(block.tenant_scope, `blocks[${index}].tenant_scope`, artifactName);
      expectBoolean(block.cacheable, `blocks[${index}].cacheable`, artifactName);
      expectBoolean(block.evictable, `blocks[${index}].evictable`, artifactName);
      expectBoolean(block.requires_approval, `blocks[${index}].requires_approval`, artifactName);
      expectString(block.hash, `blocks[${index}].hash`, artifactName);
    },
  );

  const promptDiff = expectObject(manifest.prompt_diff, "prompt_diff", artifactName);
  expectString(promptDiff.summary, "prompt_diff.summary", artifactName);
  expectStringArray(promptDiff.added_blocks, "prompt_diff.added_blocks", artifactName);
  expectStringArray(promptDiff.removed_blocks, "prompt_diff.removed_blocks", artifactName);

  return manifest;
}

function validateAgentTrace(artifact) {
  const artifactName = "agent-trace";
  const trace = expectObject(artifact, artifactName, artifactName);
  expectVersion(trace.version, artifactName);
  expectString(trace.task_id, "task_id", artifactName);
  expectString(trace.started_at, "started_at", artifactName);

  expectObjectArray(trace.events, "events", artifactName, { minLength: 1 }).forEach(
    (event, index) => {
      expectEnum(event.type, `events[${index}].type`, artifactName, [
        "message",
        "tool_call",
        "tool_result",
        "file_diff",
        "validation",
        "retry",
        "failure",
        "cost",
      ]);
      expectString(event.at, `events[${index}].at`, artifactName);
      expectString(event.summary, `events[${index}].summary`, artifactName);
    },
  );

  const summary = expectObject(trace.summary, "summary", artifactName);
  expectEnum(summary.status, "summary.status", artifactName, [
    "completed",
    "blocked",
    "failed",
  ]);
  expectString(summary.outcome, "summary.outcome", artifactName);

  return trace;
}

function validateStateStoreSnapshot(artifact) {
  const artifactName = "state-store-snapshot";
  const snapshot = expectObject(artifact, artifactName, artifactName);
  expectVersion(snapshot.version, artifactName);
  expectString(snapshot.task_id, "task_id", artifactName);

  const activePath = expectObject(snapshot.active_path, "active_path", artifactName);
  expectString(activePath.path_id, "active_path.path_id", artifactName);
  expectString(activePath.current_stage, "active_path.current_stage", artifactName);

  expectObjectArray(snapshot.candidate_pool, "candidate_pool", artifactName, {
    minLength: 1,
  }).forEach((candidate, index) => {
    expectString(candidate.candidate_id, `candidate_pool[${index}].candidate_id`, artifactName);
    expectEnum(candidate.status, `candidate_pool[${index}].status`, artifactName, [
      "active",
      "parked",
      "rejected",
    ]);
  });

  expectObjectArray(snapshot.evidence_links, "evidence_links", artifactName).forEach(
    (link, index) => {
      expectString(link.evidence_id, `evidence_links[${index}].evidence_id`, artifactName);
      expectString(link.source, `evidence_links[${index}].source`, artifactName);
      expectString(link.target, `evidence_links[${index}].target`, artifactName);
    },
  );

  expectObjectArray(snapshot.failed_branches, "failed_branches", artifactName).forEach(
    (branch, index) => {
      expectString(branch.branch_id, `failed_branches[${index}].branch_id`, artifactName);
      expectString(branch.reason, `failed_branches[${index}].reason`, artifactName);
    },
  );

  expectObjectArray(snapshot.rollback_boundaries, "rollback_boundaries", artifactName, {
    minLength: 1,
  }).forEach((boundary, index) => {
    expectString(boundary.boundary_id, `rollback_boundaries[${index}].boundary_id`, artifactName);
    expectString(boundary.restore_ref, `rollback_boundaries[${index}].restore_ref`, artifactName);
  });

  expectObjectArray(snapshot.memory_channel_checks, "memory_channel_checks", artifactName, {
    minLength: 1,
  }).forEach((check, index) => {
    expectString(check.channel, `memory_channel_checks[${index}].channel`, artifactName);
    expectEnum(check.status, `memory_channel_checks[${index}].status`, artifactName, [
      "passed",
      "warning",
      "failed",
    ]);
  });

  return snapshot;
}

function validateCacheObservabilityReport(artifact) {
  const artifactName = "cache-observability-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.task_id, "task_id", artifactName);
  expectString(report.generated_at, "generated_at", artifactName);

  expectObjectArray(report.prompt_components, "prompt_components", artifactName, {
    minLength: 1,
  }).forEach((component, index) => {
    expectString(component.component_id, `prompt_components[${index}].component_id`, artifactName);
    expectString(component.role, `prompt_components[${index}].role`, artifactName);
    expectString(component.hash, `prompt_components[${index}].hash`, artifactName);
    expectEnum(component.cache_policy, `prompt_components[${index}].cache_policy`, artifactName, [
      "stable",
      "volatile",
      "bypass",
    ]);
  });

  const stablePrefix = expectObject(report.stable_prefix, "stable_prefix", artifactName);
  expectString(stablePrefix.hash, "stable_prefix.hash", artifactName);
  expectInteger(stablePrefix.token_count, "stable_prefix.token_count", artifactName, { min: 0 });

  const providerMetrics = expectObject(report.provider_metrics, "provider_metrics", artifactName);
  expectString(providerMetrics.provider, "provider_metrics.provider", artifactName);
  expectInteger(providerMetrics.prompt_tokens, "provider_metrics.prompt_tokens", artifactName, {
    min: 0,
  });
  expectInteger(providerMetrics.cached_tokens, "provider_metrics.cached_tokens", artifactName, {
    min: 0,
  });

  expectObjectArray(report.findings, "findings", artifactName).forEach((finding, index) => {
    expectEnum(finding.severity, `findings[${index}].severity`, artifactName, [
      "info",
      "warning",
      "error",
    ]);
    expectString(finding.summary, `findings[${index}].summary`, artifactName);
  });

  return report;
}

function validateGovernanceReport(artifact) {
  const artifactName = "governance-report";
  const report = expectObject(artifact, artifactName, artifactName);
  expectVersion(report.version, artifactName);
  expectString(report.task_id, "task_id", artifactName);

  expectObjectArray(report.source_graph, "source_graph", artifactName, { minLength: 1 }).forEach(
    (node, index) => {
      expectString(node.node_id, `source_graph[${index}].node_id`, artifactName);
      expectString(node.source, `source_graph[${index}].source`, artifactName);
      expectEnum(node.trust_level, `source_graph[${index}].trust_level`, artifactName, [
        "trusted",
        "untrusted",
        "quarantined",
      ]);
    },
  );

  expectObjectArray(report.quarantined_items, "quarantined_items", artifactName).forEach(
    (item, index) => {
      expectString(item.item_id, `quarantined_items[${index}].item_id`, artifactName);
      expectString(item.reason, `quarantined_items[${index}].reason`, artifactName);
    },
  );

  expectObjectArray(report.approval_gates, "approval_gates", artifactName, {
    minLength: 1,
  }).forEach((gate, index) => {
    expectString(gate.gate_id, `approval_gates[${index}].gate_id`, artifactName);
    expectEnum(gate.status, `approval_gates[${index}].status`, artifactName, [
      "approved",
      "pending",
      "rejected",
    ]);
  });

  expectString(report.tenant_scope, "tenant_scope", artifactName);

  expectObjectArray(report.memory_injection_checks, "memory_injection_checks", artifactName, {
    minLength: 1,
  }).forEach((check, index) => {
    expectString(check.check_id, `memory_injection_checks[${index}].check_id`, artifactName);
    expectEnum(check.status, `memory_injection_checks[${index}].status`, artifactName, [
      "passed",
      "warning",
      "failed",
    ]);
  });

  expectStringArray(report.conclusions, "conclusions", artifactName, { minLength: 1 });

  return report;
}

function validateProtocolDag(artifact) {
  const artifactName = "protocol-dag";
  const dag = expectObject(artifact, artifactName, artifactName);
  expectVersion(dag.version, artifactName);
  expectString(dag.task_id, "task_id", artifactName);

  const anchor = expectObject(dag.single_agent_anchor, "single_agent_anchor", artifactName);
  expectString(anchor.role, "single_agent_anchor.role", artifactName);
  expectStringArray(
    anchor.responsibilities,
    "single_agent_anchor.responsibilities",
    artifactName,
    { minLength: 1 },
  );

  const nodeIds = new Set();
  expectObjectArray(dag.nodes, "nodes", artifactName, { minLength: 1 }).forEach((node, index) => {
    expectString(node.id, `nodes[${index}].id`, artifactName);
    if (nodeIds.has(node.id)) {
      fail(artifactName, `duplicate node id ${node.id}`);
    }

    nodeIds.add(node.id);
    expectString(node.type, `nodes[${index}].type`, artifactName);
    expectString(node.label, `nodes[${index}].label`, artifactName);
  });

  expectObjectArray(dag.edges, "edges", artifactName).forEach((edge, index) => {
    expectString(edge.from, `edges[${index}].from`, artifactName);
    expectString(edge.to, `edges[${index}].to`, artifactName);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      fail(artifactName, `edges[${index}] must reference known nodes`);
    }
  });

  const stateMachine = expectObject(dag.state_machine, "state_machine", artifactName);
  expectStringArray(stateMachine.states, "state_machine.states", artifactName, { minLength: 1 });
  expectString(stateMachine.initial_state, "state_machine.initial_state", artifactName);
  if (!stateMachine.states.includes(stateMachine.initial_state)) {
    fail(artifactName, "state_machine.initial_state must be listed in state_machine.states");
  }

  const acceptance = expectObject(dag.acceptance, "acceptance", artifactName);
  expectStringArray(acceptance.criteria, "acceptance.criteria", artifactName, { minLength: 1 });

  return dag;
}

function validateServingProfile(artifact) {
  const artifactName = "serving-profile";
  const profile = expectObject(artifact, artifactName, artifactName);
  expectVersion(profile.version, artifactName);
  expectString(profile.task_id, "task_id", artifactName);
  expectString(profile.backend, "backend", artifactName);

  expectObjectArray(profile.calls, "calls", artifactName, { minLength: 1 }).forEach(
    (call, index) => {
      expectString(call.call_id, `calls[${index}].call_id`, artifactName);
      expectString(call.operation, `calls[${index}].operation`, artifactName);
      expectInteger(call.latency_ms, `calls[${index}].latency_ms`, artifactName, { min: 0 });
      expectEnum(call.status, `calls[${index}].status`, artifactName, [
        "succeeded",
        "failed",
        "skipped",
      ]);
    },
  );

  const capacityModel = expectObject(profile.capacity_model, "capacity_model", artifactName);
  expectInteger(capacityModel.max_concurrency, "capacity_model.max_concurrency", artifactName, {
    min: 1,
  });
  expectInteger(
    capacityModel.throughput_per_minute,
    "capacity_model.throughput_per_minute",
    artifactName,
    { min: 0 },
  );

  const replaySummary = expectObject(profile.replay_summary, "replay_summary", artifactName);
  expectEnum(replaySummary.status, "replay_summary.status", artifactName, [
    "passed",
    "warning",
    "failed",
  ]);
  expectInteger(replaySummary.sample_count, "replay_summary.sample_count", artifactName, {
    min: 0,
  });

  expectStringArray(profile.tradeoffs, "tradeoffs", artifactName, { minLength: 1 });

  return profile;
}

function validateLatentCommunicationExperiment(artifact) {
  const artifactName = "latent-communication-experiment";
  const experiment = expectObject(artifact, artifactName, artifactName);
  expectVersion(experiment.version, artifactName);
  expectString(experiment.task_id, "task_id", artifactName);

  expectObjectArray(experiment.baselines, "baselines", artifactName, { minLength: 1 }).forEach(
    (baseline, index) => {
      expectString(baseline.baseline_id, `baselines[${index}].baseline_id`, artifactName);
      expectString(baseline.description, `baselines[${index}].description`, artifactName);
      expectString(baseline.metric, `baselines[${index}].metric`, artifactName);
    },
  );

  expectObjectArray(experiment.experiments, "experiments", artifactName, { minLength: 1 }).forEach(
    (item, index) => {
      expectString(item.experiment_id, `experiments[${index}].experiment_id`, artifactName);
      expectString(item.description, `experiments[${index}].description`, artifactName);
      expectString(item.result, `experiments[${index}].result`, artifactName);
    },
  );

  const compatibility = expectObject(experiment.compatibility, "compatibility", artifactName);
  expectEnum(compatibility.status, "compatibility.status", artifactName, [
    "compatible",
    "limited",
    "incompatible",
  ]);
  expectString(compatibility.notes, "compatibility.notes", artifactName);

  const safety = expectObject(experiment.safety, "safety", artifactName);
  expectEnum(safety.status, "safety.status", artifactName, [
    "passed",
    "warning",
    "failed",
  ]);
  expectStringArray(safety.checks, "safety.checks", artifactName, { minLength: 1 });

  expectString(experiment.conclusion, "conclusion", artifactName);

  return experiment;
}

export function extractSingleJsonBlock(rawOutput) {
  if (typeof rawOutput !== "string" || rawOutput.trim() === "") {
    throw new ContractValidationError("stage-output", "raw output must be a non-empty string");
  }

  const matches = [...rawOutput.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length !== 1) {
    throw new ContractValidationError(
      "stage-output",
      `expected exactly one fenced json block, found ${matches.length}`,
    );
  }

  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new ContractValidationError("stage-output", `invalid JSON payload: ${error.message}`);
  }
}

export function validateArtifact(artifactType, artifact, context = {}) {
  switch (artifactType) {
    case "spec":
      return validateSpec(artifact);
    case "plan":
      return validatePlan(artifact);
    case "architecture":
      return validateArchitecture(artifact);
    case "dispatch":
      return validateDispatch(artifact, context);
    case "execution-report":
      return validateExecutionReport(artifact, context);
    case "merge-report":
      return validateMergeReport(artifact);
    case "complexity-report":
      return validateComplexityReport(artifact);
    case "conflict-resolution":
      return validateConflictResolution(artifact, context);
    case "tree-classification":
      return validateTreeClassification(artifact, context);
    case "tree-rubrics":
      return validateTreeRubrics(artifact, "tree-rubrics", context);
    case "tree-rubrics-refined":
      return validateTreeRubrics(artifact, "tree-rubrics-refined", context);
    case "tree-rubric-verification":
      return validateTreeRubricVerification(artifact, context);
    case "final-output-files":
      return validateFinalOutputFiles(artifact, context);
    case "tree-grading-individual":
      return validateTreeGradingIndividual(artifact, context);
    case "tree-grading-feedback":
      return validateTreeGradingFeedback(artifact, context);
    case "review-individual":
      return validateReviewIndividual(artifact, context);
    case "review-feedback":
      return validateReviewFeedback(artifact);
    case "validation-report":
      return validateValidationReport(artifact, context);
    case "qa-report":
      return validateQaReport(artifact);
    case "doc-report":
      return validateDocReport(artifact);
    case "final-assessment":
      return validateFinalAssessment(artifact);
    case "pipeline-last-run-summary":
      return validateRunSummary(artifact);
    case "research-harness-state":
      return validateResearchHarnessState(artifact);
    case "context-manifest":
      return validateContextManifest(artifact);
    case "agent-trace":
      return validateAgentTrace(artifact);
    case "state-store-snapshot":
      return validateStateStoreSnapshot(artifact);
    case "cache-observability-report":
      return validateCacheObservabilityReport(artifact);
    case "governance-report":
      return validateGovernanceReport(artifact);
    case "protocol-dag":
      return validateProtocolDag(artifact);
    case "serving-profile":
      return validateServingProfile(artifact);
    case "latent-communication-experiment":
      return validateLatentCommunicationExperiment(artifact);
    default:
      throw new ContractValidationError(
        "validator",
        `no validator registered for artifact type ${artifactType}`,
      );
  }
}
