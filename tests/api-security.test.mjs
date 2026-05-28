import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");

test("API allows live spectators but protects settlement and finalized game reads", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(created.status, 201);
  assert.equal("challengerWallet" in created.body.challenge, false);

  const openRead = await fixture.get(carol, `/api/challenges/${created.body.challenge.id}`);
  assert.equal(openRead.status, 200);

  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  const game = accepted.body.game;

  const outsiderGame = await fixture.get(carol, `/api/games/${game.id}`);
  assert.equal(outsiderGame.status, 200);
  assert.equal(outsiderGame.body.game.id, game.id);

  const outsiderSettlement = await fixture.get(carol, `/api/games/${game.id}/settlement`);
  assert.equal(outsiderSettlement.status, 403);
  assert.equal(outsiderSettlement.body.error, "not_a_player");

  const acceptedChallengeRead = await fixture.get(carol, `/api/challenges/${created.body.challenge.id}`);
  assert.equal(acceptedChallengeRead.status, 403);
  assert.equal(acceptedChallengeRead.body.error, "not_your_challenge");

  // Play a move first so resign produces a true finalize (loss), not the
  // pre-move abort path introduced for OPERATIONAL_POLICY.md § 1.10.
  const whitePlayer = game.players.find((p) => p.color === "white");
  const whiteClient = whitePlayer.id === alice.user.id ? alice : bob;
  const firstMove = await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });
  assert.equal(firstMove.status, 200);

  const resigningClient = game.players[0].id === alice.user.id ? alice : bob;
  const resigned = await fixture.post(resigningClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "finalized");

  const outsiderFinalizedGame = await fixture.get(carol, `/api/games/${game.id}`);
  assert.equal(outsiderFinalizedGame.status, 403);
  assert.equal(outsiderFinalizedGame.body.error, "not_a_player");

  const opponentClient = resigningClient === alice ? bob : alice;
  const opponentColor = game.players.find((p) => p.id === opponentClient.user.id).color;
  const move = opponentColor === "white" ? { from: "e2", to: "e4" } : { from: "e7", to: "e5" };
  const moveAfterFinalized = await fixture.post(opponentClient, `/api/games/${game.id}/moves`, move);
  assert.equal(moveAfterFinalized.status, 409);
  assert.equal(moveAfterFinalized.body.error, "game_already_finalized");
});

test("expired open challenges cannot be accepted", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  await fixture.signup("carol");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(created.status, 201);

  const db = new Database(fixture.dbPath);
  const expiredAt = new Date(Date.now() - 120_000).toISOString();
  db.prepare("UPDATE challenges SET updated_at = ? WHERE id = ?").run(expiredAt, created.body.challenge.id);
  db.close();

  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 409);
  assert.equal(accepted.body.error, "invalid_challenge_transition");

  const bootstrap = await fixture.get(bob, "/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.body.lobby.openChallenges.some((c) => c.id === created.body.challenge.id), false);
});

test("starting a game clears queue tickets and pending hosted invites", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");
  const dave = await fixture.signup("dave");

  const acceptedInvite = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(acceptedInvite.status, 201);
  const aliceExtraInvite = await fixture.post(alice, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "3+0"
  });
  assert.equal(aliceExtraInvite.status, 201);
  const bobExtraInvite = await fixture.post(bob, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "1+0"
  });
  assert.equal(bobExtraInvite.status, 201);

  const carolQueued = await fixture.post(carol, "/api/matchmaking/quick", {
    stakeCents: 2500,
    timeControl: "3+0",
    tierPref: "any"
  });
  assert.equal(carolQueued.status, 200);
  assert.equal(carolQueued.body.ticket.userId, carol.user.id);
  const bobQueued = await fixture.post(bob, "/api/matchmaking/quick", {
    stakeCents: 1000,
    timeControl: "3+0",
    tierPref: "any"
  });
  assert.equal(bobQueued.status, 200);
  assert.equal(bobQueued.body.ticket.userId, bob.user.id);

  const accepted = await fixture.post(bob, `/api/challenges/${acceptedInvite.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.game.state, "live");

  const db = new Database(fixture.dbPath);
  const extraRows = db.prepare("SELECT id, state, data_json FROM challenges WHERE id IN (?, ?) ORDER BY id")
    .all(aliceExtraInvite.body.challenge.id, bobExtraInvite.body.challenge.id);
  const tickets = db.prepare("SELECT user_id FROM matchmaking_tickets ORDER BY user_id").all();
  db.close();

  assert.deepEqual(extraRows.map((row) => row.state), ["declined", "declined"]);
  assert.equal(extraRows.every((row) => JSON.parse(row.data_json).autoWithdrawnForLiveGame === true), true);
  assert.deepEqual(tickets.map((row) => row.user_id), [carol.user.id]);

  const lobby = await fixture.get(dave, "/api/bootstrap");
  assert.equal(lobby.body.lobby.openChallenges.some((c) => c.id === aliceExtraInvite.body.challenge.id), false);
  assert.equal(lobby.body.lobby.openChallenges.some((c) => c.id === bobExtraInvite.body.challenge.id), false);
});

test("live players cannot start another challenge or quick match", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(created.status, 201);
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);

  const secondChallenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(secondChallenge.status, 409);
  assert.equal(secondChallenge.body.error, "has_live_game");

  const secondQueue = await fixture.post(bob, "/api/matchmaking/quick", {
    stakeCents: 2500,
    timeControl: "3+0",
    tierPref: "any"
  });
  assert.equal(secondQueue.status, 409);
  assert.equal(secondQueue.body.error, "has_live_game");

  const carolInvite = await fixture.post(carol, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "1+0"
  });
  assert.equal(carolInvite.status, 201);
  const acceptedWhileLive = await fixture.post(alice, `/api/challenges/${carolInvite.body.challenge.id}/accept`);
  assert.equal(acceptedWhileLive.status, 409);
  assert.equal(acceptedWhileLive.body.error, "has_live_game");
});

test("admin mutation endpoints void, adjust, restrict, and audit", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;
  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });
  const resigningClient = game.players[0].id === alice.user.id ? alice : bob;
  const finalized = await fixture.post(resigningClient, `/api/games/${game.id}/resign`);
  assert.equal(finalized.body.game.state, "finalized");

  const voided = await fixture.post(admin, `/api/admin/games/${game.id}/void`, {
    reason: "confirmed platform issue"
  });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.game.state, "voided");

  const created2 = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted2 = await fixture.post(bob, `/api/challenges/${created2.body.challenge.id}/accept`);
  const game2 = accepted2.body.game;
  const white2 = game2.players.find((p) => p.color === "white");
  const whiteClient2 = white2.id === alice.user.id ? alice : bob;
  await fixture.post(whiteClient2, `/api/games/${game2.id}/moves`, { from: "e2", to: "e4" });
  const resigningClient2 = game2.players[0].id === alice.user.id ? alice : bob;
  await fixture.post(resigningClient2, `/api/games/${game2.id}/resign`);
  const adjusted = await fixture.post(admin, `/api/admin/games/${game2.id}/adjust`, {
    result: "draw",
    reason: "manual settlement correction"
  });
  assert.equal(adjusted.status, 200);
  assert.equal(adjusted.body.game.winnerId, null);

  const created3 = await fixture.post(alice, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "3+0"
  });
  const accepted3 = await fixture.post(bob, `/api/challenges/${created3.body.challenge.id}/accept`);
  const restricted = await fixture.post(admin, `/api/admin/users/${alice.user.id}/restrictions`, {
    restrictions: ["hard_ban"],
    reason: "test hard ban"
  });
  assert.equal(restricted.status, 200);
  assert.deepEqual(restricted.body.autoVoided, [accepted3.body.game.id]);

  const audit = await fixture.get(admin, "/api/admin/audit?limit=20");
  assert.equal(audit.status, 200);
  assert.equal(audit.body.actions.some((a) => a.action === "void" && a.targetId === game.id), true);
  assert.equal(audit.body.actions.some((a) => a.action === "adjust" && a.targetId === game2.id), true);
  assert.equal(audit.body.actions.some((a) => a.action === "restrict" && a.targetId === alice.user.id), true);

  const checkDb = new Database(fixture.dbPath);
  const liveAfterBan = checkDb.prepare("SELECT state FROM games WHERE id = ?").get(accepted3.body.game.id);
  const adjustmentRows = checkDb.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE type = 'settlement_adjustment' AND ref_id = ?").get(game2.id);
  const restrictionRows = checkDb.prepare("SELECT COUNT(*) AS n FROM user_restrictions WHERE user_id = ? AND restriction = 'hard_ban' AND cleared_at IS NULL").get(alice.user.id);
  checkDb.close();
  assert.equal(liveAfterBan.state, "voided");
  assert.ok(adjustmentRows.n > 0);
  assert.equal(restrictionRows.n, 1);
});

test("report intake is player-scoped and admin review is gated", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const outsiderReport = await fixture.post(carol, "/api/reports", {
    targetUserId: bob.user.id,
    gameId: game.id,
    category: "engine_assistance",
    note: "I should not be able to report a game I did not play."
  });
  assert.equal(outsiderReport.status, 403);
  assert.equal(outsiderReport.body.error, "not_a_player");

  const report = await fixture.post(alice, "/api/reports", {
    targetUserId: bob.user.id,
    gameId: game.id,
    category: "engine_assistance",
    note: "Suspiciously consistent move timing in sharp positions."
  });
  assert.equal(report.status, 201);
  assert.equal(report.body.report.status, "open");
  assert.equal(report.body.report.target.handle, bob.user.handle);

  const nonAdminInbox = await fixture.get(alice, "/api/admin/reports");
  assert.equal(nonAdminInbox.status, 403);
  assert.equal(nonAdminInbox.body.error, "admin_only");

  const inbox = await fixture.get(admin, "/api/admin/reports?limit=20");
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.reports.some((r) => r.id === report.body.report.id), true);

  const updated = await fixture.post(admin, `/api/admin/reports/${report.body.report.id}/status`, {
    status: "reviewing",
    adminNote: "Queued for manual review."
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.report.status, "reviewing");
  assert.equal(updated.body.report.adminNote, "Queued for manual review.");
});

test("signup conflicts use generic messaging", async (t) => {
  const fixture = await startFixture(t);
  const first = await fixture.post(null, "/api/auth/signup", {
    email: "same@example.com",
    handle: "same_one",
    password: "password123",
    acceptedTosVersion: 1
  });
  assert.equal(first.status, 201);

  const duplicate = await fixture.post(null, "/api/auth/signup", {
    email: "same@example.com",
    handle: "same_two",
    password: "password123",
    acceptedTosVersion: 1
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "email_taken");
  assert.equal(duplicate.body.message, "We couldn't create that account. Try another email or handle.");
});

test("auth endpoints rate-limit repeated attempts", async (t) => {
  const fixture = await startFixture(t);
  for (let i = 0; i < 12; i++) {
    const response = await fixture.post(null, "/api/auth/signup", {
      email: `rate-${i}@example.com`,
      handle: `rate_${i}`,
      password: "password123",
      acceptedTosVersion: 1
    });
    assert.equal(response.status, 201);
  }

  const limited = await fixture.post(null, "/api/auth/signup", {
    email: "rate-limit@example.com",
    handle: "rate_limit",
    password: "password123",
    acceptedTosVersion: 1
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
});

test("scholar's mate via /moves updates ratings and surfaces ratingDelta", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const black = game.players.find((p) => p.color === "black");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = black.id === alice.user.id ? alice : bob;

  const moves = [
    ["e2", "e4"], ["e7", "e5"],
    ["d1", "h5"], ["b8", "c6"],
    ["f1", "c4"], ["g8", "f6"],
    ["h5", "f7"]
  ];

  let lastResponse;
  for (let i = 0; i < moves.length; i++) {
    const [from, to] = moves[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    lastResponse = await fixture.post(client, `/api/games/${game.id}/moves`, { from, to });
    assert.equal(lastResponse.status, 200, `move ${i} (${from}->${to}) status`);
  }

  assert.equal(lastResponse.body.game.state, "finalized");
  assert.equal(lastResponse.body.game.endReason, "checkmate");
  assert.equal(lastResponse.body.settlement.ratingDelta, 16);

  const blackSettlement = await fixture.get(blackClient, `/api/games/${game.id}/settlement`);
  assert.equal(blackSettlement.body.settlement.ratingDelta, -16);

  const whiteBootstrap = await fixture.get(whiteClient, "/api/bootstrap");
  const blackBootstrap = await fixture.get(blackClient, "/api/bootstrap");
  assert.equal(whiteBootstrap.body.viewer.rating, 1516);
  assert.equal(blackBootstrap.body.viewer.rating, 1484);
});

test("settlement reports a rating change after a decisive game", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  assert.equal(alice.user.rating, 1500);
  assert.equal(bob.user.rating, 1500);

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // A decisive game needs at least one move so the resign path finalizes
  // (post-OPERATIONAL_POLICY.md § 1.10, pre-move resigns abort instead).
  const whiteClient = game.players.find((p) => p.color === "white").id === alice.user.id ? alice : bob;
  await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });

  const winningClient = game.players[0].id === alice.user.id ? bob : alice;
  const losingClient = winningClient === alice ? bob : alice;
  const resigned = await fixture.post(losingClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "finalized");

  const winnerSettlement = await fixture.get(winningClient, `/api/games/${game.id}/settlement`);
  const loserSettlement = await fixture.get(losingClient, `/api/games/${game.id}/settlement`);

  assert.equal(winnerSettlement.body.settlement.ratingDelta, 16);
  assert.equal(loserSettlement.body.settlement.ratingDelta, -16);
  assert.equal(winnerSettlement.body.settlement.ratingAfter, 1516);
  assert.equal(loserSettlement.body.settlement.ratingAfter, 1484);

  const winnerBootstrap = await fixture.get(winningClient, "/api/bootstrap");
  assert.equal(winnerBootstrap.body.viewer.rating, 1516);
});

test("user profile aggregates h2h and suppresses negative viewer dollar totals", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const firstChallenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const firstAccepted = await fixture.post(bob, `/api/challenges/${firstChallenge.body.challenge.id}/accept`);
  // Need at least one move before resign so the game finalizes (pre-move
  // resign aborts — see OPERATIONAL_POLICY.md § 1.10).
  const firstWhite = firstAccepted.body.game.players.find((p) => p.color === "white").id === alice.user.id ? alice : bob;
  await fixture.post(firstWhite, `/api/games/${firstAccepted.body.game.id}/moves`, { from: "e2", to: "e4" });
  const firstResigned = await fixture.post(alice, `/api/games/${firstAccepted.body.game.id}/resign`);
  assert.equal(firstResigned.status, 200);

  const secondChallenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const secondAccepted = await fixture.post(bob, `/api/challenges/${secondChallenge.body.challenge.id}/accept`);
  const secondWhite = secondAccepted.body.game.players.find((p) => p.color === "white").id === alice.user.id ? alice : bob;
  await fixture.post(secondWhite, `/api/games/${secondAccepted.body.game.id}/moves`, { from: "e2", to: "e4" });
  const secondResigned = await fixture.post(bob, `/api/games/${secondAccepted.body.game.id}/resign`);
  assert.equal(secondResigned.status, 200);

  const profile = await fixture.get(alice, `/api/users/${bob.user.id}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.id, bob.user.id);
  assert.equal(profile.body.user.handle, bob.user.handle);
  assert.equal("email" in profile.body.user, false);
  assert.equal(profile.body.user.stats.finishedGames, 2);
  assert.equal(profile.body.user.stats.wins, 1);
  assert.equal(profile.body.user.stats.losses, 1);
  assert.equal(profile.body.user.h2hVsViewer.games, 2);
  assert.equal(profile.body.user.h2hVsViewer.viewerWins, 1);
  assert.equal(profile.body.user.h2hVsViewer.viewerLosses, 1);
  assert.equal(profile.body.user.h2hVsViewer.draws, 0);
  assert.equal(profile.body.user.h2hVsViewer.viewerNetCents, null);
  assert.equal(profile.body.user.h2hVsViewer.last5.length, 2);
  assert.equal("stakeCents" in profile.body.user.h2hVsViewer.last5[0], false);

  const recent = await fixture.get(alice, `/api/users/${bob.user.id}/recent-games?limit=1`);
  assert.equal(recent.status, 200);
  assert.equal(recent.body.games.length, 1);
  assert.equal("stakeCents" in recent.body.games[0], false);
  assert.equal("pot" in recent.body.games[0], false);
  assert.equal(recent.body.games[0].opponent.id, alice.user.id);
});

test("replay endpoint walks the move sequence with FEN per ply", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;

  const moves = [["e2", "e4"], ["e7", "e5"], ["d1", "h5"], ["b8", "c6"]];
  for (let i = 0; i < moves.length; i++) {
    const [from, to] = moves[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    const resp = await fixture.post(client, `/api/games/${game.id}/moves`, { from, to });
    assert.equal(resp.status, 200);
  }

  const replay = await fixture.get(whiteClient, `/api/games/${game.id}/replay`);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay.moves.length, 4);
  assert.equal(replay.body.replay.moves[0].san, "e4");
  assert.equal(replay.body.replay.moves[0].color, "white");
  assert.equal(replay.body.replay.moves[3].san, "Nc6");
  assert.equal(replay.body.replay.moves[3].color, "black");
  assert.ok(replay.body.replay.moves[0].fenAfter.startsWith("rnbqkbnr/pppppppp/8/8/4P3"));

  const outsider = await fixture.get(carol, `/api/games/${game.id}/replay`);
  assert.equal(outsider.status, 200);
  assert.equal(outsider.body.replay.moves.length, 4);
});

test("game_events records moves and the finalized event", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;

  const scholarsMate = [
    ["e2", "e4"], ["e7", "e5"],
    ["d1", "h5"], ["b8", "c6"],
    ["f1", "c4"], ["g8", "f6"],
    ["h5", "f7"]
  ];
  for (let i = 0; i < scholarsMate.length; i++) {
    const [from, to] = scholarsMate[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    const resp = await fixture.post(client, `/api/games/${game.id}/moves`, { from, to });
    assert.equal(resp.status, 200);
  }

  const db = new Database(fixture.dbPath);
  const rows = db.prepare("SELECT type, payload_json FROM game_events WHERE game_id = ? ORDER BY rowid").all(game.id);
  db.close();

  const moveEvents = rows.filter((r) => r.type === "move");
  const finalizedEvents = rows.filter((r) => r.type === "finalized");
  assert.equal(moveEvents.length, 7);
  assert.equal(finalizedEvents.length, 1);

  const finalizedPayload = JSON.parse(finalizedEvents[0].payload_json);
  assert.equal(finalizedPayload.result, "white_win");
  assert.equal(finalizedPayload.reason, "checkmate");
  assert.equal(finalizedPayload.ratingChange.whiteDelta, 16);
});

test("stalemate auto-finalizes as a draw and splits the pot", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;

  // Sam Loyd's 10-move forced stalemate.
  const moves = [
    ["e2", "e3"], ["a7", "a5"],
    ["d1", "h5"], ["a8", "a6"],
    ["h5", "a5"], ["h7", "h5"],
    ["a5", "c7"], ["a6", "h6"],
    ["h2", "h4"], ["f7", "f6"],
    ["c7", "d7"], ["e8", "f7"],
    ["d7", "b7"], ["d8", "d3"],
    ["b7", "b8"], ["d3", "h7"],
    ["b8", "c8"], ["f7", "g6"],
    ["c8", "e6"]
  ];

  let lastResponse;
  for (let i = 0; i < moves.length; i++) {
    const [from, to] = moves[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    lastResponse = await fixture.post(client, `/api/games/${game.id}/moves`, { from, to });
    assert.equal(lastResponse.status, 200, `move ${i} status (${from}->${to})`);
  }

  assert.equal(lastResponse.body.game.state, "finalized");
  assert.equal(lastResponse.body.game.endReason, "stalemate");
  assert.equal(lastResponse.body.settlement.result, "draw");
  assert.equal(lastResponse.body.settlement.ratingDelta, 0);
});

test("promotion is preserved through the API for both colors", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;

  const moves = [
    ["h2", "h4", null], ["a7", "a5", null],
    ["h4", "h5", null], ["a5", "a4", null],
    ["h5", "h6", null], ["a4", "a3", null],
    ["h6", "g7", null], ["a3", "b2", null],
    ["g7", "h8", "q"], ["b2", "a1", "q"]
  ];

  let lastResponse;
  for (let i = 0; i < moves.length; i++) {
    const [from, to, promotion] = moves[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    const body = promotion ? { from, to, promotion } : { from, to };
    lastResponse = await fixture.post(client, `/api/games/${game.id}/moves`, body);
    assert.equal(lastResponse.status, 200, `move ${i} status (${from}->${to})`);
  }

  const lastTwo = lastResponse.body.game.moves.slice(-2);
  assert.equal(lastTwo[0].promotion, "q");
  assert.equal(lastTwo[0].san, "gxh8=Q");
  assert.equal(lastTwo[1].promotion, "q");
  assert.equal(lastTwo[1].san, "bxa1=Q");
  assert.ok(lastResponse.body.game.fen.startsWith("rnbqkbnQ/1ppppp1p/8/8/8/8/P1PPPPP1/qNBQKBNR"));

  const replay = await fixture.get(whiteClient, `/api/games/${game.id}/replay`);
  const promotionPly = replay.body.replay.moves.find((m) => m.san === "gxh8=Q");
  assert.equal(promotionPly.promotion, "q");
});

test("threefold repetition auto-finalizes as a draw", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;

  const shuffle = [
    ["g1", "f3"], ["g8", "f6"],
    ["f3", "g1"], ["f6", "g8"],
    ["g1", "f3"], ["g8", "f6"],
    ["f3", "g1"], ["f6", "g8"]
  ];

  let lastResponse;
  for (let i = 0; i < shuffle.length; i++) {
    const [from, to] = shuffle[i];
    const client = i % 2 === 0 ? whiteClient : blackClient;
    lastResponse = await fixture.post(client, `/api/games/${game.id}/moves`, { from, to });
    assert.equal(lastResponse.status, 200, `move ${i} status`);
  }

  assert.equal(lastResponse.body.game.state, "finalized");
  assert.equal(lastResponse.body.game.endReason, "threefold_repetition");
  assert.equal(lastResponse.body.settlement.result, "draw");
});

test("sub-minute bullet time control is accepted end-to-end", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const carol = await fixture.signup("carol");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "30s+0"
  });
  assert.equal(created.status, 201);

  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.game.clock.whiteMs, 30_000);
  assert.equal(accepted.body.game.clock.incrementMs, 0);

  const rejected = await fixture.post(carol, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "5s+0"
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "invalid_challenge_input");
});

test("flagged players lose before taking live actions", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  const game = accepted.body.game;

  const db = new Database(fixture.dbPath);
  const row = db.prepare("SELECT data_json FROM games WHERE id = ?").get(game.id);
  const data = JSON.parse(row.data_json);
  data.clock = {
    ...data.clock,
    whiteMs: 1,
    sideToMove: "white",
    lastMoveAt: new Date(Date.now() - 1000).toISOString(),
    // Post-first-moves: the main clock is ticking, so the flag fires. The
    // first-move pause path is exercised in tests/pre-move-abort.test.mjs.
    firstMovesMade: 2
  };
  db.prepare("UPDATE games SET data_json = ? WHERE id = ?").run(JSON.stringify(data), game.id);
  db.close();

  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const response = await fixture.post(whiteClient, `/api/games/${game.id}/draw-offer`);

  assert.equal(response.status, 200);
  assert.equal(response.body.timedOut, true);
  assert.equal(response.body.game.state, "finalized");
  assert.equal(response.body.game.endReason, "timeout");
  assert.notEqual(response.body.game.winnerId, white.id);
});

async function startFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-api-"));
  const dbPath = path.join(dir, "test.db");
  const previousDbPath = process.env.HORSEY_DB_PATH;
  process.env.HORSEY_DB_PATH = dbPath;

  const serverModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/server.mjs"));
  serverModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const api = await import(serverModuleUrl.href);

  t.after(async () => {
    api.closeServerResources();
    if (previousDbPath === undefined) delete process.env.HORSEY_DB_PATH;
    else process.env.HORSEY_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  async function request(client, method, pathname, body) {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = {
      host: "127.0.0.1",
      ...(client?.cookie ? { cookie: client.cookie } : {})
    };

    const response = await callRoute(api.routeApi, req);
    return response;
  }

  return {
    dbPath,
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body),
    async signup(prefix) {
      const response = await request(null, "POST", "/api/auth/signup", {
        email: `${prefix}-${Date.now()}@example.com`,
        handle: `${prefix}_${Math.random().toString(16).slice(2, 8)}`,
        password: "password123",
        acceptedTosVersion: 1
      });
      assert.equal(response.status, 201);
      return { cookie: response.cookie, user: response.body.viewer };
    }
  };
}

function callRoute(routeApi, req) {
  return new Promise((resolve, reject) => {
    let status = 200;
    const headers = {};
    let raw = "";
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      writeHead(nextStatus, nextHeaders = {}) {
        status = nextStatus;
        for (const [name, value] of Object.entries(nextHeaders)) {
          headers[name.toLowerCase()] = value;
        }
      },
      end(chunk = "") {
        raw += chunk.toString();
        resolve({
          status,
          headers,
          body: raw ? JSON.parse(raw) : {},
          cookie: String(headers["set-cookie"] ?? "").split(";")[0] || null
        });
      }
    };
    routeApi(req, res).catch(reject);
  });
}
