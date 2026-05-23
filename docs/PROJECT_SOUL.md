# Project Soul

Horsey is a full product effort starting from canonical design files. The goal is to architect and build the real system, not to recreate static mockups. The current designs establish the product mood and surface area: mobile-native, poker-floor energy, chip-based stakes, chess as the core game, and a strong emphasis on money, trust, rivalry, and live tension.

## Product Intent

Horsey is wagered chess. A player should be able to sit down, choose or accept a stake, play a real chess game, and have escrow, results, settlement, reputation, and history handled by the product. The board matters, but it sits inside a larger competitive-money system.

The design language leans toward:

- poker-floor / felt-table energy;
- chips, pots, escrow, rake, deposits, and settlement;
- fast lobby entry and rematches;
- opponent scouting, tells, trust, and history;
- live game tension around board, clock, pot, and momentum;
- post-game settlement that makes the money outcome explicit.

## Collaboration Memory

Future agents should preserve durable context here or in nearby docs. The goal is continuity across agents, not a diary.

Capture:

- product decisions and non-goals;
- architecture decisions and tradeoffs;
- licensing constraints;
- workflow and environment facts;
- recurring user preferences;
- unresolved questions that need a future decision.

Do not capture:

- raw chat transcripts;
- temporary implementation details that are obvious from code;
- agent self-commentary;
- speculative ideas that the user did not accept or ask to preserve.

## Current User Guidance

- We are starting from scratch using Claude's design files as canonical inputs.
- We are not building mockups.
- We need a frontend and backend, and likely more systems around realtime play, money, trust, operations, and compliance.
- We need to decide whether to build chess board and logic ourselves or use license-compatible open source. Chessground is considered undesirable because of its license implications for this project.
- Decision update: use BSD-2-Clause `chess.js` for chess rules through Horsey's wrapper package, while keeping board UI custom for now.
- Current board UI is the accepted custom baseline for this milestone: server-backed rules, legal hints, drag/drop, keyboard navigation, edge coordinates, captured trays, promotion, and mobile-safe tap behavior. Future board work should be scoped as named features rather than reopening a generic "crude board" cleanup loop.
- Keep this first pass high level.
- Establish a clean working relationship between the user and future coding agents so agents retain the big picture and do not become overly narrow.
- Working context such as WSL vs Windows PowerShell is valid project memory when it helps future agents operate smoothly.

## Agent Behavior

Agents should read `AGENTS.md` and this file before making broad project decisions. When a task touches product direction or architecture, also check `docs/DESIGN_REVIEW.md` and `docs/ARCHITECTURE_FIRST_PASS.md`.

When the user adds new durable guidance, update the docs in spirit. Keep the docs short enough that future agents will actually read them.

For execution planning, use `docs/IMPLEMENTATION_PLAN.md` as the current staged plan and update it when milestones, stack decisions, or product gates change.

Related focused notes:

- `docs/SCOUTING_TRUST_NEXT_PASS.md` records the next-pass product direction for Open Tables hierarchy, Scout Card reveal, trust metrics, narrative labels, and external chess-account onboarding.
