# Doc archive

Preserved historical design docs. Each file here documents thinking that was
*real* at the time but is no longer authoritative — either because the system
it describes was ripped, the direction changed, or the scope was rethought.

Archived files stay in version control as context for future design passes;
do not reference them as current-truth.

## Cosmetics v1 (ripped 2026-05-25)

- `COSMETICS_FORMALIZATION.md` — runtime architecture, v1 launch set, reconciliation
- `COSMETICS_NEXT_PASS.md` — original cosmetics research and proposal
- `COSMETICS_INVENTORY_AUDIT.md` — asset audit and category split

The v1 cosmetic system was a PNG-layered avatar renderer with a manifest
catalog, dev composition canvas, trust-border grants, milestone-cosmetic
grants, and an ownership/equip persistence layer. It was removed in favor
of a clean-slate rebuild that will be designed hand-by-hand.

The original PNG assets are preserved at
`scripts/reference/cosmetics-v1/assets/` alongside their manifest.

The avatar-semantics principle (base piece = chess strength, frame = trust,
adornments = earned history) in `PROJECT_SOUL.md` survives the rewrite and
should guide whatever lands next.
