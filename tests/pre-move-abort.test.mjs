import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

const ROOT = path.resolve(import.meta.dirname, "..");

test("resigning before any move aborts the game and returns both stakes", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const aliceBefore = await fixture.get(alice, "/api/wallet");
  const bobBefore = await fixture.get(bob, "/api/wallet");
  const aliceStartBalance = aliceBefore.body.viewer.balanceCents;
  const bobStartBalance = bobBefore.body.viewer.balanceCents;

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  assert.equal(created.status, 201);

  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  assert.equal(accepted.status, 200);
  const game = accepted.body.game;

  // Pre-move resign should abort, not finalize as a loss.
  const aliceWhite = game.players.find((p) => p.color === "white").id === alice.user.id;
  const resigner = aliceWhite ? alice : bob;
  const resigned = await fixture.post(resigner, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "aborted");
  assert.equal(resigned.body.game.endReason, "aborted_pre_move");
  assert.equal(resigned.body.game.winnerId, null);

  // Both players are made whole. No rake taken.
  const aliceAfter = await fixture.get(alice, "/api/wallet");
  const bobAfter = await fixture.get(bob, "/api/wallet");
  assert.equal(aliceAfter.body.viewer.balanceCents, aliceStartBalance);
  assert.equal(bobAfter.body.viewer.balanceCents, bobStartBalance);

  // Settlement payload reflects an aborted result.
  const settlement = await fixture.get(resigner, `/api/games/${game.id}/settlement`);
  assert.equal(settlement.status, 200);
  assert.equal(settlement.body.settlement.result, "aborted");
  assert.equal(settlement.body.settlement.reason, "aborted_pre_move");
  // No rake entry — house balance is untouched.
  const db = new Database(fixture.dbPath);
  const houseRakeRow = db.prepare(
    "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_id = ? AND type = 'rake'"
  ).get(game.id);
  db.close();
  assert.equal(houseRakeRow.n, 0);
});

test("main clock does not tick until each side has made their first move", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;
  assert.equal(game.clock.firstMovesMade, 0);
  assert.equal(game.clock.whiteMs, 180_000);
  assert.equal(game.clock.blackMs, 180_000);

  // Wait ~120ms — comfortably inside the 15s first-move window — then white plays.
  await new Promise((r) => setTimeout(r, 120));
  const whitePlayer = game.players.find((p) => p.color === "white");
  const whiteClient = whitePlayer.id === alice.user.id ? alice : bob;
  const move1 = await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });
  assert.equal(move1.status, 200);
  // White's main clock didn't tick — it stays at base time (3+0 → no increment).
  assert.equal(move1.body.game.clock.whiteMs, 180_000);
  assert.equal(move1.body.game.clock.firstMovesMade, 1);
  assert.equal(move1.body.game.clock.sideToMove, "black");

  // Black hasn't moved yet — their clock is still static.
  await new Promise((r) => setTimeout(r, 120));
  const blackPlayer = game.players.find((p) => p.color === "black");
  const blackClient = blackPlayer.id === alice.user.id ? alice : bob;
  const move2 = await fixture.post(blackClient, `/api/games/${game.id}/moves`, { from: "e7", to: "e5" });
  assert.equal(move2.status, 200);
  assert.equal(move2.body.game.clock.blackMs, 180_000);
  assert.equal(move2.body.game.clock.firstMovesMade, 2);
});

test("first-move timer fires and aborts when the side-to-move never moves", async (t) => {
  const fixture = await startFixture(t, { firstMoveDeadlineMs: 50 });
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const created = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${created.body.challenge.id}/accept`);
  const game = accepted.body.game;
  assert.equal(game.state, "live");

  // Wait past the (shrunken) first-move deadline + scheduler slack. The timer
  // fires asynchronously, so poll briefly until the state flips.
  const deadline = Date.now() + 1000;
  let aborted = null;
  while (Date.now() < deadline) {
    const fresh = await fixture.get(alice, `/api/games/${game.id}`);
    if (fresh.body.game.state === "aborted") { aborted = fresh.body.game; break; }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(aborted, "expected first-move timer to abort the game");
  assert.equal(aborted.endReason, "aborted_pre_move");
  assert.equal(aborted.winnerId, null);
});

async function startFixture(t, { firstMoveDeadlineMs } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-abort-"));
  const dbPath = path.join(dir, "test.db");
  const previousDbPath = process.env.HORSEY_DB_PATH;
  const previousDeadline = process.env.HORSEY_FIRST_MOVE_DEADLINE_MS;
  process.env.HORSEY_DB_PATH = dbPath;
  if (firstMoveDeadlineMs != null) {
    process.env.HORSEY_FIRST_MOVE_DEADLINE_MS = String(firstMoveDeadlineMs);
  }

  const serverModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/server.mjs"));
  serverModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const api = await import(serverModuleUrl.href);

  t.after(async () => {
    await api.closeServerResources();
    if (previousDbPath === undefined) delete process.env.HORSEY_DB_PATH;
    else process.env.HORSEY_DB_PATH = previousDbPath;
    if (previousDeadline === undefined) delete process.env.HORSEY_FIRST_MOVE_DEADLINE_MS;
    else process.env.HORSEY_FIRST_MOVE_DEADLINE_MS = previousDeadline;
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
    return await callRoute(api.routeApi, req);
  }

  return {
    dbPath,
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body),
    async signup(prefix) {
      const response = await request(null, "POST", "/api/auth/signup", {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`,
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
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
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
