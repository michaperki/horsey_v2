import { Chess } from "chess.js";

export const STARTING_FEN = new Chess().fen();

const PIECES = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚"
};

function turnName(turn) {
  return turn === "w" ? "white" : "black";
}

function gameStatus(chess) {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isThreefoldRepetition()) return "threefold_repetition";
  if (chess.isInsufficientMaterial()) return "insufficient_material";
  if (chess.isDraw()) return "draw";
  if (chess.isCheck()) return "check";
  return "active";
}

function resultFor(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === "w" ? "black_win" : "white_win";
  }
  if (chess.isDraw()) return "draw";
  return null;
}

export function createChess(fen = STARTING_FEN) {
  return new Chess(fen);
}

export function boardSquares(fen = STARTING_FEN) {
  const chess = createChess(fen);
  const board = chess.board();
  return board.flatMap((rank, row) => rank.map((piece, col) => {
    const file = String.fromCharCode("a".charCodeAt(0) + col);
    const rankNumber = 8 - row;
    const square = `${file}${rankNumber}`;
    return {
      square,
      row,
      col,
      color: piece?.color ?? null,
      type: piece?.type ?? null,
      symbol: piece ? PIECES[`${piece.color}${piece.type}`] : null
    };
  }));
}

export function legalMoves(fen = STARTING_FEN) {
  const chess = createChess(fen);
  return chess.moves({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    lan: move.lan,
    piece: move.piece,
    captured: move.captured ?? null,
    promotion: move.promotion ?? null,
    flags: move.flags
  }));
}

export function summarizeGame(fen = STARTING_FEN, extra = {}) {
  const chess = createChess(fen);
  return {
    fen: chess.fen(),
    turn: turnName(chess.turn()),
    status: gameStatus(chess),
    result: resultFor(chess),
    inCheck: chess.isCheck(),
    isGameOver: chess.isGameOver(),
    legalMoves: legalMoves(chess.fen()),
    board: boardSquares(chess.fen()),
    ...extra
  };
}

export function applyMove(fen, move) {
  const chess = createChess(fen);
  let applied;

  try {
    applied = chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion || "q"
    });
  } catch {
    applied = null;
  }

  if (!applied) {
    const error = new Error("Illegal chess move");
    error.code = "illegal_move";
    throw error;
  }

  return {
    move: {
      from: applied.from,
      to: applied.to,
      san: applied.san,
      lan: applied.lan,
      piece: applied.piece,
      captured: applied.captured ?? null,
      promotion: applied.promotion ?? null,
      flags: applied.flags
    },
    ...summarizeGame(chess.fen())
  };
}

export function createGameSnapshot(overrides = {}) {
  return {
    id: "game_demo_8742",
    state: "live",
    moveNumber: 1,
    lastMove: null,
    moves: [],
    ...summarizeGame(overrides.fen ?? STARTING_FEN),
    ...overrides
  };
}
