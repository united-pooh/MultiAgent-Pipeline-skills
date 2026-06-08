import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_SKILL_RELATIVE_PATH,
  resolveMcpPaths,
  resolveRepoRoot,
  resolveSkillRoot,
  skillRootCandidates,
} from "../src/paths.js";

test("resolveRepoRoot uses explicit, env, then cwd", () => {
  assert.equal(resolveRepoRoot("/tmp/explicit", { cwd: "/tmp/cwd", env: {} }), "/tmp/explicit");
  assert.equal(
    resolveRepoRoot(undefined, {
      cwd: "/tmp/cwd",
      env: { MULTI_AGENT_PIPELINE_REPO_ROOT: "/tmp/env-repo" },
    }),
    "/tmp/env-repo",
  );
  assert.equal(resolveRepoRoot(undefined, { cwd: "/tmp/cwd", env: {} }), "/tmp/cwd");
});

test("resolveSkillRoot uses explicit and env before discovered candidates", () => {
  assert.equal(
    resolveSkillRoot({
      repoRoot: "/tmp/repo",
      skillRoot: "/tmp/explicit-skill",
      env: { MULTI_AGENT_PIPELINE_SKILL_ROOT: "/tmp/env-skill" },
      existsSync: () => true,
    }),
    "/tmp/explicit-skill",
  );
  assert.equal(
    resolveSkillRoot({
      repoRoot: "/tmp/repo",
      env: { MULTI_AGENT_PIPELINE_SKILL_ROOT: "/tmp/env-skill" },
      existsSync: () => true,
    }),
    "/tmp/env-skill",
  );
});

test("resolveSkillRoot fails fast when no candidate exists", () => {
  assert.throws(
    () =>
      resolveSkillRoot({
        repoRoot: "/tmp/missing-repo",
        packageRoot: "/tmp/missing-package",
        env: {},
        existsSync: () => false,
      }),
    /Unable to locate multi-agent-pipeline skill root/,
  );
  assert.throws(
    () =>
      resolveSkillRoot({
        skillRoot: "/tmp/missing-skill",
        env: {},
        existsSync: () => false,
      }),
    /Skill root does not exist/,
  );
});

test("resolveSkillRoot prefers repo checkout resources and falls back to bundled resources", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-mcp-paths-"));
  const repoRoot = path.join(tempRoot, "workspace");
  const packageRoot = path.join(tempRoot, "package", "mcp-server");
  const repoSkillRoot = path.join(repoRoot, DEFAULT_SKILL_RELATIVE_PATH);
  const bundledSkillRoot = path.resolve(packageRoot, "..", DEFAULT_SKILL_RELATIVE_PATH);

  await fs.mkdir(repoSkillRoot, { recursive: true });
  await fs.mkdir(bundledSkillRoot, { recursive: true });

  assert.equal(resolveSkillRoot({ repoRoot, packageRoot, env: {} }), repoSkillRoot);

  await fs.rm(repoSkillRoot, { recursive: true, force: true });
  assert.equal(resolveSkillRoot({ repoRoot, packageRoot, env: {} }), bundledSkillRoot);
});

test("resolveMcpPaths returns portable public defaults", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-mcp-defaults-"));
  const repoRoot = path.join(tempRoot, "repo");
  const skillRoot = path.join(repoRoot, DEFAULT_SKILL_RELATIVE_PATH);
  await fs.mkdir(skillRoot, { recursive: true });

  const resolved = resolveMcpPaths({
    cwd: repoRoot,
    env: {},
  });

  assert.deepEqual(resolved, {
    repoRoot,
    skillRoot,
  });
  assert.deepEqual(skillRootCandidates({ repoRoot }).slice(0, 1), [skillRoot]);
});
