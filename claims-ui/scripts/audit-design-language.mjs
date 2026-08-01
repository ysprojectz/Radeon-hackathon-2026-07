#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const strict = process.argv.includes("--strict");

const scanRoots = ["app", "components"].map((dir) => join(root, dir));
const allowedPathParts = [
  "app/api/",
  "app/globals.css",
  "app/professional-theme.css",
  "app/tokens.css",
  "app/pipeline-doc/",
  "app/title-preview/",
  "app/claims/assistant-designs/",
  "components/ui/",
  "lib/types",
  "node_modules/",
  ".next/",
];

const extensions = new Set([".tsx", ".ts", ".css"]);
const technicalTerms = [
  { term: /\bHITL\b/g, preferred: "Manual review" },
  { term: /\bSLA\b/g, preferred: "Due time" },
  { term: /\bLLM\b/g, preferred: "AI assistant" },
  { term: /\bOCR\b/g, preferred: "Document data" },
  { term: /\bAPI\b/g, preferred: "Service" },
  { term: /\bPipeline\b/g, preferred: "Journey" },
  { term: /\bLifecycle\b/g, preferred: "Journey" },
  { term: /\bAudit Trail\b/g, preferred: "Event history" },
];

const stylePatterns = [
  { name: "negative tracking", pattern: /tracking-\[-|letterSpacing:\s*["']-/g },
  { name: "viewport-scaled type", pattern: /text-\[[^\]]*vw|fontSize:\s*["'][^"']*vw|font-size:\s*clamp\(/g },
  {
    name: "inline hard color",
    pattern: /style=\{\{[^}\n]*(?:#[0-9a-fA-F]{3,8}|rgba?\()|(?:color|backgroundColor|borderColor|stroke|fill):\s*["'](?:#[0-9a-fA-F]{3,8}|rgba?\()/g,
    allowCss: true,
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else if ([...extensions].some((ext) => path.endsWith(ext))) {
      files.push(path);
    }
  }
  return files;
}

function isAllowed(path) {
  const rel = relative(root, path).replaceAll("\\", "/");
  return allowedPathParts.some((part) => rel.includes(part));
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function contextLine(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

const findings = [];

for (const file of scanRoots.flatMap((dir) => walk(dir))) {
  if (isAllowed(file)) continue;
  const rel = relative(root, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");

  for (const rule of technicalTerms) {
    for (const match of text.matchAll(rule.term)) {
      const line = contextLine(text, match.index ?? 0);
      const looksVisible =
        line.includes(">") ||
        line.includes("label") ||
        line.includes("title") ||
        line.includes("description") ||
        line.includes("placeholder") ||
        line.includes("aria-label");
      if (line.includes("auditPattern") || line.includes(".test(")) continue;
      if (!looksVisible) continue;
      findings.push({
        type: "copy",
        file: rel,
        line: lineNumber(text, match.index ?? 0),
        detail: `${match[0]} -> ${rule.preferred}`,
        sample: line,
      });
    }
  }

  for (const rule of stylePatterns) {
    if (rule.allowCss && rel.endsWith(".css")) continue;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        type: "style",
        file: rel,
        line: lineNumber(text, match.index ?? 0),
        detail: rule.name,
        sample: contextLine(text, match.index ?? 0),
      });
    }
  }
}

const grouped = findings.reduce((acc, item) => {
  const key = `${item.type}:${item.detail}`;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log("ACOS design-language audit");
console.log("==========================");
console.log(`Files scanned: ${scanRoots.flatMap((dir) => walk(dir)).filter((file) => !isAllowed(file)).length}`);
console.log(`Findings: ${findings.length}`);

for (const [key, count] of Object.entries(grouped).sort()) {
  console.log(`- ${key}: ${count}`);
}

if (findings.length) {
  console.log("\nSample findings:");
  for (const item of findings.slice(0, 30)) {
    console.log(`${item.file}:${item.line} [${item.type}] ${item.detail}`);
    console.log(`  ${item.sample}`);
  }
}

if (strict && findings.length) {
  process.exitCode = 1;
}
