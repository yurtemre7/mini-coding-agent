# mini-coding-agent (MCA)

Desktop coding agent built with [Electron](https://www.electronjs.org/), React, TypeScript, Tailwind CSS, and [shadcn/ui](https://ui.shadcn.com/).

## Requirements

- Node.js 22+
- npm 10+
- macOS (primary target)

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

Slash commands (CLI and desktop prompt): `/help`, `/clear`, `/compact [focus]`, `/mode [mode]`, `/model [id]`, `/provider [id]`, `/rewind`, `/trust`, `/mcp`, `/exit`. Typing `/` in the desktop prompt opens an autocomplete list.

## Configuration

Project files win over `~/` ones; a built-in command name always wins over a file of the same name.

| What | Where |
| --- | --- |
| Settings (permissions, hooks, MCP servers) | `~/.mca/settings.json`, `.claude/settings.json`, `.mca/settings.json`, `.mca/settings.local.json`, plus `.mcp.json` for MCP |
| Custom commands | `{~/,<project>/}{.claude,.mca}/commands/<name>.md`. Body is the prompt; `$ARGUMENTS` and `$1`–`$9` are replaced. Optional `description:` frontmatter |
| Skills | `{~/,<project>/}{.claude,.mca}/skills/<name>/SKILL.md` with `name:` / `description:` frontmatter. The model sees only name + description (200 chars max) and loads the body with the `Skill` tool |
| Trust | Project allow rules, hooks and MCP servers only run after you trust the workspace (`/trust`) |

## Releasing (unsigned macOS app)

Bump `version` in `package.json`, commit, then `git tag vX.Y.Z && git push --tags`. The release workflow builds arm64 and x64 `.dmg`/`.zip` and publishes a GitHub release with checksums. The app is **not signed or notarized**: on first launch right-click the app and choose Open (or run `xattr -dr com.apple.quarantine /Applications/mini-coding-agent.app`).

## Known limits

- Packaged-app behaviour is **unverified**: bundled `rg`, `Bash` finding node/git when launched from Finder, and Keychain reads need a manual check on a Mac (CI only builds the app).
- `/rewind` restores files edited through Write/Edit; it does not undo Bash side effects or memory.
- MCP supports stdio servers only; results are capped at 25k characters.
- Subagents are one level deep and cannot use `Skill`, `Task`, `TodoWrite` or `ExitPlanMode`.

## Scripts

- `npm run dev` — Start Electron + Vite in development mode
- `npm run build` — Build main, preload, and renderer bundles
- `npm run typecheck` — Run TypeScript typechecking for Node and Web targets
- `npm test` — Run unit and component tests with Vitest
- `npm run package:mac` — Build and package macOS `.dmg` and `.zip` artifacts via `electron-builder`
