// FAIR_PLAY slice 1 tests (ADR 0008).
//
// Three layers:
//   1. Pure math from packages/shared/analysis.mjs.
//   2. Worker lifecycle against a stub engine (no real Stockfish in CI).
//   3. Admin endpoint gate using the API fixture.
//
// The actual Stockfish subprocess is exercised by the manual smoke described
// in PAYMENTS_NEXT_PASS-style go-live notes, not in CI.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

import {
  classifyCpLoss,
  cpLossForPlay,
  evalCpFromMate,
  normalizeEvalCp,
  summarizeMoveAnalyses
} from "../packages/shared/analysis.mjs";
import { startAnalysisWorker } from "../apps/api/analysis-worker.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- 1. Pure math ----------------------------------------------------------

test("classifyCpLoss honors blunder/mistake/inaccuracy thresholds", () => {
  assert.equal(classifyCpLoss(0, { isTopMove: true }), "best");
  assert.equal(classifyCpLoss(0), "good");
  assert.equal(classifyCpLoss(20), "good");
  assert.equal(classifyCpLoss(49), "good");
  assert.equal(classifyCpLoss(50), "inaccuracy");
  assert.equal(classifyCpLoss(99), "inaccuracy");
  assert.equal(classifyCpLoss(100), "mistake");
  assert.equal(classifyCpLoss(249), "mistake");
  assert.equal(classifyCpLoss(250), "blunder");
  assert.equal(classifyCpLoss(1500), "blunder");
});

test("classifyCpLoss returns null for missing or NaN loss", () => {
  assert.equal(classifyCpLoss(null), null);
  assert.equal(classifyCpLoss(undefined), null);
  assert.equal(classifyCpLoss(NaN), null);
});

test("cpLossForPlay flips perspective for black", () => {
  // White played; best was +50, played was +20 → loss 30.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 50, playedEvalCp: 20 }), 30);
  // Black played; best was -50 (good for black), played was -20 (worse for black) → loss 30.
  assert.equal(cpLossForPlay({ side: "black", bestEvalCp: -50, playedEvalCp: -20 }), 30);
  // No regression when played equals best.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 10, playedEvalCp: 10 }), 0);
  // Never negative — clamp.
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 0, playedEvalCp: 25 }), 0);
});

test("cpLossForPlay returns null if either input is missing", () => {
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: null, playedEvalCp: 10 }), null);
  assert.equal(cpLossForPlay({ side: "white", bestEvalCp: 10, playedEvalCp: null }), null);
});

test("normalizeEvalCp prefers mate over cp when mate is set", () => {
  assert.equal(normalizeEvalCp({ evalCp: 50, mateIn: 3 }), evalCpFromMate(3));
  assert.equal(normalizeEvalCp({ evalCp: 50, mateIn: null }), 50);
  assert.equal(normalizeEvalCp({ evalCp: null, mateIn: null }), null);
  // mateIn=0 should be treated as not-mate.
  assert.equal(normalizeEvalCp({ evalCp: 100, mateIn: 0 }), 100);
});

test("summarizeMoveAnalyses excludes book plies from ACPL and top-move match", () => {
  const moves = [
    { side: "white", playedSan: "e4", bestSan: "e4", cpLoss: 0, classification: null, isBook: true },
    { side: "black", playedSan: "e5", bestSan: "e5", cpLoss: 0, classification: null, isBook: true },
    { side: "white", playedSan: "Nf3", bestSan: "Nf3", cpLoss: 10, classification: "good", isBook: false },
    { side: "black", playedSan: "Nc6", bestSan: "Nc6", cpLoss: 0, classification: "best", isBook: false },
    { side: "white", playedSan: "Bb5", bestSan: "Bb5", cpLoss: 80, classification: "inaccuracy", isBook: false },
    { side: "black", playedSan: "Qd7", bestSan: "a6", cpLoss: 300, classification: "blunder", isBook: false }
  ];
  const summary = summarizeMoveAnalyses(moves);
  // White non-book moves: cpLoss 10 + 80 = 90; / 2 plies = 45 ACPL.
  assert.equal(summary.white.acpl, 45);
  assert.equal(summary.white.blunders, 0);
  assert.equal(summary.white.inaccuracies, 1);
  // Black non-book: cpLoss 0 + 300 = 300 / 2 = 150 ACPL.
  assert.equal(summary.black.acpl, 150);
  assert.equal(summary.black.blunders, 1);
  // White matched best on both non-book moves → 100% match.
  assert.equal(summary.white.topMoveMatchPct, 100);
  // Black matched 1 of 2 non-book → 50%.
  assert.equal(summary.black.topMoveMatchPct, 50);
});

test("summarizeMoveAnalyses caps individual cp_loss at 1000 so mate evals don't dominate ACPL", () => {
  // One mating sequence shouldn't push ACPL into the tens of thousands.
  // Raw cp_loss values stay uncapped on move_analysis; only the ACPL math caps.
  const moves = [
    { side: "white", playedSan: "e4", bestSan: "e4", cpLoss: 0, classification: "best", isBook: false },
    { side: "white", playedSan: "??", bestSan: "Nf3", cpLoss: 30000, classification: "blunder", isBook: false }
  ];
  const summary = summarizeMoveAnalyses(moves);
  // (0 + 1000) / 2 = 500. Without the cap it would be ~15000.
  assert.equal(summary.white.acpl, 500);
});

test("summarizeMoveAnalyses tolerates empty/all-book input", () => {
  assert.deepEqual(summarizeMoveAnalyses([]).white, {
    acpl: 0,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    topMoveMatchPct: 0
  });
});

// --- 2. Worker against a stub engine --------------------------------------
//
// The stub engine always returns the played move as "best" with eval=0 (a
// "perfect" game). That lets us assert the full pipeline writes rows without
// pulling in a real Stockfish.

function makeStubEngine() {
  return {
    version: "stub-engine-1.0",
    depth: 18,
    async analyze() {
      return { bestMoveUci: null, evalCp: 0, mateIn: null };
    },
    async close() {}
  };
}

test("worker analyzes a finalized game end-to-end against a stub engine", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Scholar's Mate to finalize the game with real moves so the worker has
  // something to chew on. Play a few moves so we're past the book-ply skip.
  const moves = [
    { color: "white", move: { from: "e2", to: "e4" } },
    { color: "black", move: { from: "e7", to: "e5" } },
    { color: "white", move: { from: "f1", to: "c4" } },
    { color: "black", move: { from: "b8", to: "c6" } },
    { color: "white", move: { from: "d1", to: "h5" } },
    { color: "black", move: { from: "g8", to: "f6" } },
    { color: "white", move: { from: "h5", to: "f7" } } // checkmate
  ];
  for (const { color, move } of moves) {
    const player = game.players.find((p) => p.color === color);
    const client = player.id === alice.user.id ? alice : bob;
    const r = await fixture.post(client, `/api/games/${game.id}/moves`, move);
    assert.equal(r.status, 200, `move failed: ${JSON.stringify(r.body)}`);
  }

  // Confirm the game finalized and a job was enqueued by finalizeGame.
  const db = new Database(fixture.dbPath);
  try {
    const finalized = db.prepare("SELECT state FROM games WHERE id = ?").get(game.id);
    assert.equal(finalized.state, "finalized");
    const job = db.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.ok(job, "expected analysis_jobs row after finalize");
    assert.equal(job.status, "pending");
  } finally {
    db.close();
  }

  // Now run the worker once with the stub engine.
  const dbApi = await freshDbApi(fixture.dbPath);
  const worker = startAnalysisWorker({
    db: dbApi,
    enginePath: "/fake/stockfish",
    startEngineImpl: async () => makeStubEngine(),
    autoStart: false
  });
  const claimed = await worker.runOnce();
  assert.ok(claimed, "worker should have claimed the pending job");
  await worker.stop();

  const verifyDb = new Database(fixture.dbPath);
  try {
    const ga = verifyDb.prepare("SELECT * FROM game_analysis WHERE game_id = ?").get(game.id);
    assert.ok(ga, "game_analysis row should exist");
    assert.equal(ga.engine_version, "stub-engine-1.0");
    assert.equal(ga.status, "complete");
    const ma = verifyDb.prepare("SELECT COUNT(*) AS n FROM move_analysis WHERE game_analysis_id = ?").get(ga.id);
    assert.equal(ma.n, moves.length);
    const finishedJob = verifyDb.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(finishedJob.status, "complete");
  } finally {
    verifyDb.close();
  }
});

test("worker re-queues on engine failure until MAX_ATTEMPTS, then marks failed", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Play one move and resign so we have a finalized game with moves.
  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const blackClient = whiteClient === alice ? bob : alice;
  const firstMove = await fixture.post(whiteClient, `/api/games/${game.id}/moves`, { from: "e2", to: "e4" });
  assert.equal(firstMove.status, 200);
  const resigned = await fixture.post(blackClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);

  const dbApi = await freshDbApi(fixture.dbPath);
  const failingEngine = {
    version: "stub-failing",
    depth: 18,
    async analyze() { throw new Error("engine boom"); },
    async close() {}
  };
  const worker = startAnalysisWorker({
    db: dbApi,
    enginePath: "/fake/stockfish",
    startEngineImpl: async () => failingEngine,
    autoStart: false
  });

  // MAX_ATTEMPTS = 3 in worker. Run until the job hits status=failed.
  for (let i = 0; i < 4; i++) {
    const job = await worker.runOnce();
    if (!job) break;
  }
  await worker.stop();

  const verifyDb = new Database(fixture.dbPath);
  try {
    const job = verifyDb.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 3);
    assert.match(String(job.last_error), /engine boom/);
    const noAnalysis = verifyDb.prepare("SELECT COUNT(*) AS n FROM game_analysis WHERE game_id = ?").get(game.id);
    assert.equal(noAnalysis.n, 0);
  } finally {
    verifyDb.close();
  }
});

test("aborted games do not enqueue an analysis job", async (t) => {
  const fixture = await startFixture(t);
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  // Resign before any move → abort path (policy § 1.10).
  const white = game.players.find((p) => p.color === "white");
  const whiteClient = white.id === alice.user.id ? alice : bob;
  const resigned = await fixture.post(whiteClient, `/api/games/${game.id}/resign`);
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.game.state, "aborted");

  const db = new Database(fixture.dbPath);
  try {
    const job = db.prepare("SELECT * FROM analysis_jobs WHERE game_id = ?").get(game.id);
    assert.equal(job, undefined, "aborted game should not enqueue an analysis job");
  } finally {
    db.close();
  }
});

// --- 3. Admin endpoint gate ------------------------------------------------

test("/api/admin/games/:id/analysis is gated and returns null payload before any run", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const nonAdmin = await fixture.get(alice, `/api/admin/games/${game.id}/analysis`);
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error, "admin_only");

  const adminView = await fixture.get(admin, `/api/admin/games/${game.id}/analysis`);
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.job, null);
  assert.equal(adminView.body.analysis, null);
  assert.deepEqual(adminView.body.moves, []);
});

test("/api/admin/games/:id/analyze refuses non-finalized games and enqueues finalized ones", async (t) => {
  const fixture = await startFixture(t);
  const admin = await fixture.signup("admin");
  const alice = await fixture.signup("alice");
  const bob = await fixture.signup("bob");
  const db = new Database(fixture.dbPath);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  db.close();

  const challenge = await fixture.post(alice, "/api/challenges", {
    stakeCents: 2500,
    timeControl: "3+0"
  });
  const accepted = await fixture.post(bob, `/api/challenges/${challenge.body.challenge.id}/accept`);
  const game = accepted.body.game;

  const liveReject = await fixture.post(admin, `/api/admin/games/${game.id}/analyze`, {});
  assert.equal(liveReject.status, 409);
  assert.equal(liveReject.body.error, "game_not_finalized");

  // Finalize via Scholar's Mate.
  const moves = [
    { color: "white", move: { from: "e2", to: "e4" } },
    { color: "black", move: { from: "e7", to: "e5" } },
    { color: "white", move: { from: "f1", to: "c4" } },
    { color: "black", move: { from: "b8", to: "c6" } },
    { color: "white", move: { from: "d1", to: "h5" } },
    { color: "black", move: { from: "g8", to: "f6" } },
    { color: "white", move: { from: "h5", to: "f7" } }
  ];
  for (const { color, move } of moves) {
    const player = game.players.find((p) => p.color === color);
    const client = player.id === alice.user.id ? alice : bob;
    await fixture.post(client, `/api/games/${game.id}/moves`, move);
  }

  // Finalize already enqueued — the explicit POST should return the existing
  // pending job, not create a second one.
  const enqueued = await fixture.post(admin, `/api/admin/games/${game.id}/analyze`, {});
  assert.equal(enqueued.status, 200);
  assert.ok(enqueued.body.job, "expected the existing job in the response");
  assert.equal(enqueued.body.job.status, "pending");
  assert.equal(enqueued.body.requeued, false);
});

// --- helpers ---------------------------------------------------------------

async function startFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "horsey-analysis-"));
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
    return callRoute(api.routeApi, req);
  }

  return {
    dbPath,
    get: (client, pathname) => request(client, "GET", pathname),
    post: (client, pathname, body = {}) => request(client, "POST", pathname, body),
    async signup(prefix) {
      const response = await request(null, "POST", "/api/auth/signup", {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.com`,
        handle: `${prefix}_${Math.random().toString(16).slice(2, 8)}`,
        password: "password123",
        acceptedTosVersion: 1
      });
      assert.equal(response.status, 201, `signup failed: ${JSON.stringify(response.body)}`);
      return { cookie: response.cookie, user: response.body.viewer };
    }
  };
}

async function freshDbApi(dbPath) {
  // Open a separate db API instance against the same file. Used so the worker
  // owns its own connection — no contention with the server's connection.
  const dbModuleUrl = pathToFileURL(path.join(ROOT, "apps/api/db.mjs"));
  dbModuleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  const mod = await import(dbModuleUrl.href);
  return mod.openDatabase(dbPath);
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
