import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type RepositoryFingerprint = {
  baseCommit: string;
  headCommit?: string;
  patchHash: string;
  changedFiles: string[];
};

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function gitFingerprint(workspace: string, baseCommit: string): Promise<RepositoryFingerprint> {
  // Binary evidence can exceed execFile's buffer; hash every byte without buffering the patch.
  const patchHash = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn("git", ["diff", "--binary", baseCommit, "--"], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`git diff failed (${code}): ${stderr.trim()}`));
      else resolve(`sha256:${hash.digest("hex")}`);
    });
  });
  // NUL-separated path output preserves Unicode and leading/trailing spaces.
  const { stdout: files } = await exec("git", ["diff", "--name-only", "-z", baseCommit, "--"], { cwd: workspace, maxBuffer: 20 * 1024 * 1024 });
  const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd: workspace });
  return {
    baseCommit,
    headCommit: head.trim() || undefined,
    patchHash,
    changedFiles: files.split("\0").filter(Boolean),
  };
}

export async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}
