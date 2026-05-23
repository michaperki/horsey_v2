import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { initialSeed } from "./seed.mjs";

const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    rating INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    available_delta_cents INTEGER NOT NULL,
    escrow_delta_cents INTEGER NOT NULL,
    ref_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(ref_id);

  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    challenger_id TEXT NOT NULL,
    recipient_id TEXT,
    game_id TEXT,
    stake_cents INTEGER NOT NULL,
    time_control TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_challenges_state ON challenges(state);
  CREATE INDEX IF NOT EXISTS idx_challenges_recipient ON challenges(recipient_id);

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    fen TEXT NOT NULL,
    challenge_id TEXT,
    winner_id TEXT,
    end_reason TEXT,
    ended_at TEXT,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_games_state ON games(state);

  CREATE TABLE IF NOT EXISTS game_players (
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    color TEXT NOT NULL,
    PRIMARY KEY (game_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);

  CREATE TABLE IF NOT EXISTS lobby (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matchmaking_tickets (
    user_id TEXT PRIMARY KEY,
    stake_cents INTEGER NOT NULL,
    time_control TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_matchmaking_match ON matchmaking_tickets(stake_cents, time_control);

  CREATE TABLE IF NOT EXISTS game_events (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id, occurred_at);
`;

function rowToPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    rating: row.rating,
    createdAt: row.created_at
  };
}

function rowToLedgerEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    availableDeltaCents: row.available_delta_cents,
    escrowDeltaCents: row.escrow_delta_cents,
    refId: row.ref_id,
    note: row.note,
    createdAt: row.created_at
  };
}

function rowToGame(row) {
  if (!row) return null;
  const data = JSON.parse(row.data_json);
  return {
    id: row.id,
    state: row.state,
    fen: row.fen,
    challengeId: row.challenge_id,
    winnerId: row.winner_id,
    endReason: row.end_reason,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    players: data.players,
    moves: data.moves,
    pot: data.pot,
    clock: data.clock ?? null,
    drawOffer: data.drawOffer ?? null,
    ratingChange: data.ratingChange ?? null
  };
}

function rowToChallenge(row) {
  if (!row) return null;
  const data = JSON.parse(row.data_json);
  return {
    ...data,
    id: row.id,
    state: row.state,
    challengerId: row.challenger_id,
    recipientId: row.recipient_id,
    gameId: row.game_id,
    stakeCents: row.stake_cents,
    timeControl: row.time_control,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTicket(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    stakeCents: row.stake_cents,
    timeControl: row.time_control,
    createdAt: row.created_at
  };
}

export function openDatabase(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateSchema(db);
  db.exec(SCHEMA);
  seedIfEmpty(db);

  return makeApi(db);
}

function migrateSchema(db) {
  const currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion >= SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    // v0 → v1: introduced email/password auth + sessions. The pre-auth users
    // had no credentials, so the only safe migration is to drop every
    // user-keyed table and let the empty schema rebuild. The seed data was a
    // mock and is replaced by per-signup wallet grants.
    db.exec(`
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS matchmaking_tickets;
      DROP TABLE IF EXISTS game_players;
      DROP TABLE IF EXISTS games;
      DROP TABLE IF EXISTS challenges;
      DROP TABLE IF EXISTS ledger_entries;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS lobby;
    `);
  }

  // v1 → v2: game_events table is created by the SCHEMA exec on the next line.
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function seedIfEmpty(db) {
  const lobbyExists = db.prepare("SELECT COUNT(*) AS n FROM lobby").get().n > 0;
  if (!lobbyExists) seedDatabase(db, initialSeed());
}

function seedDatabase(db, seed) {
  const insertLobby = db.prepare("INSERT INTO lobby (id, data_json) VALUES (1, ?)");
  db.transaction(() => {
    insertLobby.run(JSON.stringify(seed.lobby));
  })();
}

function makeApi(db) {
  const stmts = {
    listLedger: db.prepare("SELECT * FROM ledger_entries ORDER BY rowid"),
    listLedgerForUser: db.prepare("SELECT * FROM ledger_entries WHERE user_id = ? ORDER BY rowid"),
    insertLedger: db.prepare(`
      INSERT INTO ledger_entries
        (id, user_id, type, available_delta_cents, escrow_delta_cents, ref_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getUser: db.prepare("SELECT * FROM users WHERE id = ?"),
    getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    getUserByHandle: db.prepare("SELECT * FROM users WHERE handle = ?"),
    listUsers: db.prepare("SELECT * FROM users"),
    insertUser: db.prepare(`
      INSERT INTO users (id, email, handle, password_hash, password_salt, rating, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    updateUserEmail: db.prepare("UPDATE users SET email = ? WHERE id = ?"),
    updateUserPassword: db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"),
    updateUserRating: db.prepare("UPDATE users SET rating = ? WHERE id = ?"),

    getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?"),
    deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),

    getChallenge: db.prepare("SELECT * FROM challenges WHERE id = ?"),
    listOpenChallenges: db.prepare(`
      SELECT * FROM challenges
      WHERE state = 'incoming' AND recipient_id IS NULL
      ORDER BY created_at DESC
    `),
    listIncomingForRecipient: db.prepare(`
      SELECT * FROM challenges
      WHERE recipient_id = ? AND state IN ('incoming', 'countered')
      ORDER BY created_at DESC
    `),
    listSentByChallenger: db.prepare(`
      SELECT * FROM challenges
      WHERE challenger_id = ? AND state IN ('incoming', 'countered')
      ORDER BY created_at DESC
    `),
    insertChallenge: db.prepare(`
      INSERT INTO challenges
        (id, state, challenger_id, recipient_id, game_id, stake_cents, time_control, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateChallenge: db.prepare(`
      UPDATE challenges
      SET state = ?, recipient_id = ?, game_id = ?, stake_cents = ?, time_control = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `),

    getGame: db.prepare("SELECT * FROM games WHERE id = ?"),
    insertGame: db.prepare(`
      INSERT INTO games
        (id, state, fen, challenge_id, winner_id, end_reason, ended_at, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateGame: db.prepare(`
      UPDATE games
      SET state = ?, fen = ?, challenge_id = ?, winner_id = ?, end_reason = ?, ended_at = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `),
    insertGamePlayer: db.prepare("INSERT INTO game_players (game_id, user_id, color) VALUES (?, ?, ?)"),
    findLiveGameForUser: db.prepare(`
      SELECT g.* FROM games g
      JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.user_id = ? AND g.state = 'live'
      ORDER BY g.created_at DESC LIMIT 1
    `),
    listLiveGames: db.prepare("SELECT * FROM games WHERE state = 'live'"),
    findMostRecentGameForUser: db.prepare(`
      SELECT g.* FROM games g
      JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.user_id = ?
      ORDER BY g.created_at DESC LIMIT 1
    `),
    listFinalizedGamesForUser: db.prepare(`
      SELECT g.* FROM games g
      JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.user_id = ? AND g.state = 'finalized'
      ORDER BY COALESCE(g.ended_at, g.updated_at) DESC
      LIMIT ?
    `),
    listFinalizedGamesBetween: db.prepare(`
      SELECT g.* FROM games g
      JOIN game_players gp_a ON gp_a.game_id = g.id AND gp_a.user_id = ?
      JOIN game_players gp_b ON gp_b.game_id = g.id AND gp_b.user_id = ?
      WHERE g.state = 'finalized'
      ORDER BY COALESCE(g.ended_at, g.updated_at) DESC
      LIMIT ?
    `),

    getLobby: db.prepare("SELECT data_json FROM lobby WHERE id = 1"),

    insertGameEvent: db.prepare(`
      INSERT INTO game_events (id, game_id, type, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    listGameEvents: db.prepare(`
      SELECT * FROM game_events WHERE game_id = ? ORDER BY occurred_at ASC, rowid ASC
    `),

    insertTicket: db.prepare(`
      INSERT INTO matchmaking_tickets (user_id, stake_cents, time_control, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        stake_cents = excluded.stake_cents,
        time_control = excluded.time_control,
        created_at = excluded.created_at
    `),
    findMatchingTicket: db.prepare(`
      SELECT * FROM matchmaking_tickets
      WHERE stake_cents = ? AND time_control = ? AND user_id != ?
      ORDER BY created_at ASC LIMIT 1
    `),
    deleteTicket: db.prepare("DELETE FROM matchmaking_tickets WHERE user_id = ?"),
    getTicket: db.prepare("SELECT * FROM matchmaking_tickets WHERE user_id = ?")
  };

  return {
    raw: db,

    listLedger() { return stmts.listLedger.all().map(rowToLedgerEntry); },
    listLedgerForUser(userId) { return stmts.listLedgerForUser.all(userId).map(rowToLedgerEntry); },
    appendLedger(entries) {
      for (const e of entries) {
        stmts.insertLedger.run(e.id, e.userId, e.type, e.availableDeltaCents, e.escrowDeltaCents, e.refId, e.note, e.createdAt);
      }
    },

    getUser(id) { return rowToPublicUser(stmts.getUser.get(id)); },
    getPrivateUser(id) { return stmts.getUser.get(id) || null; },
    getUserByEmail(email) { return stmts.getUserByEmail.get(email) || null; },
    getUserByHandle(handle) { return stmts.getUserByHandle.get(handle) || null; },
    listUsers() { return stmts.listUsers.all().map(rowToPublicUser); },
    insertUser(user) {
      stmts.insertUser.run(
        user.id,
        user.email,
        user.handle,
        user.passwordHash,
        user.passwordSalt,
        user.rating,
        user.createdAt
      );
    },
    updateUserRating(userId, rating) {
      stmts.updateUserRating.run(rating, userId);
    },
    updateUserEmail(userId, email) {
      stmts.updateUserEmail.run(email, userId);
    },
    updateUserPassword(userId, { passwordHash, passwordSalt }) {
      stmts.updateUserPassword.run(passwordHash, passwordSalt, userId);
    },

    getSession(id) {
      const row = stmts.getSession.get(id);
      if (!row) return null;
      return { id: row.id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
    },
    insertSession(session) {
      stmts.insertSession.run(session.id, session.userId, session.createdAt, session.expiresAt);
    },
    deleteSession(id) { stmts.deleteSession.run(id); },
    deleteOtherSessions(userId, keepSessionId) { stmts.deleteOtherSessions.run(userId, keepSessionId); },
    deleteExpiredSessions(nowIso = new Date().toISOString()) {
      stmts.deleteExpiredSessions.run(nowIso);
    },

    getChallenge(id) { return rowToChallenge(stmts.getChallenge.get(id)); },
    listOpenChallenges() { return stmts.listOpenChallenges.all().map(rowToChallenge); },
    listIncomingForRecipient(userId) { return stmts.listIncomingForRecipient.all(userId).map(rowToChallenge); },
    listSentByChallenger(userId) { return stmts.listSentByChallenger.all(userId).map(rowToChallenge); },
    insertChallenge(challenge) {
      const now = new Date().toISOString();
      stmts.insertChallenge.run(
        challenge.id, challenge.state,
        challenge.challengerId, challenge.recipientId ?? null, challenge.gameId ?? null,
        challenge.stakeCents, challenge.timeControl,
        JSON.stringify(challenge), now, now
      );
    },
    saveChallenge(challenge) {
      stmts.updateChallenge.run(
        challenge.state,
        challenge.recipientId ?? null,
        challenge.gameId ?? null,
        challenge.stakeCents,
        challenge.timeControl,
        JSON.stringify(challenge),
        new Date().toISOString(),
        challenge.id
      );
    },

    getGame(id) { return rowToGame(stmts.getGame.get(id)); },
    insertGame(game) {
      const now = new Date().toISOString();
      stmts.insertGame.run(
        game.id, game.state, game.fen,
        game.challengeId ?? null, game.winnerId ?? null,
        game.endReason ?? null, game.endedAt ?? null,
        JSON.stringify({
          players: game.players,
          moves: game.moves,
          pot: game.pot,
          clock: game.clock ?? null,
          drawOffer: game.drawOffer ?? null,
          ratingChange: game.ratingChange ?? null
        }),
        now, now
      );
      for (const p of game.players) {
        stmts.insertGamePlayer.run(game.id, p.id, p.color);
      }
    },
    saveGame(game) {
      stmts.updateGame.run(
        game.state, game.fen,
        game.challengeId ?? null, game.winnerId ?? null,
        game.endReason ?? null, game.endedAt ?? null,
        JSON.stringify({
          players: game.players,
          moves: game.moves,
          pot: game.pot,
          clock: game.clock ?? null,
          drawOffer: game.drawOffer ?? null,
          ratingChange: game.ratingChange ?? null
        }),
        new Date().toISOString(),
        game.id
      );
    },
    findLiveGameForUser(userId) { return rowToGame(stmts.findLiveGameForUser.get(userId)); },
    findMostRecentGameForUser(userId) { return rowToGame(stmts.findMostRecentGameForUser.get(userId)); },
    listFinalizedGamesForUser(userId, limit = 50) {
      return stmts.listFinalizedGamesForUser.all(userId, limit).map(rowToGame);
    },
    listFinalizedGamesBetween(userA, userB, limit = 50) {
      return stmts.listFinalizedGamesBetween.all(userA, userB, limit).map(rowToGame);
    },
    listLiveGames() { return stmts.listLiveGames.all().map(rowToGame); },

    getLobby() { return JSON.parse(stmts.getLobby.get().data_json); },

    appendGameEvent(event) {
      stmts.insertGameEvent.run(
        event.id,
        event.gameId,
        event.type,
        JSON.stringify(event.payload ?? {}),
        event.occurredAt
      );
    },
    listGameEvents(gameId) {
      return stmts.listGameEvents.all(gameId).map((row) => ({
        id: row.id,
        gameId: row.game_id,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        occurredAt: row.occurred_at
      }));
    },

    upsertTicket(ticket) {
      stmts.insertTicket.run(ticket.userId, ticket.stakeCents, ticket.timeControl, ticket.createdAt);
    },
    findMatchingTicket(stakeCents, timeControl, excludingUserId) {
      return rowToTicket(stmts.findMatchingTicket.get(stakeCents, timeControl, excludingUserId));
    },
    getTicket(userId) { return rowToTicket(stmts.getTicket.get(userId)); },
    deleteTicket(userId) { stmts.deleteTicket.run(userId); },

    transaction(fn) { return db.transaction(fn); },

    close() { db.close(); }
  };
}
