#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { execFileSync } from "node:child_process";

const DEFAULT_OUTPUT_FOLDER = path.join("Clippings", "X Articles");
const DEFAULT_STATE_PATH = path.join(".codex", "state", "x-article-bookmarks.json");
const DEFAULT_COUNT = 200;

function parseArgs(argv) {
  const args = {
    vaultRoot: process.cwd(),
    outputFolder: DEFAULT_OUTPUT_FOLDER,
    statePath: DEFAULT_STATE_PATH,
    count: DEFAULT_COUNT,
    all: false,
    maxPages: undefined,
    overwrite: false,
    dryRun: false,
    limit: undefined,
    assetsMode: "local",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--vault-root") {
      args.vaultRoot = argv[++i];
    } else if (arg === "--output-folder") {
      args.outputFolder = argv[++i];
    } else if (arg === "--state-path") {
      args.statePath = argv[++i];
    } else if (arg === "--count") {
      args.count = Number.parseInt(argv[++i], 10);
    } else if (arg === "--max-pages") {
      args.maxPages = Number.parseInt(argv[++i], 10);
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(argv[++i], 10);
    } else if (arg === "--assets-mode") {
      args.assetsMode = argv[++i];
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--overwrite") {
      args.overwrite = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.count) || args.count <= 0) {
    throw new Error("--count must be a positive integer");
  }

  if (args.maxPages !== undefined && (!Number.isInteger(args.maxPages) || args.maxPages <= 0)) {
    throw new Error("--max-pages must be a positive integer");
  }

  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  if (!["local", "remote"].includes(args.assetsMode)) {
    throw new Error("--assets-mode must be one of: local, remote");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/x-article-bookmarks-to-obsidian.mjs [options]

Options:
  --vault-root <path>     Vault root to write into (default: current directory)
  --output-folder <path>  Folder inside vault for notes (default: ${DEFAULT_OUTPUT_FOLDER})
  --state-path <path>     State file path relative to vault root (default: ${DEFAULT_STATE_PATH})
  --count <n>             Number of bookmarks to fetch when not using --all (default: ${DEFAULT_COUNT})
  --all                   Page through all bookmarks
  --max-pages <n>         Stop after N pages when using --all
  --limit <n>             Stop after writing N new article notes
  --assets-mode <mode>    local downloads images into vault attachments, remote leaves image URLs hotlinked (default: local)
  --overwrite             Rewrite note files if they already exist
  --dry-run               Show what would be written without modifying files
  --help, -h              Show this help
`);
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function loadTwitterEnv() {
  const envPath = path.join(os.homedir(), ".config", "env", "twitter.env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing Twitter env file at ${envPath}`);
  }

  const env = { ...process.env };
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim().replace(/^export\s+/, "");
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  if (!env.TWITTER_AUTH_TOKEN || !env.CT0) {
    throw new Error("twitter.env is missing TWITTER_AUTH_TOKEN or CT0");
  }

  return env;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runBird(args, env) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let output;
      if (process.platform === "win32") {
        const command = ["bird", ...args]
          .map((value) => {
            const text = String(value);
            return /\s/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(" ");
        output = execFileSync("cmd.exe", ["/d", "/s", "/c", command], {
          env,
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        output = execFileSync("bird", args, {
          env,
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }

      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes("HTTP 429");
      if (!isRateLimit || attempt === maxAttempts) {
        throw error;
      }

      const waitMs = attempt * 5000;
      console.warn(`Rate limited by X. Retrying in ${waitMs / 1000}s...`);
      sleep(waitMs);
    }
  }
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeYaml(value) {
  return JSON.stringify(value ?? "");
}

function formatDateOnly(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function slugify(input) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function stripLeadingTitle(text, title) {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  const normalizedTitle = title.replace(/\r\n/g, "\n").trim();

  if (!normalizedText.startsWith(normalizedTitle)) {
    return normalizedText;
  }

  const remainder = normalizedText.slice(normalizedTitle.length).replace(/^\s+/, "");
  return remainder;
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, " ").trim();
}

function escapeMarkdownText(text) {
  return text.replace(/([\\`*_{}\[\]])/g, "\\$1");
}

function normalizeEntityMap(rawEntityMap) {
  const entityMap = new Map();
  if (!rawEntityMap) {
    return entityMap;
  }

  if (Array.isArray(rawEntityMap)) {
    for (const entry of rawEntityMap) {
      entityMap.set(Number(entry.key), entry.value);
    }
    return entityMap;
  }

  for (const [key, value] of Object.entries(rawEntityMap)) {
    entityMap.set(Number(key), value);
  }

  return entityMap;
}

function buildMediaLookup(rawArticle) {
  const mediaLookup = new Map();
  const mediaEntities = rawArticle.media_entities || [];
  for (const media of mediaEntities) {
    if (media.media_id && media.media_info?.original_img_url) {
      mediaLookup.set(String(media.media_id), media.media_info.original_img_url);
    }
  }
  return mediaLookup;
}

function toMarkdownPath(fromFilePath, targetPath) {
  return path.relative(path.dirname(fromFilePath), targetPath).split(path.sep).join("/");
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext && /^[.][a-zA-Z0-9]+$/.test(ext)) {
      return ext.toLowerCase();
    }
  } catch {
    return "";
  }

  return "";
}

async function downloadAsset(url, destinationPath, overwrite) {
  if (!overwrite && fs.existsSync(destinationPath)) {
    return destinationPath;
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "Codex X Article Sync",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download asset: ${url} (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
  return destinationPath;
}

async function prepareArticleAssets(articleData, notePath, overwrite, dryRun, assetsMode) {
  if (assetsMode === "remote") {
    const imagePathMap = new Map();
    for (const url of articleData.inlineImageUrls || []) {
      imagePathMap.set(url, url);
    }
    return {
      coverImageMarkdownPath: articleData.coverImageUrl || null,
      imagePathMap,
    };
  }

  const noteBaseName = path.basename(notePath, ".md");
  const assetsRoot = path.join(path.dirname(notePath), "_assets", noteBaseName);
  const imagePathMap = new Map();
  const inlineImageUrls = [...new Set(articleData.inlineImageUrls || [])];

  const createTargetPath = (baseName, url, fallbackExt) => {
    const ext = extensionFromUrl(url) || fallbackExt;
    return path.join(assetsRoot, `${baseName}${ext}`);
  };

  let coverImageMarkdownPath = null;
  if (articleData.coverImageUrl) {
    const coverPath = createTargetPath("cover", articleData.coverImageUrl, ".jpg");
    if (!dryRun) {
      await downloadAsset(articleData.coverImageUrl, coverPath, overwrite);
    }
    coverImageMarkdownPath = toMarkdownPath(notePath, coverPath);
    imagePathMap.set(articleData.coverImageUrl, coverImageMarkdownPath);
  }

  for (let index = 0; index < inlineImageUrls.length; index += 1) {
    const url = inlineImageUrls[index];
    const targetPath = createTargetPath(`image-${String(index + 1).padStart(2, "0")}`, url, ".jpg");
    if (!dryRun) {
      await downloadAsset(url, targetPath, overwrite);
    }
    imagePathMap.set(url, toMarkdownPath(notePath, targetPath));
  }

  return {
    coverImageMarkdownPath,
    imagePathMap,
  };
}

function renderInlineMarkdown(text, inlineStyleRanges = [], entityRanges = [], entityMap = new Map()) {
  if (!text) {
    return "";
  }

  const openings = new Map();
  const closings = new Map();

  function pushEvent(map, position, event) {
    if (!map.has(position)) {
      map.set(position, []);
    }
    map.get(position).push(event);
  }

  function styleMarkers(style) {
    switch (style) {
      case "Bold":
        return { open: "**", close: "**", priority: 20 };
      case "Italic":
        return { open: "*", close: "*", priority: 30 };
      case "Code":
        return { open: "`", close: "`", priority: 40 };
      default:
        return null;
    }
  }

  for (const range of inlineStyleRanges) {
    const markers = styleMarkers(range.style);
    if (!markers || range.length <= 0) {
      continue;
    }

    let start = range.offset;
    let end = range.offset + range.length;
    while (start < end && /\s/.test(text[start])) {
      start += 1;
    }
    while (end > start && /\s/.test(text[end - 1])) {
      end -= 1;
    }
    if (end <= start) {
      continue;
    }

    const event = {
      kind: "style",
      start,
      end,
      ...markers,
    };
    pushEvent(openings, event.start, event);
    pushEvent(closings, event.end, event);
  }

  for (const range of entityRanges) {
    const entity = entityMap.get(Number(range.key));
    const url = entity?.type === "LINK" ? entity.data?.url : null;
    if (!url || range.length <= 0) {
      continue;
    }

    const event = {
      kind: "link",
      start: range.offset,
      end: range.offset + range.length,
      open: "[",
      close: `](${url})`,
      priority: 10,
    };
    pushEvent(openings, event.start, event);
    pushEvent(closings, event.end, event);
  }

  const boundaries = new Set([0, text.length, ...openings.keys(), ...closings.keys()]);
  const positions = [...boundaries].sort((a, b) => a - b);
  let output = "";

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];

    const closingEvents = (closings.get(position) || []).sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return right.start - left.start;
    });
    for (const event of closingEvents) {
      output += event.close;
    }

    const openingEvents = (openings.get(position) || []).sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return right.end - left.end;
    });
    for (const event of openingEvents) {
      output += event.open;
    }

    const nextPosition = positions[index + 1];
    if (nextPosition !== undefined && nextPosition > position) {
      output += escapeMarkdownText(text.slice(position, nextPosition));
    }
  }

  return output;
}

function renderAtomicBlock(block, entityMap, mediaLookup, resolveImageUrl) {
  const entityRange = block.entityRanges?.[0];
  if (!entityRange) {
    return "";
  }

  const entity = entityMap.get(Number(entityRange.key));
  const mediaItems = entity?.data?.mediaItems || [];
  const imageUrls = mediaItems
    .map((item) => mediaLookup.get(String(item.mediaId)))
    .filter(Boolean);

  if (imageUrls.length === 0) {
    return "";
  }

  return imageUrls
    .map((url, index) => `![Article image ${index + 1}](${resolveImageUrl(url)})`)
    .join("\n\n");
}

function renderBlockContent(block, entityMap, mediaLookup, resolveImageUrl) {
  if (block.type === "atomic") {
    return renderAtomicBlock(block, entityMap, mediaLookup, resolveImageUrl);
  }

  const content = renderInlineMarkdown(
    String(block.text || ""),
    block.inlineStyleRanges || [],
    block.entityRanges || [],
    entityMap
  ).trim();
  if (!content) {
    return "";
  }

  switch (block.type) {
    case "header-one":
      return `# ${content.replace(/^\*\*(.*)\*\*$/s, "$1")}`;
    case "header-two":
      return `## ${content.replace(/^\*\*(.*)\*\*$/s, "$1")}`;
    case "header-three":
      return `### ${content.replace(/^\*\*(.*)\*\*$/s, "$1")}`;
    case "unordered-list-item":
      return content
        .split("\n")
        .map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`))
        .join("\n");
    case "ordered-list-item":
      return content
        .split("\n")
        .map((line, index) => (index === 0 ? `1. ${line}` : `   ${line}`))
        .join("\n");
    case "blockquote":
      return content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "unstyled":
    default:
      return content;
  }
}

function renderArticleBlocks(blocks, entityMap, mediaLookup, resolveImageUrl) {
  const renderedBlocks = [];

  for (const block of blocks || []) {
    const rendered = renderBlockContent(block, entityMap, mediaLookup, resolveImageUrl);
    if (!rendered) {
      continue;
    }
    renderedBlocks.push(rendered);
  }

  return renderedBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildFrontmatter(articleData, syncDate) {
  const tags = ["clippings"];
  const lines = [
    "---",
    `title: ${escapeYaml(articleData.title)}`,
    `source: ${escapeYaml(articleData.tweetUrl)}`,
    `author: ${escapeYaml(articleData.authorName)}`,
    `published: ${escapeYaml(articleData.publishedDate)}`,
    `created: ${escapeYaml(syncDate)}`,
    `description: ${escapeYaml(articleData.previewText)}`,
    "tags:",
    ...tags.map((tag) => `  - ${tag}`),
  ];

  lines.push("---");
  return lines.join("\n");
}

function parseArticlePayload(tweet) {
  const rawArticle = tweet?._raw?.article?.article_results?.result;
  if (!rawArticle) {
    return null;
  }

  const title = tweet.article?.title || rawArticle.title;
  const previewText = tweet.article?.previewText || rawArticle.preview_text || "";
  const articleId = rawArticle.rest_id || rawArticle.id || tweet.id;
  const tweetId = tweet.id;
  const authorUsername = tweet.author?.username || tweet?._raw?.core?.user_results?.result?.core?.screen_name || "";
  const authorName = tweet.author?.name || tweet?._raw?.core?.user_results?.result?.core?.name || authorUsername;
  const coverImageUrl = rawArticle.cover_media?.media_info?.original_img_url || "";
  const publishedSecs = rawArticle.metadata?.first_published_at_secs;
  const publishedDate = publishedSecs ? formatDateOnly(publishedSecs * 1000) : formatDateOnly(tweet.createdAt);
  const entityMap = normalizeEntityMap(rawArticle.content_state?.entityMap);
  const mediaLookup = buildMediaLookup(rawArticle);
  const fallbackText = stripLeadingTitle(tweet.text || rawArticle.plain_text || "", title);

  return {
    title,
    previewText,
    articleId,
    tweetId,
    authorUsername,
    authorName,
    blocks: rawArticle.content_state?.blocks || [],
    entityMap,
    mediaLookup,
    inlineImageUrls: [...new Set(mediaLookup.values())],
    text: fallbackText,
    coverImageUrl,
    publishedDate,
    bookmarkSavedAt: formatDateOnly(tweet.createdAt),
    tweetUrl: `https://x.com/${authorUsername}/status/${tweetId}`,
    articleUrl: `https://x.com/i/article/${articleId}`,
  };
}

function buildMarkdown(articleData, syncDate, assetRefs) {
  const frontmatter = buildFrontmatter(articleData, syncDate);
  const resolveImageUrl = (url) => assetRefs?.imagePathMap?.get(url) || url;
  const renderedContent = renderArticleBlocks(
    articleData.blocks || [],
    articleData.entityMap,
    articleData.mediaLookup,
    resolveImageUrl
  );
  const metadataComments = [
    "<!-- x-sync",
    `article_url: ${articleData.articleUrl}`,
    `article_id: ${articleData.articleId}`,
    `tweet_url: ${articleData.tweetUrl}`,
    `tweet_id: ${articleData.tweetId}`,
    `author_handle: ${articleData.authorUsername}`,
    `bookmark_saved_at: ${articleData.bookmarkSavedAt}`,
    articleData.coverImageUrl ? `cover_image: ${articleData.coverImageUrl}` : null,
    "-->",
  ]
    .filter(Boolean)
    .join("\n");

  const bodySections = [
    frontmatter,
    metadataComments,
    "",
    assetRefs?.coverImageMarkdownPath ? `![Cover image](${assetRefs.coverImageMarkdownPath})` : null,
    assetRefs?.coverImageMarkdownPath ? "" : null,
    renderedContent || articleData.text || articleData.previewText,
    "",
    "## Source",
    "",
    `- X post: ${articleData.tweetUrl}`,
    `- Native article: ${articleData.articleUrl}`,
  ].filter((section) => section !== null);

  return `${bodySections.join("\n").trim()}\n`;
}

function resolveNotePath(outputRoot, articleData, overwrite) {
  const baseSlug = slugify(articleData.title) || articleData.articleId;
  const safeTitle = sanitizeFileName(baseSlug);
  let fileName = `${safeTitle}.md`;
  let destination = path.join(outputRoot, fileName);

  if (!fs.existsSync(destination) || overwrite) {
    return destination;
  }

  fileName = `${safeTitle}-${articleData.tweetId}.md`;
  destination = path.join(outputRoot, fileName);
  return destination;
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

function indexExistingNotes(outputRoot) {
  const index = {
    articleIds: new Map(),
    articleUrls: new Map(),
    tweetIds: new Map(),
    tweetUrls: new Map(),
  };

  if (!fs.existsSync(outputRoot)) {
    return index;
  }

  const stack = [outputRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");
      const articleId = extractMatch(content, [
        /^article_id:\s*"?([^"\r\n]+)"?/m,
        /^<!-- x-sync[\s\S]*?^article_id:\s*(.+)$/m,
      ]);
      const articleUrl = extractMatch(content, [
        /^x_article_url:\s*"?([^"\r\n]+)"?/m,
        /^<!-- x-sync[\s\S]*?^article_url:\s*(.+)$/m,
        /^- Native article:\s*(.+)$/m,
      ]);
      const tweetId = extractMatch(content, [
        /^tweet_id:\s*"?([^"\r\n]+)"?/m,
        /^<!-- x-sync[\s\S]*?^tweet_id:\s*(.+)$/m,
      ]);
      const tweetUrl = extractMatch(content, [
        /^source:\s*"?([^"\r\n]+)"?/m,
        /^<!-- x-sync[\s\S]*?^tweet_url:\s*(.+)$/m,
        /^- X post:\s*(.+)$/m,
      ]);

      if (articleId) {
        index.articleIds.set(articleId, fullPath);
      }

      if (articleUrl) {
        index.articleUrls.set(articleUrl, fullPath);
      }

      if (tweetId) {
        index.tweetIds.set(tweetId, fullPath);
      }

      if (tweetUrl) {
        index.tweetUrls.set(tweetUrl, fullPath);
      }
    }
  }

  return index;
}

function findExistingNotePath(index, articleData) {
  return (
    index.articleIds.get(articleData.articleId) ||
    index.articleUrls.get(articleData.articleUrl) ||
    index.tweetIds.get(articleData.tweetId) ||
    index.tweetUrls.get(articleData.tweetUrl) ||
    null
  );
}

function getBookmarkExpandedUrl(bookmark) {
  return bookmark?._raw?.legacy?.entities?.urls?.[0]?.expanded_url || null;
}

function isNativeArticleBookmark(bookmark) {
  const url = getBookmarkExpandedUrl(bookmark);
  return typeof url === "string" && /https?:\/\/x\.com\/i\/article\//i.test(url);
}

function fetchBookmarks(env, options) {
  const birdArgs = ["bookmarks"];
  if (options.all) {
    birdArgs.push("--all");
    if (options.maxPages !== undefined) {
      birdArgs.push("--max-pages", String(options.maxPages));
    }
  } else {
    birdArgs.push("--count", String(options.count));
  }

  birdArgs.push("--json-full");
  const parsed = JSON.parse(runBird(birdArgs, env));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && Array.isArray(parsed.tweets)) {
    return parsed.tweets;
  }
  throw new Error("Unexpected bookmarks response shape");
}

function fetchTweetById(env, tweetId) {
  return JSON.parse(runBird(["read", tweetId, "--json-full"], env));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultRoot = path.resolve(expandHome(args.vaultRoot));
  const outputRoot = path.resolve(vaultRoot, args.outputFolder);
  const statePath = path.resolve(vaultRoot, args.statePath);
  const syncDate = formatDateOnly(new Date());
  const env = loadTwitterEnv();
  const state = readJsonFile(statePath, {
    checkedBookmarkIds: [],
    importedArticleIds: [],
    importedTweetIds: [],
    lastRunAt: null,
  });
  const existingIndex = indexExistingNotes(outputRoot);

  const checkedBookmarkIds = new Set(state.checkedBookmarkIds);
  const importedArticleIds = new Set(state.importedArticleIds);
  const importedTweetIds = new Set(state.importedTweetIds);
  const bookmarks = fetchBookmarks(env, args);

  fs.mkdirSync(outputRoot, { recursive: true });

  let scanned = 0;
  let imported = 0;
  let articleMatches = 0;
  let failedReads = 0;

  for (const bookmark of bookmarks) {
    if (!args.overwrite && checkedBookmarkIds.has(bookmark.id)) {
      continue;
    }

    scanned += 1;
    checkedBookmarkIds.add(bookmark.id);

    if (!isNativeArticleBookmark(bookmark)) {
      continue;
    }

    let fullTweet;
    try {
      fullTweet = fetchTweetById(env, bookmark.id);
    } catch (error) {
      failedReads += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping bookmark ${bookmark.id}: ${message}`);
      continue;
    }

    const articleData = parseArticlePayload(fullTweet);
    if (!articleData) {
      continue;
    }

    articleMatches += 1;

    const existingNotePath = findExistingNotePath(existingIndex, articleData);
    const seenInState =
      importedArticleIds.has(articleData.articleId) || importedTweetIds.has(articleData.tweetId);
    const alreadyInVault = existingNotePath !== null;

    if (!args.overwrite && (seenInState || alreadyInVault)) {
      continue;
    }

    const notePath = existingNotePath || resolveNotePath(outputRoot, articleData, args.overwrite);
    const assetRefs = await prepareArticleAssets(
      articleData,
      notePath,
      args.overwrite,
      args.dryRun,
      args.assetsMode
    );
    const markdown = buildMarkdown(articleData, syncDate, assetRefs);

    if (args.dryRun) {
      console.log(`[dry-run] ${notePath}`);
    } else {
      fs.writeFileSync(notePath, markdown, "utf8");
      console.log(`Wrote ${path.relative(vaultRoot, notePath)}`);
    }

    importedArticleIds.add(articleData.articleId);
    importedTweetIds.add(articleData.tweetId);
    existingIndex.articleIds.set(articleData.articleId, notePath);
    existingIndex.articleUrls.set(articleData.articleUrl, notePath);
    existingIndex.tweetIds.set(articleData.tweetId, notePath);
    existingIndex.tweetUrls.set(articleData.tweetUrl, notePath);
    imported += 1;

    if (args.limit !== undefined && imported >= args.limit) {
      break;
    }
  }

  state.checkedBookmarkIds = [...checkedBookmarkIds];
  state.importedArticleIds = [...importedArticleIds];
  state.importedTweetIds = [...importedTweetIds];
  state.lastRunAt = new Date().toISOString();

  if (!args.dryRun) {
    writeJsonFile(statePath, state);
  }

  console.log("");
  console.log(`Unchecked bookmarks processed: ${scanned}`);
  console.log(`Native article bookmarks found: ${articleMatches}`);
  console.log(`Notes written or refreshed: ${imported}`);
  console.log(`Bookmark read failures: ${failedReads}`);
  console.log(`Output folder: ${outputRoot}`);
  if (!args.dryRun) {
    console.log(`State file: ${statePath}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
