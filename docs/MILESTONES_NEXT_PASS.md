# Milestones — celebration grammar & retention layer

Companion docs: [`PROJECT_SOUL.md`](PROJECT_SOUL.md) (intentional casino energy), [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) (visual atmosphere), [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md) (audio layer).

## Thesis

Real-stake products cannot manufacture variable-ratio dopamine without becoming the predatory casino-skin variant we explicitly reject. But they *can* celebrate genuine first-times and statistical inflection points — and those moments earn the right to break the visual + audio restraint of ordinary play. The milestone system does two jobs:

1. **Licenses selective intensity.** Confetti, banners, stronger audio, glow effects, table-wide callouts — these are off by default. A milestone unlock is what flips them on, briefly, in a contained way. This is what keeps ordinary settlements honest and milestone settlements meaningful.
2. **Provides retention hooks.** Notifications, profile badges, feed callouts, achievement chips on scout cards. None of this requires inventing fake currency, daily-grind mechanics, or streak-shield manipulation. The signal is real (a real win, a real upset, a real streak) and the recognition is the reward.

The line we don't cross: milestones never *pay out* play tokens, never use loot-language ("claim", "redeem"), never gate gameplay, never push notifications about milestones the user could earn. They are *recognized* when they happen, not gamified into chores.

## What counts as a milestone

Two axes:

- **First-time milestones** — one-time, durable, high celebration ceiling. The user is genuinely doing this for the first time.
- **Recurring milestones** — re-triggerable, cooldown-gated, lower ceiling each time. Hot tables, streaks, upsets.

### First-time milestones

| Event | Detection signal | Default intensity | Persistence |
|---|---|---|---|
| First win | first finalized game where viewer is winner | tier 3 (burst) | profile badge: "First Win" |
| First verified win | first finalized win where viewer.trustTier ≥ verified | tier 3 (burst, verified-gold accent) | profile badge: "Verified First" |
| First $X pot won | first time `creditedCents` ≥ {100¢, 500¢, 1000¢, 2500¢} thresholds | tier 2 (callout) per threshold | profile badge: "$X Won" |
| First watcher | first time `watcherCount` ≥ 1 on viewer's live game | tier 1 (toast) | none |
| First open table that fills | first hosted open challenge that gets accepted | tier 1 (toast) | none |
| First rematch | first rematch challenge accepted | tier 1 (toast) | none |
| First sub-30s clock survival | first finalized game where viewer survived <30s on clock and won | tier 2 (callout) | profile badge: "Clock Survivor" |

### Recurring milestones

| Event | Detection signal | Default intensity | Cooldown |
|---|---|---|---|
| 3-win streak | three consecutive finalized wins by viewer | tier 2 (callout, gold chevron on identity badge) | once per streak — refire on each new threshold (3, 5, 7, 10, 15) |
| Upset victory | viewer wins where `opponent.rating ≥ viewer.rating + 200` | tier 2 (callout, "UPSET" label) | once per game |
| Comeback win | viewer wins after being down material delta ≤ -X (X TBD; probably -5 in centipawns or material units) | tier 2 (callout, "COMEBACK") | once per game |
| Biggest pot ever (PB) | viewer wins a pot where `creditedCents > max(prior creditedCents)` | tier 3 (burst, "PERSONAL BEST") | once per PB — naturally cooldown by definition |
| Watcher milestone | viewer's live game crosses watcher thresholds (5, 10, 25, 50) | tier 1 (toast) → tier 3 (burst at 50+) | once per threshold per game |
| Hot table (system-wide) | live game with watchers ≥ N or stake ≥ N or rating-sum ≥ N | tier 2 (callout, "HOT TABLE" pulse on Live now row) | rate-limited globally |
| Daily streak (login) | consecutive days returning | **tier 0 — visible counter on profile only, no celebration** | n/a — see anti-patterns |

Daily-streak deserves its own note: we surface the count (it's real signal — repeat engagement is a legitimate metric) but we do *not* celebrate it. No banner, no audio, no streak-shield mechanic, no "don't lose your streak!" pressure. Anyone who plays daily can see the number on their profile; anyone who doesn't isn't shamed.

## Intensity tiers

Each milestone declares a tier (0–4). The client composes UI based on tier. Higher tiers include lower-tier elements.

| Tier | Visual | Audio | Persistence |
|---|---|---|---|
| 0 | counter increment on profile only | none | persistent counter |
| 1 (toast) | small chip on top-right, 2s, dismisses on click | soft chime (-12 dB) | none (just acknowledgment) |
| 2 (callout) | colored banner across settlement card or top of Live now row, 3s | medium SFX (-6 dB) | recorded on profile / feed |
| 3 (burst) | **contained** chip-burst from the settlement card, 1.2s, plus banner | heavier SFX (full mix) | profile badge + feed callout |
| 4 (broadcast) | full settlement re-skin + animated chip-stack burst + table-wide banner + (future) push to followers | full audio cue with tier-appropriate intro | profile badge + feed callout + notification to followers (future) |

**Containment rules:**
- Tier 3 confetti bursts from the settlement card, not the viewport. Confetti particles do not exit the card boundary.
- Tier 4 is reserved for genuine wide-reach moments (huge PB pot, long streak hit, public upset). Should fire <1% of settlements globally.
- A settlement that triggers multiple milestones composes the highest tier, plus stacks the badges/feed callouts of the lower ones. It does *not* play multiple audio cues — one cue at the highest tier.

## Detection & schema

```
TABLE user_milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,      -- e.g., 'first_win', 'win_streak_3', 'pb_pot'
  occurred_at TEXT NOT NULL,
  game_id TEXT,                  -- nullable; some milestones aren't game-scoped
  metadata_json TEXT NOT NULL,   -- e.g., {"creditedCents":1500,"opponentId":...}
  count INTEGER NOT NULL DEFAULT 1
)
CREATE INDEX idx_user_milestones_user ON user_milestones(user_id, event_key);
```

- Detection happens server-side at the relevant write — game-outcome milestones in `settleGame`, watcher milestones in the spectator counter, hot-table on lobby heartbeat.
- Insert a row on first detection. Bump `count` (+ append a new row, or upsert depending on event semantics) on recurring detections.
- Publish `milestone.unlocked` on the user's WS channel: `{ eventKey, tier, intensity, metadata }`. Client picks the renderer.
- For hot-table (system-wide), publish on the `lobby` channel — every connected client gets the callout but only viewers on Live now actually render it.

## Cooldown / dedup rules

- **First-time** milestones: by definition, only fire once. Detection is `SELECT 1 FROM user_milestones WHERE user_id=? AND event_key=?` before insert.
- **Streak milestones**: fire when the streak crosses each declared threshold (3, 5, 7, 10, 15). Reset on loss/draw.
- **Upset / comeback / PB**: fire once per qualifying game. Don't fire on rematches if the same conditions repeat trivially (e.g., a 200-point upset followed by another against same opponent within 1 hour shouldn't double-burst).
- **Hot-table**: rate-limit globally — at most one "HOT TABLE" callout per N minutes per pulse threshold.
- **Watcher milestones**: per-game, per-threshold.

## Composition with settlement

The settlement physicality (see [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) § Phase 4) is the *base layer*. Milestone composition is the *overlay layer* that ride on top:

1. Settlement animation fires unconditionally (chip cascade, bankroll counter, rake split).
2. If `milestone.unlocked` arrives within the settlement window, the milestone overlay composes on top after the base settlement completes (so the chip motion is visible, then the milestone banner/burst follows).
3. Tier 0–1 fire as a toast that doesn't block; tier 2+ may briefly hold attention but always dismiss themselves within 3s.
4. Sound cues from milestone overlays *replace* the base settlement SFX at the equivalent priority — they don't layer (would be cacophony).

## Cross-cutting

- **Reduced-motion**: tier 3+ visuals collapse to tier 2 (banner only, no burst). Tier 2 callouts remain. Tier 1 toasts remain. The milestone *is recognized*, just not animated.
- **Reduced-sensory** (see [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md)): mutes all milestone audio cues. Visuals unchanged.
- **Admin queryability**: all unlocks are persisted, so admin can audit "was this 'upset victory' legit?" — useful for sandbag flagging (e.g., a low-rated account triggering many upsets in a short window).
- **Anti-fraud**: certain milestones (PB pot, biggest upset) might warrant a separate fraud-review queue if they fire for accounts in a sandbag-flag state.

## Anti-patterns

- **Paying out tokens for milestones.** Milestones are *recognized*, not *claimed*. No play-token grant on first win. The win itself is the reward.
- **Loot-language UI.** No "Claim your achievement!" CTA. Use "Earned" or "Unlocked" passive voice; no action verb that implies the user needs to do something.
- **Streak shields / freezes.** No mechanism to "save" a broken streak. Streaks are honest — a loss breaks them.
- **Push notifications about milestones the user could earn.** No "You're 1 win away from a 5-streak!" reminder. We celebrate what happened, not what's almost-happening.
- **Achievement spam for trivial actions.** First move, first opening, first capture — all rejected. Trivial achievements dilute the real ones.
- **Persistent overlays that block the next action.** Even tier 3 bursts dismiss within 1.2s and are click-dismissable.
- **Full-screen confetti.** Confetti is contained to the settlement card. The viewport stays clean.
- **Daily-streak guilt mechanics.** Counter is visible; pressure to maintain is not added.

## Sequencing

1. **Foundation.** `user_milestones` schema, server-side detection in `settleGame`, `milestone.unlocked` WS event, client-side intensity-tier renderer with tier-0 / tier-1 stubs.
2. **Tier 1 + 2 baseline.** First win + 3-win streak as first real milestones. Toast + callout intensity. No audio yet.
3. **Tier 3 burst.** Contained chip-burst CSS animation. Wire to "first verified win" + "biggest pot ever".
4. **Audio integration.** Once [`SOUNDSCAPE_NEXT_PASS.md`](SOUNDSCAPE_NEXT_PASS.md) foundation lands, pair milestone tiers with audio cues at matching intensity.
5. **Upset + comeback.** Need material-delta tracking (already partially there) or rating delta (already there). Wire callouts.
6. **Hot table.** System-wide milestone. Needs a lobby-heartbeat heuristic.
7. **Profile badge surface.** Renders earned milestones on the profile / scout card.
8. **Feed callouts.** A "recent moments" feed on the lobby — last few milestones across the platform (privacy-aware: opt-out, no exact dollar amounts on small pots).

## Open questions

- Threshold tuning. Streak thresholds (3/5/7/10/15) and pot thresholds ($1/$5/$10/$25) are first-pass guesses. Need real engagement data before locking.
- Comeback definition. "Down material delta -X" requires an authoritative position evaluation; absent that, fallback heuristic is "lost a queen and won anyway" or "lost half their material and won." Pick one before shipping.
- Public feed scope. A "recent moments" feed on the lobby could leak privacy (small-pot wins by users who want to be invisible). Need opt-out + amount-bucketing rules.
- Tier 4 broadcast. Reserved but not yet specified. Define before any tier-4 event ships (probably gated on follower system existing first).
