import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function writeJson(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, "utf8"));
}

export async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function sanitizeForPath(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function uniqueStrings(values) {
  return [...new Set(values)];
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function buffersEqual(left, right) {
  if (left === null && right === null) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return Buffer.compare(left, right) === 0;
}

export function isProbablyBinary(buffer) {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length > 0.3;
}

export async function copyDirectory(sourceDir, targetDir, { shouldIgnore = () => false } = {}) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (shouldIgnore(sourcePath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, { shouldIgnore });
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      await fs.symlink(linkTarget, targetPath);
      continue;
    }

    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function listFilesRecursive(rootDir, { shouldIgnore = () => false } = {}) {
  const results = [];

  async function walk(currentDir) {
    if (!(await pathExists(currentDir))) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (shouldIgnore(absolutePath, entry)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      results.push(absolutePath);
    }
  }

  await walk(rootDir);
  results.sort();
  return results;
}

export function formatShortList(items) {
  if (items.length === 0) {
    return "none";
  }

  return items.join(", ");
}
