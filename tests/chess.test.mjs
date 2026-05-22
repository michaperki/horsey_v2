import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, legalMoves, STARTING_FEN, summarizeGame } from "../packages/chess/src/board.mjs";

test("summarizeGame exposes starting legal moves and board squares", () => {
  const game = summarizeGame(STARTING_FEN);

  assert.equal(game.turn, "white");
  assert.equal(game.status, "active");
  assert.equal(game.board.length, 64);
  assert.equal(game.legalMoves.length, 20);
});

test("applyMove validates and applies a legal move", () => {
  const result = applyMove(STARTING_FEN, { from: "e2", to: "e4" });

  assert.equal(result.move.san, "e4");
  assert.equal(result.turn, "black");
  assert.equal(result.board.find((square) => square.square === "e4").symbol, "♙");
});

test("applyMove rejects an illegal move", () => {
  assert.throws(
    () => applyMove(STARTING_FEN, { from: "e2", to: "e5" }),
    /Illegal chess move/
  );
});

test("legalMoves includes knight moves", () => {
  const moves = legalMoves(STARTING_FEN).map((move) => `${move.from}${move.to}`);

  assert.ok(moves.includes("g1f3"));
  assert.ok(moves.includes("b1c3"));
});

test("applyMove supports castling", () => {
  const result = applyMove("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", {
    from: "e1",
    to: "g1"
  });

  assert.equal(result.move.san, "O-O");
  assert.equal(result.board.find((square) => square.square === "g1").symbol, "♔");
  assert.equal(result.board.find((square) => square.square === "f1").symbol, "♖");
});

test("applyMove supports en passant captures", () => {
  const result = applyMove("8/8/8/3pP3/8/8/8/4K2k w - d6 0 1", {
    from: "e5",
    to: "d6"
  });

  assert.equal(result.move.san, "exd6");
  assert.equal(result.move.captured, "p");
  assert.ok(result.move.flags.includes("e"));
  assert.equal(result.board.find((square) => square.square === "d5").symbol, null);
});

test("applyMove keeps the selected promotion piece", () => {
  const result = applyMove("8/P7/8/8/8/8/8/4K2k w - - 0 1", {
    from: "a7",
    to: "a8",
    promotion: "n"
  });

  assert.equal(result.move.promotion, "n");
  assert.equal(result.board.find((square) => square.square === "a8").symbol, "♘");
});

test("summarizeGame detects stalemate", () => {
  const result = summarizeGame("7k/5Q2/7K/8/8/8/8/8 b - - 0 1");

  assert.equal(result.status, "stalemate");
  assert.equal(result.result, "draw");
  assert.equal(result.isGameOver, true);
});

test("summarizeGame detects checkmate result", () => {
  const result = summarizeGame("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");

  assert.equal(result.status, "checkmate");
  assert.equal(result.result, "black_win");
  assert.equal(result.isGameOver, true);
});
