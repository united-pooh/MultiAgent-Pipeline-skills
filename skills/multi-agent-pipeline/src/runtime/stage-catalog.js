import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_STAGE_PROFILES, defaultCodexHome } from "./constants.js";

const SKILL_RELATIVE_PATHS = Object.freeze({
  superpowers: "skills/superpowers/SKILL.md",
  "ce-frontend-design": "skills/ce-frontend-design/SKILL.md",
});

function cloneReference(reference) {
  return { ...reference };
}

export function resolveDefaultSkillPaths({ codexHome = defaultCodexHome(), overrides = {} } = {}) {
  return {
    superpowers: path.join(codexHome, SKILL_RELATIVE_PATHS.superpowers),
    "ce-frontend-design": path.join(codexHome, SKILL_RELATIVE_PATHS["ce-frontend-design"]),
    ...overrides,
  };
}

export class StageCatalog {
  constructor(repoRoot, { stageProfiles = DEFAULT_STAGE_PROFILES, skillPaths } = {}) {
    this.repoRoot = repoRoot;
    this.stageProfiles = stageProfiles;
    this.skillPaths = resolveDefaultSkillPaths({ overrides: skillPaths });
    this.cache = new Map();
  }

  async readRelativeFile(relativePath) {
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath);
    }

    const absolutePath = path.join(this.repoRoot, relativePath);
    const contents = await fs.readFile(absolutePath, "utf8");
    const value = { absolutePath, relativePath, contents };
    this.cache.set(relativePath, value);
    return value;
  }

  resolveStageProfile(stage, { reviewerId = null, reviewMode = null } = {}) {
    const profile = this.stageProfiles[stage];
    if (!profile) {
      throw new Error(`Unknown stage profile: ${stage}`);
    }

    return { ...profile };
  }

  resolveRequiredSkills(stage, { workerGroup = null } = {}) {
    if (stage === "spec" || stage === "plan") {
      return [
        {
          name: "superpowers",
          path: this.skillPaths.superpowers,
        },
      ];
    }

    if ((stage === "execution" || stage === "review") && workerGroup) {
      return (workerGroup.required_skills ?? []).map((skillName) => ({
        name: skillName,
        path: this.skillPaths[skillName],
      }));
    }

    return [];
  }

  async buildStageRequest(stage, context = {}) {
    const profile = this.resolveStageProfile(stage, context);
    const prompt = await this.readRelativeFile(profile.promptFile);
    const references = await Promise.all(
      (profile.referenceFiles ?? []).map((referencePath) => this.readRelativeFile(referencePath)),
    );

    return {
      stage,
      requestKey: buildStageRequestKey(stage, context),
      profile,
      prompt: cloneReference(prompt),
      references: references.map(cloneReference),
      requiredSkills: this.resolveRequiredSkills(stage, context),
      context: { ...context },
      repoRoot: this.repoRoot,
    };
  }
}

export function buildStageRequestKey(stage, context = {}) {
  if (stage === "review") {
    return `${stage}:${context.workerGroup?.group_id ?? "unknown"}:iteration-${context.iteration ?? "?"}:reviewer-${context.reviewerId ?? "?"}`;
  }

  if (stage === "execution" || stage === "validation" || stage === "qa") {
    return `${stage}:${context.workerGroup?.group_id ?? "unknown"}:iteration-${context.iteration ?? "?"}`;
  }

  return stage;
}

export function loadStageCatalog(repoRoot, options = {}) {
  return new StageCatalog(repoRoot, options);
}
