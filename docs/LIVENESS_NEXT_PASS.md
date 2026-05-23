# Lobby liveness next pass

Focused roadmap for the next product slice after the Open Tables / Scout Card / Wager dossier / Counter work landed. The unifying theme is that the lobby has earned its public-table fantasy structurally, but still doesn't *feel* like a live place — counts are static snapshots, no in-progress games are visible, the wager timer doesn't tick, and the rating numbers driving the entire identity layer are a defaulted lie.

Companion docs: `docs/PROJECT_SOUL.md` (charter), `docs/LOBBY_DESIGN_GAP.md` (lobby waves), `docs/USER_PROFILE_IA.md` (identity layer), `docs/IA_PROPOSAL.md` (per-screen real-vs-mocked matrix), `docs/IMPLEMENTATION_PLAN.md` (phased roadmap).

## Why this exists

The product direction the user has been pulling toward is consistent: **presence, activity, momentum, spectatorship, casino-floor energy.** The recent work has shipped the structural pieces that fantasy needs:

- Open Tables reads like a public table listing, not a wall of mini-cards.
- The Scout Card is a quiet inspection surface, not a callout button.
- The Wager screen carries an actual dossier at the moment of decision.
- Counter is a real negotiation, not a no-op state transition.

What's left is the *animation* of the room — the cues that say "the casino is open and people are playing." Static counts, defaulted ratings, untimed timers, and no visible in-progress games all undercut the public-table feeling that the structure now supports.

## Candidates

Five candidates ranked by leverage given the design direction.

### 1. Live Games feed in the right rail  *(biggest single product move)*

A small list of currently-in-progress tables, visible from the lobby. Reads as `Vish · Kobe · $50 · move 14`, no spectatorship needed for v1 — just public game metadata.

- **Why it matters.** The single strongest "the casino floor is alive" signal we can ship. Open Tables shows who's looking for action; Live Games shows action *in progress*. Together they tell the player "there's a room, people are in it, and the room is moving."
- **Scope.** New endpoint or extension to `/api/bootstrap` returning live-game summaries (handles + stake + move count + clock-running indicator). New right-rail card under Open Tables. No spectator pipeline, no game-watching UI — just the visible feed.
- **What it unlocks.** Becomes the natural mounting point later for the deferred Hot Upsets / Rivals / spectator surfaces in `LOBBY_DESIGN_GAP.md` Wave 4.
- **Privacy guardrail.** Show stake and move count, not move-by-move detail. Public game metadata only.

### 2. Heartbeat numbers go live over WS

The `1,204 online · 412 in active games` strip is currently a snapshot from bootstrap. Wire it to the existing WS presence channel so the numbers tick.

- **Why it matters.** Cheapest possible "the room is breathing" payoff. Static counts read as fake; ticking counts read as ambient liveness even without any other animation.
- **Scope.** The WS layer already tracks per-user presence (`apps/api/realtime.mjs`). Add a periodic broadcast (or join/leave-triggered delta) that updates `state.bootstrap.lobby.onlineCount` and `activeGames`. Render path already exists in `renderHeartbeatStrip()`.
- **What it unlocks.** Makes the lobby surface state-aware over WS in general — the same channel can later feed item #1 (live game feed) and #3 (live challenge expiry).

### 3. Real expiry countdown on Wager + Open Tables

The backend already tracks `expiresInSeconds` + `updatedAt`; the client computes `challengeSecondsRemaining()` but only renders it as a static label that updates per re-render, not as a live ticking display.

- **Why it matters.** Adds genuine urgency to the decision moment that the U4 dossier was leaning into. "Accept in 0:42" is a small detail but it's the difference between a static page and a moment with a clock. Also stops abandoned open invites from feeling permanent.
- **Scope.** Tick the relevant render once a second when wager / play routes are active and a non-terminal challenge is in view. The existing `manageClockTick` rAF loop is the right place — extend it to also touch challenge-expiry DOM nodes the same way it touches live-table clocks.
- **IA flag.** Listed as ⚠️ Mock #4 in `IA_PROPOSAL.md`.

### 4. Real rating system  *(largest, most foundational)*

Every account starts at 1200 and never updates. Every `1842` rating in the dossier / scout card / open tables / settlement is defaulted. The entire scouting/identity layer is built on a number that isn't a number.

- **Why it matters.** Highest-leverage long-term move. Until ratings are real:
  - The Scout Card's rating tile is a lie.
  - The settlement screen's `ratingDelta` returns `null` and the row is hidden.
  - The win-rate / streak / last-10 reads exist but have no anchor to opponent strength.
  - Rivalries can't be calibrated.
- **Scope.** Bigger lift than the others:
  - Pick a system (ELO with a moderate K-factor or Glicko-2; ELO is simpler for v1).
  - Update both players' ratings on game finalization in the existing post-game hook.
  - Record `ratingChange` snapshots (already partially scaffolded — `stats.ratingTimeline` reads from these).
  - Surface `ratingDelta` on the settlement screen now that it'll be non-null.
- **Why this is its own weight class.** Server work + decision on the rating model + migration story for the seed accounts. Don't bundle with the liveness items.

### 5. Profile rematch CTA when h2h exists  *(shipped)*

Small polish item explicitly named in `USER_PROFILE_IA.md` Wave U3 ("Remaining polish: dedicated rematch affordance when h2h exists").

- [x] CTA branches on `h2h.games > 0`. Reads `Rematch Vish · $25` when shared history exists, `Challenge Vish · $25` when it doesn't. The opponent handle is now in the label either way — the prior copy was just `Challenge $25` with no name, which felt impersonal for the directed-callout that this CTA is.

## Recommended sequencing

The three liveness items (#2, #3, #1) are thematically related and can land in any order; #2 is the cheapest, #3 the most focused, #1 the biggest. The polish item (#5) is independent and trivial.

The rating system (#4) is a separate weight class and should not be bundled with the liveness pass — both because it touches game finalization and ratings calibration, and because the liveness work makes the rating numbers feel more present, which makes the "ratings are fake" problem more visible. Better to make the room breathe first, then make the numbers real.

Suggested order:

1. **#5 Profile rematch CTA** — trivial polish, finishes a U3 follow-up.
2. **#3 Expiry countdown** — small but adds tension to the wager moment.
3. **#2 Heartbeat over WS** — biggest "room is breathing" payoff per LOC.
4. **#1 Live Games feed** — largest visual delta; lands the casino-floor fantasy.
5. **#4 Real ratings** — its own pass, after the liveness slice settles.

## Constraints worth respecting

- **Privacy / loss-advertising.** Live Games feed shows other people's stake amounts (already public via Open Tables for their own pending invites), but should not surface anyone's win/loss totals or net dollar deltas. Stake + move count + handles only.
- **Backend authority for state.** The same rule applied to matchmaking and counter applies here: the server is source of truth for "this game is live" / "this challenge expired." The client renders what the server says.
- **No fake trust badges along the way.** Resist the temptation to surface "verified" / "fair play" / "rivals" while landing the live-games feed — those belong to the Phase 6 trust subsystem (`SCOUTING_TRUST_NEXT_PASS.md` Waves T1/T2). The feed should carry only data we genuinely have.

## How to use

- Treat this as a focused note alongside `LOBBY_DESIGN_GAP.md` and `USER_PROFILE_IA.md`. Promote any item that grows into a multi-screen workstream into `IMPLEMENTATION_PLAN.md`.
- When an item ships, mark it shipped here (or move the documentation into the canonical doc for its surface — e.g., live-games feed should end up documented in `LOBBY_DESIGN_GAP.md` since it's a lobby surface).
