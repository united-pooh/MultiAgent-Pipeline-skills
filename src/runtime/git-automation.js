import { execFile } from "node:child_process";

export const DEFAULT_GITMOJI_BY_TYPE = {
  feat: ":sparkles:",
  fix: ":wrench:",
  docs: ":memo:",
  refactor: ":wrench:",
  test: ":white_check_mark:",
  chore: ":hammer:",
};

export const DEFAULT_GIT_PUBLICATION_POLICY = {
  enabled: false,
  remote: "origin",
  failureMode: "throw",
  doc: {
    enabled: true,
    commit: true,
    push: false,
    type: "docs",
    scope: "pipeline",
    gitmoji: ":memo:",
    description: "更新流水线交付文档",
    paths: "updated_files",
  },
  cleanup: {
    enabled: true,
    commit: true,
    push: true,
    type: "feat",
    scope: "pipeline",
    gitmoji: ":sparkles:",
    description: "完成流水线交付",
    paths: "all",
  },
};

function cleanSubjectPart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMessageLines(lines = []) {
  return lines
    .flatMap((line) => String(line ?? "").split("\n"))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

export function formatConventionalGitmojiCommitMessage({
  type = "chore",
  scope = null,
  gitmoji = null,
  description,
  body = [],
  footers = [],
} = {}) {
  const normalizedType = cleanSubjectPart(type);
  const normalizedScope = cleanSubjectPart(scope);
  const normalizedDescription = cleanSubjectPart(description);
  const normalizedGitmoji = cleanSubjectPart(gitmoji ?? DEFAULT_GITMOJI_BY_TYPE[normalizedType]);

  if (!normalizedType) {
    throw new Error("Commit message type is required");
  }

  if (!normalizedDescription) {
    throw new Error("Commit message description is required");
  }

  const prefix = normalizedScope
    ? `${normalizedType}(${normalizedScope})`
    : normalizedType;
  const subject = `${prefix}: ${[normalizedGitmoji, normalizedDescription].filter(Boolean).join(" ")}`;
  const bodyLines = cleanMessageLines(body);
  const footerLines = cleanMessageLines(footers);
  const sections = [subject];

  if (bodyLines.length > 0) {
    sections.push(bodyLines.join("\n"));
  }

  if (footerLines.length > 0) {
    sections.push(footerLines.join("\n"));
  }

  return `${sections.join("\n\n")}\n`;
}

function normalizePhasePolicy(defaultPhase, override) {
  if (override === false) {
    return {
      ...defaultPhase,
      enabled: false,
    };
  }

  if (override === true || override === undefined || override === null) {
    return {
      ...defaultPhase,
    };
  }

  return {
    ...defaultPhase,
    ...override,
    enabled: override.enabled ?? defaultPhase.enabled,
  };
}

export function normalizeGitPublicationPolicy(policy = null) {
  if (!policy || policy.enabled !== true) {
    return {
      ...DEFAULT_GIT_PUBLICATION_POLICY,
      doc: { ...DEFAULT_GIT_PUBLICATION_POLICY.doc },
      cleanup: { ...DEFAULT_GIT_PUBLICATION_POLICY.cleanup },
      enabled: false,
    };
  }

  const remote = policy.remote ?? DEFAULT_GIT_PUBLICATION_POLICY.remote;
  const failureMode = policy.failureMode ?? DEFAULT_GIT_PUBLICATION_POLICY.failureMode;
  const defaultDoc = {
    ...DEFAULT_GIT_PUBLICATION_POLICY.doc,
    push: policy.push ?? DEFAULT_GIT_PUBLICATION_POLICY.doc.push,
  };
  const defaultCleanup = {
    ...DEFAULT_GIT_PUBLICATION_POLICY.cleanup,
    push: policy.push ?? DEFAULT_GIT_PUBLICATION_POLICY.cleanup.push,
  };

  return {
    enabled: true,
    remote,
    failureMode,
    doc: normalizePhasePolicy(defaultDoc, policy.doc),
    cleanup: normalizePhasePolicy(defaultCleanup, policy.cleanup),
  };
}

function gitCommandText(args) {
  return `git ${args.join(" ")}`;
}

export function defaultRunGitCommand({ repoRoot, args, allowExitCodes = [0] }) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoRoot, encoding: "utf8" }, (error, stdout, stderr) => {
      const exitCode = typeof error?.code === "number" ? error.code : 0;
      const result = {
        args,
        exitCode,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      };

      if (!allowExitCodes.includes(exitCode)) {
        const gitError = new Error(
          `${gitCommandText(args)} failed with exit code ${exitCode}: ${result.stderr || result.stdout}`,
        );
        gitError.result = result;
        reject(gitError);
        return;
      }

      resolve(result);
    });
  });
}

export class GitAutomation {
  constructor({ repoRoot, runGitCommand = defaultRunGitCommand }) {
    if (!repoRoot) {
      throw new Error("GitAutomation requires repoRoot");
    }

    this.repoRoot = repoRoot;
    this.runGitCommand = runGitCommand;
  }

  git(args, options = {}) {
    return this.runGitCommand({
      repoRoot: this.repoRoot,
      args,
      ...options,
    });
  }

  async currentBranch() {
    const result = await this.git(["branch", "--show-current"]);
    return result.stdout.trim();
  }

  async hasChanges(paths = []) {
    const args = ["status", "--porcelain"];
    if (paths.length > 0) {
      args.push("--", ...paths);
    }

    const result = await this.git(args);
    return result.stdout.trim() !== "";
  }

  async hasStagedChanges() {
    const result = await this.git(["diff", "--cached", "--quiet"], {
      allowExitCodes: [0, 1],
    });
    return result.exitCode === 1;
  }

  async commit({ message, paths = [] }) {
    if (!(await this.hasChanges(paths))) {
      return {
        status: "skipped",
        reason: "no_changes",
      };
    }

    if (paths.length > 0) {
      await this.git(["add", "--", ...paths]);
    } else {
      await this.git(["add", "-A"]);
    }

    if (!(await this.hasStagedChanges())) {
      return {
        status: "skipped",
        reason: "no_staged_changes",
      };
    }

    await this.git(["commit", "-m", message.trimEnd()]);
    return {
      status: "committed",
    };
  }

  async push({ remote = "origin", branch = null } = {}) {
    const targetBranch = branch ?? (await this.currentBranch());
    if (!targetBranch) {
      throw new Error("Cannot push from a detached HEAD without an explicit branch");
    }

    await this.git(["push", remote, targetBranch]);
    return {
      status: "pushed",
      remote,
      branch: targetBranch,
    };
  }

  async commitAndMaybePush({ message, paths = [], push = false, remote = "origin", branch = null }) {
    const commitResult = await this.commit({ message, paths });

    if (commitResult.status !== "committed") {
      return {
        ...commitResult,
        pushed: false,
      };
    }

    if (!push) {
      return {
        ...commitResult,
        pushed: false,
      };
    }

    const pushResult = await this.push({ remote, branch });
    return {
      ...commitResult,
      pushed: true,
      remote: pushResult.remote,
      branch: pushResult.branch,
    };
  }
}
