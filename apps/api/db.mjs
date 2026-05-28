import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { initialSeed } from "./seed.mjs";
import { DEFAULT_AVATAR_ID, defaultOwnedAvatarIds } from "../../packages/shared/avatars.mjs";

const SCHEMA_VERSION = 15;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    rating INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    onboarding_completed_at TEXT,
    equipped_avatar TEXT NOT NULL DEFAULT '${DEFAULT_AVATAR_ID}',
    email_verified_at TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS email_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens(token_hash, type);
  CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);

  CREATE TABLE IF NOT EXISTS user_avatars (
    user_id TEXT NOT NULL,
    avatar_id TEXT NOT NULL,
    source TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    PRIMARY KEY (user_id, avatar_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_avatars_user ON user_avatars(user_id);

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
    tier_pref TEXT NOT NULL DEFAULT 'any',
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

  CREATE TABLE IF NOT EXISTS external_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_username TEXT NOT NULL,
    external_id TEXT,
    status TEXT NOT NULL,
    claim_token TEXT,
    claim_token_expires_at TEXT,
    imported_stats_json TEXT,
    last_synced_at TEXT,
    verified_at TEXT,
    verified_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_external_accounts_user ON external_accounts(user_id);

  CREATE TABLE IF NOT EXISTS user_milestones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 1,
    game_id TEXT,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_milestones_user ON user_milestones(user_id, event_key, occurred_at);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data_json TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, entity_type, entity_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user_updated ON notifications(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);

  -- Payments v1 (ADR 0007). Checkout creates purchase rows; signed
  -- NOWPayments IPNs update the row and credit chips idempotently.
  CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,             -- 'nowpayments' for v1
    provider_session_id TEXT,           -- NOWPayments invoice id; nullable until invoice created
    provider_payment_id TEXT,           -- NOWPayments payment id once the user picks a currency
    package_id TEXT NOT NULL,           -- 'starter' | 'standard' | 'roller' | 'whale'
    amount_usd_cents INTEGER NOT NULL,  -- the package price in USD cents
    chips_credited_cents INTEGER NOT NULL,  -- what we credit on finished, includes bonus
    status TEXT NOT NULL,               -- 'pending' | 'confirming' | 'confirmed' | 'finished' | 'failed' | 'expired' | 'refunded'
    pay_currency TEXT,                  -- 'usdttrc20' | 'usdcpolygon' | etc.; null until user picks
    pay_amount TEXT,                    -- string to avoid float drift; the crypto amount expected
    ledger_entry_id TEXT,               -- set once chips have been credited
    raw_provider_json TEXT,             -- last IPN payload for audit
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_purchases_provider_session ON purchases(provider, provider_session_id);

  -- Versioned ToS acceptance. Re-acceptance is required on version bump.
  CREATE TABLE IF NOT EXISTS tos_acceptances (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tos_version INTEGER NOT NULL,
    accepted_at TEXT NOT NULL,
    UNIQUE(user_id, tos_version)
  );
  CREATE INDEX IF NOT EXISTS idx_tos_acceptances_user ON tos_acceptances(user_id);

  -- Cashout waitlist — emails collected while cashout is deferred to Phase 7.
  CREATE TABLE IF NOT EXISTS cashout_waitlist (
    id TEXT PRIMARY KEY,
    user_id TEXT,             -- null if the email submitter isn't logged in
    email TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(email)
  );

  -- Admin audit log. One row per privileged mutation (void / adjust / restrict /
  -- clear-restriction). The before/after JSON snapshots capture enough to
  -- reconstruct what changed without joining back to mutable rows.
  CREATE TABLE IF NOT EXISTS admin_actions (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,      -- 'game' | 'user'
    target_id TEXT NOT NULL,
    action TEXT NOT NULL,           -- 'void' | 'adjust' | 'restrict' | 'clear_restriction'
    reason TEXT NOT NULL,
    before_json TEXT,               -- nullable for actions with no prior state
    after_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_admin_actions_actor ON admin_actions(actor_user_id);
  CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at DESC);

  -- Shadow-restriction ladder per FAIR_PLAY_NEXT_PASS.md § Enforcement Ladder.
  -- One row per active restriction. Cleared restrictions stay in the table for
  -- audit; cleared_at is non-null when no longer active.
  CREATE TABLE IF NOT EXISTS user_restrictions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    restriction TEXT NOT NULL,      -- enum, see RESTRICTION_LADDER below
    reason TEXT NOT NULL,
    applied_by TEXT NOT NULL,       -- admin user_id
    applied_at TEXT NOT NULL,
    cleared_at TEXT,                -- null = active
    cleared_by TEXT,
    cleared_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_restrictions_active ON user_restrictions(user_id, cleared_at);
  CREATE INDEX IF NOT EXISTS idx_user_restrictions_restriction ON user_restrictions(restriction, cleared_at);

  -- Player reports. Intake is user-facing; review and status changes are
  -- admin-only. Punitive actions remain separate admin mutations.
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_user_id TEXT NOT NULL,
    target_user_id TEXT,
    game_id TEXT,
    category TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    admin_note TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_game ON reports(game_id);
`;

function rowToPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    rating: row.rating,
    createdAt: row.created_at,
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
    equippedAvatar: row.equipped_avatar ?? null,
    emailVerifiedAt: row.email_verified_at ?? null,
    isAdmin: Number(row.is_admin ?? 0) === 1
  };
}

function rowToEmailToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? null,
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
    ratingChange: data.ratingChange ?? null,
    timeControl: data.timeControl ?? null,
    adminVoid: data.adminVoid ?? null,
    adminAdjustment: data.adminAdjustment ?? null
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

function rowToExternalAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalUsername: row.external_username,
    externalId: row.external_id,
    status: row.status,
    claimToken: row.claim_token ?? null,
    claimTokenExpiresAt: row.claim_token_expires_at ?? null,
    importedStats: row.imported_stats_json ? JSON.parse(row.imported_stats_json) : null,
    lastSyncedAt: row.last_synced_at,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id ?? null,
    providerPaymentId: row.provider_payment_id ?? null,
    packageId: row.package_id,
    amountUsdCents: row.amount_usd_cents,
    chipsCreditedCents: row.chips_credited_cents,
    status: row.status,
    payCurrency: row.pay_currency ?? null,
    payAmount: row.pay_amount ?? null,
    ledgerEntryId: row.ledger_entry_id ?? null,
    rawProvider: row.raw_provider_json ? JSON.parse(row.raw_provider_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTosAcceptance(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tosVersion: row.tos_version,
    acceptedAt: row.accepted_at
  };
}

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetUserId: row.target_user_id ?? null,
    gameId: row.game_id ?? null,
    category: row.category,
    note: row.note,
    status: row.status,
    adminNote: row.admin_note ?? null,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    title: row.title,
    body: row.body ?? null,
    data: row.data_json ? JSON.parse(row.data_json) : null,
    readAt: row.read_at ?? null,
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
    tierPref: row.tier_pref || "any",
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
  // v2 → v3: external_accounts table is likewise created by the SCHEMA exec.
  // v3 → v4: add users.onboarding_completed_at; backfill existing rows from
  //          created_at so accounts that pre-date the onboarding modal don't
  //          get prompted on their next login.
  if (currentVersion < 4 && currentVersion >= 1) {
    const cols = db.prepare("PRAGMA table_info('users')").all();
    if (!cols.some((c) => c.name === "onboarding_completed_at")) {
      db.exec("ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT");
    }
    db.prepare(`
      UPDATE users SET onboarding_completed_at = created_at
      WHERE onboarding_completed_at IS NULL
    `).run();
  }
  // v4 → v5: matchmaking_tickets gains tier_pref so each ticket can express a
  // minimum opponent tier. Default 'any' preserves existing behavior.
  if (currentVersion < 5 && currentVersion >= 1) {
    const cols = db.prepare("PRAGMA table_info('matchmaking_tickets')").all();
    if (!cols.some((c) => c.name === "tier_pref")) {
      db.exec("ALTER TABLE matchmaking_tickets ADD COLUMN tier_pref TEXT NOT NULL DEFAULT 'any'");
    }
  }
  // v5 → v6: user_milestones table is created by the SCHEMA exec on the next
  // line. No backfill — milestones detected from this point forward only.
  // v6 → v7: cosmetics, user_cosmetics, user_cosmetic_equip were added.
  // v7 → v8: cosmetic infra ripped (see commit "Rip cosmetics infra..."). Drop
  // the three cosmetic tables; the next cosmetic system, when designed, will
  // introduce its own shape under a future schema bump.
  if (currentVersion < 8) {
    db.exec("DROP TABLE IF EXISTS user_cosmetic_equip");
    db.exec("DROP TABLE IF EXISTS user_cosmetics");
    db.exec("DROP TABLE IF EXISTS cosmetics");
  }
  // v8 → v9: MVP avatar system. users.equipped_avatar holds the avatar id the
  // user is currently showing; user_avatars is the ownership join. Backfill
  // grants every existing account the default-owned set so equip works
  // immediately after the migration.
  if (currentVersion < 9 && currentVersion >= 1) {
    const cols = db.prepare("PRAGMA table_info('users')").all();
    if (!cols.some((c) => c.name === "equipped_avatar")) {
      db.exec(
        `ALTER TABLE users ADD COLUMN equipped_avatar TEXT NOT NULL DEFAULT '${DEFAULT_AVATAR_ID}'`
      );
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_avatars (
        user_id TEXT NOT NULL,
        avatar_id TEXT NOT NULL,
        source TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        PRIMARY KEY (user_id, avatar_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_avatars_user ON user_avatars(user_id);
    `);
    const insertUserAvatar = db.prepare(`
      INSERT OR IGNORE INTO user_avatars (user_id, avatar_id, source, acquired_at)
      VALUES (?, ?, 'default', ?)
    `);
    const now = new Date().toISOString();
    const users = db.prepare("SELECT id FROM users").all();
    for (const u of users) {
      for (const avatarId of defaultOwnedAvatarIds()) {
        insertUserAvatar.run(u.id, avatarId, now);
      }
    }
  }
  // v14 → v15: player reports. The reports table is created idempotently by
  // the SCHEMA exec. No backfill.

  // v12 → v13: payments v1 (ADR 0007). Adds purchases / tos_acceptances /
  // cashout_waitlist tables. Checkout + signed NOWPayments webhook crediting
  // are wired against the purchases table; live use still depends on secrets
  // and HORSEY_PAYMENTS_ENABLED=1.

  // v13 → v14: admin mutation slice. admin_actions audit log + user_restrictions
  // ladder, both created idempotently by the SCHEMA exec above. No backfill.
  // See OPERATIONAL_POLICY.md § 1.14 and FAIR_PLAY_NEXT_PASS.md § Enforcement
  // Ladder.

  // v11 → v12: notifications table is created by the SCHEMA exec on the next
  // line. UNIQUE(user_id, entity_type, entity_id) enforces one row per
  // logical thread so async-resolution events (pot_state, payment_state,
  // cashout_state) can update in place rather than double-write. See
  // docs/NOTIFICATIONS_NEXT_PASS.md.

  // v10 → v11: add users.is_admin (default 0). Admins are hand-set in the DB
  // (`UPDATE users SET is_admin=1 WHERE handle='...'`); there is no
  // admin-creates-admin UI in this slice. The flag gates /api/admin/* routes
  // and the #admin web page.
  if (currentVersion < 11 && currentVersion >= 1) {
    const cols = db.prepare("PRAGMA table_info('users')").all();
    if (!cols.some((c) => c.name === "is_admin")) {
      db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
    }
  }
  // v9 → v10: email verification + password reset. users.email_verified_at is
  // null for unverified accounts. Existing rows are grandfathered to
  // created_at so accounts that pre-date verification don't get nagged. The
  // email_tokens table stores hashed verify/reset tokens with TTL + single-use
  // consumption.
  if (currentVersion < 10 && currentVersion >= 1) {
    const cols = db.prepare("PRAGMA table_info('users')").all();
    if (!cols.some((c) => c.name === "email_verified_at")) {
      db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    }
    db.prepare(`
      UPDATE users SET email_verified_at = created_at
      WHERE email_verified_at IS NULL
    `).run();
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens(token_hash, type);
      CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);
    `);
  }
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
    updateUserEmail: db.prepare("UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?"),
    updateUserPassword: db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"),
    updateUserRating: db.prepare("UPDATE users SET rating = ? WHERE id = ?"),
    markEmailVerified: db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL"),
    updateUserEquippedAvatar: db.prepare("UPDATE users SET equipped_avatar = ? WHERE id = ?"),
    markOnboardingCompleted: db.prepare(`
      UPDATE users SET onboarding_completed_at = ?
      WHERE id = ? AND onboarding_completed_at IS NULL
    `),

    insertUserAvatar: db.prepare(`
      INSERT OR IGNORE INTO user_avatars (user_id, avatar_id, source, acquired_at)
      VALUES (?, ?, ?, ?)
    `),
    listUserAvatarsForUser: db.prepare(
      "SELECT avatar_id, source, acquired_at FROM user_avatars WHERE user_id = ?"
    ),
    countUserAvatar: db.prepare(
      "SELECT COUNT(*) AS n FROM user_avatars WHERE user_id = ? AND avatar_id = ?"
    ),

    getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?"),
    deleteSessionsForUser: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
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
    countLiveGames: db.prepare("SELECT count(*) AS n FROM games WHERE state = 'live'"),
    listRecentFinalizedGames: db.prepare(`
      SELECT * FROM games WHERE state = 'finalized'
      ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT ?
    `),
    listRecentChallengesAll: db.prepare(`
      SELECT * FROM challenges ORDER BY created_at DESC LIMIT ?
    `),
    listAllExternalAccounts: db.prepare(`
      SELECT * FROM external_accounts ORDER BY created_at DESC
    `),
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

    insertUserMilestone: db.prepare(`
      INSERT INTO user_milestones (id, user_id, event_key, tier, game_id, metadata_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    countUserMilestoneByKey: db.prepare(`
      SELECT COUNT(*) AS n FROM user_milestones WHERE user_id = ? AND event_key = ?
    `),
    listUserMilestones: db.prepare(`
      SELECT * FROM user_milestones WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 50
    `),

    insertTicket: db.prepare(`
      INSERT INTO matchmaking_tickets (user_id, stake_cents, time_control, tier_pref, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        stake_cents = excluded.stake_cents,
        time_control = excluded.time_control,
        tier_pref = excluded.tier_pref,
        created_at = excluded.created_at
    `),
    listMatchingTickets: db.prepare(`
      SELECT * FROM matchmaking_tickets
      WHERE stake_cents = ? AND time_control = ? AND user_id != ?
      ORDER BY created_at ASC
    `),
    deleteTicket: db.prepare("DELETE FROM matchmaking_tickets WHERE user_id = ?"),
    getTicket: db.prepare("SELECT * FROM matchmaking_tickets WHERE user_id = ?"),

    listExternalAccountsForUser: db.prepare(`
      SELECT * FROM external_accounts WHERE user_id = ? ORDER BY created_at ASC
    `),
    getExternalAccount: db.prepare("SELECT * FROM external_accounts WHERE id = ?"),
    getExternalAccountByProvider: db.prepare(`
      SELECT * FROM external_accounts WHERE user_id = ? AND provider = ?
    `),
    insertExternalAccount: db.prepare(`
      INSERT INTO external_accounts (
        id, user_id, provider, external_username, external_id, status,
        claim_token, claim_token_expires_at,
        imported_stats_json, last_synced_at,
        verified_at, verified_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateExternalAccountStats: db.prepare(`
      UPDATE external_accounts
      SET external_username = ?, external_id = ?, imported_stats_json = ?, last_synced_at = ?, updated_at = ?
      WHERE id = ?
    `),
    updateExternalAccountClaimToken: db.prepare(`
      UPDATE external_accounts
      SET status = ?, claim_token = ?, claim_token_expires_at = ?, updated_at = ?
      WHERE id = ?
    `),
    markExternalAccountVerified: db.prepare(`
      UPDATE external_accounts
      SET status = 'verified', verified_at = ?, verified_by = ?,
          claim_token = NULL, claim_token_expires_at = NULL, updated_at = ?
      WHERE id = ?
    `),
    listExternalAccountsByProviderHandle: db.prepare(`
      SELECT * FROM external_accounts
      WHERE provider = ? AND LOWER(external_username) = LOWER(?)
    `),
    deleteExternalAccount: db.prepare("DELETE FROM external_accounts WHERE id = ?"),

    insertEmailToken: db.prepare(`
      INSERT INTO email_tokens (id, user_id, type, token_hash, expires_at, consumed_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `),
    findEmailTokenByHash: db.prepare(`
      SELECT * FROM email_tokens WHERE token_hash = ? AND type = ? LIMIT 1
    `),
    markEmailTokenConsumed: db.prepare(`
      UPDATE email_tokens SET consumed_at = ? WHERE id = ?
    `),
    deleteEmailTokensForUserByType: db.prepare(`
      DELETE FROM email_tokens WHERE user_id = ? AND type = ?
    `),
    countRecentEmailTokensForUser: db.prepare(`
      SELECT COUNT(*) AS n FROM email_tokens
      WHERE user_id = ? AND type = ? AND created_at > ?
    `),

    insertPurchase: db.prepare(`
      INSERT INTO purchases
        (id, user_id, provider, provider_session_id, provider_payment_id, package_id,
         amount_usd_cents, chips_credited_cents, status, pay_currency, pay_amount,
         ledger_entry_id, raw_provider_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updatePurchase: db.prepare(`
      UPDATE purchases SET
        provider_session_id = ?, provider_payment_id = ?, status = ?,
        pay_currency = ?, pay_amount = ?, ledger_entry_id = ?,
        raw_provider_json = ?, updated_at = ?
      WHERE id = ?
    `),
    findPurchase: db.prepare("SELECT * FROM purchases WHERE id = ?"),
    findPurchaseByProviderSession: db.prepare(`
      SELECT * FROM purchases WHERE provider = ? AND provider_session_id = ?
    `),
    listPurchasesForUser: db.prepare(`
      SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `),

    insertTosAcceptance: db.prepare(`
      INSERT OR IGNORE INTO tos_acceptances (id, user_id, tos_version, accepted_at)
      VALUES (?, ?, ?, ?)
    `),
    findTosAcceptance: db.prepare(`
      SELECT * FROM tos_acceptances WHERE user_id = ? AND tos_version = ?
    `),
    listTosAcceptancesForUser: db.prepare(`
      SELECT * FROM tos_acceptances WHERE user_id = ? ORDER BY tos_version DESC
    `),
    latestTosAcceptanceForUser: db.prepare(`
      SELECT * FROM tos_acceptances WHERE user_id = ?
      ORDER BY tos_version DESC LIMIT 1
    `),

    insertCashoutWaitlist: db.prepare(`
      INSERT OR IGNORE INTO cashout_waitlist (id, user_id, email, created_at)
      VALUES (?, ?, ?, ?)
    `),
    countCashoutWaitlist: db.prepare(`SELECT COUNT(*) AS n FROM cashout_waitlist`),

    insertAdminAction: db.prepare(`
      INSERT INTO admin_actions
        (id, actor_user_id, target_type, target_id, action, reason, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAdminActions: db.prepare(`
      SELECT * FROM admin_actions
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `),
    listAdminActionsForTarget: db.prepare(`
      SELECT * FROM admin_actions
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at DESC, rowid DESC
    `),

    insertUserRestriction: db.prepare(`
      INSERT INTO user_restrictions
        (id, user_id, restriction, reason, applied_by, applied_at, cleared_at, cleared_by, cleared_reason)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `),
    clearUserRestriction: db.prepare(`
      UPDATE user_restrictions
      SET cleared_at = ?, cleared_by = ?, cleared_reason = ?
      WHERE id = ? AND cleared_at IS NULL
    `),
    findActiveUserRestriction: db.prepare(`
      SELECT * FROM user_restrictions
      WHERE user_id = ? AND restriction = ? AND cleared_at IS NULL
      LIMIT 1
    `),
    listActiveRestrictionsForUser: db.prepare(`
      SELECT * FROM user_restrictions
      WHERE user_id = ? AND cleared_at IS NULL
      ORDER BY applied_at ASC
    `),
    listRestrictionsForUser: db.prepare(`
      SELECT * FROM user_restrictions
      WHERE user_id = ?
      ORDER BY applied_at DESC
    `),

    insertReport: db.prepare(`
      INSERT INTO reports
        (id, reporter_user_id, target_user_id, game_id, category, note, status,
         admin_note, resolved_by, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `),
    findReport: db.prepare("SELECT * FROM reports WHERE id = ?"),
    listReports: db.prepare(`
      SELECT * FROM reports
      ORDER BY
        CASE status
          WHEN 'open' THEN 0
          WHEN 'reviewing' THEN 1
          WHEN 'resolved' THEN 2
          WHEN 'dismissed' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT ?
    `),
    updateReportStatus: db.prepare(`
      UPDATE reports
      SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `),

    findNotification: db.prepare(`
      SELECT * FROM notifications WHERE id = ?
    `),
    findNotificationByEntity: db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND entity_type = ? AND entity_id = ?
    `),
    insertNotification: db.prepare(`
      INSERT INTO notifications
        (id, user_id, type, entity_type, entity_id, status, title, body, data_json, read_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `),
    updateNotification: db.prepare(`
      UPDATE notifications
      SET type = ?, status = ?, title = ?, body = ?, data_json = ?, read_at = ?, updated_at = ?
      WHERE id = ?
    `),
    listNotificationsForUser: db.prepare(`
      SELECT * FROM notifications WHERE user_id = ?
      ORDER BY updated_at DESC LIMIT ?
    `),
    countUnreadNotificationsForUser: db.prepare(`
      SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL
    `),
    markNotificationReadIfOwner: db.prepare(`
      UPDATE notifications SET read_at = ?
      WHERE id = ? AND user_id = ? AND read_at IS NULL
    `),
    markAllNotificationsReadForUser: db.prepare(`
      UPDATE notifications SET read_at = ?
      WHERE user_id = ? AND read_at IS NULL
    `)
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
      // Grant the default-owned avatar set so every new account can equip
      // anything baseline without a separate seeding step.
      for (const avatarId of defaultOwnedAvatarIds()) {
        stmts.insertUserAvatar.run(user.id, avatarId, "default", user.createdAt);
      }
    },
    updateUserRating(userId, rating) {
      stmts.updateUserRating.run(rating, userId);
    },
    updateUserEquippedAvatar(userId, avatarId) {
      stmts.updateUserEquippedAvatar.run(avatarId, userId);
    },

    grantUserAvatar(userId, avatarId, source, acquiredAt = new Date().toISOString()) {
      stmts.insertUserAvatar.run(userId, avatarId, source, acquiredAt);
    },
    listUserAvatarsForUser(userId) {
      return stmts.listUserAvatarsForUser.all(userId).map((row) => ({
        avatarId: row.avatar_id,
        source: row.source,
        acquiredAt: row.acquired_at
      }));
    },
    userOwnsAvatar(userId, avatarId) {
      return Number(stmts.countUserAvatar.get(userId, avatarId)?.n ?? 0) > 0;
    },
    markOnboardingCompleted(userId, nowIso = new Date().toISOString()) {
      stmts.markOnboardingCompleted.run(nowIso, userId);
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
    deleteSessionsForUser(userId) { stmts.deleteSessionsForUser.run(userId); },
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
          ratingChange: game.ratingChange ?? null,
          timeControl: game.timeControl ?? null,
          adminVoid: game.adminVoid ?? null,
          adminAdjustment: game.adminAdjustment ?? null
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
          ratingChange: game.ratingChange ?? null,
          timeControl: game.timeControl ?? null,
          adminVoid: game.adminVoid ?? null,
          adminAdjustment: game.adminAdjustment ?? null
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
    countLiveGames() { return Number(stmts.countLiveGames.get()?.n ?? 0); },
    listRecentFinalizedGames(limit = 50) {
      return stmts.listRecentFinalizedGames.all(limit).map(rowToGame);
    },
    listRecentChallengesAll(limit = 100) {
      return stmts.listRecentChallengesAll.all(limit).map(rowToChallenge);
    },
    listAllExternalAccounts() {
      return stmts.listAllExternalAccounts.all().map(rowToExternalAccount);
    },

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

    insertUserMilestone(m) {
      stmts.insertUserMilestone.run(
        m.id,
        m.userId,
        m.eventKey,
        m.tier ?? 1,
        m.gameId ?? null,
        JSON.stringify(m.metadata ?? {}),
        m.occurredAt
      );
    },
    countUserMilestoneByKey(userId, eventKey) {
      return stmts.countUserMilestoneByKey.get(userId, eventKey)?.n ?? 0;
    },
    listUserMilestones(userId) {
      return stmts.listUserMilestones.all(userId).map((row) => ({
        id: row.id,
        userId: row.user_id,
        eventKey: row.event_key,
        tier: row.tier,
        gameId: row.game_id,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
        occurredAt: row.occurred_at
      }));
    },

    upsertTicket(ticket) {
      stmts.insertTicket.run(
        ticket.userId,
        ticket.stakeCents,
        ticket.timeControl,
        ticket.tierPref || "any",
        ticket.createdAt
      );
    },
    listMatchingTickets(stakeCents, timeControl, excludingUserId) {
      return stmts.listMatchingTickets.all(stakeCents, timeControl, excludingUserId).map(rowToTicket);
    },
    getTicket(userId) { return rowToTicket(stmts.getTicket.get(userId)); },
    deleteTicket(userId) { stmts.deleteTicket.run(userId); },

    listExternalAccountsForUser(userId) {
      return stmts.listExternalAccountsForUser.all(userId).map(rowToExternalAccount);
    },
    getExternalAccount(id) {
      return rowToExternalAccount(stmts.getExternalAccount.get(id));
    },
    getExternalAccountByProvider(userId, provider) {
      return rowToExternalAccount(stmts.getExternalAccountByProvider.get(userId, provider));
    },
    insertExternalAccount(account) {
      stmts.insertExternalAccount.run(
        account.id,
        account.userId,
        account.provider,
        account.externalUsername,
        account.externalId ?? null,
        account.status,
        account.claimToken ?? null,
        account.claimTokenExpiresAt ?? null,
        account.importedStats != null ? JSON.stringify(account.importedStats) : null,
        account.lastSyncedAt ?? null,
        account.verifiedAt ?? null,
        account.verifiedBy ?? null,
        account.createdAt,
        account.updatedAt
      );
    },
    updateExternalAccountStats(id, { externalUsername, externalId, importedStats }) {
      const now = new Date().toISOString();
      stmts.updateExternalAccountStats.run(
        externalUsername,
        externalId ?? null,
        importedStats != null ? JSON.stringify(importedStats) : null,
        now,
        now,
        id
      );
    },
    deleteExternalAccount(id) {
      stmts.deleteExternalAccount.run(id);
    },
    updateExternalAccountClaimToken(id, { status, claimToken, claimTokenExpiresAt }) {
      stmts.updateExternalAccountClaimToken.run(
        status,
        claimToken ?? null,
        claimTokenExpiresAt ?? null,
        new Date().toISOString(),
        id
      );
    },
    markExternalAccountVerified(id, { verifiedBy = "profile_token", verifiedAt = new Date().toISOString() } = {}) {
      stmts.markExternalAccountVerified.run(verifiedAt, verifiedBy, verifiedAt, id);
    },
    listExternalAccountsByProviderHandle(provider, username) {
      return stmts.listExternalAccountsByProviderHandle.all(provider, username).map(rowToExternalAccount);
    },

    insertEmailToken(token) {
      stmts.insertEmailToken.run(
        token.id,
        token.userId,
        token.type,
        token.tokenHash,
        token.expiresAt,
        token.createdAt
      );
    },
    findEmailTokenByHash(tokenHash, type) {
      return rowToEmailToken(stmts.findEmailTokenByHash.get(tokenHash, type));
    },
    markEmailTokenConsumed(id, consumedAt = new Date().toISOString()) {
      stmts.markEmailTokenConsumed.run(consumedAt, id);
    },
    deleteEmailTokensForUserByType(userId, type) {
      stmts.deleteEmailTokensForUserByType.run(userId, type);
    },
    countRecentEmailTokensForUser(userId, type, sinceIso) {
      return Number(stmts.countRecentEmailTokensForUser.get(userId, type, sinceIso)?.n ?? 0);
    },
    markEmailVerified(userId, verifiedAt = new Date().toISOString()) {
      return stmts.markEmailVerified.run(verifiedAt, userId).changes > 0;
    },

    // Notifications: entity-anchored, update-in-place.
    // See docs/NOTIFICATIONS_NEXT_PASS.md.
    upsertNotification({
      userId,
      type,
      entityType,
      entityId,
      status,
      title,
      body = null,
      data = null,
      idHint = null
    }) {
      const now = new Date().toISOString();
      const existing = stmts.findNotificationByEntity.get(userId, entityType, entityId);
      const dataJson = data == null ? null : JSON.stringify(data);
      if (existing) {
        const statusChanged = existing.status !== status;
        const typeChanged = existing.type !== type;
        // A *new* status (or new type) flips read_at to null so the user
        // notices the resolution. A no-op upsert (same status, same type)
        // preserves read_at so we don't spam the badge.
        const nextReadAt = statusChanged || typeChanged ? null : existing.read_at;
        stmts.updateNotification.run(
          type,
          status,
          title,
          body,
          dataJson,
          nextReadAt,
          now,
          existing.id
        );
        return {
          inserted: false,
          notification: rowToNotification(stmts.findNotification.get(existing.id))
        };
      }
      const id = idHint || `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.insertNotification.run(
        id,
        userId,
        type,
        entityType,
        entityId,
        status,
        title,
        body,
        dataJson,
        now,
        now
      );
      return {
        inserted: true,
        notification: rowToNotification(stmts.findNotification.get(id))
      };
    },
    listNotificationsForUser(userId, limit = 50) {
      return stmts.listNotificationsForUser.all(userId, limit).map(rowToNotification);
    },
    countUnreadNotificationsForUser(userId) {
      return Number(stmts.countUnreadNotificationsForUser.get(userId)?.n ?? 0);
    },
    markNotificationRead(userId, id, readAt = new Date().toISOString()) {
      return stmts.markNotificationReadIfOwner.run(readAt, id, userId).changes > 0;
    },
    markAllNotificationsRead(userId, readAt = new Date().toISOString()) {
      return stmts.markAllNotificationsReadForUser.run(readAt, userId).changes;
    },
    getNotification(id) {
      return rowToNotification(stmts.findNotification.get(id));
    },
    findNotificationForEntity(userId, entityType, entityId) {
      return rowToNotification(stmts.findNotificationByEntity.get(userId, entityType, entityId));
    },

    // Reports.
    insertReport(report) {
      const now = new Date().toISOString();
      stmts.insertReport.run(
        report.id,
        report.reporterUserId,
        report.targetUserId ?? null,
        report.gameId ?? null,
        report.category,
        report.note,
        report.status ?? "open",
        now,
        now
      );
      return rowToReport(stmts.findReport.get(report.id));
    },
    getReport(id) {
      return rowToReport(stmts.findReport.get(id));
    },
    listReports(limit = 100) {
      return stmts.listReports.all(limit).map(rowToReport);
    },
    updateReportStatus(id, { status, adminNote = null, resolvedBy = null, resolvedAt = null }) {
      const now = new Date().toISOString();
      stmts.updateReportStatus.run(status, adminNote, resolvedBy, resolvedAt, now, id);
      return rowToReport(stmts.findReport.get(id));
    },

    // Purchases.
    insertPurchase(p) {
      const now = new Date().toISOString();
      stmts.insertPurchase.run(
        p.id,
        p.userId,
        p.provider,
        p.providerSessionId ?? null,
        p.providerPaymentId ?? null,
        p.packageId,
        p.amountUsdCents,
        p.chipsCreditedCents,
        p.status,
        p.payCurrency ?? null,
        p.payAmount ?? null,
        p.ledgerEntryId ?? null,
        p.rawProvider ? JSON.stringify(p.rawProvider) : null,
        now,
        now
      );
      return rowToPurchase(stmts.findPurchase.get(p.id));
    },
    updatePurchase(id, fields) {
      const existing = stmts.findPurchase.get(id);
      if (!existing) return null;
      const merged = {
        provider_session_id: fields.providerSessionId ?? existing.provider_session_id,
        provider_payment_id: fields.providerPaymentId ?? existing.provider_payment_id,
        status: fields.status ?? existing.status,
        pay_currency: fields.payCurrency ?? existing.pay_currency,
        pay_amount: fields.payAmount ?? existing.pay_amount,
        ledger_entry_id: fields.ledgerEntryId ?? existing.ledger_entry_id,
        raw_provider_json: fields.rawProvider
          ? JSON.stringify(fields.rawProvider)
          : existing.raw_provider_json
      };
      stmts.updatePurchase.run(
        merged.provider_session_id,
        merged.provider_payment_id,
        merged.status,
        merged.pay_currency,
        merged.pay_amount,
        merged.ledger_entry_id,
        merged.raw_provider_json,
        new Date().toISOString(),
        id
      );
      return rowToPurchase(stmts.findPurchase.get(id));
    },
    getPurchase(id) { return rowToPurchase(stmts.findPurchase.get(id)); },
    findPurchaseByProviderSession(provider, sessionId) {
      return rowToPurchase(stmts.findPurchaseByProviderSession.get(provider, sessionId));
    },
    listPurchasesForUser(userId, limit = 50) {
      return stmts.listPurchasesForUser.all(userId, limit).map(rowToPurchase);
    },

    // ToS acceptances. The active version lives in shared code, not in the DB.
    recordTosAcceptance({ userId, tosVersion, acceptedAt = new Date().toISOString() }) {
      const id = `tos_${userId}_v${tosVersion}`;
      stmts.insertTosAcceptance.run(id, userId, tosVersion, acceptedAt);
      return rowToTosAcceptance(stmts.findTosAcceptance.get(userId, tosVersion));
    },
    getLatestTosAcceptance(userId) {
      return rowToTosAcceptance(stmts.latestTosAcceptanceForUser.get(userId));
    },
    hasAcceptedTosVersion(userId, tosVersion) {
      return !!stmts.findTosAcceptance.get(userId, tosVersion);
    },

    // Cashout waitlist.
    addCashoutWaitlistEntry({ userId = null, email }) {
      const id = `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.insertCashoutWaitlist.run(id, userId, email, new Date().toISOString());
    },
    countCashoutWaitlist() {
      return Number(stmts.countCashoutWaitlist.get()?.n ?? 0);
    },

    // Admin audit log.
    appendAdminAction({ actorUserId, targetType, targetId, action, reason, before = null, after = null }) {
      const id = `aa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.insertAdminAction.run(
        id,
        actorUserId,
        targetType,
        targetId,
        action,
        reason,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        new Date().toISOString()
      );
      return id;
    },
    listAdminActions(limit = 100) {
      return stmts.listAdminActions.all(limit).map(rowToAdminAction);
    },
    listAdminActionsForTarget(targetType, targetId) {
      return stmts.listAdminActionsForTarget.all(targetType, targetId).map(rowToAdminAction);
    },

    // User restrictions ladder.
    applyUserRestriction({ userId, restriction, reason, appliedBy, appliedAt = new Date().toISOString() }) {
      const existing = stmts.findActiveUserRestriction.get(userId, restriction);
      if (existing) return existing.id;
      const id = `ur_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.insertUserRestriction.run(id, userId, restriction, reason, appliedBy, appliedAt);
      return id;
    },
    clearUserRestriction({ userId, restriction, clearedBy, clearedReason, clearedAt = new Date().toISOString() }) {
      const existing = stmts.findActiveUserRestriction.get(userId, restriction);
      if (!existing) return null;
      stmts.clearUserRestriction.run(clearedAt, clearedBy, clearedReason, existing.id);
      return existing.id;
    },
    listActiveRestrictionsForUser(userId) {
      return stmts.listActiveRestrictionsForUser.all(userId).map(rowToUserRestriction);
    },
    listRestrictionsForUser(userId) {
      return stmts.listRestrictionsForUser.all(userId).map(rowToUserRestriction);
    },

    transaction(fn) { return db.transaction(fn); },

    close() { db.close(); }
  };
}

function rowToAdminAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    action: row.action,
    reason: row.reason,
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
    createdAt: row.created_at
  };
}

function rowToUserRestriction(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    restriction: row.restriction,
    reason: row.reason,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
    clearedAt: row.cleared_at,
    clearedBy: row.cleared_by,
    clearedReason: row.cleared_reason,
    active: !row.cleared_at
  };
}
