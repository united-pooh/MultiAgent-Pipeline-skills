import fs from "node:fs/promises";
import path from "node:path";

export const STAGE_PROMPTS = [
  ["pipeline/spec", "spec.md", "Spec"],
  ["pipeline/plan", "plan.md", "Plan"],
  ["pipeline/architecture", "architecture.md", "Architecture"],
  ["pipeline/dispatch", "dispatch.md", "Dispatch"],
  ["pipeline/execution", "execution.md", "Execution"],
  ["pipeline/validation", "validation.md", "Validation"],
  ["pipeline/tree-classification", "tree-classification.md", "Tree Classification"],
  ["pipeline/tree-rubric-generation", "tree-rubric-generation.md", "Tree Rubric Generation"],
  ["pipeline/tree-rubric-verification", "tree-rubric-verification.md", "Tree Rubric Verification"],
  ["pipeline/tree-rubric-refinement", "tree-rubric-refinement.md", "Tree Rubric Refinement"],
  ["pipeline/tree-grading", "tree-grading.md", "Tree Grading"],
  ["pipeline/qa", "qa.md", "QA"],
  ["pipeline/doc", "doc.md", "Documentation"],
  ["pipeline/final-assessment", "final-assessment.md", "Final Assessment"],
];

export function listPrompts() {
  return STAGE_PROMPTS.map(([name, , title]) => ({
    name,
    title,
    description: `Multi-Agent Pipeline ${title} stage prompt.`,
    arguments: [
      {
        name: "runId",
        description: "Optional durable run ID to include in the prompt context.",
        required: false,
      },
    ],
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getPrompt(name, args = {}, { skillRoot }) {
  const entry = STAGE_PROMPTS.find(([promptName]) => promptName === name);
  if (!entry) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const [, fileName, title] = entry;
  const promptText = await fs.readFile(path.join(skillRoot, "agents", fileName), "utf8");
  const runContext = args.runId ? `\n\nDurable run ID: ${args.runId}` : "";
  return {
    description: `Multi-Agent Pipeline ${title} prompt.`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${promptText}${runContext}`,
        },
      },
    ],
  };
}
