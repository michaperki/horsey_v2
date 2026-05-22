# Claude Design Review

This review treats Claude's design files as canonical source material for the first production architecture pass. The files are not the final app; they are design evidence for what Horsey must become.

## Files Reviewed

Low-fi / exploration:

- `Horsey Wireframes.html`
- `Horsey Wireframes (standalone).html`
- `Horsey Wireframes (standalone source).html`
- `app.jsx`
- `lobby.jsx`
- `wager.jsx`
- `ingame.jsx`
- `postgame.jsx`
- `profile.jsx`
- `primitives.jsx`
- `tweaks-panel.jsx`

Hi-fi / artboard direction:

- `Horsey Hi-Fi.html`
- `hifi-app.jsx`
- `hifi-system.jsx`
- `hifi-lobby.jsx`
- `hifi-wager.jsx`
- `hifi-game.jsx`
- `hifi-postgame.jsx`
- `design-canvas.jsx`

## Canonical Product Surfaces

The design set establishes these core surfaces:

- Lobby: quick match, stake selection, time control, open tables, live floor, rivals, online activity.
- Wager / scouting: incoming challenge, opponent dossier, recent form, tells, trust indicators, stake/time/pot summary, accept/counter/decline.
- In-game: live chess board, clocks, move history, eval/momentum, captured pieces, pot rail, escrow status, quick chat, draw/resign.
- Post-game settlement: final result, credited wallet amount, rake, balance/rating/streak change, final position, rematch, double-or-nothing, auto-requeue.
- Identity / profile: player history, head-to-head, earnings, tendencies, trust and safety, wallet/trust panels.

## Product Signals

The repeated motifs are important:

- Money is not decorative. Stakes, pots, escrow, rake, balance, and settlement are first-class.
- Opponent context matters before accepting a wager. The designs emphasize scouting, reliability, tendencies, head-to-head, and fair-play trust.
- The in-game experience should be tense but focused. Board, clocks, pot, and turn state should dominate.
- Mobile is not an afterthought. Hi-fi artboards include iPhone-class lobby, wager, in-game, and settlement flows.
- Rivalry and rematch loops are central. The product wants repeat opponents, histories, streaks, and fast follow-up games.

## What Is Placeholder

Claude's board components are visual placeholders using sparse unicode pieces. They do not establish final board implementation, legal move logic, drag/drop behavior, animation, orientation, premoves, clocks, or server validation.

Current implementation note: the production scaffold now has a custom board UI backed by server-validated `chess.js` rules, with legal hints, click/drag/keyboard interaction, edge coordinates, captured trays, promotion, and mobile-safe tap behavior. Treat it as the accepted current-milestone baseline; future board work should be scoped as named features such as premoves, animation, replay, or a documented permissive-license replacement.

The sample player data, balances, trust stats, anti-cheat labels, and game IDs are demo content. They establish required domains, not real data models.

The designs imply but do not solve:

- legal/compliance model for wagered chess;
- escrow and wallet ledger design;
- anti-cheat and fair-play enforcement;
- realtime architecture;
- chess rules and adjudication;
- dispute, disconnect, and timeout handling;
- payment provider integration;
- moderation and reporting operations.

## Design Principles To Preserve

- Keep chess legible and tactile.
- Keep money state explicit and auditable.
- Make trust and risk visible before a player accepts a wager.
- Make settlement immediate, understandable, and reviewable.
- Design for fast loops: quick match, rematch, counter, auto-requeue.
- Let desktop expose richer scouting and analysis, while mobile stays thumb-first and focused.
