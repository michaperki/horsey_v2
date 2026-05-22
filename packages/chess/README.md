# Chess Package

This package holds Horsey's chess domain wrapper.

Horsey currently uses `chess.js` for chess move generation, validation, piece placement/movement, and result detection. The package is BSD-2-Clause licensed, which is permissive and compatible with a closed-source product direction when notices are preserved.

Chessground is still treated as undesirable for this project because the user does not want license obligations that would force open-sourcing Horsey.

The intended architecture is server-authoritative chess state with optional client-side previews for responsiveness. App code should import Horsey's wrapper functions from this package rather than binding directly to `chess.js`.
