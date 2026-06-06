import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RUNS_DIRECTORY = ".pipeline-runs";

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== null) {
      return fallback;
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export class RunStore {
  constructor({ repoRoot = process.cwd(), clock = () => new Date() } = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.clock = clock;
    this.runsRoot = path.join(this.repoRoot, RUNS_DIRECTORY);
    this.indexPath = path.join(this.runsRoot, "index.json");
  }

  now() {
    return this.clock().toISOString();
  }

  async ensureInitialized() {
    await fs.mkdir(this.runsRoot, { recursive: true });
    if (!(await pathExists(this.indexPath))) {
      await writeJson(this.indexPath, {
        version: "1.0",
        runs: [],
        idempotency: {},
      });
    }
  }

  async readIndex() {
    await this.ensureInitialized();
    return readJson(this.indexPath, {
      version: "1.0",
      runs: [],
      idempotency: {},
    });
  }

  async writeIndex(index) {
    await writeJson(this.indexPath, {
      version: "1.0",
      runs: Array.from(new Set(index.runs ?? [])).sort(),
      idempotency: index.idempotency ?? {},
    });
  }

  runDir(runId) {
    return path.join(this.runsRoot, safeSegment(runId));
  }

  async createRun({
    objective,
    input = {},
    thresholds = {},
    metadata = {},
    idempotencyKey = null,
    mode = "client_orchestrated",
  }) {
    if (typeof objective !== "string" || objective.trim() === "") {
      throw new Error("pipeline.start_run requires a non-empty objective");
    }

    await this.ensureInitialized();
    const normalizedThresholds = {
      maxRuntimeMs: thresholds.maxRuntimeMs ?? null,
      maxIterations: thresholds.maxIterations ?? null,
      budget: thresholds.budget ?? null,
    };
    const idempotencyHash = idempotencyKey
      ? hashValue({
          repoRoot: this.repoRoot,
          idempotencyKey,
        })
      : hashValue({
          repoRoot: this.repoRoot,
          objective: objective.trim(),
          input,
          thresholds: normalizedThresholds,
          mode,
        });
    const index = await this.readIndex();
    if (idempotencyKey) {
      for (const runId of index.runs ?? []) {
        const indexedRun = await readJson(path.join(this.runDir(runId), "run.json"), null);
        if (indexedRun?.repoRoot === this.repoRoot && indexedRun.idempotencyKey === idempotencyKey) {
          index.idempotency[idempotencyHash] = runId;
          await this.writeIndex(index);
          const existingRun = await this.getRun(runId);
          await this.appendEvent(runId, {
            type: "run.idempotent_key_hit",
            message: "Returned existing durable run for matching explicit idempotency key.",
          });
          return {
            ...existingRun,
            idempotent: true,
          };
        }
      }
    }

    const existingRunId = index.idempotency[idempotencyHash];
    if (existingRunId) {
      const existingRun = await this.getRun(existingRunId);
      await this.appendEvent(existingRunId, {
        type: "run.idempotent_hit",
        message: "Returned existing durable run for matching idempotency hash.",
      });
      return {
        ...existingRun,
        idempotent: true,
      };
    }

    const createdAt = this.now();
    const runId = `RUN-${compactTimestamp(new Date(createdAt))}-${idempotencyHash.slice(0, 8)}`;
    const runDir = this.runDir(runId);
    const run = {
      version: "1.0",
      runId,
      repoRoot: this.repoRoot,
      objective: objective.trim(),
      mode,
      idempotencyKey,
      idempotencyHash,
      status: "working",
      createdAt,
      updatedAt: createdAt,
    };
    const config = {
      version: "1.0",
      input,
      thresholds: normalizedThresholds,
      metadata,
    };
    const state = {
      version: "1.0",
      runId,
      status: "working",
      lifecycle: "ready_for_client_orchestration",
      currentStage: "created",
      currentIteration: 0,
      restartFrom: null,
      cancellation: null,
      humanInputs: [],
      stageRecords: [],
      checkpoints: [],
      researchRecords: [],
      updatedAt: createdAt,
    };

    await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });
    await fs.mkdir(path.join(runDir, "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(runDir, "research"), { recursive: true });
    await writeJson(path.join(runDir, "run.json"), run);
    await writeJson(path.join(runDir, "config.json"), config);
    await writeJson(path.join(runDir, "state.json"), state);
    await fs.writeFile(path.join(runDir, "events.jsonl"), "", "utf8");
    index.runs = Array.from(new Set([...(index.runs ?? []), runId])).sort();
    index.idempotency[idempotencyHash] = runId;
    await this.writeIndex(index);
    await this.appendEvent(runId, {
      type: "run.created",
      message: "Durable pipeline run created.",
      data: { objective: run.objective, thresholds: normalizedThresholds },
    });

    return this.getRun(runId);
  }

  async readState(runId) {
    return readJson(path.join(this.runDir(runId), "state.json"));
  }

  async writeState(runId, patch) {
    const state = await this.readState(runId);
    const updated = {
      ...state,
      ...patch,
      updatedAt: this.now(),
    };
    await writeJson(path.join(this.runDir(runId), "state.json"), updated);
    const run = await readJson(path.join(this.runDir(runId), "run.json"));
    await writeJson(path.join(this.runDir(runId), "run.json"), {
      ...run,
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
    return updated;
  }

  async appendEvent(runId, event) {
    const entry = {
      time: this.now(),
      runId,
      ...event,
    };
    await fs.appendFile(
      path.join(this.runDir(runId), "events.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    return entry;
  }

  async readEvents(runId) {
    const eventsPath = path.join(this.runDir(runId), "events.jsonl");
    if (!(await pathExists(eventsPath))) {
      return [];
    }

    const text = await fs.readFile(eventsPath, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  }

  async getRun(runId) {
    const runDir = this.runDir(runId);
    const [run, config, state, events] = await Promise.all([
      readJson(path.join(runDir, "run.json")),
      readJson(path.join(runDir, "config.json")),
      readJson(path.join(runDir, "state.json")),
      this.readEvents(runId),
    ]);
    return {
      run,
      config,
      state,
      events,
    };
  }

  async listRuns() {
    const index = await this.readIndex();
    const runs = [];
    for (const runId of index.runs ?? []) {
      const run = await readJson(path.join(this.runDir(runId), "run.json"), null);
      if (run) {
        runs.push(run);
      }
    }

    runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return runs;
  }

  async cancelRun({ runId, reason = "cancelled by MCP client" }) {
    const state = await this.writeState(runId, {
      status: "cancelled",
      lifecycle: "cancelled",
      cancellation: {
        reason,
        cancelledAt: this.now(),
      },
    });
    await this.appendEvent(runId, {
      type: "run.cancelled",
      message: reason,
    });
    return this.getRun(state.runId);
  }

  async resumeRun({ runId, reason = "resumed by MCP client" }) {
    const state = await this.writeState(runId, {
      status: "working",
      lifecycle: "ready_for_client_orchestration",
      cancellation: null,
    });
    await this.appendEvent(runId, {
      type: "run.resumed",
      message: reason,
    });
    return this.getRun(state.runId);
  }

  async submitHumanInput({ runId, input, note = "" }) {
    const state = await this.readState(runId);
    const entry = {
      id: `input-${String(state.humanInputs.length + 1).padStart(3, "0")}`,
      time: this.now(),
      note,
      input,
    };
    await this.writeState(runId, {
      humanInputs: [...state.humanInputs, entry],
    });
    await this.appendEvent(runId, {
      type: "human_input.submitted",
      message: note || "Human input submitted.",
      data: { id: entry.id },
    });
    return entry;
  }

  async recordStage({ runId, stage, status = "recorded", artifactType = null, payload = {} }) {
    if (typeof stage !== "string" || stage.trim() === "") {
      throw new Error("pipeline.run_stage requires a stage name");
    }

    const state = await this.readState(runId);
    const safeStage = safeSegment(stage);
    const artifactName = `${safeStage}-${String(state.stageRecords.length + 1).padStart(3, "0")}.json`;
    const artifactRef = path.posix.join("artifacts", artifactName);
    const artifactPath = path.join(this.runDir(runId), artifactRef);
    const record = {
      id: `stage-${String(state.stageRecords.length + 1).padStart(3, "0")}`,
      stage,
      status,
      artifactType,
      artifactRef,
      recordedAt: this.now(),
    };
    await writeJson(artifactPath, payload);
    await this.writeState(runId, {
      currentStage: stage,
      currentIteration: Math.max(state.currentIteration, payload?.iteration ?? 0),
      stageRecords: [...state.stageRecords, record],
    });
    await this.appendEvent(runId, {
      type: "stage.recorded",
      message: `${stage} recorded with status ${status}.`,
      data: record,
    });
    return record;
  }

  async recordResearch({ runId = null, query, sources = [], fetchSources = false, notes = [] }) {
    if (typeof query !== "string" || query.trim() === "") {
      throw new Error("pipeline.research requires a non-empty query");
    }

    const baseDir = runId
      ? path.join(this.runDir(runId), "research")
      : path.join(this.runsRoot, "research");
    await fs.mkdir(baseDir, { recursive: true });
    const fetchedSources = [];
    if (fetchSources) {
      for (const source of sources) {
        const url = typeof source === "string" ? source : source.url;
        if (!url) {
          continue;
        }

        try {
          const response = await fetch(url);
          const text = await response.text();
          fetchedSources.push({
            url,
            status: response.status,
            fetchedAt: this.now(),
            excerpt: text.slice(0, 4000),
          });
        } catch (error) {
          fetchedSources.push({
            url,
            status: "error",
            fetchedAt: this.now(),
            error: error.message,
          });
        }
      }
    }

    const record = {
      version: "1.0",
      id: `research-${compactTimestamp(this.clock())}-${hashValue({ query, sources }).slice(0, 8)}`,
      runId,
      query: query.trim(),
      sources,
      fetchedSources,
      notes,
      createdAt: this.now(),
    };
    const recordPath = path.join(baseDir, `${record.id}.json`);
    await writeJson(recordPath, record);
    if (runId) {
      const state = await this.readState(runId);
      await this.writeState(runId, {
        researchRecords: [...state.researchRecords, path.posix.join("research", `${record.id}.json`)],
      });
      await this.appendEvent(runId, {
        type: "research.recorded",
        message: `Research recorded: ${record.query}`,
        data: { id: record.id },
      });
    }

    return record;
  }

  async commitCheckpoint({
    runId,
    message,
    paths = [],
    dryRun = true,
    allowEmpty = false,
  }) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new Error("pipeline.commit_checkpoint requires a commit message");
    }

    const state = await this.readState(runId);
    const checkpoint = {
      id: `checkpoint-${String(state.checkpoints.length + 1).padStart(3, "0")}`,
      message: message.trim(),
      paths,
      dryRun,
      allowEmpty,
      createdAt: this.now(),
      status: "recorded",
      commit: null,
    };

    if (!dryRun) {
      if (paths.length > 0) {
        await execFileAsync("git", ["add", "--", ...paths], { cwd: this.repoRoot });
      } else {
        await execFileAsync("git", ["add", "-A"], { cwd: this.repoRoot });
      }

      const args = ["commit", "-m", checkpoint.message];
      if (allowEmpty) {
        args.splice(1, 0, "--allow-empty");
      }
      await execFileAsync("git", args, { cwd: this.repoRoot });
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.repoRoot });
      checkpoint.status = "committed";
      checkpoint.commit = stdout.trim();
    }

    await writeJson(
      path.join(this.runDir(runId), "checkpoints", `${checkpoint.id}.json`),
      checkpoint,
    );
    await this.writeState(runId, {
      checkpoints: [...state.checkpoints, checkpoint],
    });
    await this.appendEvent(runId, {
      type: "git.checkpoint",
      message: checkpoint.status,
      data: checkpoint,
    });
    return checkpoint;
  }

  async inspectWorkspace() {
    const workspacePath = path.join(this.repoRoot, ".pipeline-workspace");
    const summaryPath = path.join(this.repoRoot, ".pipeline-last-run-summary.json");
    return {
      repoRoot: this.repoRoot,
      runsRoot: this.runsRoot,
      workspaceExists: await pathExists(workspacePath),
      runsRootExists: await pathExists(this.runsRoot),
      lastRunSummaryExists: await pathExists(summaryPath),
      installedSkillPath: path.join(os.homedir(), ".codex", "skills", "multi-agent-pipeline"),
    };
  }

  async exportSummary(runId) {
    const { run, config, state, events } = await this.getRun(runId);
    return {
      runId,
      objective: run.objective,
      status: state.status,
      lifecycle: state.lifecycle,
      thresholds: config.thresholds,
      currentStage: state.currentStage,
      currentIteration: state.currentIteration,
      stageRecordCount: state.stageRecords.length,
      checkpointCount: state.checkpoints.length,
      researchRecordCount: state.researchRecords.length,
      eventCount: events.length,
      updatedAt: state.updatedAt,
    };
  }
}
