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

**Intentional casino energy.** Horsey is a wagering product, and the visual and audio language should embrace that. The reference points are **high-stakes poker room, sportsbook terminal, and esports broadcast** — never mobile-game candy-crush casino spam. Chess.com and similar pure-skill products *simulate* stakes through casino grammar (full-screen upsells, premium-currency gems, "claim/redeem" loot-language, manufactured urgency) because their underlying product doesn't naturally have them. Horsey doesn't need to simulate — but it also shouldn't artificially flatten the celebration of real money events. Ordinary settlements feel physical and grounded (real chip-stack motion, asymmetric weight per outcome); milestone moments (first win, upset, biggest pot, streaks) earn selective intensity — contained confetti bursts, stronger audio, glow effects, feed callouts. Losses feel heavy and honest, not euphemized. Sound is a first-class layer (chip clacks, rake slide, bankroll tick), not an afterthought. The line we don't cross: variable-ratio loot boxes, premium-currency aesthetics, daily-reward grind, loot-language on commerce, slide-whistle/coin-shower sound design. Reduced-motion and reduced-sensory settings must be honored throughout. See `docs/ARENA_NEXT_PASS.md` for the visual atmosphere backlog, `docs/MILESTONES_NEXT_PASS.md` for the celebration system, and `docs/SOUNDSCAPE_NEXT_PASS.md` for the audio layer.

**Avatar semantics.** The avatar is public identity. MVP direction (set 2026-05-26 after the v1 atomic system was ripped on 2026-05-25): instead of compositing layered atoms at runtime, ship a curated catalog of full-image avatars that players pick from. Acquisition is two-rail — some unlock via play milestones (signals of experience), others purchase with in-game currency (signals of taste / wealth). Avatar choice is **purely cosmetic**: a player can equip a queen on day one. Chess strength lives in the rating number, not the picture. The **frame / border** carries trust and account status (`provisional` / `claimed` / `verified` / `established`), rendered as simple CSS treatments rather than authored art. Adornments (badges, auras, live-state crowns) are deferred — not part of MVP. Assets live at `apps/web/assets/avatars/`. The v1 atomic-system thinking is archived under `docs/archive/COSMETICS_FORMALIZATION.md` for historical reference; the principles there about not letting cosmetics impersonate trust still apply.

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

- `docs/ARENA_NEXT_PASS.md` records the "intentional casino energy" atmosphere thesis and feature backlog — anticipation surfaces, animated buy-ins, spectator presence, settlement physicality, streak/momentum cues, and the line between poker-room intensity (adopt) and mobile-game spam (reject).
- `docs/MILESTONES_NEXT_PASS.md` records the milestone system — which moments earn contained celebration (first win, upset, biggest pot, streaks, hot table), the intensity-tier ladder, detection and dedup rules, and the retention layer this licenses.
- `docs/SOUNDSCAPE_NEXT_PASS.md` records the three-layer sound model (core chess interaction, economic, lobby/social), the tactile/material design principles, the reduced-sensory setting, and the mixing hierarchy that keeps blitz from becoming chaos.
- `docs/SCOUTING_TRUST_NEXT_PASS.md` records the next-pass product direction for Open Tables hierarchy, Scout Card reveal, trust metrics, narrative labels, and external chess-account onboarding.
- `docs/LIVENESS_NEXT_PASS.md` records the next-pass priorities for making the lobby feel live: heartbeat-over-WS, live challenge timers, in-progress games feed, and the real rating system that the entire identity layer is currently faking.
- `docs/marketing/IMAGE_AD_PROMPTS.md` records reusable image-generation prompts and guardrails for Horsey advertising concepts.
