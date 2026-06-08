import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SKILL_RELATIVE_PATH = path.join("skills", "multi-agent-pipeline");
export const MCP_SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function uniquePaths(paths) {
  return Array.from(new Set(paths.map((entry) => path.resolve(entry))));
}

export function resolveRepoRoot(repoRoot, { cwd = process.cwd(), env = process.env } = {}) {
  return path.resolve(repoRoot ?? env.MULTI_AGENT_PIPELINE_REPO_ROOT ?? cwd);
}

export function skillRootCandidates({ repoRoot, packageRoot = MCP_SERVER_ROOT }) {
  return uniquePaths([
    path.join(repoRoot, DEFAULT_SKILL_RELATIVE_PATH),
    path.resolve(packageRoot, "..", DEFAULT_SKILL_RELATIVE_PATH),
    path.join(packageRoot, DEFAULT_SKILL_RELATIVE_PATH),
  ]);
}

export function resolveSkillRoot({
  repoRoot,
  skillRoot,
  env = process.env,
  packageRoot = MCP_SERVER_ROOT,
  existsSync = fs.existsSync,
} = {}) {
  if (skillRoot) {
    const resolved = path.resolve(skillRoot);
    if (!existsSync(resolved)) {
      throw new Error(`Skill root does not exist: ${resolved}`);
    }
    return resolved;
  }

  if (env.MULTI_AGENT_PIPELINE_SKILL_ROOT) {
    const resolved = path.resolve(env.MULTI_AGENT_PIPELINE_SKILL_ROOT);
    if (!existsSync(resolved)) {
      throw new Error(`MULTI_AGENT_PIPELINE_SKILL_ROOT does not exist: ${resolved}`);
    }
    return resolved;
  }

  const resolvedRepoRoot = resolveRepoRoot(repoRoot, { env });
  const candidates = skillRootCandidates({ repoRoot: resolvedRepoRoot, packageRoot });
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Unable to locate multi-agent-pipeline skill root. Checked: ${candidates.join(", ")}`,
    );
  }

  return found;
}

export function resolveMcpPaths(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot, options);
  const skillRoot = resolveSkillRoot({
    ...options,
    repoRoot,
  });

  return {
    repoRoot,
    skillRoot,
  };
}
