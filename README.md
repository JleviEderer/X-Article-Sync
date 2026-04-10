# X Article Sync

Sync native X Article bookmarks into Obsidian as Markdown notes with YAML frontmatter.

## What it does

- Pulls bookmarks from X with `bird`
- Expands only likely native article bookmarks with `bird read --json-full`
- Detects native X Articles from the expanded payload
- Writes notes directly into your target Obsidian folder
- Renders article structure into Markdown, including headings, lists, blockquotes, links, cover images, and inline article images
- Tracks processed bookmarks in a state file outside the vault
- Dedupe checks both the state file and existing vault notes
- Supports incremental syncs, overwrite refreshes, and deeper paged backfills
- Supports `local` or `remote` image handling

## Repo layout

- `scripts/x-article-bookmarks-to-obsidian.mjs`: main importer
- `scripts/run-x-article-sync.ps1`: local launcher pointed at the user's real vault path
- `scripts/run-x-article-sync.sh`: Linux/server launcher driven by environment variables
- `scripts/register-x-article-sync-task.ps1`: helper to register a daily Windows scheduled task
- `deploy/x-article-sync.env.example`: example server env file for cron

## Usage

Run the importer directly:

```powershell
node scripts/x-article-bookmarks-to-obsidian.mjs `
  --vault-root "C:\Users\justi\Obsidian Vault" `
  --output-folder "Outputs\X_Articles" `
  --state-path "C:\Users\justi\dev\x-article-sync\.codex\state\x-article-bookmarks.json" `
  --assets-mode remote `
  --count 200
```

Or use the preconfigured launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-x-article-sync.ps1
```

On Linux or AWS, use the shell launcher after setting your server paths:

```bash
export X_ARTICLE_SYNC_VAULT_ROOT="/srv/obsidian-vault"
export X_ARTICLE_SYNC_STATE_PATH="/var/lib/x-article-sync/x-article-bookmarks.json"
./scripts/run-x-article-sync.sh
```

By default, the Linux launcher also stages, commits, and pushes changes in the configured article folder if the target vault is a Git repo. Set `X_ARTICLE_SYNC_PUSH_VAULT_CHANGES=0` if you want write-only behavior instead.

Useful variants:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-x-article-sync.ps1 -DryRun -Count 20
powershell -ExecutionPolicy Bypass -File .\scripts\run-x-article-sync.ps1 -Overwrite -Count 200 -Limit 20
powershell -ExecutionPolicy Bypass -File .\scripts\run-x-article-sync.ps1 -All -MaxPages 20
```

Backfill existing note frontmatter locally without calling X again:

```powershell
node .\scripts\backfill-x-article-frontmatter.mjs `
  --vault-root "C:\Users\justi\Obsidian Vault" `
  --output-folder "Outputs\X_Articles"
```

## Flags

- `--count <n>`: fetch a recent bookmark window when not using `--all`
- `--all --max-pages <n>`: walk older bookmark pages for backfills
- `--limit <n>`: stop after writing `n` article notes
- `--overwrite`: revisit already-checked bookmarks in the selected window and refresh matching notes
- `--dry-run`: inspect what would be imported without writing files
- `--assets-mode remote`: keep image links remote and avoid local `_assets` folders
- `--assets-mode local`: download article images into the vault

For very large bookmark corpora, set `X_ARTICLE_SYNC_MAX_BUFFER_BYTES` if the full `bird bookmarks --all --json-full` payload exceeds the default child-process buffer.

## Automation

Register a daily Windows scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-x-article-sync-task.ps1
```

Choose a different daily time:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-x-article-sync-task.ps1 -DailyAt "09:00"
```

For AWS or another Linux server, keep this as a separate cron job instead of folding it into another worker. Example:

```cron
15 * * * * . /etc/x-article-sync.env && cd /srv/x-article-sync && /usr/bin/flock -n /tmp/x-article-sync.lock ./scripts/run-x-article-sync.sh >> /var/log/x-article-sync.log 2>&1
```

Suggested server layout:

- Repo checkout: `/srv/x-article-sync`
- Vault root: wherever your server-side Obsidian vault is mounted or synced
- State file: `/var/lib/x-article-sync/x-article-bookmarks.json`
- Env file: `/etc/x-article-sync.env`
- Log file: `/var/log/x-article-sync.log`

Why this shape:

- `flock` prevents overlapping cron runs
- state stays outside the vault
- the job remains isolated from `/daily` and other automation
- `remote` assets avoids writing `_assets` folders into the vault
- the Linux launcher can push just the article folder without sweeping unrelated vault changes into the same commit

## Notes

- Auth is loaded from `~/.config/env/twitter.env`
- If `TWITTER_AUTH_TOKEN` and `CT0` are already in the environment, the script uses those directly
- You can also point the script at a different auth file with `--twitter-env-file` or `X_ARTICLE_SYNC_TWITTER_ENV_FILE`
- On Linux/server runs, set `X_ARTICLE_SYNC_PUSH_VAULT_CHANGES=0` if you do not want the launcher to commit and push vault changes
- Optional `X_ARTICLE_SYNC_GIT_AUTHOR_NAME` and `X_ARTICLE_SYNC_GIT_AUTHOR_EMAIL` let you control the author label used for those scoped vault commits
- The env loader supports lines like `export KEY=value`
- The script writes directly into the vault; Obsidian does not need to be open
- Native X Articles are detected from expanded bookmark payloads, not preview text alone
- The included PowerShell launcher is preconfigured for `C:\Users\justi\Obsidian Vault\Outputs\X_Articles`
