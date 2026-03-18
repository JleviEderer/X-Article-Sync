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
PUSH_VAULT_CHANGES="${X_ARTICLE_SYNC_PUSH_VAULT_CHANGES:-1}"

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

node "${args[@]}"

if [[ "$PUSH_VAULT_CHANGES" != "1" ]]; then
  exit 0
fi

if ! git -C "$X_ARTICLE_SYNC_VAULT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Vault is not a git worktree; skipping vault push step"
  exit 0
fi

export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=Never

if [[ -n "${X_ARTICLE_SYNC_GIT_AUTHOR_NAME:-}" ]]; then
  git -C "$X_ARTICLE_SYNC_VAULT_ROOT" config user.name "$X_ARTICLE_SYNC_GIT_AUTHOR_NAME"
fi

if [[ -n "${X_ARTICLE_SYNC_GIT_AUTHOR_EMAIL:-}" ]]; then
  git -C "$X_ARTICLE_SYNC_VAULT_ROOT" config user.email "$X_ARTICLE_SYNC_GIT_AUTHOR_EMAIL"
fi

git -C "$X_ARTICLE_SYNC_VAULT_ROOT" add -A -- "$OUTPUT_FOLDER"

if git -C "$X_ARTICLE_SYNC_VAULT_ROOT" diff --cached --quiet -- "$OUTPUT_FOLDER"; then
  echo "No x-article-sync vault changes to push"
  exit 0
fi

current_branch="$(git -C "$X_ARTICLE_SYNC_VAULT_ROOT" symbolic-ref --quiet --short HEAD || true)"
if [[ -z "$current_branch" ]]; then
  echo "Vault repo is in detached HEAD state; refusing to push" >&2
  exit 1
fi

commit_time="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"
git -C "$X_ARTICLE_SYNC_VAULT_ROOT" commit -m "x-article-sync: ${commit_time}"
git -C "$X_ARTICLE_SYNC_VAULT_ROOT" pull --rebase --autostash origin "$current_branch"
git -C "$X_ARTICLE_SYNC_VAULT_ROOT" push origin "$current_branch"
