#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
NODE_SCRIPT="$SCRIPT_DIR/x-article-bookmarks-to-obsidian.mjs"

: "${X_ARTICLE_SYNC_VAULT_ROOT:?Set X_ARTICLE_SYNC_VAULT_ROOT to your server vault root}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is not available in PATH" >&2
  exit 1
fi

if ! command -v bird >/dev/null 2>&1; then
  echo "bird is not available in PATH" >&2
  exit 1
fi

OUTPUT_FOLDER="${X_ARTICLE_SYNC_OUTPUT_FOLDER:-Commonplace/X_Articles}"
STATE_PATH="${X_ARTICLE_SYNC_STATE_PATH:-$REPO_ROOT/.codex/state/x-article-bookmarks.json}"
ASSETS_MODE="${X_ARTICLE_SYNC_ASSETS_MODE:-remote}"

args=(
  "$NODE_SCRIPT"
  "--vault-root" "$X_ARTICLE_SYNC_VAULT_ROOT"
  "--output-folder" "$OUTPUT_FOLDER"
  "--state-path" "$STATE_PATH"
  "--assets-mode" "$ASSETS_MODE"
)

if [[ -n "${X_ARTICLE_SYNC_TWITTER_ENV_FILE:-}" ]]; then
  args+=("--twitter-env-file" "$X_ARTICLE_SYNC_TWITTER_ENV_FILE")
fi

args+=("$@")

exec node "${args[@]}"
