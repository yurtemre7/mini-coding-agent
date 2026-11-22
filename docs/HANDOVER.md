# MCA Implementation Handover

Status as of 2026-11-21. Design reference: [`docs/PLAN.md`](PLAN.md). Contributor workflow: [`CLAUDE.md`](../CLAUDE.md).

## Summary

**The first implementation is done.** Milestones 0–8 of the plan are implemented, tested and merged to `main`: provider-agnostic runtime (Anthropic, OpenRouter), file/search/Bash/Web/Task/Todo/Skill tools, permissions and workspace trust, hooks, project context, sessions, compaction, MCP (stdio), custom commands and skills, the `mca` CLI and the Electron desktop app, plus CI and a tag-triggered release workflow for an unsigned macOS app. Beyond the plan: model picker, effort setting, `.env` keys, light/dark theme, ESLint, attachments.

| | |
|---|---|
| Branch | `main` is the trunk; CI is green on Ubuntu and macOS, and `package:mac` succeeds in CI |
| Tests | 446 (Vitest, no network). `bash.test.ts` "timeout kills the whole process group" fails only in the Linux dev container, passes on CI runners |
| Release | `v0.1.0` matches `package.json` but is **not tagged yet** (the cloud session could not push tags). The release workflow has never run |
| Live API | never exercised: every test uses `FakeProvider` or recorded/synthetic streams |
| Packaged app | built by CI, never launched |

## Running it

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY or OPENROUTER_API_KEY
npm run dev                   # desktop app; restarts itself when main/preload change
npm run build && node out/cli/index.js -p "read package.json and tell me the version"
node out/cli/index.js         # interactive REPL in the current directory
```

CLI flags: `-p/--print`, `--provider`, `--model`, `--effort`, `--permission-mode`, `--allowed-tools`, `--trust`, `--continue`, `--resume <id>`, `--version`, `--help`.

## Milestone status

| Milestone | Status | Commits | Review |
|---|---|---|---|
| 0 Scaffolding | Done | `229993c` | Clean |
| 1 Contracts, providers, headless loop | Done | `d6f75cf`..`39743e8` | 1 fix round |
| 2 File tools, search, Bash | Done | `3b9042a`..`f815dd8` | 2 fix rounds |
| 3 Permissions, trust, REPL | Done | `9f03f38`..`8bb75ce` | 3 fix rounds (security) |
| 4 Desktop vertical slice | Done | `f837382`..`e397d36` | 1 fix round |
| 5 Hooks, project context | Done | | Self-checked |
| 6 Planning, subagents, WebFetch | Done: TodoWrite + sidebar, ExitPlanMode + plan dialog with reject feedback, Task subagents (Explore / general-purpose, nested by `parentId`), WebFetch | | Self-checked, no live API |
| 7 Sessions, compaction, MCP | Done: sessions (`fa52cdf`, `c044b19`), compaction, MCP (stdio) | | Self-checked, no live API |
| 8 Skills, commands, polish, packaging | Done (merged); packaged-app check from Finder still manual: `Skill` tool + skills index in the context reminder, custom commands (`$ARGUMENTS`, `$1`–`$9`), `/model` `/provider`, desktop slash autocomplete (and `/…` input routed to commands), `--help`, README | | Self-checked, no live API |

Work requested outside the plan (all after Milestone 4, checked by the controller, not by a separate reviewer):

| Feature | Commits |
|---|---|
| API key from `.env` (lowest priority) + `.env.example` | `f90385e` |
| Model combobox (live model list), key source + "key rejected" status, Lucide icons | `8cac7d6` |
| Overflow fixes in dialogs, tool cards, chat, sidebar, picker | `b4ccc68`, `66d5253` |
| Effort setting (default Medium) in providers, agent, CLI and desktop; resend without effort if a model rejects it | `a42d8a0`, `647d8da` |
| `npm run dev --watch`, test isolation of `HOME` | `5836d45`, `b66a3a3` |
| "Free" badge on OpenRouter `:free` models | `a42d22f` |

## Architecture as built

```text
src/shared/   types.ts (AgentEvent, IpcContract, ModelInfo, Effort...), reducer.ts (one pure reducer for main + renderer)
src/core/     pure Node runtime, no Electron/React imports
  provider/   types, anthropic, openrouter, fake, models, factory, retry
  agent.ts    runTurn / runTools / runOne / sealHistory / AgentSession
  tools/      files (Read/Write/Edit), search (Glob/Grep via rg), bash
  exec.ts env.ts paths.ts filestate.ts permissions.ts settings.ts trust.ts
  credentials.ts commands.ts session.ts registry.ts tool.ts
src/cli/      index.ts (flags), headless.ts (-p), ui.ts (REPL)
src/main/     index.ts (window), ipc.ts, controller.ts (desktop Frontend), batcher.ts, validate.ts, urls.ts
src/preload/  contextBridge `window.mca` with runtime channel allowlists
src/renderer/ App, ChatTranscript, PromptInput, ModelCombobox, PermissionDialog, SettingsDialog, ChatsSidebar
```

Milestone 7 notes: `compact.ts` summarizes the whole history into one `<system-reminder>` user message (todos and instruction reminder re-attached, `readState` cleared). It triggers at 80% of the window after any model call (also mid-turn, and at the start of a turn from the last known size), on `/compact [focus]`, and once per turn on a "prompt too long" rejection (the summary request itself retries with the oldest half of tool results cleared). The transcript gets a `compact` record; loading restarts from the newest one. After a compaction `/rewind` restores files but the compacted history stays. `mcp.ts` runs stdio servers from `.mcp.json` and `mcpServers` in settings files: project-level ones start only in a trusted workspace (and are listed in the trust prompt), user-level ones always. Servers connect in parallel with a 10 s timeout; a failure is a warning. Tools are `mcp__<server>__<tool>`, never read-only (so they prompt in default mode), results are text only and capped at 25k. `/mcp` and the Settings dialog show status.

Registered tools today: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `TodoWrite`, `ExitPlanMode`, `Task`, `WebFetch`, `Skill`. MCP tools are added per workspace. Subagents never get `Task`, `TodoWrite`, `ExitPlanMode` or `Skill`.

Workbench P1.1/P1.2 notes: `core/checkpoints.ts` (CheckpointStore: content-addressed blobs + per-turn manifests), `core/changes.ts` (summaries and unified diffs via jsdiff; binary and >2 MB files are flagged, not diffed), a `changes` event before `turn_end`, `/diff [all]`, IPC `changes:diff`/`changes:revert` and the desktop DiffPanel (Turn/All, per-file confirmed revert, disabled while busy).

Backlog-intake batch (JURA-2/3/10/14/15/16/17): permission prompts clip long commands and rules; `AnthropicProvider.contextWindow` prefers the models API's `max_input_tokens`; `/resume` and "workspace switch continues the newest chat"; recent-workspace removal (`workspace:forget`, list only); key help on the setup screen; `UsageMeter` (context fill + per-chat token totals, cost estimate added later, see below); `core/watchdog.ts` loop detector, `attention` event, `Controller` notify timers and `main/notify.ts` (desktop only; phone push deferred, needs a delivery channel). Not done: JURA-1 terminal (P1.6, needs a pty dependency), JURA-2 thinking-mode toggle and cost estimate, JURA-7 broader non-technical UX.

Milestone 8 notes: skills live in `{~/,<project>/}{.claude,.mca}/skills/<name>/SKILL.md` (later wins); the reminder lists name + description (200 chars) and the `Skill` tool returns the body. Custom commands are `{...}/commands/<name>.md` (`$ARGUMENTS`, `$1`–`$9`); built-in names always win; a custom command becomes a normal prompt. The desktop prompt routes any `/…` text without attachments to `session:command`, and `commands:list` feeds the autocomplete.

Milestone 6 notes: subagents run at depth 1 with their own read bookkeeping but the parent's rewind checkpoints and permissions; `Explore` gets only static read-only tools. `WebFetch` follows same-host redirects only (a cross-host redirect is returned to the model), caps at 5 MB / 100k chars, and summarizes with the provider's fast model (`FAST_MODEL` sentinel resolved by the desktop provider proxy). Headless `-p` in plan mode prints the plan and stops. Also added since M4: light/dark/system theme (`mca.theme`), ESLint flat config (`npm run lint`, also in CI).

### Files on disk

| Path | Contents |
|---|---|
| macOS Keychain, service `mca` | API keys saved from the desktop Settings |
| `~/.mca/credentials.json` (0600) | Key fallback when the Keychain is unavailable |
| `.env` in the launch directory | Key fallback, checked last; only the two key variables are read |
| `~/.mca/state.json` | Trusted workspaces, recent workspaces, last provider/model/effort |
| `~/.mca/projects/<path>-<hash>/<id>.jsonl` (0600) | Saved chats; `.jsonl.bak` next to a repaired damaged one |
| `~/.mca/settings.json`, `.mca/settings*.json`, `.claude/settings.json` | Permission rules and `defaultMode` |

## Decisions that differ from the plan text

- **ripgrep path**: `@vscode/ripgrep` 1.18 ships the binary in a platform package, so `rg` resolves via the package's `rgPath` with `app.asar` → `app.asar.unpacked`, and `electron-builder.yml` unpacks `node_modules/@vscode/ripgrep-*/bin/**`.
- **`max_tokens` stop** drops every `tool_use` in that message, not only the cut one (OpenRouter emits the cut call too, so it cannot be singled out).
- **`bypassPermissions`** does not prompt for protected paths (the Paths rule wins), but explicit and built-in `ask` rules (`.env*`, `~/.ssh`, `~/.aws`) still prompt.
- **Untrusted workspaces** also ignore the project `defaultMode`, not only project `allow` rules.
- **Bash deny rules over-deny on purpose**: with any Bash deny rule, the whole command is de-quoted and tokenised, and the rule matches if its command word appears anywhere (`echo rm` is denied by `Bash(rm:*)`). Computed command words (`$`, `{`, globs) and wrappers (`env`, `xargs`, `sudo`, `find -exec`...) count as matches.
- **Allow rules** never match a command with a leading `VAR=` assignment, and match file paths by realpath only (symlinks cannot borrow an allowed glob).
- **Read-only Bash auto-allow** is narrow: any argument with `$ ~ * ? [ {`, stray quotes or backslashes prompts, and `rg`/`grep` accept only a small option allowlist. `tree` was removed.
- **Desktop state sync**: mutation IPC calls return nothing; every event carries a sequence number and the renderer drops events already contained in its snapshot.
- **Renderer slash commands** are allowlisted; `/trust` from the window goes through the trust dialog, `/exit` is refused.
- **Key lookup order**: env → Keychain → `~/.mca/credentials.json` → `.env` (last, so a cloned repo's `.env` never overrides your key).
- **Effort** is sent on every request (default `medium`); OpenRouter maps `xhigh`/`max` to `high`; an Anthropic model that returns a 400 mentioning effort is retried once without it and remembered for the session.

## Releasing

Unsigned macOS builds are released by tag (`.github/workflows/release.yml`):

```bash
npm version 0.2.0 --no-git-tag-version   # bump package.json, then commit it
git commit -am "release 0.2.0" && git push
git tag v0.2.0 && git push origin v0.2.0
```

The tag must equal the `package.json` version, or the workflow stops. It runs lint, typecheck and tests, builds arm64 and x64 `.dmg`/`.zip` with `identity: null` (no signing, `CSC_IDENTITY_AUTO_DISCOVERY=false`), writes `SHA256SUMS.txt`, and creates the GitHub release with `gh release create` (a tag containing `-`, such as `v0.2.0-beta.1`, is marked prerelease). Users must clear the quarantine flag (`xattr -dr com.apple.quarantine`), which the release notes explain. The release workflow has never run: the first tag (`v0.1.0`) is its test.

## Known gaps and parked findings

- Deny rule `Bash(git push:*)` does not match `git -c x=y push` (options between the words).
- `git diff HEAD~1`, `ls *.ts`, `grep -rn` and similar now prompt (false positives of the strict read-only check).
- Rewind checkpoints are persisted per chat (`<id>.checkpoints/`, 200 MB cap, oldest turns evicted), so a resumed chat can rewind files (the conversation is not rewound). Persist failures are swallowed silently. Changes made through `Bash` are never covered (backlog: git-snapshot diffs).
- `Edit` decodes files as UTF-8; a non-UTF-8 text file is rewritten with replacement characters.
- `readState` is keyed by resolved path, not realpath (read via symlink, then edit via the real path reports "not read").
- `Glob` understates the omitted-file count on very large trees.
- Unicode case folding beyond `toLowerCase` (e.g. long s) is unverified on APFS for protected paths.
- `listSessions` parses every transcript in a workspace (slow with very large histories); the sidebar does not highlight the active chat.
- MCP: stdio only (no HTTP/SSE, OAuth, resources or prompts); servers are not restarted if they crash mid-session; `Explore` subagents never see MCP tools. Compaction was not exercised against a real model.
- The `will-navigate` block and the preload allowlist have no runtime tests (the allowlist is checked against the contract at compile time).
- `env.ts` login-shell parsing can be confused by shell startup output printed before `env -0`.

## Not verified (manual)

- Any call to the real Anthropic or OpenRouter API, including that `claude-sonnet-5-5`, `claude-haiku-5-5` and the `anthropic/...` OpenRouter ids are valid, and which models accept `output_config.effort`.
- Packaged-app check from Finder (M8): bundled `rg`, Bash finds node/git, Keychain read; plus the unproven release workflow (first tag is its test).
- Keychain round-trip from the packaged app; launching from Finder (PATH resolution, bundled `rg`).
- Ctrl+C behaviour in a real terminal (logic is unit-tested), and Ctrl+C leaving no child process behind.
- Desktop flows by hand: folder picker, closing the window mid-turn, trust dialog on launch, resuming a saved chat. The user has run the app and confirmed chat, permission prompts and the model picker work.
- CI on `macos-latest` and `npm run package:mac`.

## Development flow

1. Branch from `main` (`feat/<topic>` or `fix/<topic>`); never commit to `main` directly once a remote reviewer exists. Small, focused commits.
2. Before pushing run `npm run lint && npm run typecheck && npm test && npm run build`. New behaviour needs a test (core logic in `src/core/*.test.ts` with `FakeProvider`, UI with Testing Library).
3. Open a PR to `main`. CI (`ci.yml`) runs lint, typecheck, test and build on Ubuntu and macOS, then `package:mac`; all must be green to merge.
4. Update this file when behaviour, decisions or known gaps change (keep *Backlog* current: add what you find, delete what you fix).
5. Release: bump `version`, commit, tag `vX.Y.Z` (see *Releasing*). Tags `vX.Y.Z-rc.1` make prereleases.

## Backlog

Ordered by value. Pull from the top; each item should end as a PR.

**Verify first (needs a Mac / real keys)**
1. Push tag `v0.1.0`, watch the release workflow, install the `.dmg` per the README, and walk the packaged-app checklist: bundled `rg` runs, Bash finds `node`/`git` when launched from Finder, Keychain key is read, no Keychain prompt loop.
2. Smoke-test with real keys: `mca -p` on both providers; desktop flow Read → Grep → Edit (approve) → Bash → Rewind; plan mode with parallel Explore subagents; a long session that compacts then `--continue`; a `.mcp.json` server.
3. Confirm model ids and which models accept `output_config.effort`.

**Product**
- Highlight the active chat in the sidebar.
- MCP: restart crashed servers, expose MCP tools to `Explore`, HTTP/SSE transport.
- Code signing and notarization (needs an Apple Developer ID), then auto-update.
- Windows/Linux builds (the core is portable; Keychain falls back to `~/.mca/credentials.json`).

**Hardening** (see *Known gaps* for the full list): Bash deny-rule matching with options between words, `Edit` on non-UTF-8 files, `readState` realpath keying, runtime tests for the `will-navigate` block and preload allowlist.

## Working notes for the next person

- Restart `npm run dev` after editing anything in `src/main`, `src/preload` or `src/core` if `--watch` did not pick it up; a stale main process shows "No handler registered for ..." in the app.
- Core tests run with a throwaway `HOME` (`src/core/test-home.ts`); new tests that touch `~/.mca` need nothing extra.
- The implementation ledger, task briefs and review packages are in `.superpowers/sdd/PLAN/` (git-ignored, local to this machine). `progress.md` there records every ruling with its reason.

## UI polish batch (JURA-7, partial)
Settings is a tabbed dialog (General: theme + notifications switch; Provider; MCP servers; About: version, license, platform, GitHub/issues/releases links from `REPO_URL`). The theme toggle moved out of the sidebar. New `EmptyState` guides first use (choose a folder, then "What should we work on?"); the provider setup card has a welcome line. Visual checks: build the renderer and load `out/renderer` in Playwright Chromium with a mocked `window.mca` (no Electron needed). Still open: sidebar restructure, first-run walkthrough, dark-mode review on a real Mac.

## Project management, instructions, notifications (batch 4)
- Chats: delete (inline confirm; the open chat is replaced by a fresh one; idle only) and export to Markdown (`core/export.ts`, save dialog in main). `deleteSession` removes transcript, `.bak` and checkpoints. Sidebar also has "Show in Finder" for the workspace.
- Custom instructions: Settings > Instructions. Stored in prefs (`systemPrompt`, `systemReplace`, capped at 20k chars), appended to the built-in prompt or replacing it; applied from the next turn via `AgentSession.setSystem`. The CLI (interactive and headless) reads the same prefs through `composeSystem`.
- Notifications (desktop, only while the window is unfocused, one Settings switch): task finished (`turn_end` reason done), stopped by error, permission prompt waiting, looks stuck, long turn. Aborted turns do not notify.
- Permission dialog buttons are now "Deny / Allow for this session / Allow once" (plan: "Reject plan / Approve plan"); dialogs scroll instead of overflowing.
- Not yet: rename chat, project-level instructions UI, delete all chats of a workspace.

## Workbench: git, terminal, layout (batch 5)
- Layout: header controls for 1/2/3 columns plus sidebar and tools toggles (Cmd/Ctrl+B, Cmd/Ctrl+J), persisted in localStorage (`lib/layout.ts`). The right column ("tools") has tabs Changes (agent diffs), Git, Terminal.
- Git (`core/git.ts`, no shell, `git` via execFile, no prompts/pager): status with branch/ahead/behind, stage/unstage, per-file staged/unstaged diff (untracked shown as added), commit, plain push (never forced; sets the upstream on origin the first time), branch list/create/switch (names validated by `git check-ref-format`). Paths from the renderer are rejected if absolute, `..` or option-like. Commit, push and switch are blocked while the agent runs.
- Terminal (`core/terminal.ts`): a command runner, NOT a pty: one login-shell command at a time in the workspace, streamed output (1 MB cap), Stop kills the process group, history with arrow keys. No vim/ssh prompts/colors. It is the user's own shell, so agent permission rules do not apply. A real pty needs `node-pty` (native rebuild + notarization impact): backlog.
- Not yet: resizable columns, discard-changes in the Git tab, pull/fetch, stash, merge-conflict UI, inline line comments.

## Catastrophic-command guard (loop iteration 2)
- `dangerOf(cmd)` in `core/permissions.ts`: `rm -r` on `/`, `~`, `$HOME` or a top-level system directory (and `--no-preserve-root`), recursive `chmod/chown` there, `dd of=/dev/<disk>`, `mkfs`/`fdisk`/`diskutil erase`, shutdown/reboot, fork bomb, `curl | sh`. Works through `sudo`/quotes/absolute paths/`&&` chains.
- Decision step 3 (a hard ask): prompts in EVERY mode including `bypassPermissions`, cannot be pre-approved by an allow rule or session grant, is never remembered (no `suggestion`), headless sessions deny it. `deny` rules and plan mode still win. Request carries `danger: true`: desktop shows a red warning and "Run anyway"; CLI prints WARNING.
- Known gap: only statically visible commands are matched; computed commands (`$cmd`, `eval`) get no danger warning and are NOT forced to prompt: in `bypassPermissions` or headless runs they are not caught. They cannot match a scoped Bash allow rule, but a bare `Bash` allow rule can permit them when no deny or ask rule applies. Quotes, `/bin/bash`, `env bash`, `/home/<me>` and per-segment operands are handled. Not a sandbox.

## Design system and composer (loop iteration 3)
- `docs/DESIGN.md` is the rulebook: semantic tokens added (`success`, `warning`, `info`, `sidebar`, `surface`, `shadow-float`, font stacks); diffs now use `text-success`/`text-destructive`; side columns use `bg-sidebar`. Known gap: other components were already token-based; a Storybook-style gallery and a `warning` use in UsageMeter are not done.
- Composer: one rounded card (focus-within ring, drag-over overlay), borderless auto-growing textarea, quiet toolbar chips, round icon Send/Stop, Attach and `@` buttons; `@` mentions workspace files (`workspace:files` IPC -> `core/workspace-files.ts`: `git ls-files -co --exclude-standard`, or a bounded walk; max 5000). The `@path` text is sent as written; the model reads it with its tools.
- Multimodal today: images (png/jpeg/gif/webp) and text files via paste, drop, picker, up to 10 x 5 MB. Not done: voice dictation (Electron has no working Web Speech backend; would need a local/whisper or provider transcription API), screenshot capture, PDF attachments, dropping folders.

## Cost estimate (per chat)
- `core/provider/pricing.ts` holds Anthropic list prices (per million tokens, checked 2026-11) and `estimateCostUsd`; the agent puts `costUsd` on each `usage` event (the provider's own figure wins, e.g. OpenRouter `usage.cost`), the reducer sums it into `usage.totalCostUsd`, and `UsageMeter` shows "Est. cost". `costPartial` (shown as "≥") means some request had no known price.
- Known gaps: it is an estimate (no tiers such as Haiku 5.5 above 100K, no fast-mode or batch pricing); subagent requests are not counted; there is no public API for remaining credit, so none is shown. Update `PRICES` when prices change.

## Workspace tiles in the sidebar
`ChatsSidebar` shows workspaces as collapsible tiles, each holding its chats; the open workspace starts expanded and the choice is remembered (`localStorage` `mca.collapsed`). Tiles reorder by drag and drop or Move up/down in the tile menu; "New workspace" sits on top. The order is the `recent` list in `~/.mca/state.json` (cap 30, new folders go on top, reopening keeps the position); `last` is a separate key for launch reopen. IPC: `workspace:overview` (all workspaces with their chats) and `workspace:reorder`. Opening a chat in another workspace switches workspace first. Menus are wide enough for "Export as Markdown" (previously clipped). Not visually checked in a running app. Remove-from-list is disabled for the open workspace.
