# ADR 0002: Use chess.js For Chess Rules

Status: accepted

## Context

Horsey needs legal move validation and game-state adjudication early. Building every chess rule from scratch would slow the first playable loop and increase risk. The user prefers ripping a suitable open-source option where practical, but wants to avoid chessground because of license concerns.

## Decision

Use `chess.js` for chess rules, move generation, FEN handling, and result detection.

Keep the board UI custom for now. App code should depend on Horsey's `packages/chess` wrapper instead of directly coupling to `chess.js`.

## License

`chess.js` is published as BSD-2-Clause. Preserve notices and re-check license obligations before production distribution.

Sources checked:

- https://github.com/jhlywa/chess.js/
- https://www.jsdelivr.com/package/npm/chess.js

## Consequences

This avoids copyleft risk from chessground while giving Horsey a proven rules engine. The wrapper lets us replace the library later if licensing, performance, or product requirements change.
