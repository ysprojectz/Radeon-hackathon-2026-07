import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if ((arg === "-p" || arg === "--port") && args[index + 1]) {
    process.env.PORT = args[index + 1];
    index += 1;
  } else if ((arg === "-H" || arg === "--hostname") && args[index + 1]) {
    process.env.HOSTNAME = args[index + 1];
    index += 1;
  }
}

process.env.PORT ||= "3000";
process.env.HOSTNAME ||= "0.0.0.0";

const serverPath = resolve(".next/standalone/server.js");
const standaloneRoot = resolve(".next/standalone");

if (!existsSync(serverPath)) {
  console.error("Standalone build not found. Run `npm run build` before `npm run start`.");
  process.exit(1);
}

function ensureRuntimeLink(target, linkPath, parentDir) {
  if (existsSync(linkPath) || !existsSync(target)) {
    return;
  }
  mkdirSync(parentDir, { recursive: true });
  symlinkSync(target, linkPath, "junction");
}

ensureRuntimeLink(resolve(".next/static"), resolve(standaloneRoot, ".next/static"), resolve(standaloneRoot, ".next"));
ensureRuntimeLink(resolve("public"), resolve(standaloneRoot, "public"), standaloneRoot);

await import(serverPath);
