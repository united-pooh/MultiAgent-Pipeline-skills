import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..", "..");
export const skillRoot = path.join(repoRoot, "skills", "multi-agent-pipeline");

export async function createTempRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-mcp-repo-"));
  await fs.mkdir(path.join(tempRoot, "skills"), { recursive: true });
  await fs.symlink(skillRoot, path.join(tempRoot, "skills", "multi-agent-pipeline"));
  return tempRoot;
}

export function fixedClock() {
  return new Date("2026-06-06T12:00:00.000Z");
}
