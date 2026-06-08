import {
  FINAL_ASSESSMENT_DIMENSIONS,
  INTEGRATION_STRATEGY,
  PRE_CRITERIA,
  TREE_RUBRIC_VALIDATION_DIMENSIONS,
} from "./constants.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }

  return value;
}

export function mergeTemplateValues(templateValue, inputValue) {
  if (inputValue === undefined) {
    return clone(templateValue);
  }

  if (Array.isArray(templateValue) && Array.isArray(inputValue)) {
    if (templateValue.length === 0 || inputValue.length === 0) {
      return clone(inputValue);
    }

    return inputValue.map((item, index) => {
      const itemTemplate = templateValue[Math.min(index, templateValue.length - 1)];
      return mergeTemplateValues(itemTemplate, item);
    });
  }

  if (isPlainObject(templateValue) && isPlainObject(inputValue)) {
    const result = clone(templateValue);
    for (const [key, value] of Object.entries(inputValue)) {
      result[key] = mergeTemplateValues(result[key], value);
    }
    return result;
  }

  return clone(inputValue);
}

function groupIdFromContext(context) {
  return (
    context.workerGroup?.group_id ??
    context.executionReport?.group_id ??
    context.validationReport?.group_id ??
    context.mergeReport?.group_id ??
    context.treeGradingFeedback?.group_id ??
    context.finalOutputFiles?.group_id ??
    context.treeRubrics?.group_id ??
    context.classification?.group_id ??
    null
  );
}

function iterationFromContext(context) {
  return (
    context.iteration ??
    context.executionReport?.iteration ??
    context.validationReport?.iteration ??
    context.mergeReport?.iteration ??
    context.treeGradingFeedback?.iteration ??
    context.finalOutputFiles?.iteration ??
    null
  );
}

function taskIdFromContext(context) {
  const groupId = groupIdFromContext(context);
  return (
    context.treeRubrics?.task_id ??
    context.classification?.task_id ??
    context.rubric?.task_id ??
    (groupId ? `${groupId}-task` : null)
  );
}

function withGroupAndIteration(context) {
  const fields = {};
  const groupId = groupIdFromContext(context);
  const iteration = iterationFromContext(context);

  if (groupId) {
    fields.group_id = groupId;
  }

  if (Number.isInteger(iteration)) {
    fields.iteration = iteration;
  }

  return fields;
}

function fixedDimensionScores() {
  return FINAL_ASSESSMENT_DIMENSIONS.map((dimension) => ({
    dimension,
    score: "",
    evidence: "",
  }));
}

function fixedVerificationDimensions() {
  return TREE_RUBRIC_VALIDATION_DIMENSIONS.map((dimension) => ({
    dimension,
    status: "",
    evidence: "",
    suggestion: null,
  }));
}

function fixedPreResults() {
  return PRE_CRITERIA.map((criterion) => ({
    criterion,
    score: "",
    evidence: "",
    suggestion: null,
  }));
}

export function deterministicArtifactFields(
  artifactType,
  context = {},
  stageExecution = {},
  { includeFixedArrays = true } = {},
) {
  const base = { version: "1.0" };
  const groupAndIteration = withGroupAndIteration(context);
  const taskId = taskIdFromContext(context);

  switch (artifactType) {
    case "spec":
      return {
        ...base,
        applied_skills: [],
      };
    case "plan":
      return {
        ...base,
        applied_skills: [],
        spec_ref: "spec.json",
      };
    case "architecture":
      return {
        ...base,
        spec_ref: "spec.json",
        plan_ref: "plan.json",
      };
    case "dispatch":
      return {
        ...base,
        spec_ref: "spec.json",
        plan_ref: "plan.json",
        architecture_ref: "architecture.json",
        integration_strategy: INTEGRATION_STRATEGY,
      };
    case "execution-report": {
      const proposalRef = stageExecution.proposal?.ref ?? stageExecution.proposal?.path ?? null;
      return {
        ...base,
        ...groupAndIteration,
        ...(context.baseRef ? { base_ref: context.baseRef } : {}),
        ...(proposalRef ? { proposal_ref: proposalRef } : {}),
      };
    }
    case "validation-report":
    case "qa-report":
      return {
        ...base,
        ...groupAndIteration,
      };
    case "tree-classification":
      return {
        ...base,
        ...groupAndIteration,
        ...(taskId ? { task_id: taskId } : {}),
      };
    case "tree-rubrics":
    case "tree-rubrics-refined":
      return {
        ...base,
        ...(groupIdFromContext(context) ? { group_id: groupIdFromContext(context) } : {}),
        ...(taskId ? { task_id: taskId } : {}),
        ...(context.classification?.task_type ? { task_type: context.classification.task_type } : {}),
      };
    case "tree-rubric-verification":
      return {
        ...base,
        ...(groupIdFromContext(context) ? { group_id: groupIdFromContext(context) } : {}),
        ...(taskId ? { task_id: taskId } : {}),
        ...(includeFixedArrays ? { dimension_results: fixedVerificationDimensions() } : {}),
      };
    case "tree-grading-individual":
      return {
        ...base,
        ...groupAndIteration,
        ...(Number.isInteger(context.graderId) ? { grader_id: context.graderId } : {}),
        ...(taskId ? { task_id: taskId } : {}),
      };
    case "review-individual":
      return {
        ...base,
        ...(Number.isInteger(context.reviewerId) ? { reviewer_id: context.reviewerId } : {}),
        ...(includeFixedArrays ? { pre_results: fixedPreResults() } : {}),
      };
    case "doc-report":
      return base;
    case "final-assessment":
      return {
        ...base,
        iteration: (context.previousAssessments?.length ?? 0) + 1,
        ...(includeFixedArrays ? { dimension_scores: fixedDimensionScores() } : {}),
      };
    default:
      return base;
  }
}

export function materializeArtifactFromTemplate({
  artifactType,
  template = null,
  values,
  context = {},
  stageExecution = {},
}) {
  const deterministicDefaults = deterministicArtifactFields(artifactType, context, stageExecution);
  const deterministicOverrides = deterministicArtifactFields(
    artifactType,
    context,
    stageExecution,
    { includeFixedArrays: false },
  );
  const base = mergeTemplateValues(template ?? {}, deterministicDefaults);
  const withValues = mergeTemplateValues(base, values);
  return mergeTemplateValues(withValues, deterministicOverrides);
}
