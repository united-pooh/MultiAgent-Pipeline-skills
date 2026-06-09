import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_STAGE_PROFILES } from "./constants.js";

function cloneReference(reference) {
  return { ...reference };
}

function parseJsonReference(reference) {
  try {
    return JSON.parse(reference.contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${reference.relativePath}: ${error.message}`);
  }
}

export function resolveDefaultSkillPaths({ overrides = {} } = {}) {
  return { ...overrides };
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

  resolveStageProfile(stage, { reviewerId = null, reviewMode = null, graderId = null } = {}) {
    const profile = this.stageProfiles[stage];
    if (!profile) {
      throw new Error(`Unknown stage profile: ${stage}`);
    }

    return { ...profile };
  }

  resolveRequiredSkills(stage, { workerGroup = null } = {}) {
    if (stage === "spec" || stage === "plan") {
      return [];
    }

    if ((stage === "execution" || stage === "review") && workerGroup) {
      return (workerGroup.required_skills ?? []).map((skillName) => ({
        name: skillName,
        source: "skill-internal-capability",
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
    const artifactTemplate = profile.artifactTemplateFile
      ? await this.readRelativeFile(profile.artifactTemplateFile)
      : null;

    return {
      stage,
      requestKey: buildStageRequestKey(stage, context),
      profile,
      prompt: cloneReference(prompt),
      references: references.map(cloneReference),
      artifactTemplate: artifactTemplate
        ? {
            ...cloneReference(artifactTemplate),
            artifact: parseJsonReference(artifactTemplate),
          }
        : null,
      requiredSkills: this.resolveRequiredSkills(stage, context),
      context: { ...context },
      repoRoot: this.repoRoot,
    };
  }
}

export function buildStageRequestKey(stage, context = {}) {
  if (stage === "tree-grading") {
    return `${stage}:${context.workerGroup?.group_id ?? "unknown"}:iteration-${context.iteration ?? "?"}:grader-${context.graderId ?? "?"}`;
  }

  if (stage.startsWith("tree-")) {
    return `${stage}:${context.workerGroup?.group_id ?? "unknown"}:iteration-${context.iteration ?? "?"}`;
  }

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
