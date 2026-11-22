# mini-coding-agent (MCA)

Desktop coding agent built with [Electron](https://www.electronjs.org/), React, TypeScript, Tailwind CSS, and [shadcn/ui](https://ui.shadcn.com/).

## Requirements

- Node.js 22+
- npm 10+
- macOS (primary target) and Windows 10/11 (x64). On Windows commands run in Git Bash when Git for Windows is installed, otherwise in PowerShell (every command then asks first). Windows support is new and CI-built, not yet checked by hand on a real PC.

## Getting Started

```bash
npm install
npm run dev
```

## API Keys

Keys are looked up in this order: environment variables (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`), the macOS Keychain (saved from the desktop Settings), `~/.mca/credentials.json`, then a `.env` file in the directory `mca` or the app is launched from. For local development:

```bash
cp .env.example .env
```

`.env` is git-ignored. It is read last, so a `.env` shipped in a cloned repo never overrides a key you configured yourself.

## CLI

```bash
npm run build && node out/cli/index.js          # interactive (the `mca` bin after install/link)
mca -p "explain src/main" --permission-mode plan  # one prompt, answer on stdout, tool activity on stderr
git diff | mca -p "review this diff"             # piped stdin is appended to the prompt
mca --continue                                    # resume the newest saved session for this directory
```

`mca --help` lists every flag. Exit codes: 0 ok, 1 runtime error, 2 usage error or missing key. Headless runs treat the workspace as untrusted unless you pass `--trust`.

Slash commands (CLI and desktop prompt): `/help`, `/clear`, `/compact [focus]`, `/mode [mode]`, `/model [id]`, `/provider [id]`, `/rewind`, `/diff [all]`, `/resume [n|id]` (desktop), `/trust`, `/mcp`, `/exit`. Typing `/` in the desktop prompt opens an autocomplete list.

## Configuration

Project files win over `~/` ones; a built-in command name always wins over a file of the same name.

| What | Where |
| --- | --- |
| Settings (permissions, hooks, MCP servers) | `~/.mca/settings.json`, `.claude/settings.json`, `.mca/settings.json`, `.mca/settings.local.json`, plus `.mcp.json` for MCP |
| Custom commands | `{~/,<project>/}{.claude,.mca}/commands/<name>.md`. Body is the prompt; `$ARGUMENTS` and `$1`–`$9` are replaced. Optional `description:` frontmatter |
| Skills | `{~/,<project>/}{.claude,.mca}/skills/<name>/SKILL.md` with `name:` / `description:` frontmatter. The model sees only name + description (200 chars max) and loads the body with the `Skill` tool |
| Trust | Project allow rules, hooks and MCP servers only run after you trust the workspace (`/trust`) |

## Installing on macOS

Download the build for your Mac from the [Releases page](https://github.com/yurtemre7/mini-coding-agent/releases): `arm64` for Apple Silicon (M1 and later), `x64` for Intel (check  > About This Mac).

1. Open `mini-coding-agent-<version>-<arch>.dmg` and drag **mini-coding-agent** into **Applications**.
2. The app is **not signed or notarized**, so Gatekeeper blocks it ("is damaged" or "cannot be opened"). Remove the quarantine flag once in Terminal:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/mini-coding-agent.app"
   ```

   Add `sudo` in front if you get "Operation not permitted" (for example when the app was copied by another user or sits in a protected folder).
3. Open the app. Without the command above you can instead right-click the app, choose **Open**, then **Open** again; on macOS 15 use **System Settings > Privacy & Security > Open Anyway**.
4. Optional: verify the download with `shasum -a 256 -c SHA256SUMS.txt` (the file is attached to each release).
5. Add an API key in the app's Settings (stored in the macOS Keychain), or export `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` before launching from a terminal.

The flag comes back only when you download a new build, so repeat step 2 after each update.

## Installing on Windows

Download the `.exe` installer from the Releases page and run it. It is unsigned: in the SmartScreen warning choose **More info**, then **Run anyway**. Install [Git for Windows](https://git-scm.com/download/win) so MCA can use Git Bash (set `MCA_BASH` to a `bash.exe` to pick another). API keys are stored in `%USERPROFILE%\.mca\credentials.json` (no Keychain on Windows), or set `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`.

## Releasing (unsigned macOS app)

Bump `version` in `package.json`, commit, then `git tag vX.Y.Z && git push --tags`. The release workflow builds arm64 and x64 `.dmg`/`.zip` and publishes a GitHub release with checksums. The app is **not signed or notarized**: on first launch right-click the app and choose Open (or run `xattr -dr com.apple.quarantine /Applications/mini-coding-agent.app`).

## Known limits

- Packaged-app behaviour is **unverified**: bundled `rg`, `Bash` finding node/git when launched from Finder, and Keychain reads need a manual check on a Mac (CI only builds the app).
- `/rewind` restores files edited through Write/Edit (checkpoints are saved with the chat, so it also works after a restart); it does not undo Bash side effects or memory.
- MCP supports stdio servers only; results are capped at 25k characters.
- Subagents are one level deep and cannot use `Skill`, `Task`, `TodoWrite` or `ExitPlanMode`.

## Scripts

- `npm run dev` — Start Electron + Vite in development mode
- `npm run build` — Build main, preload, and renderer bundles
- `npm run typecheck` — Run TypeScript typechecking for Node and Web targets
- `npm test` — Run unit and component tests with Vitest
- `npm run package:win` — Build the Windows NSIS installer (run on Windows)
- `npm run package:mac` — Build and package macOS `.dmg` and `.zip` artifacts via `electron-builder`

## Notifications

The desktop app shows a system notification (while the window is in the background) when the model looks stuck repeating the same tool calls, when a permission prompt has waited a minute, and when a turn has run for ten minutes. Phone push is not supported yet.
