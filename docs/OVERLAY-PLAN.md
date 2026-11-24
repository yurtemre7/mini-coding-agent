# Floating chat overlay (picture-in-picture) — feasibility and plan

Request: a small, opaque, floating chat window (history with scroll + prompt field) that stays visible on a single-monitor setup, including over full-screen and borderless-full-screen apps such as games.

## 1. Feasibility

Verdict: **feasible for borderless / windowed-fullscreen apps on Windows and macOS; not possible for true exclusive fullscreen without injecting into the game (which we will not do).**

| Case | Works? | How / caveat |
|---|---|---|
| Floating, frameless, always-on-top window over normal apps | Yes | `BrowserWindow({ frame:false, alwaysOnTop:true, resizable:true, skipTaskbar:true })`. Electron 36 supports all of it. |
| Over borderless-windowed games (Windows) | Yes | `win.setAlwaysOnTop(true, 'screen-saver')`. The desktop compositor draws it above. Many DX11/12 "exclusive" games are already flip-model borderless on Windows 10/11, so they work too. |
| Over native full-screen apps/Spaces (macOS) | Yes, with care | `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` + level `screen-saver`, ideally `type: 'panel'`. Electron may hide the Dock icon while the flag is toggled; handle it explicitly and test. |
| True exclusive fullscreen (old DirectX 9/11, some Vulkan) | No | A normal window cannot draw over it. Only hook/injection overlays can (Overwolf, Steam overlay style). These are flagged by anti-cheat (EAC, BattlEye, Vanguard) and risk bans. Out of scope; the UI must tell users to switch the game to "Borderless" or "Windowed fullscreen". |
| Linux X11 | Mostly | always-on-top honoured by most window managers. |
| Linux Wayland | Unreliable | The protocol has no general always-on-top; GNOME ignores it. Best effort, documented as unsupported. |
| Typing while a game has focus | Yes, via a global hotkey | `globalShortcut` toggles/focuses the overlay (RegisterHotKey on Windows works over borderless games). Showing without stealing focus uses `showInactive()`; typing needs focus, so the hotkey focuses it and the same hotkey (or Esc) returns focus to the game. |
| Games that lock the mouse (FPS) | Partly | Keyboard works after the hotkey. Mouse use needs the game to release the cursor (menu/pause). Optional "click-through when not focused" via `setIgnoreMouseEvents(true, { forward: true })`. |
| Opaque, minimal | Yes | No transparency needed, which also avoids GPU/compositing issues. |

Not verifiable in this container: real games, macOS Spaces, Windows DWM behaviour. Phase 0 is therefore a hands-on spike on real machines before any product work.

## 2. Architecture fit

- The runtime already lives in the main process (`Controller`); the renderer is a view. A second window is mostly a second view of the same state.
- Gap 1: `ipc.ts` sends events to `getWindow()` = the first window only. Change to broadcast `agent:events`, `prompt:request` and `terminal:event` to every live window; `session:getState` already lets a new window catch up.
- Gap 2: the message queue (JURA-19) lives in the renderer, so each window would have its own. For v1 the overlay uses its own queue and shows a note-free minimal composer; later move the queue into `Controller` (already a known gap in HANDOVER).
- Gap 3: permission prompts. Fail-closed rule applies: a pending prompt must be answerable from the overlay (compact Allow / Deny card) and must also surface in the main window. First answer wins; a stale answer is already ignored by id.
- Same renderer bundle, route `?view=overlay` → `OverlayApp` (reuses `ChatTranscript`, a trimmed `PromptInput`, `UsageMeter` as a thin bar). No second build target.

## 3. Plan

Each phase ends with lint, typecheck, tests and build green; every behaviour gets a test (Electron facade injected, so no real windows in tests).

**Phase 0 — spike (throwaway, no tests).** Tiny always-on-top window + global shortcut. Test on Windows 10/11 (borderless game, exclusive game, video player fullscreen), macOS (native fullscreen app, a game), one Linux X11. First run a free proxy test: open a YouTube video in browser Picture-in-Picture over the target game. Chrome's PiP is also an always-on-top window, so if it shows over the game, ours very likely will; if it does not, ours will not either. Also check whether Chromium's Document Picture-in-Picture API is usable in Electron 36 (untested, do not rely on it). Output: a compatibility table appended to this file and a go/no-go per platform. Decide `screen-saver` vs `pop-up-menu` level, `panel` vs normal window on macOS.

**Phase 1 — multi-window plumbing.** Broadcast events to all windows; window registry in `main/index.ts`; tests that two windows receive the same batches and that a prompt answered in one clears in the other.

**Phase 2 — `OverlayManager` (`src/main/overlay.ts`).** Creates/destroys the window, applies the always-on-top flags per platform, remembers bounds (clamped to a visible display, DPI aware, multi-monitor safe), registers/unregisters the global shortcut, falls back cleanly when the shortcut is taken. Prefs: `overlayEnabled`, `overlayShortcut`, `overlayBounds`. New IPC (`overlay:toggle`, `overlay:setEnabled`, `overlay:setShortcut`) with validators. Fail-closed: invalid shortcut → keep the old one and tell the user.

**Phase 3 — overlay UI.** Minimal opaque layout: draggable title strip with pin/close, scrollable history (existing transcript, compact density), prompt field at the bottom, tiny context meter, inline Allow/Deny card for prompts, "Open main window" link. Resizable with a sensible minimum. Esc or the shortcut hands focus back to the game.

**Phase 4 — settings and onboarding (JURA-7).** One plain toggle: "Floating chat — keep a small chat on top of other apps". Shortcut picker with a safe default (proposed `Ctrl/Cmd+Shift+Space`, changeable). Help text: "If your game uses exclusive fullscreen, switch it to Borderless or Windowed fullscreen so the chat can show on top." No jargon, works with defaults.

**Phase 5 — hardening and docs.** Manual verification matrix from Phase 0 re-run on the real implementation; HANDOVER section (design, platform limits, known gaps: Wayland, exclusive fullscreen, per-window queue); optional follow-up: move the queue into `Controller`, click-through mode, adjustable size presets.

## 4. Risks and decisions for the owner

- Exclusive-fullscreen games will not show the overlay. Acceptable? (Recommended: yes, document it; no injection.)
- Default shortcut and whether to allow click-through mode.
- Should the overlay stay open when the main window is closed (menu-bar/tray style app)? Recommended: yes, as an opt-in, in a later phase.
- macOS: hiding the Dock icon while the overlay is over a fullscreen Space is an Electron constraint; confirm it is acceptable.

## 5. Rough size

Phase 0: ~1 day on real machines. Phases 1–4: about 3–4 focused days. Phase 5: ~1 day. The platform behaviour in Phase 0 is the main uncertainty.
