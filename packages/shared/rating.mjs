export const DEFAULT_K_FACTOR = 32;
export const RATING_FORMULA_VERSION = 1;

const RESULT_SCORES = {
  white_win: { white: 1, black: 0 },
  black_win: { white: 0, black: 1 },
  draw: { white: 0.5, black: 0.5 }
};

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function computeRatingChange({ whiteRating, blackRating, result, k = DEFAULT_K_FACTOR }) {
  if (!Number.isFinite(whiteRating) || !Number.isFinite(blackRating)) {
    throw new TypeError("ratings must be finite numbers");
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError("k must be a positive number");
  }
  const scores = RESULT_SCORES[result];
  if (!scores) {
    throw new RangeError(`result must be one of: ${Object.keys(RESULT_SCORES).join(", ")}`);
  }

  const whiteExpected = expectedScore(whiteRating, blackRating);
  const whiteDelta = Math.round(k * (scores.white - whiteExpected)) || 0;
  const blackDelta = -whiteDelta || 0;

  return {
    whiteBefore: whiteRating,
    blackBefore: blackRating,
    whiteAfter: whiteRating + whiteDelta,
    blackAfter: blackRating + blackDelta,
    whiteDelta,
    blackDelta,
    k,
    formulaVersion: RATING_FORMULA_VERSION
  };
}
