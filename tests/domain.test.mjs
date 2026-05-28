import assert from "node:assert/strict";
import test from "node:test";
import {
  abortGameSettlement,
  adjustGameSettlement,
  calculatePot,
  cents,
  createEscrowHold,
  createLedgerEntry,
  dollars,
  findSettlementEntries,
  formatMoney,
  HOUSE_USER_ID,
  settleGame,
  transitionChallenge,
  voidGameSettlement,
  walletSummary
} from "../packages/shared/domain.mjs";

function seededLedger(stake) {
  return [
    createLedgerEntry({
      id: "led_seed_w",
      userId: "usr_w",
      type: "seed_grant",
      availableDeltaCents: cents(1000)
    }),
    createLedgerEntry({
      id: "led_seed_l",
      userId: "usr_l",
      type: "seed_grant",
      availableDeltaCents: cents(1000)
    }),
    createEscrowHold({
      id: "led_hold_w",
      userId: "usr_w",
      challengeId: "chg_1",
      amountCents: stake,
      ledgerEntries: [
        createLedgerEntry({
          id: "led_seed_w",
          userId: "usr_w",
          type: "seed_grant",
          availableDeltaCents: cents(1000)
        })
      ],
      createdAt: "2026-05-20T00:00:00.000Z"
    }),
    createEscrowHold({
      id: "led_hold_l",
      userId: "usr_l",
      challengeId: "chg_1",
      amountCents: stake,
      ledgerEntries: [
        createLedgerEntry({
          id: "led_seed_l",
          userId: "usr_l",
          type: "seed_grant",
          availableDeltaCents: cents(1000)
        })
      ],
      createdAt: "2026-05-20T00:00:00.000Z"
    })
  ];
}

test("money helpers convert dollars and cents", () => {
  assert.equal(cents(250), 25000);
  assert.equal(dollars(25000), 250);
  assert.equal(formatMoney(47500), "$475.00");
});

test("calculatePot applies the default 5 percent rake", () => {
  assert.deepEqual(calculatePot({ stakeCents: 25000 }), {
    stakeCents: 25000,
    grossPotCents: 50000,
    rakeCents: 2500,
    netPotCents: 47500
  });
});

test("walletSummary derives available and escrow balances from ledger entries", () => {
  const ledger = [
    createLedgerEntry({
      id: "led_1",
      userId: "usr_sam",
      type: "seed_grant",
      availableDeltaCents: cents(100)
    }),
    createLedgerEntry({
      id: "led_2",
      userId: "usr_sam",
      type: "escrow_hold",
      availableDeltaCents: -cents(25),
      escrowDeltaCents: cents(25)
    })
  ];

  assert.deepEqual(walletSummary(ledger, "usr_sam"), {
    balanceCents: cents(75),
    escrowCents: cents(25),
    entries: ledger
  });
});

test("createEscrowHold rejects holds larger than available fake-money balance", () => {
  const ledger = [
    createLedgerEntry({
      id: "led_1",
      userId: "usr_sam",
      type: "seed_grant",
      availableDeltaCents: cents(10)
    })
  ];

  assert.throws(
    () => createEscrowHold({
      id: "led_hold",
      userId: "usr_sam",
      challengeId: "chg_1",
      amountCents: cents(25),
      ledgerEntries: ledger
    }),
    /insufficient fake-money balance/
  );
});

test("settleGame credits winner net pot, debits loser stake, and records rake", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);
  const pot = calculatePot({ stakeCents: stake });

  const outcome = settleGame({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_w",
    ledgerEntries: ledger
  });

  assert.equal(outcome.alreadySettled, false);
  assert.equal(outcome.newEntries.length, 5);

  const merged = [...ledger, ...outcome.newEntries];
  const winnerWallet = walletSummary(merged, "usr_w");
  const loserWallet = walletSummary(merged, "usr_l");
  const houseWallet = walletSummary(merged, HOUSE_USER_ID);

  assert.equal(winnerWallet.balanceCents, cents(1000) + (pot.netPotCents - stake));
  assert.equal(winnerWallet.escrowCents, 0);
  assert.equal(loserWallet.balanceCents, cents(1000) - stake);
  assert.equal(loserWallet.escrowCents, 0);
  assert.equal(houseWallet.balanceCents, pot.rakeCents);

  const totalAvailable = merged.reduce((sum, entry) => sum + entry.availableDeltaCents, 0);
  assert.equal(totalAvailable, cents(2000));
});

test("settleGame splits the pot on draw and rounds remainder to house", () => {
  const stake = 333; // gross 666, rake 33, netPot 633 → per-player 316, remainder 1
  const ledger = seededLedger(stake);
  const pot = calculatePot({ stakeCents: stake });
  const perPlayer = Math.floor(pot.netPotCents / 2);
  const remainder = pot.netPotCents - perPlayer * 2;

  const outcome = settleGame({
    gameId: "game_2",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: null,
    ledgerEntries: ledger
  });

  assert.equal(outcome.alreadySettled, false);
  assert.equal(outcome.newEntries.length, 5);

  const merged = [...ledger, ...outcome.newEntries];
  const aWallet = walletSummary(merged, "usr_w");
  const bWallet = walletSummary(merged, "usr_l");
  const houseWallet = walletSummary(merged, HOUSE_USER_ID);

  assert.equal(aWallet.balanceCents, cents(1000) - stake + perPlayer);
  assert.equal(bWallet.balanceCents, cents(1000) - stake + perPlayer);
  assert.equal(aWallet.escrowCents, 0);
  assert.equal(bWallet.escrowCents, 0);
  assert.equal(houseWallet.balanceCents, pot.rakeCents + remainder);

  const totalAvailable = merged.reduce((sum, entry) => sum + entry.availableDeltaCents, 0);
  assert.equal(totalAvailable, cents(2000));
});

test("settleGame is idempotent for the same gameId", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);

  const first = settleGame({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_w",
    ledgerEntries: ledger
  });
  const merged = [...ledger, ...first.newEntries];

  const second = settleGame({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_w",
    ledgerEntries: merged
  });

  assert.equal(second.alreadySettled, true);
  assert.equal(second.newEntries.length, 0);
  assert.equal(second.entries.length, 5);
  assert.deepEqual(
    second.entries.map((entry) => entry.id).sort(),
    findSettlementEntries(merged, "game_1").map((entry) => entry.id).sort()
  );
});

test("settleGame rejects when a player has no escrow hold", () => {
  const stake = cents(250);
  const ledger = [
    createLedgerEntry({
      id: "led_seed_w",
      userId: "usr_w",
      type: "seed_grant",
      availableDeltaCents: cents(1000)
    })
  ];

  assert.throws(
    () => settleGame({
      gameId: "game_1",
      challengeId: "chg_1",
      stakeCents: stake,
      playerIds: ["usr_w", "usr_l"],
      winnerId: "usr_w",
      ledgerEntries: ledger
    }),
    /escrow_hold/
  );
});

test("settleGame rejects when winnerId is not in playerIds", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);

  assert.throws(
    () => settleGame({
      gameId: "game_1",
      challengeId: "chg_1",
      stakeCents: stake,
      playerIds: ["usr_w", "usr_l"],
      winnerId: "usr_outsider",
      ledgerEntries: ledger
    }),
    /winnerId/
  );
});

test("abortGameSettlement returns both stakes with no rake and no wager entries", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);

  const { newEntries, alreadySettled } = abortGameSettlement({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    ledgerEntries: ledger
  });

  assert.equal(alreadySettled, false);
  assert.equal(newEntries.length, 2);
  for (const entry of newEntries) {
    assert.equal(entry.type, "escrow_release");
    assert.equal(entry.availableDeltaCents, stake);
    assert.equal(entry.escrowDeltaCents, -stake);
  }
  // No rake, no wager_win/loss/draw entries written.
  assert.equal(newEntries.some((e) => e.type === "rake"), false);
  assert.equal(newEntries.some((e) => e.type.startsWith("wager_")), false);

  // After applying the new entries, both players are made whole.
  const finalLedger = [...ledger, ...newEntries];
  assert.equal(walletSummary(finalLedger, "usr_w").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, "usr_l").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, HOUSE_USER_ID === undefined ? "house" : HOUSE_USER_ID).balanceCents, 0);
});

test("abortGameSettlement is idempotent when escrow already released", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);
  const first = abortGameSettlement({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    ledgerEntries: ledger
  });
  const replayed = abortGameSettlement({
    gameId: "game_1",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    ledgerEntries: [...ledger, ...first.newEntries]
  });
  assert.equal(replayed.alreadySettled, true);
  assert.equal(replayed.newEntries.length, 0);
});

test("abortGameSettlement requires an escrow_hold for both players", () => {
  const ledger = [
    createLedgerEntry({
      id: "led_seed",
      userId: "usr_w",
      type: "seed_grant",
      availableDeltaCents: cents(1000)
    })
  ];
  assert.throws(
    () => abortGameSettlement({
      gameId: "game_1",
      challengeId: "chg_1",
      stakeCents: cents(250),
      playerIds: ["usr_w", "usr_l"],
      ledgerEntries: ledger
    }),
    /escrow_hold/
  );
});

test("voidGameSettlement reverses live escrow holds", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);

  const { newEntries, alreadyVoided } = voidGameSettlement({
    gameId: "game_void_live",
    challengeId: "chg_1",
    playerIds: ["usr_w", "usr_l"],
    ledgerEntries: ledger
  });

  assert.equal(alreadyVoided, false);
  assert.equal(newEntries.length, 2);
  const finalLedger = [...ledger, ...newEntries];
  assert.equal(walletSummary(finalLedger, "usr_w").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, "usr_w").escrowCents, 0);
  assert.equal(walletSummary(finalLedger, "usr_l").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, "usr_l").escrowCents, 0);
});

test("voidGameSettlement reverses finalized winner, loser, and house rake", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);
  const settled = settleGame({
    gameId: "game_void_final",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_w",
    ledgerEntries: ledger
  });

  const { newEntries, alreadyVoided } = voidGameSettlement({
    gameId: "game_void_final",
    challengeId: "chg_1",
    playerIds: ["usr_w", "usr_l"],
    ledgerEntries: [...ledger, ...settled.newEntries]
  });

  assert.equal(alreadyVoided, false);
  const finalLedger = [...ledger, ...settled.newEntries, ...newEntries];
  assert.equal(walletSummary(finalLedger, "usr_w").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, "usr_l").balanceCents, cents(1000));
  assert.equal(walletSummary(finalLedger, HOUSE_USER_ID).balanceCents, 0);
});

test("adjustGameSettlement writes compensating entries to net a new result", () => {
  const stake = cents(250);
  const ledger = seededLedger(stake);
  const settled = settleGame({
    gameId: "game_adjust",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_w",
    ledgerEntries: ledger
  });

  const adjusted = adjustGameSettlement({
    gameId: "game_adjust",
    challengeId: "chg_1",
    stakeCents: stake,
    playerIds: ["usr_w", "usr_l"],
    winnerId: "usr_l",
    ledgerEntries: [...ledger, ...settled.newEntries]
  });

  const pot = calculatePot({ stakeCents: stake });
  const finalLedger = [...ledger, ...settled.newEntries, ...adjusted.newEntries];
  assert.equal(walletSummary(finalLedger, "usr_w").balanceCents, cents(1000) - stake);
  assert.equal(walletSummary(finalLedger, "usr_l").balanceCents, cents(1000) + pot.netPotCents - stake);
  assert.equal(walletSummary(finalLedger, HOUSE_USER_ID).balanceCents, pot.rakeCents);
});

test("transitionChallenge allows incoming challenge accept and blocks terminal transitions", () => {
  const challenge = { id: "chg_1", state: "incoming" };
  const accepted = transitionChallenge(challenge, "accepted", { acceptedAt: "now" });

  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.acceptedAt, "now");
  assert.throws(
    () => transitionChallenge(accepted, "declined"),
    /cannot transition challenge/
  );
});
