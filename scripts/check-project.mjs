import { access } from "node:fs/promises";

const required = [
  "AGENTS.md",
  "README.md",
  "docs/PROJECT_SOUL.md",
  "docs/IMPLEMENTATION_PLAN.md",
  "apps/api/server.mjs",
  "apps/web/index.html",
  "packages/shared/domain.mjs",
  "packages/chess/README.md"
];

let failed = false;

for (const file of required) {
  try {
    await access(file);
  } catch {
    console.error(`missing required file: ${file}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Project structure check passed.");
}
