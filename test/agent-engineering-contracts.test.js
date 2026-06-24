import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ContractValidationError, validateArtifact } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureRoot = path.resolve(__dirname, "../templates/artifacts");

const artifactContracts = [
  {
    type: "research-harness-state",
    invalidate: (artifact) => {
      delete artifact.output_validation.status;
    },
  },
  {
    type: "context-manifest",
    invalidate: (artifact) => {
      artifact.blocks[0].hash = "";
    },
  },
  {
    type: "agent-trace",
    invalidate: (artifact) => {
      artifact.events[0].type = "unknown";
    },
  },
  {
    type: "state-store-snapshot",
    invalidate: (artifact) => {
      delete artifact.active_path.current_stage;
    },
  },
  {
    type: "cache-observability-report",
    invalidate: (artifact) => {
      artifact.provider_metrics.cached_tokens = -1;
    },
  },
  {
    type: "governance-report",
    invalidate: (artifact) => {
      artifact.source_graph[0].trust_level = "unknown";
    },
  },
  {
    type: "protocol-dag",
    invalidate: (artifact) => {
      artifact.edges[0].to = "missing-node";
    },
  },
  {
    type: "serving-profile",
    invalidate: (artifact) => {
      artifact.calls[0].latency_ms = -1;
    },
  },
  {
    type: "latent-communication-experiment",
    invalidate: (artifact) => {
      delete artifact.safety.checks;
    },
  },
];

async function loadFixture(type) {
  const fixturePath = path.join(fixtureRoot, `${type}.json`);
  const rawFixture = await fs.readFile(fixturePath, "utf8");
  return JSON.parse(rawFixture);
}

function cloneArtifact(artifact) {
  return JSON.parse(JSON.stringify(artifact));
}

for (const contract of artifactContracts) {
  test(`${contract.type} fixture is valid`, async () => {
    const artifact = await loadFixture(contract.type);

    assert.equal(validateArtifact(contract.type, artifact), artifact);
  });

  test(`${contract.type} rejects malformed artifacts`, async () => {
    const artifact = cloneArtifact(await loadFixture(contract.type));
    contract.invalidate(artifact);

    assert.throws(
      () => validateArtifact(contract.type, artifact),
      (error) => error instanceof ContractValidationError,
    );
  });
}
