/**
 * Sync compile live-lock helpers.
 *
 * A lock must protect a real running sync process, but it must not permanently
 * block the app after the parent process is interrupted by a stop action,
 * desktop shutdown, or an external provider/quota failure. New locks therefore
 * include both PID and script path so a future run can distinguish a still-live
 * sync process from a recycled PID owned by another command.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Creates the on-disk lock payload for the current sync compile process.
 */
export function createLockFileContent(now = new Date()) {
  return `${JSON.stringify({
    pid: process.pid,
    script: process.argv[1] ? path.resolve(process.argv[1]) : "",
    createdAt: now.toISOString(),
  })}\n`;
}

/**
 * Returns true only when a lock can be safely removed before a new sync starts.
 */
export async function canClearStaleLock(lockText, options = {}) {
  const lock = parseLockInfo(lockText);
  const pid = lock.pid;
  if (!Number.isInteger(pid) || pid <= 0) return true;

  const processExists = options.processExists ?? isProcessAlive;
  if (!processExists(pid)) {
    return true;
  }

  if (!lock.script) return false;
  const readCommandLine = options.readCommandLine ?? readProcessCommandLine;
  const commandLine = await readCommandLine(pid);
  if (!commandLine) return false;
  return !normalizeForCommandMatch(commandLine).includes(
    normalizeForCommandMatch(lock.script),
  );
}

/**
 * Formats a lock owner for user-facing "already running" errors.
 */
export function formatLockOwner(lockText) {
  const lock = parseLockInfo(lockText);
  if (!lock.pid) return "unknown";
  return lock.script ? `${lock.pid} (${lock.script})` : String(lock.pid);
}

function parseLockInfo(lockText) {
  const raw = lockText.trim();
  if (!raw.startsWith("{")) {
    return { pid: Number(raw), script: "" };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      pid: Number(parsed?.pid),
      script: typeof parsed?.script === "string" ? path.resolve(parsed.script) : "",
    };
  } catch {
    return { pid: Number(raw), script: "" };
  }
}

function normalizeForCommandMatch(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessCommandLine(pid) {
  if (process.platform === "win32") {
    return readWindowsProcessCommandLine(pid);
  }
  return readUnixProcessCommandLine(pid);
}

async function readWindowsProcessCommandLine(pid) {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { windowsHide: true },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readUnixProcessCommandLine(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
    return raw.replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}
