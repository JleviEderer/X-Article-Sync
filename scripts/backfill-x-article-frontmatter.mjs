#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_OUTPUT_FOLDER = path.join("Outputs", "X_Articles");

function parseArgs(argv) {
  const args = {
    vaultRoot: process.cwd(),
    outputFolder: DEFAULT_OUTPUT_FOLDER,
    updatedDate: new Date().toISOString().slice(0, 10),
    dryRun: false,
    limit: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--vault-root") {
      args.vaultRoot = argv[++i];
    } else if (arg === "--output-folder") {
      args.outputFolder = argv[++i];
    } else if (arg === "--updated-date") {
      args.updatedDate = argv[++i];
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(argv[++i], 10);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.updatedDate)) {
    throw new Error("--updated-date must be YYYY-MM-DD");
  }

  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-x-article-frontmatter.mjs [options]

Options:
  --vault-root <path>     Vault root that contains the article folder
  --output-folder <path>  Folder inside vault to scan (default: ${DEFAULT_OUTPUT_FOLDER})
  --updated-date <date>   Updated date to stamp on patched notes (default: today)
  --limit <n>             Stop after patching N notes
  --dry-run               Show what would be patched without writing files
  --help, -h              Show this help
`);
}

function readMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return null;
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function hasKey(frontmatter, key) {
  return new RegExp(`^${key}:\\s*`, "m").test(frontmatter);
}

function extractMatch(content, patterns) {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function unquoteYamlScalar(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function normalizeDate(value) {
  const scalar = unquoteYamlScalar(value);
  if (!scalar || scalar === "null") {
    return null;
  }

  const dateMatch = scalar.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

function buildSourceUrls(content, sourceValue) {
  const urls = [];
  const sourceUrl = unquoteYamlScalar(sourceValue);
  const articleUrl = extractMatch(content, [
    /^x_article_url:\s*"?([^"\r\n]+)"?/m,
    /^<!-- x-sync[\s\S]*?^article_url:\s*(.+)$/m,
    /^- Native article:\s*(.+)$/m,
  ]);

  if (sourceUrl) {
    urls.push(sourceUrl);
  }

  if (articleUrl) {
    const normalizedArticleUrl = unquoteYamlScalar(articleUrl);
    if (normalizedArticleUrl && !urls.includes(normalizedArticleUrl)) {
      urls.push(normalizedArticleUrl);
    }
  }

  return urls;
}

function patchFrontmatter(frontmatter, content, updatedDate) {
  if (hasKey(frontmatter, "source_type")) {
    return null;
  }

  const sourceValue = extractMatch(frontmatter, [/^source:\s*(.+)$/m]);
  if (!sourceValue) {
    return null;
  }

  const dateValue =
    normalizeDate(extractMatch(frontmatter, [/^date:\s*(.+)$/m])) ||
    normalizeDate(extractMatch(frontmatter, [/^created:\s*(.+)$/m])) ||
    normalizeDate(extractMatch(frontmatter, [/^published:\s*(.+)$/m])) ||
    normalizeDate(extractMatch(content, [/^<!-- x-sync[\s\S]*?^bookmark_saved_at:\s*(.+)$/m])) ||
    updatedDate;

  const sourceUrls = buildSourceUrls(content, sourceValue);
  const lines = frontmatter.split(/\r?\n/);
  const insertAfterIndex = lines.findIndex((line) => /^source:\s*/.test(line));
  const insertionIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : 0;
  const additions = [];

  if (!hasKey(frontmatter, "type")) {
    additions.push("type: reference");
  }

  if (!hasKey(frontmatter, "date")) {
    additions.push(`date: ${dateValue}`);
  }

  additions.push("source_type: x-article");

  if (!hasKey(frontmatter, "derivation")) {
    additions.push("derivation: source-extract");
  }

  if (!hasKey(frontmatter, "trust_level")) {
    additions.push("trust_level: high");
  }

  if (!hasKey(frontmatter, "retrieve_priority")) {
    additions.push("retrieve_priority: medium");
  }

  if (!hasKey(frontmatter, "source_urls") && sourceUrls.length > 0) {
    additions.push("source_urls:");
    for (const url of sourceUrls) {
      additions.push(`  - ${url}`);
    }
  }

  if (!hasKey(frontmatter, "updated")) {
    additions.push(`updated: ${updatedDate}`);
  }

  if (additions.length === 0) {
    return null;
  }

  const nextLines = [...lines];
  nextLines.splice(insertionIndex, 0, ...additions);
  return nextLines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultRoot = path.resolve(args.vaultRoot);
  const outputRoot = path.resolve(vaultRoot, args.outputFolder);
  const files = readMarkdownFiles(outputRoot);

  let scanned = 0;
  let patched = 0;
  let skipped = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const parts = splitFrontmatter(content);
    scanned += 1;

    if (!parts) {
      skipped += 1;
      continue;
    }

    const nextFrontmatter = patchFrontmatter(parts.frontmatter, content, args.updatedDate);
    if (!nextFrontmatter) {
      skipped += 1;
      continue;
    }

    const nextContent = `---\n${nextFrontmatter}\n---\n${parts.body}`;
    if (args.dryRun) {
      console.log(`[dry-run] ${path.relative(vaultRoot, filePath)}`);
    } else {
      fs.writeFileSync(filePath, nextContent, "utf8");
      console.log(`Patched ${path.relative(vaultRoot, filePath)}`);
    }

    patched += 1;
    if (args.limit !== undefined && patched >= args.limit) {
      break;
    }
  }

  console.log("");
  console.log(`Files scanned: ${scanned}`);
  console.log(`Files patched: ${patched}`);
  console.log(`Files skipped: ${skipped}`);
  console.log(`Output folder: ${outputRoot}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
