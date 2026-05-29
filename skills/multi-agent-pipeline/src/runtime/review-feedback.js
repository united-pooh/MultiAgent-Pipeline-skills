import { PRE_CRITERIA } from "./constants.js";
import { validateArtifact } from "./contracts.js";
import { formatShortList, uniqueStrings } from "./utils.js";

function effectiveVote(score) {
  return score === "warning" ? "pass" : score;
}

function buildSummary(mode, failCount, warningCount) {
  if (failCount === 0) {
    return `${mode} review passed all ${PRE_CRITERIA.length} PRE dimensions. Preserved warnings: ${warningCount}.`;
  }

  return `${mode} review failed ${failCount} of ${PRE_CRITERIA.length} PRE dimensions. Non-blocking warnings preserved: ${warningCount}.`;
}

function buildWarningStrings(reviews) {
  const warnings = [];

  for (const review of reviews) {
    for (const result of review.pre_results) {
      if (result.score === "warning") {
        warnings.push(`${result.criterion}: ${result.suggestion}`);
      }
    }
  }

  return uniqueStrings(warnings);
}

function mergeIssuesForCriterion(criterion, reviews) {
  const flagged = [];

  for (const review of reviews) {
    const match = review.pre_results.find((result) => result.criterion === criterion);
    if (!match || match.score === "pass") {
      continue;
    }

    flagged.push({
      reviewerId: review.reviewer_id,
      evidence: match.evidence,
      suggestion: match.suggestion,
    });
  }

  if (flagged.length === 0) {
    return null;
  }

  return {
    criterion,
    evidence: uniqueStrings(flagged.map((item) => item.evidence)).join(" | "),
    suggestion: formatShortList(uniqueStrings(flagged.map((item) => item.suggestion))),
    flagged_by: flagged.map((item) => item.reviewerId).sort((left, right) => left - right),
  };
}

export function aggregateReviewFeedback({ mode = "EME", iteration, reviews }) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    throw new Error("aggregateReviewFeedback requires at least one review");
  }

  const emeVotes = [];
  const mergedIssues = [];

  for (const criterion of PRE_CRITERIA) {
    const rawVotes = reviews.map((review) => {
      const result = review.pre_results.find((entry) => entry.criterion === criterion);
      if (!result) {
        throw new Error(`reviewer ${review.reviewer_id} missing criterion ${criterion}`);
      }

      return result.score;
    });

    const normalizedVotes = rawVotes.map(effectiveVote);
    const passVotes = normalizedVotes.filter((vote) => vote === "pass").length;
    const failVotes = normalizedVotes.length - passVotes;
    const finalScore = failVotes > passVotes ? "fail" : "pass";
    const consensus = normalizedVotes.every((vote) => vote === normalizedVotes[0])
      ? "unanimous"
      : "majority";

    emeVotes.push({
      criterion,
      votes: rawVotes,
      final_score: finalScore,
      consensus,
    });

    if (finalScore === "fail") {
      const issue = mergeIssuesForCriterion(criterion, reviews);
      if (issue) {
        mergedIssues.push(issue);
      }
    }
  }

  const warnings = buildWarningStrings(reviews);
  const blockingIssuesCount = emeVotes.filter((entry) => entry.final_score === "fail").length;
  const feedback = {
    version: "1.0",
    iteration,
    mode,
    verdict: blockingIssuesCount === 0 ? "pass" : "fail",
    eme_votes: emeVotes,
    merged_issues: mergedIssues,
    summary: buildSummary(mode, blockingIssuesCount, warnings.length),
    blocking_issues_count: blockingIssuesCount,
    warnings,
  };

  return validateArtifact("review-feedback", feedback);
}
