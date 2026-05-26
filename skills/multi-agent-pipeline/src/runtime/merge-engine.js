import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { BINARY_EXTENSIONS, TEXT_EXTENSIONS } from "./constants.js";
import { buffersEqual, ensureDir, isProbablyBinary, listFilesRecursive, pathExists } from "./utils.js";

const execFileAsync = promisify(execFile);

function inferFormat(relativePath, buffer) {
  const extension = path.extname(relativePath).toLowerCase();

  if (extension === ".json") {
    return "json";
  }

  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }

  if (extension === ".xls" || extension === ".xlsx" || extension === ".csv" || extension === ".tsv") {
    return "spreadsheet";
  }

  if (extension === ".ppt" || extension === ".pptx") {
    return "presentation";
  }

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"].includes(extension)) {
    return extension === ".svg" ? "text" : "image";
  }

  if (BINARY_EXTENSIONS.has(extension)) {
    return "binary";
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  return isProbablyBinary(buffer) ? "binary" : "text";
}

async function readFileIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  return fs.readFile(targetPath);
}

function conflictTypeForStructured(relativePath, proposalBuffer, mainBuffer) {
  if (path.extname(relativePath).toLowerCase() === ".json") {
    try {
      const proposalValue = JSON.parse(proposalBuffer.toString("utf8"));
      const mainValue = JSON.parse(mainBuffer.toString("utf8"));
      if (Array.isArray(proposalValue) || Array.isArray(mainValue)) {
        return "array_conflict";
      }
    } catch {
      return "same_key";
    }
  }

  return "same_key";
}

function buildConflict({
  relativePath,
  format,
  conflictType,
  summary,
  proposalRef,
  mainlineRef,
  baseRef,
}) {
  return {
    file: relativePath,
    format,
    conflict_type: conflictType,
    summary,
    left_ref: `${proposalRef}:${relativePath}`,
    right_ref: `${mainlineRef}:${relativePath}`,
    base_ref: `${baseRef}:${relativePath}`,
  };
}

export class MergeEngine {
  constructor({ repoRoot, artifactStore }) {
    this.repoRoot = repoRoot;
    this.artifactStore = artifactStore;
  }

  async mergeProposal({ groupId, iteration, baseRef, proposal, changedFiles = [] }) {
    if (!proposal?.ref || !proposal?.path) {
      throw new Error("mergeProposal requires proposal.ref and proposal.path");
    }

    const mainlineRef = await this.artifactStore.createWorkspaceSnapshot({
      refPath: path.posix.join("merge", groupId, `iteration-${iteration}-mainline.json`),
      snapshotName: `${groupId}-iteration-${iteration}-mainline`,
    });
    const baseDir = await this.artifactStore.resolveSnapshotDir(baseRef);
    const mainlineDir = await this.artifactStore.resolveSnapshotDir(mainlineRef);
    const candidatePaths = await this.collectCandidatePaths({
      baseDir,
      mainlineDir,
      proposalDir: proposal.path,
      changedFiles,
    });

    const operations = [];
    const conflicts = [];

    for (const relativePath of candidatePaths) {
      const resolution = await this.resolvePath({
        relativePath,
        baseDir,
        mainlineDir,
        proposal,
        mainlineRef,
        baseRef,
      });

      if (resolution.kind === "conflict") {
        conflicts.push(resolution.conflict);
      } else if (resolution.kind !== "noop") {
        operations.push(resolution);
      }
    }

    if (conflicts.length > 0) {
      const conflictBundleRef = await this.artifactStore.writeMergeAuxiliary(
        groupId,
        iteration,
        "conflict-bundle.json",
        {
          version: "1.0",
          proposal_ref: proposal.ref,
          conflicts,
        },
      );
      return {
        report: {
          version: "1.0",
          group_id: groupId,
          iteration,
          base_ref: baseRef,
          mainline_ref: mainlineRef,
          proposal_ref: proposal.ref,
          result_ref: conflictBundleRef,
          status: "conflicted",
          conflicts,
        },
      };
    }

    if (operations.length > 0) {
      await this.applyOperations(operations);
      const resultRef = await this.artifactStore.createWorkspaceSnapshot({
        refPath: path.posix.join("merge", groupId, `iteration-${iteration}-result.json`),
        snapshotName: `${groupId}-iteration-${iteration}-result`,
      });
      return {
        report: {
          version: "1.0",
          group_id: groupId,
          iteration,
          base_ref: baseRef,
          mainline_ref: mainlineRef,
          proposal_ref: proposal.ref,
          result_ref: resultRef,
          status: "merged",
          conflicts: [],
        },
      };
    }

    return {
      report: {
        version: "1.0",
        group_id: groupId,
        iteration,
        base_ref: baseRef,
        mainline_ref: mainlineRef,
        proposal_ref: proposal.ref,
        result_ref: mainlineRef,
        status: "noop",
        conflicts: [],
      },
    };
  }

  async collectCandidatePaths({ baseDir, mainlineDir, proposalDir, changedFiles }) {
    if (changedFiles.length > 0) {
      return [...new Set(changedFiles)].sort();
    }

    const [baseFiles, mainlineFiles, proposalFiles] = await Promise.all([
      listFilesRecursive(baseDir),
      listFilesRecursive(mainlineDir),
      listFilesRecursive(proposalDir),
    ]);

    const normalize = (rootDir, absolutePath) =>
      absolutePath.slice(rootDir.length + 1).split(path.sep).join("/");

    return [...new Set([
      ...baseFiles.map((file) => normalize(baseDir, file)),
      ...mainlineFiles.map((file) => normalize(mainlineDir, file)),
      ...proposalFiles.map((file) => normalize(proposalDir, file)),
    ])].sort();
  }

  async resolvePath({
    relativePath,
    baseDir,
    mainlineDir,
    proposal,
    mainlineRef,
    baseRef,
  }) {
    const baseBuffer = await readFileIfExists(path.join(baseDir, relativePath));
    const mainBuffer = await readFileIfExists(path.join(mainlineDir, relativePath));
    const proposalBuffer = await readFileIfExists(path.join(proposal.path, relativePath));

    if (buffersEqual(mainBuffer, proposalBuffer)) {
      return { kind: "noop", relativePath };
    }

    if (buffersEqual(baseBuffer, mainBuffer)) {
      if (proposalBuffer === null) {
        return { kind: "delete", relativePath };
      }

      return { kind: "write", relativePath, buffer: proposalBuffer };
    }

    if (buffersEqual(baseBuffer, proposalBuffer)) {
      return { kind: "noop", relativePath };
    }

    if (baseBuffer === null && mainBuffer === null && proposalBuffer !== null) {
      return { kind: "write", relativePath, buffer: proposalBuffer };
    }

    if (baseBuffer === null && mainBuffer !== null && proposalBuffer === null) {
      return { kind: "noop", relativePath };
    }

    if (baseBuffer === null && mainBuffer !== null && proposalBuffer !== null) {
      return {
        kind: "conflict",
        conflict: buildConflict({
          relativePath,
          format: inferFormat(relativePath, proposalBuffer),
          conflictType: "manual_only",
          summary: "File was added differently on both sides without a shared base.",
          proposalRef: proposal.ref,
          mainlineRef,
          baseRef,
        }),
      };
    }

    const format = inferFormat(relativePath, proposalBuffer ?? mainBuffer ?? baseBuffer ?? Buffer.alloc(0));

    if (proposalBuffer === null || mainBuffer === null) {
      return {
        kind: "conflict",
        conflict: buildConflict({
          relativePath,
          format,
          conflictType: "manual_only",
          summary: "File was deleted on one side and modified on the other.",
          proposalRef: proposal.ref,
          mainlineRef,
          baseRef,
        }),
      };
    }

    if (format === "json" || format === "yaml") {
      return {
        kind: "conflict",
        conflict: buildConflict({
          relativePath,
          format,
          conflictType: conflictTypeForStructured(relativePath, proposalBuffer, mainBuffer),
          summary: "Structured data changed on both sides and requires manual resolution.",
          proposalRef: proposal.ref,
          mainlineRef,
          baseRef,
        }),
      };
    }

    if (format !== "text") {
      return {
        kind: "conflict",
        conflict: buildConflict({
          relativePath,
          format,
          conflictType: "binary_conflict",
          summary: "Non-text artifact changed on both sides.",
          proposalRef: proposal.ref,
          mainlineRef,
          baseRef,
        }),
      };
    }

    const mergedText = await this.mergeText({
      relativePath,
      baseBuffer,
      mainBuffer,
      proposalBuffer,
    });

    if (mergedText.conflicted) {
      return {
        kind: "conflict",
        conflict: buildConflict({
          relativePath,
          format: "text",
          conflictType: "same_hunk",
          summary: "Text merge produced overlapping hunks.",
          proposalRef: proposal.ref,
          mainlineRef,
          baseRef,
        }),
      };
    }

    if (buffersEqual(mainBuffer, mergedText.buffer)) {
      return { kind: "noop", relativePath };
    }

    return { kind: "write", relativePath, buffer: mergedText.buffer };
  }

  async mergeText({ relativePath, baseBuffer, mainBuffer, proposalBuffer }) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-merge-"));
    const currentPath = path.join(tempDir, "current");
    const basePath = path.join(tempDir, "base");
    const otherPath = path.join(tempDir, "other");

    try {
      await Promise.all([
        fs.writeFile(currentPath, mainBuffer),
        fs.writeFile(basePath, baseBuffer),
        fs.writeFile(otherPath, proposalBuffer),
      ]);
      const { stdout } = await execFileAsync("git", [
        "merge-file",
        "-p",
        "--diff3",
        currentPath,
        basePath,
        otherPath,
      ]);
      return { conflicted: false, buffer: Buffer.from(stdout, "utf8") };
    } catch (error) {
      if (error.code === 1) {
        return { conflicted: true, buffer: Buffer.from(error.stdout ?? "", "utf8"), file: relativePath };
      }

      throw error;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async applyOperations(operations) {
    for (const operation of operations) {
      const targetPath = path.join(this.repoRoot, operation.relativePath);
      if (operation.kind === "delete") {
        await fs.rm(targetPath, { force: true });
        continue;
      }

      await ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, operation.buffer);
    }
  }
}
