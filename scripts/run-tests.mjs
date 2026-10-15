import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
for (const file of readdirSync("scripts")
  .filter((name) => /^test-.*\.mjs$/.test(name) && name !== "test-vm.mjs")
  .sort()) {
  const result = spawnSync(process.execPath, ["scripts/" + file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], {
  stdio: "inherit",
});
process.exit(result.status || 0);
