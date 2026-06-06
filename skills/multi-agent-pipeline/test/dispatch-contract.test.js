import assert from "node:assert/strict";
import test from "node:test";

import { ContractValidationError, validateArtifact } from "../src/index.js";

function makeWorkerGroups(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      group_id: `group-${id}`,
      tasks: [`TASK-${String(id).padStart(3, "0")}`],
      owned_files: [`src/group-${id}.js`],
      depends_on_groups: [],
      required_skills: [],
    };
  });
}

function makeDispatchArtifact(groupCount) {
  const workerGroups = makeWorkerGroups(groupCount);

  return {
    version: "1.0",
    spec_ref: "spec.json",
    plan_ref: "plan.json",
    architecture_ref: "architecture.json",
    worker_groups: workerGroups,
    execution_waves: [
      {
        wave: 1,
        groups: workerGroups.map((group) => group.group_id),
      },
    ],
    integration_strategy: {
      merge_mode: "three_way",
      conflict_policy: "pause_for_human",
      base_strategy: "wave_start_snapshot",
    },
    rationale: "Focused fixture for dispatch fanout validation.",
  };
}

test("dispatch validation accepts a 6-group execution wave", () => {
  const dispatch = makeDispatchArtifact(6);

  assert.equal(validateArtifact("dispatch", dispatch), dispatch);
});

test("dispatch validation rejects a 7-group execution wave", () => {
  const dispatch = makeDispatchArtifact(7);

  assert.throws(
    () => validateArtifact("dispatch", dispatch),
    (error) =>
      error instanceof ContractValidationError &&
      /max of 6 groups per wave/.test(error.message),
  );
});
