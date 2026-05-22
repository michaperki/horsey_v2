# Architecture First Pass

This is a high-level starting point. It should guide early implementation without pretending the hard product decisions are already solved.

## System Shape

Horsey likely needs these major layers:

- Frontend app: production UI for lobby, wager/scouting, game, settlement, profile, wallet, account, and admin/support surfaces.
- Backend API: authenticated application API, user/session management, matchmaking, challenge lifecycle, game lifecycle, profiles, histories, wallet summaries, and settlement views.
- Realtime service: low-latency game state, clocks, presence, challenge notifications, reconnects, spectators, and quick chat.
- Chess domain: board state, legal move generation, validation, notation, result detection, clocks, resign/draw/timeout/disconnect adjudication.
- Money domain: wallet ledger, escrow holds, rake, settlement, refunds, chargebacks, deposits, withdrawals, reconciliation, and audit logs.
- Trust and safety: identity/KYC hooks, anti-cheat signals, fair-play review, reports, sanctions, device/session risk, and operational tooling.
- Data platform: event logs for games, financial events, trust signals, player stats, rivalry stats, and product analytics.
- Admin/ops: support views for wallet issues, disputes, anti-cheat reviews, stuck games, settlement correction, and moderation.

## Frontend Notes

The frontend should be designed as a real app, not a design replica. It needs reusable primitives, state management, route structure, authenticated sessions, realtime subscriptions, responsive layouts, and accessibility.

Initial route candidates:

- `/` or `/play`: lobby / quick match.
- `/challenges/:id`: wager scouting and accept/counter/decline.
- `/games/:id`: live game.
- `/games/:id/settlement`: result and post-game actions.
- `/players/:id`: profile and scouting.
- `/wallet`: balance, deposit, withdraw, escrow history.
- `/admin`: later operational tools.

## Backend Domain Model Candidates

Early entities to explore:

- User / account / profile.
- Wallet account and ledger entries.
- Challenge.
- Matchmaking ticket.
- Game.
- Game participant.
- Move.
- Clock state.
- Escrow hold.
- Settlement.
- Player stats.
- Trust profile.
- Report / fair-play review.

Money must use ledger-style accounting from the beginning. Avoid storing only mutable balances without auditable entries.

## Realtime And Chess

The server should be authoritative for game state. The client may preview legal moves for responsiveness, but submitted moves must be validated server-side.

Core requirements to design early:

- legal move validation;
- turn enforcement;
- clock authority and drift handling;
- reconnect and grace windows;
- resignation, draw offers, timeout, abandonment;
- move history and notation;
- game result finalization;
- idempotent settlement trigger after final result;
- spectator read model if live floor/watch remains in scope.

## Chess Board / Engine Direction

The project needs explicit licensing decisions before adopting chess UI or engine libraries. Chessground is currently treated as a poor fit because the user does not want license obligations that would force open-sourcing this project.

Current decision:

- Use `chess.js` for rules through Horsey's local `packages/chess` wrapper.
- Keep the board UI custom for now.
- The current board works but is crude; it is not the final product-quality board.

Options to evaluate:

- Continue improving the custom board UI while using `chess.js`.
- Build custom board UI and implement rules from scratch.
- Adopt a permissively licensed board UI package after verifying its current license, maintenance status, and suitability.

Do not import additional chess libraries until license and obligations are checked and recorded in docs.

## Money And Compliance

Because this is wagered chess, money and compliance are core architecture, not later polish. Before production use, the project will need clear decisions around:

- supported jurisdictions;
- age and identity verification;
- payment provider and payout provider;
- custody/escrow model;
- rake and fee disclosure;
- tax/reporting obligations;
- fraud, chargebacks, sanctions, and AML expectations;
- responsible play and account limits;
- dispute and refund policy.

Agents should flag these as product/legal requirements and avoid treating them as ordinary UI features.

## Early Implementation Sequence

A practical build order:

1. Create a real app skeleton with frontend, backend, shared types, and local development workflow.
2. Define the core domain model for users, challenges, games, moves, clocks, wallets, escrow, and settlements.
3. Build a local-only chess game loop with server-authoritative validation and a production-intended board component.
4. Add challenge and wager flows with fake-money ledger entries before any real payment integration.
5. Add realtime presence, game updates, reconnect behavior, and clock handling.
6. Add settlement, history, profile stats, and rematch loops.
7. Add trust/safety and admin surfaces before any real-money launch.

## Open Questions

- What jurisdictions and payment rails are in scope?
- Is the first playable milestone fake-money, sandbox-money, or real-money?
- What license families are acceptable for frontend chess UI and chess rule libraries?
- Should chess logic live in the main backend or a dedicated game service?
- What level of anti-cheat is required for the first closed test?
- Should mobile ship as responsive web first, native wrapper, or separate native app later?
- What stack should the project standardize on for frontend, backend, database, realtime, and deployment?
