import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { nowIso, pathExists, toPosixPath, uniqueStrings } from "./utils.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_COMPLEXITY_THRESHOLDS = Object.freeze({
  medium: 15,
  high: 25,
});

export function defaultComplexityAnalyzerPath() {
  return fileURLToPath(new URL("../../scripts/better_highlights_cognitive_repro.py", import.meta.url));
}

function safeResolve(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return absolutePath;
}

function classifyComplexity(totalPoints, thresholds) {
  if (totalPoints >= thresholds.high) {
    return "high";
  }

  if (totalPoints >= thresholds.medium) {
    return "medium";
  }

  return "low";
}

function functionNameFromAnalyzer(value) {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    return value;
  }

  return value.slice(separatorIndex + 1);
}

function summarizeFunctions(functions, errors, thresholds) {
  const functionCount = functions.length;
  const totalPoints = functions.reduce((sum, item) => sum + item.total_points, 0);
  const maxTotalPoints = functions.reduce(
    (max, item) => Math.max(max, item.total_points),
    0,
  );
  const averageTotalPoints = functionCount === 0
    ? 0
    : Number((totalPoints / functionCount).toFixed(2));
  const highComplexityFunctions = functions.filter((item) => item.level === "high").length;
  const mediumComplexityFunctions = functions.filter((item) => item.level === "medium").length;
  const hasAnalyzerErrors = errors.length > 0;
  const complexityConclusion =
    hasAnalyzerErrors ||
    highComplexityFunctions > 0 ||
    maxTotalPoints >= thresholds.high ||
    averageTotalPoints >= thresholds.medium
      ? "high"
      : "low";
  const readabilityConclusion =
    hasAnalyzerErrors || complexityConclusion === "high" || mediumComplexityFunctions >= 3
      ? "low"
      : "high";

  return {
    functionCount,
    maxTotalPoints,
    averageTotalPoints,
    highComplexityFunctions,
    mediumComplexityFunctions,
    readabilityConclusion,
    complexityConclusion,
  };
}

function buildSummary({
  status,
  functionCount,
  maxTotalPoints,
  highComplexityFunctions,
  mediumComplexityFunctions,
  readabilityConclusion,
  complexityConclusion,
  errors,
}) {
  if (status === "skipped") {
    return "Readability high; complexity low. No changed Python files were available for cognitive complexity analysis.";
  }

  if (errors.length > 0) {
    return `Readability ${readabilityConclusion}; complexity ${complexityConclusion}. Analyzer reported ${errors.length} error(s), so downstream stages should inspect the changed Python files manually.`;
  }

  return `Readability ${readabilityConclusion}; complexity ${complexityConclusion}. Analyzed ${functionCount} function(s); max total points ${maxTotalPoints}; medium functions ${mediumComplexityFunctions}; high functions ${highComplexityFunctions}.`;
}

async function runAnalyzer({
  analyzerPath,
  pythonBin,
  targetPath,
  thresholds,
}) {
  const { stdout } = await execFileAsync(
    pythonBin,
    [
      analyzerPath,
      "--json",
      "--function-report",
      "--medium",
      String(thresholds.medium),
      "--high",
      String(thresholds.high),
      targetPath,
    ],
    {
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return JSON.parse(stdout);
}

function normalizeAnalyzerError(error) {
  return {
    message: error.message,
    exit_code: Number.isInteger(error.code) ? error.code : null,
    stdout: typeof error.stdout === "string" ? error.stdout : "",
    stderr: typeof error.stderr === "string" ? error.stderr : "",
  };
}

export async function runComplexityHook({
  repoRoot,
  groupId,
  iteration,
  changedFiles,
  proposalPath = null,
  clock = () => new Date(),
  analyzerPath = defaultComplexityAnalyzerPath(),
  pythonBin = process.env.PYTHON ?? "python3",
  thresholds = DEFAULT_COMPLEXITY_THRESHOLDS,
} = {}) {
  const uniqueChangedFiles = uniqueStrings(changedFiles ?? []);
  const sourceRoot = proposalPath ?? repoRoot;
  const analyzedFiles = [];
  const skippedFiles = [];
  const errors = [];
  const functions = [];

  for (const changedFile of uniqueChangedFiles) {
    if (path.extname(changedFile) !== ".py") {
      skippedFiles.push({
        file: changedFile,
        reason: "not_python",
      });
      continue;
    }

    const targetPath = safeResolve(sourceRoot, changedFile);
    if (!targetPath) {
      skippedFiles.push({
        file: changedFile,
        reason: "invalid_path",
      });
      continue;
    }

    if (!(await pathExists(targetPath))) {
      skippedFiles.push({
        file: changedFile,
        reason: proposalPath ? "missing_in_proposal" : "missing_in_repo",
      });
      continue;
    }

    try {
      const output = await runAnalyzer({
        analyzerPath,
        pythonBin,
        targetPath,
        thresholds,
      });
      const analyzerFunctions = output.functions ?? [];
      analyzedFiles.push({
        file: changedFile,
        source_path: toPosixPath(path.relative(sourceRoot, targetPath)),
        function_count: analyzerFunctions.length,
      });

      for (const item of analyzerFunctions) {
        const totalPoints = item.total_points ?? 0;
        functions.push({
          file: changedFile,
          function: functionNameFromAnalyzer(item.function),
          analyzer_function: item.function,
          loop_points: item.loop_points ?? 0,
          if_points: item.if_points ?? 0,
          logical_points: item.logical_points ?? 0,
          other_points: item.other_points ?? 0,
          total_points: totalPoints,
          level: classifyComplexity(totalPoints, thresholds),
        });
      }
    } catch (error) {
      errors.push({
        file: changedFile,
        ...normalizeAnalyzerError(error),
      });
    }
  }

  const {
    functionCount,
    maxTotalPoints,
    averageTotalPoints,
    highComplexityFunctions,
    mediumComplexityFunctions,
    readabilityConclusion,
    complexityConclusion,
  } = summarizeFunctions(functions, errors, thresholds);
  const status =
    errors.length > 0
      ? "error"
      : analyzedFiles.length > 0
        ? "completed"
        : "skipped";

  return {
    version: "1.0",
    group_id: groupId,
    iteration,
    created_at: nowIso(clock),
    analyzer: {
      name: "better_highlights_cognitive_repro",
      path: "scripts/better_highlights_cognitive_repro.py",
      metric: "better-highlights-like cognitive complexity approximation",
      medium_threshold: thresholds.medium,
      high_threshold: thresholds.high,
    },
    source: {
      proposal_path: proposalPath,
      changed_files: uniqueChangedFiles,
    },
    status,
    analyzed_files: analyzedFiles,
    skipped_files: skippedFiles,
    errors,
    function_count: functionCount,
    max_total_points: maxTotalPoints,
    average_total_points: averageTotalPoints,
    medium_complexity_functions: mediumComplexityFunctions,
    high_complexity_functions: highComplexityFunctions,
    readability_conclusion: readabilityConclusion,
    complexity_conclusion: complexityConclusion,
    summary: buildSummary({
      status,
      functionCount,
      maxTotalPoints,
      highComplexityFunctions,
      mediumComplexityFunctions,
      readabilityConclusion,
      complexityConclusion,
      errors,
    }),
    functions,
  };
}
