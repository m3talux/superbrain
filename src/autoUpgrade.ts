import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { planReattribution, applyReattribution } from "./reattributeFromHistory.js";
import { planCleanup, applyCleanup } from "../scripts/cleanup-daily-mirrors.js";
import { writeFailure } from "./sentinel.js";

export function upgradeSentinelPath(dataDir: string, version: string): string {
  return path.join(dataDir, `upgraded-${version}`);
}

export async function runCheapUpgradeSteps(dataDir: string, version: string): Promise<void> {
  const sentinel = upgradeSentinelPath(dataDir, version);
  if (fs.existsSync(sentinel)) return;

  try {
    const reattribPlan = planReattribution(dataDir);
    applyReattribution(reattribPlan);
  } catch (e: any) {
    writeFailure(`auto-upgrade reattribute failed: ${e?.message || e}`);
  }

  try {
    const vault = vaultPath();
    if (fs.existsSync(vault)) {
      const mirrorPlan = planCleanup(vault);
      applyCleanup(vault, mirrorPlan);
    }
  } catch (e: any) {
    writeFailure(`auto-upgrade cleanup-daily-mirrors failed: ${e?.message || e}`);
  }

  try {
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, new Date().toISOString() + "\n", "utf8");
  } catch (e: any) {
    writeFailure(`auto-upgrade sentinel write failed: ${e?.message || e}`);
  }
}
