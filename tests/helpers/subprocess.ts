import { spawnSync, spawn, type ChildProcess } from "node:child_process";

// spawnSync blocks until the child exits and reaps it, so the returned pid
// belongs to a process that is no longer alive. PID reuse inside a single test
// window is vanishingly unlikely, which makes this a deterministic dead pid.
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "0"]);
  if (typeof r.pid !== "number") throw new Error("spawnSync returned no pid");
  return r.pid;
}

// Spawn a real detached Node child that runs `code` (an inline -e script) and
// keeps running until the test kills it. The caller is responsible for killing
// the returned child; it is detached so a parent crash never orphans the test.
export function spawnChild(
  code: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  return spawn(process.execPath, ["-e", code], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Resolve once the child has printed `marker` on stdout, or reject on timeout.
// Lets a test wait for "the child has acquired the lock" before killing it.
export function waitForMarker(
  child: ChildProcess,
  marker: string,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`marker "${marker}" not seen within ${timeoutMs}ms; saw: ${buf}`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      buf += String(d);
      if (buf.includes(marker)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error(`child exited before printing "${marker}"; saw: ${buf}`));
    });
  });
}

// Wait for a child to exit and resolve with its exit code / signal.
export function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}
