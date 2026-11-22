# MCA design system

One rule: **use tokens, never raw palette colors or one-off sizes.** shadcn/ui (new-york) components are the building blocks; this file says how they are themed and composed. Tokens live in `src/renderer/src/index.css` (`:root` for light, `.dark` for dark, mapped by `@theme inline`).

## Color tokens (Tailwind classes: `bg-*`, `text-*`, `border-*`)
| Token | Use |
|---|---|
| `background` / `foreground` | the work area and its text |
| `sidebar` | side columns (chats, tools): one step off the background |
| `surface` | floating, raised things: the composer, menus |
| `card`, `popover` | shadcn containers |
| `muted` / `muted-foreground` | quiet fills, secondary text |
| `accent` | hover and selected rows |
| `primary` | the one main action in a view |
| `destructive` | errors, deletions, dangerous commands (never decoration) |
| `success`, `warning`, `info` | status: additions, caution, neutral notices |
| `border`, `input`, `ring` | lines, fields, focus |

Never write `text-red-600`, `bg-green-500` or hex values: add a token instead. Status is never conveyed by color alone (pair it with `+`/`-`, an icon or text).

## Shape, depth, motion
- Radius: `rounded-md` controls, `rounded-lg` panels and menus, `rounded-2xl` the composer, `rounded-full` icon buttons in it.
- Depth: borders first; `shadow-float` only for things that float over content (composer, popovers).
- Motion: 150 ms `--ease-out` for hover/focus/drag states; nothing animates continuously except a running spinner.

## Type and spacing
- Fonts: `font-sans` (system UI), `font-mono` for code, commands, paths and diffs.
- Sizes: `text-sm` body, `text-xs` secondary and toolbars, `text-base` only for inputs on small screens. No other sizes.
- Spacing: a 4 px grid (`gap-1/2/3`, `p-2/3`); side columns `p-3`, dialogs `gap-4`.

## Patterns
- **Icon buttons** have `aria-label` and a `title`; 32 px (`h-8 w-8`) in toolbars.
- **Quiet controls** (selects inside the composer): `border-0 bg-transparent shadow-none hover:bg-accent`.
- **Dialogs**: `max-h-[90vh] overflow-y-auto`, long text wraps (`[overflow-wrap:anywhere]`), destructive confirmations name the object.
- **Empty states** explain the next step; **errors** use `role="alert"` and `text-destructive`.
- **Focus** is visible everywhere (`ring`); containers that wrap a field show it with `focus-within`.
- Keyboard: Cmd/Ctrl+B sidebar, Cmd/Ctrl+J tools, Enter sends, Shift+Enter newline, `/` commands, `@` files.
