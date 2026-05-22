export const RAKE_RATE = 0.05;
export const CHALLENGE_STATES = ["incoming", "accepted", "declined", "countered", "expired"];
export const HOUSE_USER_ID = "house";
export const SETTLEMENT_ENTRY_TYPES = new Set([
  "escrow_release",
  "wager_win",
  "wager_loss",
  "wager_draw",
  "rake"
]);

export function cents(amount) {
  if (!Number.isFinite(amount)) {
    throw new TypeError("amount must be a finite number");
  }
  return Math.round(amount * 100);
}

export function dollars(amountInCents) {
  if (!Number.isInteger(amountInCents)) {
    throw new TypeError("amountInCents must be an integer");
  }
  return amountInCents / 100;
}

export function formatMoney(amountInCents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(dollars(amountInCents));
}

export function calculatePot({ stakeCents, rakeRate = RAKE_RATE }) {
  if (!Number.isInteger(stakeCents) || stakeCents <= 0) {
    throw new RangeError("stakeCents must be a positive integer");
  }
  if (!Number.isFinite(rakeRate) || rakeRate < 0 || rakeRate >= 1) {
    throw new RangeError("rakeRate must be between 0 and 1");
  }

  const grossPotCents = stakeCents * 2;
  const rakeCents = Math.round(grossPotCents * rakeRate);
  return {
    stakeCents,
    grossPotCents,
    rakeCents,
    netPotCents: grossPotCents - rakeCents
  };
}

export function assertKnownState(value, allowed, label = "state") {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export function createLedgerEntry({
  id,
  userId,
  type,
  availableDeltaCents,
  escrowDeltaCents = 0,
  refId = null,
  note = "",
  createdAt = new Date().toISOString()
}) {
  if (!id || !userId || !type) {
    throw new TypeError("ledger entries require id, userId, and type");
  }
  if (!Number.isInteger(availableDeltaCents) || !Number.isInteger(escrowDeltaCents)) {
    throw new TypeError("ledger deltas must be integer cents");
  }

  return {
    id,
    userId,
    type,
    availableDeltaCents,
    escrowDeltaCents,
    refId,
    note,
    createdAt
  };
}

export function walletSummary(ledgerEntries, userId) {
  const entries = ledgerEntries.filter((entry) => entry.userId === userId);
  const balanceCents = entries.reduce((sum, entry) => sum + entry.availableDeltaCents, 0);
  const escrowCents = entries.reduce((sum, entry) => sum + entry.escrowDeltaCents, 0);

  if (balanceCents < 0 || escrowCents < 0) {
    const error = new RangeError("wallet summary cannot be negative");
    error.code = "negative_wallet";
    throw error;
  }

  return {
    balanceCents,
    escrowCents,
    entries
  };
}

export function createEscrowHold({ id, userId, challengeId, amountCents, ledgerEntries, createdAt }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError("amountCents must be a positive integer");
  }

  const summary = walletSummary(ledgerEntries, userId);
  if (summary.balanceCents < amountCents) {
    const error = new RangeError("insufficient fake-money balance for escrow hold");
    error.code = "insufficient_funds";
    throw error;
  }

  return createLedgerEntry({
    id,
    userId,
    type: "escrow_hold",
    availableDeltaCents: -amountCents,
    escrowDeltaCents: amountCents,
    refId: challengeId,
    note: "Stake locked for accepted challenge",
    createdAt
  });
}

export function findSettlementEntries(ledgerEntries, gameId) {
  return ledgerEntries.filter(
    (entry) => entry.refId === gameId && SETTLEMENT_ENTRY_TYPES.has(entry.type)
  );
}

function releaseEntry({ gameId, userId, stakeCents, createdAt }) {
  return createLedgerEntry({
    id: `led_release_${gameId}_${userId}`,
    userId,
    type: "escrow_release",
    availableDeltaCents: stakeCents,
    escrowDeltaCents: -stakeCents,
    refId: gameId,
    note: "Escrow released at game finalization",
    createdAt
  });
}

export function settleGame({
  gameId,
  challengeId,
  stakeCents,
  playerIds,
  winnerId = null,
  rakeRate = RAKE_RATE,
  ledgerEntries,
  createdAt = new Date().toISOString()
}) {
  if (!gameId || !challengeId) {
    throw new TypeError("settleGame requires gameId and challengeId");
  }
  if (!Array.isArray(playerIds) || playerIds.length !== 2 || playerIds[0] === playerIds[1]) {
    throw new TypeError("playerIds must be two distinct ids");
  }
  if (winnerId !== null && !playerIds.includes(winnerId)) {
    throw new RangeError("winnerId must be null (draw) or one of playerIds");
  }

  const existing = findSettlementEntries(ledgerEntries, gameId);
  if (existing.length > 0) {
    return { newEntries: [], entries: existing, alreadySettled: true };
  }

  const hasHold = (userId) => ledgerEntries.some(
    (entry) =>
      entry.userId === userId &&
      entry.type === "escrow_hold" &&
      entry.refId === challengeId
  );

  if (!hasHold(playerIds[0]) || !hasHold(playerIds[1])) {
    const error = new RangeError("settleGame requires an escrow_hold for both players");
    error.code = "missing_escrow_hold";
    throw error;
  }

  const pot = calculatePot({ stakeCents, rakeRate });
  const newEntries = [
    releaseEntry({ gameId, userId: playerIds[0], stakeCents, createdAt }),
    releaseEntry({ gameId, userId: playerIds[1], stakeCents, createdAt })
  ];

  if (winnerId === null) {
    const perPlayerShare = Math.floor(pot.netPotCents / 2);
    const remainder = pot.netPotCents - perPlayerShare * 2;
    for (const playerId of playerIds) {
      newEntries.push(createLedgerEntry({
        id: `led_draw_${gameId}_${playerId}`,
        userId: playerId,
        type: "wager_draw",
        availableDeltaCents: perPlayerShare - stakeCents,
        refId: gameId,
        note: "Split pot from drawn game",
        createdAt
      }));
    }
    newEntries.push(createLedgerEntry({
      id: `led_rake_${gameId}`,
      userId: HOUSE_USER_ID,
      type: "rake",
      availableDeltaCents: pot.rakeCents + remainder,
      refId: gameId,
      note: "House rake from settled pot",
      createdAt
    }));
  } else {
    const loserId = playerIds.find((id) => id !== winnerId);
    newEntries.push(
      createLedgerEntry({
        id: `led_win_${gameId}_${winnerId}`,
        userId: winnerId,
        type: "wager_win",
        availableDeltaCents: pot.netPotCents - stakeCents,
        refId: gameId,
        note: "Net winnings credited",
        createdAt
      }),
      createLedgerEntry({
        id: `led_loss_${gameId}_${loserId}`,
        userId: loserId,
        type: "wager_loss",
        availableDeltaCents: -stakeCents,
        refId: gameId,
        note: "Stake forfeited",
        createdAt
      }),
      createLedgerEntry({
        id: `led_rake_${gameId}`,
        userId: HOUSE_USER_ID,
        type: "rake",
        availableDeltaCents: pot.rakeCents,
        refId: gameId,
        note: "House rake from settled pot",
        createdAt
      })
    );
  }

  return { newEntries, entries: newEntries, alreadySettled: false, pot };
}

export function transitionChallenge(challenge, nextState, extra = {}) {
  assertKnownState(challenge.state, CHALLENGE_STATES, "challenge.state");
  assertKnownState(nextState, CHALLENGE_STATES, "nextState");

  if (challenge.state === nextState) {
    return { ...challenge, ...extra };
  }

  const allowed = {
    incoming: ["accepted", "declined", "countered", "expired"],
    countered: ["accepted", "declined", "expired"],
    accepted: [],
    declined: [],
    expired: []
  };

  if (!allowed[challenge.state].includes(nextState)) {
    const error = new RangeError(`cannot transition challenge from ${challenge.state} to ${nextState}`);
    error.code = "invalid_challenge_transition";
    throw error;
  }

  return {
    ...challenge,
    ...extra,
    state: nextState
  };
}
