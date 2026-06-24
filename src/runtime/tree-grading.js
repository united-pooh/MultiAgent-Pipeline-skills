import { validateArtifact } from "./contracts.js";
import { uniqueStrings } from "./utils.js";

export function weightForDepth(depth) {
  if (depth <= 1) {
    return 1;
  }

  if (depth === 2) {
    return 2;
  }

  return 3;
}

function collectRubricNodes(rubric) {
  return rubric.branches.flatMap((branch, branchIndex) =>
    branch.nodes.map((node) => ({
      ...node,
      branch_name: branch.name,
      branch_index: branchIndex + 1,
      weight: weightForDepth(node.depth),
    })),
  );
}

function majorityScore(scores) {
  const passVotes = scores.filter((score) => score === 1).length;
  return passVotes >= Math.ceil(scores.length / 2) ? 1 : 0;
}

function dependencyBlocker(node, branchNodes, rawScoresByNodeId) {
  const shallowerFailures = branchNodes
    .filter((candidate) => candidate.depth < node.depth)
    .filter((candidate) => rawScoresByNodeId.get(candidate.id) === 0)
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));

  return shallowerFailures[0]?.id ?? null;
}

function buildNodeResult(node, rubric, graderResults) {
  const graderScores = graderResults.map((grader) => {
    const match = grader.node_results.find((result) => result.node_id === node.id);
    return {
      grader_id: grader.grader_id,
      raw_score: match.raw_score,
      evidence: match.evidence,
      failure_reason: match.failure_reason,
      suggestion: match.suggestion,
    };
  });
  const rawScore = majorityScore(graderScores.map((score) => score.raw_score));
  const branch = rubric.branches[node.branch_index - 1];
  const rawScoresByNodeId = new Map(
    collectRubricNodes({ ...rubric, branches: [branch] }).map((branchNode) => {
      const scores = graderResults.map((grader) =>
        grader.node_results.find((result) => result.node_id === branchNode.id).raw_score,
      );
      return [branchNode.id, majorityScore(scores)];
    }),
  );
  const blocker = dependencyBlocker(node, branch.nodes, rawScoresByNodeId);
  const effectiveScore = rawScore === 1 && blocker === null ? 1 : 0;
  const consensus = graderScores.every((score) => score.raw_score === graderScores[0].raw_score)
    ? "unanimous"
    : "majority";

  return {
    node_id: node.id,
    branch: node.branch_name,
    depth: node.depth,
    weight: node.weight,
    grader_scores: graderScores,
    raw_score: rawScore,
    effective_score: effectiveScore,
    dependency_blocked_by: blocker,
    consensus,
  };
}

export function aggregateTreeGradingFeedback({
  threshold = 0.8,
  requireDepthOnePass = true,
  rubric,
  graderResults,
  iteration = null,
}) {
  const validatedRubric = validateArtifact("tree-rubrics-refined", rubric);
  const validatedGraders = graderResults.map((grader) =>
    validateArtifact("tree-grading-individual", grader, { rubric: validatedRubric }),
  );

  const nodes = collectRubricNodes(validatedRubric);
  const nodeResults = nodes.map((node) => buildNodeResult(node, validatedRubric, validatedGraders));
  const totalWeight = nodeResults.reduce((sum, result) => sum + result.weight, 0);
  const earnedWeight = nodeResults.reduce(
    (sum, result) => sum + result.weight * result.effective_score,
    0,
  );
  const weightedScore = totalWeight === 0 ? 0 : earnedWeight / totalWeight;
  const passRate =
    nodeResults.length === 0
      ? 0
      : nodeResults.filter((result) => result.effective_score === 1).length / nodeResults.length;
  const depthOnePassed = nodeResults
    .filter((result) => result.depth === 1)
    .every((result) => result.effective_score === 1);
  const nodesPassed = nodeResults
    .filter((result) => result.effective_score === 1)
    .map((result) => result.node_id);
  const nodesFailed = nodeResults
    .filter((result) => result.effective_score === 0)
    .map((result) => result.node_id);
  const verdict =
    weightedScore >= threshold && (!requireDepthOnePass || depthOnePassed) ? "pass" : "fail";

  const feedback = {
    version: "1.0",
    group_id: validatedRubric.group_id,
    iteration: iteration ?? validatedGraders[0]?.iteration ?? 1,
    task_id: validatedRubric.task_id,
    threshold,
    require_depth_one_pass: requireDepthOnePass,
    verdict,
    weighted_score: Number(weightedScore.toFixed(6)),
    pass_rate: Number(passRate.toFixed(6)),
    num_branches: validatedRubric.branches.length,
    max_depth: Math.max(...nodes.map((node) => node.depth)),
    nodes_passed: nodesPassed,
    nodes_failed: nodesFailed,
    blocking_nodes: verdict === "fail" ? nodesFailed : [],
    non_blocking_nodes: verdict === "pass" ? nodesFailed : [],
    node_results: nodeResults,
    summary:
      verdict === "pass"
        ? `Tree grading passed with weighted_score ${weightedScore.toFixed(3)}.`
        : `Tree grading failed with weighted_score ${weightedScore.toFixed(3)}.`,
  };

  feedback.nodes_passed = uniqueStrings(feedback.nodes_passed);
  feedback.nodes_failed = uniqueStrings(feedback.nodes_failed);
  feedback.blocking_nodes = uniqueStrings(feedback.blocking_nodes);
  feedback.non_blocking_nodes = uniqueStrings(feedback.non_blocking_nodes);

  return validateArtifact("tree-grading-feedback", feedback, { rubric: validatedRubric });
}
