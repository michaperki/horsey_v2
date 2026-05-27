// Versioned ToS body. Bump TOS_VERSION when the meaning of acceptance
// changes — every active user is re-prompted on next session.
//
// This file is shared between the API and the client so both render the
// same wording from one source. Schema (apps/api/db.mjs) tracks
// tos_acceptances(user_id, tos_version, accepted_at). The active version
// is *not* stored in the DB; it lives here so a version bump is a one-line
// change.

export const TOS_VERSION = 1;

export const TOS_TITLE = "Horsey Terms — entertainment chips";

// Plain text + structured sections. The client uses TOS_SECTIONS for
// rendering; tests / audit logs can use TOS_PLAIN_TEXT for hashing the
// exact wording someone accepted.
export const TOS_SECTIONS = [
  {
    heading: "Entertainment chips, not money.",
    body: "Chips purchased on Horsey are entertainment credit for use within the platform. They are not currency, have no monetary value outside Horsey, and cannot be redeemed, withdrawn, transferred, or cashed out at this time."
  },
  {
    heading: "Cashout is not part of v1.",
    body: "Cashout / redemption is intentionally deferred to a later product phase, subject to legal and regulatory review in each jurisdiction. By purchasing chips today, you accept that there is no cashout pathway. You may join the cashout waitlist; we will notify waitlist members if and when cashout opens in their region."
  },
  {
    heading: "You can request a refund during the initial period.",
    body: "Refunds during the initial closed-beta period are processed manually on request, no questions asked, up to the original purchase amount. We will refund in the same currency you paid in, minus any unavoidable on-chain fees. Send refund requests to the email associated with your account."
  },
  {
    heading: "No real-money expectation outside chips.",
    body: "Chips won, lost, or held in escrow during play stay as chips. The pot in a game is denominated in chips. The rake is denominated in chips. None of these represent a claim on real-world currency unless and until a cashout product launches and you separately enroll."
  },
  {
    heading: "Responsible play.",
    body: "Set a session and daily spend cap you are comfortable with. If you suspect you have a gambling problem, please contact your local responsible-gambling resource. We are working on in-product tools but they are not a substitute for self-awareness."
  },
  {
    heading: "Things we don't do.",
    body: "We do not require KYC for chip purchases. We do not share your handle or play history with chess.com / lichess / any third party. We do not run promotional sweepstakes, daily-rewards grinds, or loot boxes."
  },
  {
    heading: "Geographic availability.",
    body: "Chip purchases are blocked in jurisdictions where wagering on skill games is restricted under the legal framework we currently operate under. The block list may change. If you are uncertain whether Horsey is legal in your jurisdiction, do not purchase chips."
  }
];

export const TOS_PLAIN_TEXT = TOS_SECTIONS
  .map(({ heading, body }) => `${heading}\n${body}`)
  .join("\n\n");

export function needsTosAcceptance(latestAcceptedVersion) {
  if (latestAcceptedVersion == null) return true;
  return Number(latestAcceptedVersion) < TOS_VERSION;
}
