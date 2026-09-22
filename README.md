# pi-sync — Sync Pi settings through Git

A fork of `@dbaida/pi-sync` that syncs your Pi agent settings across machines
using a Git repository.

Upstream hardcodes the set of paths it syncs. This fork reads `include` and
`exclude` from `pi-sync.json`, so a directory or a data file an extension writes
can be synced without editing code. Everything else behaves as upstream.

Use it when you want the same Pi skills, prompts, themes, extensions, keybindings, models, and global instructions on multiple machines without copying files manually. Your configuration is stored as normal Git-tracked files, so you can inspect changes, review history, and restore earlier versions with familiar Git workflows.

## When to use this

Use pi-sync when you want to:

- set up a new machine with your existing Pi configuration
- keep prompts, skills, themes, extensions, and global instructions consistent across machines
- back up Pi agent config in a private Git repo
- review Pi configuration changes through Git history and diffs
- restore an older config version locally without changing the remote repo

## Prerequisites

- Pi coding agent installed.
- `git` installed and available in your shell.
- A **private** Git repository for synced Pi configuration.
- For GitHub HTTPS repositories, GitHub CLI (`gh`) is recommended so Git can reuse your existing GitHub login.

Install GitHub CLI if needed:

```bash
brew install gh
```

Then authenticate and configure Git HTTPS credentials:

```bash
gh auth login
gh auth setup-git
```

SSH repository URLs are also supported, but they require normal SSH key and `ssh-agent` setup.

## Install

```bash
pi remove npm:@dbaida/pi-sync        # only if present: both register /pisync
pi install git:github.com/gravity-rose/pi-sync
```

Pin a ref to control updates. Refs are pinned tags or commits, so
`pi update --extensions` reconciles an existing clone but never moves it to a
newer ref. To advance, install again at the new ref:

```bash
pi install git:github.com/gravity-rose/pi-sync@4d9c2e1
```

The repository does not have to be public. A private one works over SSH
(`git:git@github.com:gravity-rose/pi-sync`) or HTTPS with your normal Git
credentials.

To confirm it is this fork rather than upstream, check that `include` and
`exclude` in `pi-sync.json` are honoured: upstream hardcodes its path list and
ignores both. `/pisync doctor` verifies config and repository access.

Extensions do not hot-reload, so start a new Pi session afterwards.

For local development from this repository root:

```bash
pi -e .
```

For a machine set up from the pi-decoupling bundle there is also an installer,
which backs up `settings.json` and `pi-sync.json` first, merges the `include`
list rather than overwriting it, and verifies the result. It installs from a
local checkout rather than from this repository:

```bash
~/pi-decoupling/scripts/08-install-sync-fork.sh --dry-run
~/pi-decoupling/scripts/08-install-sync-fork.sh
```

## Quick start

1. Create a private Git repository for your Pi config.
2. Install the extension:

   ```bash
   pi install git:github.com/gravity-rose/pi-sync
   ```

3. In Pi, run:

   ```text
   /pisync init
   ```

4. Enter your repository URL. HTTPS GitHub URLs are recommended if you already use `gh auth login`.
5. Verify setup:

   ```text
   /pisync doctor
   ```

6. On your first machine, publish current config:

   ```text
   /pisync push
   ```

7. On another machine, use the same repository and run:

   ```text
   /pisync pull
   ```

When everything matches, the footer should show:

```text
PI-SYNC: ↑0 ↓0
```

## Configuration

Run inside Pi:

```text
/pisync init
```

The init flow asks for a Git repository URL, branch, and whether auto-sync should be enabled. HTTPS GitHub URLs are recommended because they can reuse an existing GitHub CLI login or Git credential helper without SSH key setup.

The generated file is stored at:

```text
~/.pi/agent/pi-sync.json
```

It is itself synced, so an `include` change travels between machines. That costs
an extra pull; see [Changing `include` takes two pulls](#changing-include-takes-two-pulls).

Example:

```json
{
  "repository": "https://github.com/<user>/<repo>.git",
  "branch": "main",
  "autoSync": true
}
```

For GitHub HTTPS repositories, `/pisync init` can optionally run `gh auth setup-git` after confirming with you. This lets Git reuse your existing GitHub CLI login. SSH URLs still require normal SSH key and ssh-agent setup.

Environment overrides are also supported: `PI_SYNC_REPOSITORY` (or `PI_SYNC_REPO`), `PI_SYNC_BRANCH`, and `PI_SYNC_AUTO_SYNC`. Run `/pisync doctor` after setup to verify repository access and get auth-specific guidance.

### `include` and `exclude`

`include` is added to the defaults listed under [What is synced](#what-is-synced);
`exclude` is applied on top of the built-in deny rules. Patterns support `**`
across path segments, `*` inside one segment, `?` for one character, and nothing
else — everything else is literal.

```json
{
  "repository": "https://github.com/<user>/<repo>.git",
  "branch": "main",
  "autoSync": true,
  "include": ["lib/**", "prose/**", "pi-memory-extension.json", "pi-sync.json"],
  "exclude": ["**/.DS_Store", "**/*.tmp", "**/*.log"]
}
```

What a new path costs depends on its **first segment**, not on the file:

| New path                              | Config change | Pulls |
 | ------------------------------------- | ------------- | ----- |
| `lib/togo.ts`, `lib/nested/togo.ts`   | none          | 1     |
| `extensions/x.ts`, `skills/…`, `themes/…`, `prompts/…`, `prose/…` | none | 1 |
| `settings.json`, `models.json`, `AGENTS.md`, `keybindings.json`, `plannotator.json` | none | 1 |
| `togo.json` (new top-level file)      | `include`     | 2     |
| `data/togo.ts` (new top-level dir)    | `include`     | 2     |

Put extension output under a head that is already listed and a new file is free.
A new head is the only thing that costs anything.

### Changing `include` takes two pulls

A pull reads the remote through this machine's **local** `pi-sync.json`, so the
run that brings the new `include` list cannot see the paths it newly covers. They
are in the repo, just not fetched yet.

pi-sync detects this and says so at the end of the first pull:

```text
pi-sync: the include list changed and 2 remote path(s) are not covered by it
yet: lib/togo.ts, lib/togo-more.ts. Run /pisync pull again to fetch them.
```

Run `/pisync pull` again and the new paths arrive. Nothing is lost in between:
the first pull does not delete anything it cannot see, because pruning is limited
to top-level entries the remote snapshot actually manages.

If instead the second pull reports that both sides changed, that is the same
situation with a local edit in the way. `/pisync pull --force` resolves it and
writes a backup to `~/.pi/agent/.pisync/backups/` first.

The gap is not listed by `/pisync diff` or `/pisync status`: both read the remote
through the same local `include` list, so the paths it cannot cover are invisible
there. The notice above is the only report.

## Commands

```text
/pisync config
/pisync doctor
/pisync status [--verbose]
/pisync diff
/pisync push
/pisync pull
/pisync sync
/pisync history
/pisync checkout <commit-ish>
/pisync unlock --stale
```

Command guide:

| Command                         | Use it when                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `/pisync init`                  | Configure pi-sync for this machine.                                   |
| `/pisync doctor`                | Verify config, Git access, secret scan, and lock status.              |
| `/pisync status [--verbose]`    | Check local/remote drift and optionally list changed paths.           |
| `/pisync diff`                  | Review textual differences before pushing or pulling.                 |
| `/pisync push`                  | Publish local Pi settings to the Git repo.                            |
| `/pisync pull`                  | Apply remote Git settings locally after backup and confirmation.      |
| `/pisync sync`                  | Conservatively push or pull when only one side changed.               |
| `/pisync history`               | Show recent synced Git commits.                                       |
| `/pisync checkout <commit-ish>` | Restore a previous commit locally without changing the remote branch. |
| `/pisync unlock --stale`        | Remove a stale local lock after confirming no sync is running.        |

Useful flags:

- `--yes` / `-y`: skip confirmation prompts.
- `--force`: allow push/pull when both local and remote state changed.
- `--verbose` / `-v`: show changed paths for `/pisync status`.
- `--stale`: remove a stale local lock.

Press Tab after `/pisync ` to autocomplete subcommands with short descriptions.

## Footer status

pi-sync shows drift in the footer:

```text
PI-SYNC: ↑1 ↓0
```

- `↑` means local output changes that are not pushed.
- `↓` means remote input changes that are not pulled.

Common states:

| Status  | Meaning                | Next step                                                                    |
| ------- | ---------------------- | ---------------------------------------------------------------------------- |
| `↑0 ↓0` | Local and remote match | Nothing                                                                      |
| `↑1 ↓0` | Local files changed    | `/pisync diff`, then `/pisync push`                                          |
| `↑0 ↓1` | Remote changed         | `/pisync pull`                                                               |
| `↑1 ↓1` | Both changed           | `/pisync diff`, then choose `/pisync pull --force` or `/pisync push --force` |

## What is synced

The extension syncs allowlisted Pi and Plannotator config files into the root of the configured Git repo:

```text
settings.json
keybindings.json
models.json
AGENTS.md
plannotator.json
skills/
prompts/
themes/
extensions/
lib/
prose/
pi-memory-extension.json
pi-sync.json
.plannotator/config.json
```

`lib/`, `prose/`, `pi-memory-extension.json` and `pi-sync.json` are this fork's
additions to upstream's set; the rest is upstream's default list. `plannotator.json`
maps to `~/.pi/agent/plannotator.json` for phase prompts and orchestrator behavior.
`.plannotator/config.json` maps to `~/.plannotator/config.json` for review and
annotation feedback templates.

It excludes `.env*`, `node_modules`, `.git`, `.pisync`, and paths containing
`secret` or `token`, and it refuses to push common API-key patterns. `/pisync
diff` and confirmation prompts use textual `git diff --no-index` output between
remote files and local files.

## Safety

- Use a private Git repository for synced Pi config.
- Local state, clone cache, locks, and backups live under `~/.pi/agent/.pisync/`.
- Pull and checkout create local backups before changing files.
- Pull and checkout apply normal Git-tracked files while still preflighting paths and refusing symlink escapes.
- Checkout restores a previous commit locally without changing the remote branch; use `/pisync push` afterwards only if you want to publish that checked-out state as a new commit.
- Auto-sync is enabled by default but never pushes local changes automatically; it only pulls safe remote changes or asks you to resolve conflicts manually.
- Secret scanning is best-effort. Do not intentionally store API keys or tokens in synced Pi config.

## Troubleshooting

| Symptom                                        | Likely cause                                            | Suggested fix                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/pisync doctor` says repository access failed | Git auth is not configured for the repo URL             | For GitHub HTTPS, run `gh auth login` and `gh auth setup-git`. For SSH, run `ssh -T git@github.com` and configure your SSH key. |
| `Permission denied (publickey)`                | SSH repository URL without working SSH key setup        | Use an HTTPS repository URL, or add/load an SSH key registered with GitHub.                                                     |
| `gh: command not found`                        | GitHub CLI is not installed                             | Install it with `brew install gh`, then run `gh auth login` and `gh auth setup-git`.                                            |
| Footer shows `PI-SYNC: ↑1 ↓0`                  | Local config differs from the last synced state         | Run `/pisync diff`, then `/pisync push` if you want to publish local changes.                                                   |
| Footer shows `PI-SYNC: ↑0 ↓1`                  | Remote config changed                                   | Run `/pisync pull`.                                                                                                             |
| Footer shows both local and remote changes     | Local and remote diverged                               | Run `/pisync diff`, then choose `/pisync pull --force` or `/pisync push --force`.                                               |
| Push is refused due to possible secrets        | A synced file path or content matched secret heuristics | Remove the secret/token from synced config or rename/exclude the sensitive file.                                                |
| New paths stay missing after a pull           | `include` changed; that run cannot see what it newly covers | Run `/pisync pull` again. pi-sync prints this notice itself when it detects the case.                                       |
| A lock is stale                                | A previous sync was interrupted                         | After verifying no sync is running, run `/pisync unlock --stale`.                                                               |
| Checkout restored older local files            | `/pisync checkout` is local-only by design              | Run `/pisync pull` to return to remote latest, or `/pisync push` to publish the checked-out state.                              |
