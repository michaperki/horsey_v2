# Admin Console — Next Pass (redesign)

Living note for the admin dashboard redesign. The current admin is a functional
read/mutate portal (Users · Games · Reports · Stuck · Ledger · Challenges ·
External · Purchases · Audit) rendered as a flat tab bar over dense tables in the
light "paper" theme. It works, but it reads as a generic CRUD tool, not a Horsey
surface, and it lands an operator in a wall of Users rows with no triage.

Companion docs: `docs/PROJECT_SOUL.md` (mood + intentional casino energy),
`docs/marketing/IMAGE_AD_PROMPTS.md` (brand visual grammar), `docs/FAIR_PLAY_NEXT_PASS.md`
(what the admin must observe), `docs/IMPLEMENTATION_PLAN.md` § 8 / Phase 6 (admin roadmap).

Scope decision (2026-05-29): **full IA restructure + visual reskin**, planned first.

## Brand → operator-console translation

The brand image is a premium product-photo of *wagered chess with poker-floor
energy*: deep green felt, warm paper, ink-black pieces, muted gold for
money/escrow/pot, small red only for urgency (clock pressure). Restrained and
chess-first, **not** casino-loud. For an internal operator tool the right
reference is a **sportsbook / trading ops terminal**: dense, legible, premium,
dark felt chrome with paper data surfaces. We borrow the palette and restraint,
not the chip-physics animations (those stay in the player app).

All tokens already exist in `styles.css` — this is *applying* them with intent,
not inventing a palette:

| Token | Hex | Console role |
|---|---|---|
| `--felt` / `--felt-2` | `#174d35` / `#0f3426` | Chrome: header rail, nav, group dividers, panel frame |
| `--paper` / `--paper-2` | `#fbf6ea` / `#ece1cd` | Data surfaces: tables, cards — rows stay legible/dense |
| `--ink` / `--muted` | `#1b1815` / `#6d6253` | Text |
| `--gold` / `--gold-2` | `#d3a441` / `#f1c96b` | **Money only**: Balance, Escrow, Pot, Ledger amounts, Purchases, settlement |
| `--red` | `#b53a2d` | **Urgency only**: stuck games, open reports, hard-ban/restriction, suspicious review |
| `--green` | `#267a4b` | Healthy/positive operational state (live, clean) |

Discipline rules (the whole point of "restrained"):
- Gold is never decorative. If a cell isn't money/escrow/pot, it is not gold.
- Red is never a general accent. It marks something an operator must act on.
- Felt is chrome and framing; data lives on paper so 12px tabular rows stay readable.
- No confetti, no chip animations, no gradients-for-fun. Polish = spacing,
  alignment, tabular-nums, restraint. "Fintech, not Vegas."

## IA restructure

### 1. Overview landing (new default)
Open the admin on a **triage Overview**, not the Users table. A HUD-like status
strip + recent-flags read — the operator's "what needs me right now":

- Status tiles (counts, color by token): **Live games** (green), **Open reports**
  (red when >0), **Stuck games** (red when >0), **Pending analysis** (gold),
  **Restricted accounts** (red when >0).
- Below the strip: a compact **recent flags** list — newest open reports +
  newest `suspicious`/`open` analysis reviews — each linking into the relevant tab.
- Tiles are clickable → jump to the corresponding tab pre-scoped where possible.

### 2. Grouped navigation (replace flat tab bar)
Three operator-meaningful groups instead of nine equal tabs:

- **TRUST** — Reports · Fair-Play Queue · Restrictions (derived from Users)
- **MONEY** — Ledger · Purchases · Escrow (derived from Users escrow)
- **OPS** — Games · Stuck · Challenges · External · Audit · Users

Group labels are felt-rail section headers; tabs sit under them. `Overview` is a
standalone home above the groups. Fair-Play Queue is **new** — today the only
path to the analysis panel is the Games tab's "Recently analyzed" table; it
deserves first-class placement under TRUST (see memory: admin analysis review entry).

### 3. Analysis panel stays, restyled
The Fair Play Review panel (phase/critical/clock/baseline/concern + engine-rank
bars) is the one rich surface and is good — it gets the felt-frame + gold-money
treatment and becomes the destination of the Fair-Play Queue, not a second card
hanging off Games.

## Backend needs

- **`GET /api/admin/overview`** (new) — single cheap summary for the triage strip:
  counts {liveGames, openReports, stuckGames, pendingAnalysis, restrictedUsers}
  + small recent-flags arrays. Aggregates existing queries; avoids 5 client fetches.
- **Fair-Play Queue** — either a `GET /api/admin/analysis?status=open|suspicious`
  list endpoint, or extend the games payload. Prefer a dedicated endpoint so the
  queue isn't capped by the "recent finalized" window.
- Everything else reuses current endpoints; the restructure is mostly client-side.

## Staged slices (small commits, review running app between)

1. **Tokens + chrome.** Felt header rail, paper data surfaces, gold-money / red-urgency
   cell helpers, denser tables. **Done** (`36b71b6`).
2. **Overview endpoint + landing.** `GET /api/admin/overview`, triage strip, recent-flags,
   default tab. **Done** (`160f925`).
3. **Grouped nav.** TRUST / MONEY / OPS sections + Restrictions derived view (escrow folded
   into a Users column + Overview tile per resolved decisions). **Done** (`cd5087c`).
4. **Fair-Play Queue.** `GET /api/admin/analysis` + status chips + first-class tab; analysis
   panel restyled and opened as an in-place breadcrumb drilldown. **Done** (`2d62f7e`, `85bfb4a`).
5. **Polish pass.** Header carries the active section + a Refresh control; removed the
   redundant "Recently analyzed" section from the Games tab (and trimmed its server payload —
   the Fair-Play Queue owns analyzed games now); Pending-analysis tile points at the queue;
   consistent empty-state copy. **Done.**

Redesign complete. Future work would be incremental (e.g. column-level numeric right-align,
per-tab empty-state context, a real pending-analysis job list rather than just a count).

## Resolved decisions (2026-05-29)

- **Escrow** is *not* its own view — it's a gold money column + emphasis on Users
  plus a total-escrow-held tile on Overview. MONEY group is therefore **Ledger ·
  Purchases** only.
- **Overview recent-flags** show operator-actionable items only (open reports +
  open/`suspicious` analysis reviews). No high-ACPL "clean" games — that's noise.
- **Desktop-operator-first.** Keep the existing table scroll-wrap for narrow
  screens; do not invest in a dedicated mobile admin layout.
