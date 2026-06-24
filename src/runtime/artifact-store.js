import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_ARTIFACT_FILES } from "./constants.js";
import { validateArtifact } from "./contracts.js";
import {
  copyDirectory,
  ensureDir,
  nowIso,
  pathExists,
  readJson,
  removePath,
  sanitizeForPath,
  toPosixPath,
  writeJson,
} from "./utils.js";

export class ArtifactStore {
  constructor({
    repoRoot,
    workspaceDirName = ".pipeline-workspace",
    summaryFileName = ".pipeline-last-run-summary.json",
    clock = () => new Date(),
    snapshotIgnoreNames = [".git", ".pipeline-workspace", ".pipeline-last-run-summary.json", "node_modules"],
  }) {
    this.repoRoot = repoRoot;
    this.workspaceDirName = workspaceDirName;
    this.workspaceRoot = path.join(repoRoot, workspaceDirName);
    this.summaryFileName = summaryFileName;
    this.summaryPath = path.join(repoRoot, summaryFileName);
    this.clock = clock;
    this.snapshotIgnoreNames = new Set(snapshotIgnoreNames);
  }

  async initializeRun() {
    await ensureDir(this.workspaceRoot);
    await Promise.all([
      "bases",
      "execution",
      "complexity",
      "merge",
      "validation",
      "tree_rubrics",
      "final_outputs",
      "grading_history",
      "conflict_resolutions",
      "review_history",
      "qa",
      "assessment_history",
      "logs",
      "snapshots",
      "tmp",
    ].map((relativePath) => ensureDir(path.join(this.workspaceRoot, relativePath))));
  }

  rootArtifactPath(stage) {
    const fileName = ROOT_ARTIFACT_FILES[stage];
    if (!fileName) {
      throw new Error(`Unknown root artifact stage: ${stage}`);
    }

    return path.join(this.workspaceRoot, fileName);
  }

  workspacePath(relativePath) {
    return path.join(this.workspaceRoot, relativePath);
  }

  async appendLog(message) {
    const logPath = path.join(this.workspaceRoot, "logs", "pipeline.log");
    await ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, `[${nowIso(this.clock)}] ${message}\n`, "utf8");
  }

  async appendPetEvent(event) {
    const logPath = path.join(this.workspaceRoot, "logs", "codex-pet-events.jsonl");
    await ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async writeRootArtifact(stage, artifact) {
    const absolutePath = this.rootArtifactPath(stage);
    await writeJson(absolutePath, artifact);
    return ROOT_ARTIFACT_FILES[stage];
  }

  async readArtifactRef(relativePath) {
    return readJson(this.workspacePath(relativePath));
  }

  async writeBaseRef(wave, groupId, metadata) {
    const relativePath = path.posix.join(
      "bases",
      `wave-${wave}-${sanitizeForPath(groupId)}-base.json`,
    );
    await writeJson(this.workspacePath(relativePath), metadata);
    return relativePath;
  }

  async writeExecutionReport(groupId, iteration, artifact) {
    const relativePath = path.posix.join(
      "execution",
      groupId,
      `iteration-${iteration}-execution-report.json`,
    );
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeComplexityReport(groupId, iteration, artifact) {
    const validated = validateArtifact("complexity-report", artifact);
    const relativePath = path.posix.join(
      "complexity",
      groupId,
      `iteration-${iteration}-complexity-report.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeMergeReport(groupId, iteration, artifact) {
    const validated = validateArtifact("merge-report", artifact);
    const relativePath = path.posix.join(
      "merge",
      groupId,
      `iteration-${iteration}-merge-report.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeValidationReport(groupId, iteration, artifact) {
    const validated = validateArtifact("validation-report", artifact);
    const relativePath = path.posix.join(
      "validation",
      groupId,
      `iteration-${iteration}-validation-report.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeResolvedMergeReport(groupId, iteration, artifact) {
    const validated = validateArtifact("merge-report", artifact);
    const relativePath = path.posix.join(
      "merge",
      groupId,
      `iteration-${iteration}-resolved-merge-report.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeMergeAuxiliary(groupId, iteration, fileName, artifact) {
    const relativePath = path.posix.join("merge", groupId, `iteration-${iteration}-${fileName}`);
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeConflictResolution(groupId, iteration, artifact) {
    const validated = validateArtifact("conflict-resolution", artifact);
    const relativePath = path.posix.join(
      "conflict_resolutions",
      groupId,
      `iteration-${iteration}-conflict-resolution.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeTreeClassification(groupId, iteration, artifact) {
    const validated = validateArtifact("tree-classification", artifact);
    const relativePath = path.posix.join(
      "tree_rubrics",
      groupId,
      `iteration-${iteration}-classification.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeTreeRubrics(groupId, iteration, artifact) {
    const validated = validateArtifact("tree-rubrics", artifact);
    const relativePath = path.posix.join(
      "tree_rubrics",
      groupId,
      `iteration-${iteration}-tree-rubrics.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeTreeRubricVerification(groupId, iteration, artifact) {
    const validated = validateArtifact("tree-rubric-verification", artifact);
    const relativePath = path.posix.join(
      "tree_rubrics",
      groupId,
      `iteration-${iteration}-validation-result.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeRefinedTreeRubrics(groupId, iteration, artifact) {
    const validated = validateArtifact("tree-rubrics-refined", artifact);
    const relativePath = path.posix.join(
      "tree_rubrics",
      groupId,
      `iteration-${iteration}-tree-rubrics-refined.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeFinalOutputFiles(groupId, iteration, artifact) {
    const validated = validateArtifact("final-output-files", artifact);
    const relativePath = path.posix.join(
      "final_outputs",
      groupId,
      `iteration-${iteration}-final-output-files.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeTreeGraderOutput(groupId, iteration, graderId, artifact) {
    const relativePath = path.posix.join(
      "grading_history",
      groupId,
      `iteration-${iteration}-grader-${graderId}.json`,
    );
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeTreeGradingFeedback(groupId, iteration, artifact) {
    const validated = validateArtifact("tree-grading-feedback", artifact);
    const relativePath = path.posix.join(
      "grading_history",
      groupId,
      `iteration-${iteration}-tree-grading-feedback.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeReviewerOutput(groupId, iteration, reviewerId, artifact) {
    const relativePath = path.posix.join(
      "review_history",
      groupId,
      `iteration-${iteration}-reviewer-${reviewerId}.json`,
    );
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeReviewFeedback(groupId, iteration, artifact) {
    const validated = validateArtifact("review-feedback", artifact);
    const relativePath = path.posix.join(
      "review_history",
      groupId,
      `iteration-${iteration}-review-feedback.json`,
    );
    await writeJson(this.workspacePath(relativePath), validated);
    return relativePath;
  }

  async writeQaReport(groupId, iteration, artifact) {
    const relativePath = path.posix.join("qa", groupId, `iteration-${iteration}-qa-report.json`);
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeAssessmentHistory(iteration, artifact) {
    const relativePath = path.posix.join(
      "assessment_history",
      `iteration-${iteration}-final-assessment.json`,
    );
    await writeJson(this.workspacePath(relativePath), artifact);
    return relativePath;
  }

  async writeRunSummary(summary) {
    const validated = validateArtifact("pipeline-last-run-summary", summary);
    await writeJson(this.summaryPath, validated);
    return this.summaryPath;
  }

  async readRootArtifact(stage) {
    return readJson(this.rootArtifactPath(stage));
  }

  async workspaceExists() {
    return pathExists(this.workspaceRoot);
  }

  async listWorkspaceArtifacts(relativeDir, { include = null } = {}) {
    const absoluteDir = this.workspacePath(relativeDir);
    if (!(await pathExists(absoluteDir))) {
      return [];
    }

    const files = await fs.readdir(absoluteDir, { withFileTypes: true });
    const artifactFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((fileName) => (include ? include(fileName) : fileName.endsWith(".json")))
      .sort();

    const results = [];
    for (const fileName of artifactFiles) {
      const ref = path.posix.join(relativeDir, fileName);
      results.push({
        ref,
        artifact: await this.readArtifactRef(ref),
      });
    }

    return results;
  }

  async readGroupExecutionHistory(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("execution", groupId));
  }

  async readGroupComplexityReports(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("complexity", groupId));
  }

  async readGroupMergeHistory(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("merge", groupId), {
      include: (fileName) =>
        fileName === "mainline.json"
          ? false
          : fileName.endsWith("-merge-report.json"),
    });
  }

  async readGroupReviewFeedbackHistory(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("review_history", groupId), {
      include: (fileName) => fileName.endsWith("-review-feedback.json"),
    });
  }

  async readGroupValidationReports(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("validation", groupId));
  }

  async readGroupReviewerOutputs(groupId, { iteration = null } = {}) {
    return this.listWorkspaceArtifacts(path.posix.join("review_history", groupId), {
      include: (fileName) => {
        if (!fileName.endsWith(".json") || fileName.endsWith("-review-feedback.json")) {
          return false;
        }

        if (!fileName.includes("-reviewer-")) {
          return false;
        }

        return iteration === null || fileName.startsWith(`iteration-${iteration}-reviewer-`);
      },
    });
  }

  async readGroupQaReports(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("qa", groupId));
  }

  async readGroupTreeGradingFeedbackHistory(groupId) {
    return this.listWorkspaceArtifacts(path.posix.join("grading_history", groupId), {
      include: (fileName) => fileName.endsWith("-tree-grading-feedback.json"),
    });
  }

  async readGroupTreeGraderOutputs(groupId, { iteration = null } = {}) {
    return this.listWorkspaceArtifacts(path.posix.join("grading_history", groupId), {
      include: (fileName) => {
        if (!fileName.endsWith(".json") || fileName.endsWith("-tree-grading-feedback.json")) {
          return false;
        }

        if (!fileName.includes("-grader-")) {
          return false;
        }

        return iteration === null || fileName.startsWith(`iteration-${iteration}-grader-`);
      },
    });
  }

  async readAssessmentHistory() {
    return this.listWorkspaceArtifacts("assessment_history");
  }

  async readConflictResolutions() {
    const groupDirs = await fs.readdir(this.workspacePath("conflict_resolutions"), {
      withFileTypes: true,
    }).catch(() => []);
    const results = [];

    for (const entry of groupDirs.filter((candidate) => candidate.isDirectory())) {
      const relativeDir = path.posix.join("conflict_resolutions", entry.name);
      results.push(...(await this.listWorkspaceArtifacts(relativeDir)));
    }

    results.sort((left, right) => left.ref.localeCompare(right.ref));
    return results;
  }

  async createWorkspaceSnapshot({ refPath, snapshotName, metadata = {}, sourceDir = this.repoRoot }) {
    const safeName = sanitizeForPath(snapshotName);
    const snapshotRelativePath = path.posix.join("snapshots", safeName);
    const snapshotAbsolutePath = this.workspacePath(snapshotRelativePath);
    await removePath(snapshotAbsolutePath);
    await ensureDir(path.dirname(snapshotAbsolutePath));

    await copyDirectory(sourceDir, snapshotAbsolutePath, {
      shouldIgnore: (candidatePath, entry) => {
        const repoRelativePath = path.relative(sourceDir, candidatePath);
        const rootSegment = repoRelativePath.split(path.sep)[0];
        if (entry.isDirectory() && this.snapshotIgnoreNames.has(rootSegment)) {
          return true;
        }

        if (repoRelativePath === this.summaryFileName) {
          return true;
        }

        return false;
      },
    });

    const snapshotRef = refPath;
    const snapshotMetadata = {
      version: "1.0",
      snapshot_id: safeName,
      snapshot_path: snapshotRelativePath,
      created_at: nowIso(this.clock),
      source_dir: toPosixPath(path.relative(this.repoRoot, sourceDir) || "."),
      ...metadata,
    };
    await writeJson(this.workspacePath(snapshotRef), snapshotMetadata);
    return snapshotRef;
  }

  async resolveSnapshotDir(refPath) {
    const metadata = await readJson(this.workspacePath(refPath));
    if (!metadata.snapshot_path) {
      throw new Error(`Snapshot ref ${refPath} is missing snapshot_path`);
    }

    const snapshotDir = this.workspacePath(metadata.snapshot_path);
    if (!(await pathExists(snapshotDir))) {
      throw new Error(`Snapshot directory missing for ${refPath}: ${snapshotDir}`);
    }

    return snapshotDir;
  }

  async cleanupWorkspace() {
    await removePath(this.workspaceRoot);
  }
}
