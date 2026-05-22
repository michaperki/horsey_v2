import { cents, formatMoney } from "../../packages/shared/domain.mjs";

export const SIGNUP_GRANT_CENTS = cents(1000);
export const SIGNUP_DEFAULT_RATING = 1500;

export function initialSeed() {
  return {
    lobby: {
      onlineCount: 0,
      activeGames: 0,
      stakes: [1, 5, 10, 25, 50, 100, 250, 500, 1000].map((amount) => ({
        amountCents: cents(amount),
        label: amount >= 1000 ? "$1K" : formatMoney(cents(amount)).replace(".00", "")
      })),
      timeControls: ["30s+0", "45s+0", "1+0", "2+1", "3+0", "3+2", "5+0", "10+0", "15+10"],
      rivals: []
    }
  };
}
