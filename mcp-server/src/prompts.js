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

export const METHODOLOGY_PROMPTS = [
  ["pipeline/methodology/brainstorming", "brainstorming.md", "Brainstorming Methodology"],
  ["pipeline/methodology/frontend-design", "frontend-design.md", "Frontend Design Methodology"],
  ["pipeline/methodology/superpowers", "superpowers.md", "Superpowers Methodology"],
];

export function listPrompts() {
  return [
    ...STAGE_PROMPTS.map(([name, , title]) => ({
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
    })),
    ...METHODOLOGY_PROMPTS.map(([name, , title]) => ({
      name,
      title,
      description: `Multi-Agent Pipeline internal ${title.toLowerCase()}.`,
      arguments: [
        {
          name: "runId",
          description: "Optional durable run ID to include in the prompt context.",
          required: false,
        },
      ],
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getPrompt(name, args = {}, { skillRoot }) {
  const stageEntry = STAGE_PROMPTS.find(([promptName]) => promptName === name);
  const methodologyEntry = METHODOLOGY_PROMPTS.find(([promptName]) => promptName === name);
  const entry = stageEntry ?? methodologyEntry;
  if (!entry) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const [, fileName, title] = entry;
  const promptPath = stageEntry
    ? path.join(skillRoot, "agents", fileName)
    : path.join(skillRoot, "references", "methodologies", fileName);
  const promptText = await fs.readFile(promptPath, "utf8");
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
