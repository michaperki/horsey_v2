# Soundscape — perceived liveness & tension

Companion docs: [`PROJECT_SOUL.md`](PROJECT_SOUL.md) (intentional casino energy), [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) (visual atmosphere), [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) (celebration system).

## Thesis

Horsey today is **visually alive but acoustically dead**. Sound is a disproportionately large contributor to perceived liveness, tension, and polish in both competitive games and gambling products — and we have none of it. Currently a tab-switched listener hears silence; they should hear a high-stakes live room.

The useful heuristic: **if someone tab-switches away and only hears the app, it should sound like a high-stakes live poker room, sportsbook terminal, or esports broadcast — not a mobile game and not silence.**

Sound is also the one product layer that most strongly disambiguates "intentional casino energy" from "mobile-game casino spam." Chip clacks on felt vs. coin-shower jingles is a non-negotiable line — it's the audio equivalent of the visual line in [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) between poker-room references and candy-crush references.

## The three layers

### 1. Core chess interaction

The lowest, most reactive layer. These fire many times per game and must be near-silent in mix but tactile in feel. They are the "wood on felt" baseline.

| Event | Sound | Notes |
|---|---|---|
| Piece pickup (mouse-down on own piece) | subtle wood lift, ~100ms | Quiet, easy to miss when not focused |
| Piece drop (legal move) | wood click on felt, ~120ms | The signature sound; needs 3+ variant samples to avoid robotic repetition |
| Capture impact | heavier wood-on-wood thunk, ~150ms | Slight bass weight; reads as "that hit" |
| Check | single low tonal chime, ~400ms | Singular event per ply; can be louder |
| Checkmate | two-stage: low tone + soft impact, ~700ms total | The match-ending sound; deserves real production |
| Premove snap | clipped click (mechanical, no wood) | Distinct from a real move drop |
| Clock low-time tension | sub-30s: slow sub-bass pulse @ 60bpm; sub-10s: faster pulse @ 100bpm | Builds tension; mute below sub-30s threshold |
| Illegal move thunk | muted thump, not a buzzer | Buzzer = arcade. Thunk = "that's not allowed" |
| Draw / resign / finalize | single resolving tone, ~600ms | Pre-settlement cue; differs from settlement itself |

### 2. Economic layer

The wagering and money-movement layer. Less frequent than chess interaction; higher mix priority because each event carries real meaning.

| Event | Sound | Notes |
|---|---|---|
| Challenge accepted | chip-tap → settle, ~400ms | The "you're in a game" cue |
| Stake locked (both sides escrow) | chip-rack settle, ~500ms | Heavier — both sides committed |
| Settlement chip-rake (win) | chip cascade + landing, ~700ms | Paired with the visual chip-rake animation |
| Settlement chip-rake (loss) | heavy chip slide away, ~1100ms | Slower and weightier than the win version |
| Settlement (draw) | balanced split sound, ~500ms | Neutral, no celebration |
| Bankroll tick-up | sportsbook-style counter ticker | Plays during the bankroll counter tween |
| Bankroll tick-down | same ticker, lower pitch | Honest about the direction |
| Rake-to-house | thin chip slide, ~300ms | The rake split visualization's audio pair |
| Watcher join | soft "presence" tone, easy to miss | Low ambient; doesn't break concentration |
| Milestone hit (tier-appropriate) | per [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) intensity ladder | Replaces base settlement SFX at the equivalent priority |

### 3. Lobby / social layer

The ambient and notification layer. Fires when the user isn't necessarily focused on a single action.

| Event | Sound | Notes |
|---|---|---|
| Incoming challenge | soft bell, ~300ms | The "someone wants to play you" cue |
| Open table appears in feed | felt-thump (subtle) | Easy to miss; not interruptive |
| Hot table pulse | intermittent low chime, ~200ms | Plays once when "HOT TABLE" milestone fires; not looped |
| Railbird / watcher activity spike (far future) | rising murmur | Suggests "the room is paying attention" — deferred |
| Tournament / arena announcements (far future) | PA-style chime + (optional) voice | Big-room broadcast; reserved for tournaments |
| Background ambient (far future, opt-in) | low live-room presence tone | Off by default; opt-in only |

## Sound design principles

- **Tactile / material > tonal / synth.** Wood, chips, felt, paper, glass. Pure sine/saw tones only as deliberate sportsbook ticks (bankroll counter). No general-purpose synth bloops.
- **No cartoon sounds.** No boings, no "ta-da", no slide-whistles, no 8-bit chiptune, no coin-shower jingles. Cartoon sound is the fastest way to destroy the high-stakes register.
- **No autoplay before interaction.** WebAudio API requires a user gesture before sound plays. We respect that — the first interaction (login click, hero button) is the trigger to initialize the audio context.
- **Sounds stack carefully during blitz.** Bullet chess produces dozens of clicks per second across both clocks. The sound system must rate-limit and duck. Specifically: piece-drop sounds within 50ms of each other should be consolidated to one playback; clock-tension pulses should mute during rapid move exchanges.
- **Single channel of meaning.** Each sound + visual pair should mean one thing. If a chip-rake animation plays without the chip SFX, that's the reduced-sensory fallback — intentional. If a chip SFX plays without an animation, that's a bug.
- **Subtle UI ticks are fine.** Open-tables row hover, button confirmation. Keep under -24 dB so they don't compete with content sounds.
- **Material variety.** Each sound should have 2–3 variant samples loaded; randomized selection avoids robotic repetition. Especially critical for piece-drop (fires 30+ times per game).

## Reduced sensory intensity

A user setting, separate from but commonly paired with `prefers-reduced-motion`. Three levels:

| Setting | Behavior |
|---|---|
| **Full** (default) | All sound layers active; mixing per the volume hierarchy below |
| **Essentials only** | Mute ambient + decorative; keep clock tension, check, mate, settlement, and milestone audio |
| **Mute** | Master mute; no sound regardless of layer |

Defaults:
- `prefers-reduced-motion` does **not** automatically set sound to muted — they're separate axes. But the settings UI should pair them visually (one "intensity" section).
- New users start at "Full" but the first ambient sound (e.g., watcher-join) should *not* fire until the user has played at least one game — avoid jump-scaring a brand-new user.

## Mixing / volume hierarchy

| Tier | Examples | Default mix |
|---|---|---|
| Critical | check, mate, low-time, settlement | full volume (0 dB) |
| Action feedback | piece drop, button confirm, chip click | -6 dB |
| Ambient / presence | watcher join, lobby tone | -12 dB |
| Decorative | UI hover ticks, table felt rustle | -18 to -24 dB |

A master volume slider always exists. Per-tier sliders ship later (advanced settings). Ducking rules:

- When a tier-1 critical sound plays, tier-3/4 sounds mute for the duration.
- When a piece drop and clock tension pulse collide (within 50ms), keep the piece drop, drop the pulse for that beat.
- When milestone audio plays, base settlement SFX mute (already covered by [`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md)).

## Implementation notes

- **WebAudio API**, not HTMLAudio. WebAudio gives precise scheduling and low latency suitable for blitz tick density; HTMLAudio has scheduling jitter that becomes audible at high event rates.
- **Sample sources**: license-clean (CC0 or commercial license with clear redistribution terms). Avoid generic royalty-free libraries with unclear chess-product licensing.
- **Sample bank size**: target <500 KB initial download; preload tier-1 (critical) and tier-2 (action feedback) on first user interaction; lazy-load tier-3 (ambient/decorative) on demand.
- **Variant strategy**: 2–3 samples per high-frequency event (piece drop, capture). Random pick on each playback. Pre-shuffle to avoid same-sample-twice-in-a-row.
- **Audio context init**: on first user gesture (post-login click), construct the `AudioContext` and decode samples. Provide a fallback "click to enable sound" prompt if autoplay is blocked.
- **Architecture**: a small `sound.mjs` module exposing `playSound(eventKey, { intensity })`. Single audio context, single sample registry, single mixing graph. The rest of the app calls `playSound` and doesn't think about it.
- **Per-tab vs per-app**: each browser tab has its own audio context, but users may have multiple Horsey tabs open. The sound module should detect document visibility and mute when the tab is hidden (avoid double-play across tabs).
- **Spectator audio**: spectators should hear settlement and critical events but *not* the player's own piece-drop sounds — those belong to the player. Default mix for spectators is "Essentials only".

## Anti-patterns

- **Generic Howler.js "click.wav".** Synth bloops will date the product immediately. We commission or curate, we don't grab royalty-free placeholder.
- **"Coin pour" payout sounds.** Exactly the mobile-casino aesthetic we're rejecting. Settlement is a chip rake, not a slot-machine jackpot.
- **Looping table ambience.** Ambience that loops becomes uncanny when you focus on it; defer until we can do it properly (long varied loops, low mix, opt-in only).
- **Sound on every state change.** Notification overload destroys the meaning of any single sound. Sounds fire on *events*, not on state changes that aren't user-meaningful.
- **Sound used to mask latency.** A "loading sound" while the server thinks is a smell — fix the latency instead.
- **Voice announcements.** No "You win!" voiceover. No "checkmate" voice. We are not Sportscenter (yet). The most we'd consider is a PA-chime for tournaments, far future.
- **Music.** No background music ever. Horsey is a wagering room, not a game-with-soundtrack. If users want music, they put on their own.

## Cross-cutting

- **Accessibility**: critical visual cues must have audio pairs (and vice versa) so users relying on one channel aren't excluded. Check + mate are the obvious cases.
- **Localization**: sound design is language-agnostic; no voice content means no localization burden.
- **Admin / observability**: log sound init failures (autoplay blocked, decode errors). Don't log per-sound playback (way too high volume).
- **Performance budget**: total audio CPU per game should be negligible. WebAudio is cheap, but a poorly-mixed setup can hit performance during blitz. Profile early.

## Sequencing

1. **Foundation.** `sound.mjs` module, WebAudio context init on first gesture, sample preload, master mute toggle, reduced-sensory setting in user preferences. Ship with one demo sample wired to settlement so the harness is exercised.
2. **Tier 1 chess interaction.** Piece drop (3 variants), capture, check, mate. Wire to existing game events. This is the "the table sounds real" baseline.
3. **Tier 2 economic.** Settlement chip-rake (win + loss + draw variants), bankroll tick, stake-locked. Wire to the settlement physicality pass (see [`ARENA_NEXT_PASS.md`](ARENA_NEXT_PASS.md) § Phase 4).
4. **Tier 3 lobby/social.** Incoming challenge, open table appears, watcher join. Wire to existing WS events.
5. **Polish.** Variant samples for high-frequency events, clock tension pulses, milestone integration ([`MILESTONES_NEXT_PASS.md`](MILESTONES_NEXT_PASS.md) tier pairing).
6. **Per-tier volume controls.** Advanced settings UI. Pair with mute presets.
7. **(Far future) Background ambience.** Opt-in only, long varied loop, very low mix.
8. **(Far future) Tournament/arena PA.** Reserved for the tournament product.

## Open questions

- **Sample sourcing.** CC0 sample libraries for chip/felt/wood — need to identify clean sources. Commission may be necessary for the signature piece-drop sound (the one that fires most).
- **Spectator audio defaults.** "Essentials only" is the proposed default — confirm with a real spectator session before locking.
- **Mobile audio.** Mobile browsers handle WebAudio differently (Safari quirks especially). Need a test pass on real devices before claiming "ships on mobile."
- **Volume calibration across devices.** Laptop speakers vs. AirPods vs. external monitors produce wildly different perceived volumes. A "calibrate" step on first launch may be worth it.
- **Audio-only checkmate cue.** Distinguishable from check chime? Or use a clearly different timbre? Currently proposed as "two-stage low tone + impact" — needs prototyping.
