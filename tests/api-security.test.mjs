import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");

test("API protects game reads and rejects moves after finalization", async (t) => {
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
  assert.equal(outsiderGame.status, 403);
  assert.equal(outsiderGame.body.error, "not_a_player");

  const outsiderSettlement = await fixture.get(carol, `/api/games/${game.id}/settlement`);
  assert.equal(outsiderSettlement.status, 403);
  assert.equal(outsiderSettlement.body.error, "not_a_player");

  const acceptedChallengeRead = await fixture.get(carol, `/api/challenges/${created.body.challenge.id}`);
  assert.equal(acceptedChallengeRead.status, 403);
  assert.equal(acceptedChallengeRead.body.error, "not_your_challenge");

  const resigningClient = game.players[0].id === alice.user.id ? alice : bob;
  const resigned = await fixture.post(resigningClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "finalized");

  const currentTurnClient = game.turn === game.players.find((p) => p.id === alice.user.id).color ? alice : bob;
  const move = game.turn === "white" ? { from: "e2", to: "e4" } : { from: "e7", to: "e5" };
  const moveAfterFinalized = await fixture.post(currentTurnClient, `/api/games/${game.id}/moves`, move);
  assert.equal(moveAfterFinalized.status, 409);
  assert.equal(moveAfterFinalized.body.error, "game_already_finalized");
});

test("expired open challenges cannot be accepted", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

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
  assert.equal(outsider.status, 403);
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

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 1000,
    timeControl: "30s+0"
  });
  assert.equal(created.status, 201);

  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.game.clock.whiteMs, 30_000);
  assert.equal(accepted.body.game.clock.incrementMs, 0);

  const rejected = await fixture.post(alice, "/api/challenges", {
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
    lastMoveAt: new Date(Date.now() - 1000).toISOString()
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
        password: "password123"
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
