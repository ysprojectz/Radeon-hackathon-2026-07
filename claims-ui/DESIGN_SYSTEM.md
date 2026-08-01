# ACOS Design System — Enterprise Standard (v1.1, 2026-07-24)

This is the single source of truth for color, typography, spacing, and
component standards across the ACOS claims-ui frontend. It replaces the
ad-hoc, per-component color choices found throughout the app as of this
writing. Decided once, here, so execution work doesn't fragment into
inconsistent choices file-by-file.

**v1.1 revision, same day:** superseded v1.0's "dark-mode-only" decision.
This is claims/medical software — a light, clean, clinical color scheme is
the correct domain convention (matches how enterprise medical/claims
platforms are normally built; a dark neon dashboard reads as consumer/
gaming). **The app is now light-mode-only** (still no toggle — one theme,
just the other one). All token values below are the light-theme values;
treat any dark hex values found elsewhere in the codebase as stale.

**Critical gotcha found during the light-mode conversion, read before
touching tokens again:** `app/tokens.css` and `app/professional-theme.css`
had a genuine CSS circular custom-property reference — tokens.css defined
`--surface-base: var(--bg-card)` (a legacy alias) while professional-
theme.css separately defined `--bg-card: var(--surface-base)` (pointing
back). A cyclic `var()` reference resolves to nothing everywhere it's used,
per the CSS spec — this silently made every card/panel using `--bg-card`
render fully transparent, with no console error or visual crash, just an
empty background. It went undetected through an entire prior redesign pass
because the previous (dark) values happened to still look plausible against
a dark backdrop-filter blur. **Lesson: never redeclare a token in a second
file by pointing it at that same file's own alias for the first token** —
if `professional-theme.css` needs a token tokens.css already defines, it
should reference tokens.css's real name directly, never round-trip through
a legacy alias. When in doubt, verify a token isn't circular by checking in
a real browser: `getComputedStyle(document.documentElement).getPropertyValue('--your-token')`
should return the real value, not an empty string.

**Why this exists:** an audit (screenshots of the live dashboard, claims
list, and review queue pages, plus a full read of `app/globals.css`) found:
- KPI/stat cards each get an arbitrary, unrelated accent color (blue, purple,
  pink/magenta, amber, green — with no semantic meaning behind the choice)
- The root token file (`app/globals.css`) literally defines pink and purple
  as "brand" colors (`--color-brand-accent-1: #f8a5c2`, `--color-brand-
  accent-2: #a855f7`) — this is the actual source of the multi-color spread,
  not just inconsistent component-level choices
- "Glow" shadow effects (`shadow-glow-cyan`, `shadow-glow-emerald`) read as
  consumer/gaming UI, not enterprise software
- Light mode is broken in visible ways (sidebar section headers nearly
  invisible, icon backgrounds staying dark against light cards) because
  color correctness is patched after the fact via ~1688 lines of `!important`
  attribute-selector overrides in `globals.css`, rather than components using
  theme-adaptive tokens correctly to begin with

## 1. Color

### 1.1 Brand / accent
One primary accent, used deliberately and sparingly — primary buttons, active
nav/tab state, focus rings, key links, chart primary series. NOT smeared
across every icon background or card for decoration.

| Token | Value | Use |
|---|---|---|
| `--brand-primary` | `#2563EB` (blue-600) | Primary actions, active states, focus rings |
| `--brand-primary-hover` | `#1D4ED8` (blue-700) | Hover/pressed state of primary actions |
| `--brand-primary-subtle` | `#EFF6FF` (blue-50) light / `rgba(37,99,235,0.14)` dark | Subtle tinted backgrounds behind brand-colored content (e.g. active nav item background) |

The ACOS logo mark itself is a separate brand asset and is out of scope here
— only the UI chrome (buttons, links, active states, focus rings) moves to
this blue. Do not recolor the logo.

### 1.2 Semantic status colors
Used **only** for their semantic meaning. Never decoratively. If a card/icon
doesn't represent success, warning, danger, or informational status, it uses
a **neutral** treatment (see 1.3), not a random hue.

| Meaning | Token | Value |
|---|---|---|
| Success / positive / settled | `--status-success` | `#059669` (emerald-600) |
| Warning / needs attention | `--status-warning` | `#D97706` (amber-600) |
| Danger / error / blocked / overdue | `--status-danger` | `#DC2626` (red-600) |
| Informational (distinct from a primary action) | `--status-info` | `#2563EB` (same as brand-primary — don't introduce a second blue) |

Delete `--color-brand-secondary` (`#f7dc6f` yellow), `--color-brand-accent-1`
(`#f8a5c2` pink), `--color-brand-accent-2` (`#a855f7` purple) entirely — these
are the root cause of the multi-color spread and have no defined semantic
meaning. Anywhere they're referenced, replace with the correct semantic color
above or a neutral (1.3), based on what that specific instance is actually
communicating (read the surrounding context — don't do a blind find/replace).

### 1.3 Neutrals (backgrounds, borders, text, "no special meaning" icons)
A single, consistent slate scale, used for everything that isn't brand or
semantic status. Most KPI card icons (e.g. "Total Claims," "Overall Volume,"
"Market Distribution" — things that are just informational counts with no
inherent status) should use a neutral treatment, NOT a random accent color.

| Token | Live value (light — the only theme) |
|---|---|
| `--bg-primary` (page background) | `#F8FAFC` (slate-50) |
| `--bg-card` | `#FFFFFF` |
| `--bg-card-muted` (neutral icon chips, subtle fills) | `#F1F5F9` (slate-100) |
| `--text-primary` | `#0F172A` (slate-900) |
| `--text-secondary` | `#475569` (slate-600) |
| `--text-muted` | `#64748B` (slate-500) |
| `--border-subtle` | `rgba(15,23,42,0.08)` |
| `--border-strong` | `rgba(148,163,184,0.28)` | `rgba(15,23,42,0.16)` |

Keep the existing `--acos-*` naming as aliases if needed for a lower-risk
migration, but they must resolve to these values — don't maintain two
parallel palettes.

### 1.4 Shadows / elevation
Remove `shadow-glow-cyan`, `shadow-glow-emerald`, `shadow-glow-danger`, and
any other colored "glow" shadow. Replace with standard neutral elevation:

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.06)` |
| `--shadow` | `0 2px 8px rgba(0,0,0,0.08)` |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.10)` |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.14)` |

One exception: a focus ring may use `--brand-primary` at low opacity
(`0 0 0 3px rgba(37,99,235,0.35)`) — that's a functional accessibility
affordance, not decoration.

## 2. Typography
- One UI sans-serif (`--font-ui`, already defined) for all interface text.
  Remove any ad-hoc `font-*` overrides on individual components that aren't
  using this variable.
- Type scale (use exactly these steps, nothing in between):

| Role | Size | Weight |
|---|---|---|
| Eyebrow / label / metadata | 11px | 600, letter-spacing 0.04em, uppercase |
| Body small / secondary | 13px | 400–500 |
| Body / default | 14px | 400 |
| Card value / emphasis | 20px | 600 |
| Section heading | 16px | 600 |
| Page title | 22px | 700 |

Don't use font-weight 800/900 anywhere — 700 is the maximum. Heavier weights
read as consumer/marketing, not enterprise software.

## 3. Spacing & layout
- Use Tailwind's default 4px-based spacing scale exclusively (`p-2`, `p-4`,
  `gap-4`, `gap-6`, etc.) — no arbitrary one-off pixel values (`p-[13px]`,
  `mt-[7px]`) unless there's a documented, specific reason.
- KPI/stat card grid: consistent gap (`gap-4`), consistent internal padding
  (`p-5`), consistent icon-chip size (40×40px) and corner radius across every
  instance of this pattern app-wide — audit every page that has a stat-card
  row (dashboard, claims list, review queue, reports, and others) and make
  them structurally identical, not just similar.
- Page header pattern: title + optional breadcrumb on the left, primary
  action(s) on the right — same vertical rhythm and alignment on every page.

## 4. Buttons
Four variants only, used consistently everywhere (check `components/ui/
button.tsx` or equivalent shadcn primitive and enforce it — don't let pages
define their own one-off button styles):

| Variant | Use | Style |
|---|---|---|
| Primary | The one main action on a screen/section | Solid `--brand-primary`, white text |
| Secondary | Alternative but still important actions | Outline, `--border-strong`, `--text-primary` |
| Ghost | Low-emphasis / toolbar actions | No border/fill until hover, `--text-secondary` |
| Destructive | Delete/reject/deny-type actions | Solid `--status-danger`, white text |

Consistent height (36px default, 32px compact), padding, corner radius
(`--radius-button`), and focus ring across all four.

## 5. Dialogs / modals
- Consistent header (title + close button top-right), consistent footer
  button alignment (primary action right-aligned, secondary/cancel to its
  left), consistent overlay dim (`rgba(0,0,0,0.5)`), consistent corner radius
  and max-width per dialog size class (sm/md/lg — define these once, reuse).
- Audit every modal/dialog in the app against this and fix outliers rather
  than leaving each screen's dialog subtly different.

## 6. Responsive behavior
Verify and fix at three breakpoints minimum: 375px (mobile), 768px (tablet),
1440px (desktop). Specifically check:
- Sidebar collapses to an overlay/drawer below tablet width, doesn't just
  compress and clip
- Stat-card grids reflow (4-across → 2-across → 1-across), never overflow or
  cause horizontal page scroll
- Tables/lists get their own horizontal scroll container on narrow
  viewports rather than breaking the page layout
- No text truncation/overlap at any of the three breakpoints on any audited
  page

## 7. Light/dark mode — fix at the root, not with overrides
The current approach patches color mistakes globally via `!important`
attribute selectors matching partial class names (e.g. `[class*="text-white/
6"]`). This is fragile — it silently breaks for any new component using a
pattern the overrides don't anticipate (this is exactly why sidebar section
headers and stat-card icon backgrounds are currently broken in light mode).

**Correct fix:** components should reference the semantic tokens above
(`text-text-primary`, `bg-bg-card`, etc.) directly, which already resolve to
the right value per theme via the CSS variable definitions — not hardcoded
`text-white/60`-style utility classes that then need a global override to
"fix" after the fact. Go through components using raw white/black-opacity
utilities and switch them to the semantic token classes so they're correct
by construction in both themes. Once components are fixed at the source, the
override layer in `globals.css` should shrink dramatically — remove overrides
that are no longer needed rather than leaving dead CSS behind.
