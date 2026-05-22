# Horsey Agent Guide

This repository is the beginning of the real Horsey project. The current JSX and HTML files are canonical design inputs created by Claude, not the implementation target and not disposable mockups. Future agents should use them to understand the product, visual direction, and required surfaces, then build production frontend, backend, realtime, chess, wallet, trust, and operations systems from scratch or from license-compatible components.

## Working Agreement

- Keep the big picture visible. Horsey is not "a chess board UI"; it is wagered chess with escrow, live play, matchmaking, scouting, rivalry/history, settlement, wallet, trust, and anti-cheat concerns.
- Treat the design files as canonical source material until replaced by a documented product decision.
- Do not overfit to low-fi implementation details. The wireframes use placeholder boards and demo state; they are product direction, not finished architecture.
- Capture meaningful new user guidance in docs as it appears. Do not transcribe every sentence. Preserve intent, constraints, preferences, and working-context facts.
- Prefer updating existing docs over scattering new notes. If a new area emerges, add a small purpose-built doc and link it from `docs/PROJECT_SOUL.md`.
- When making architectural choices, record the decision and the reason. This project should accumulate judgment, not just code.
- The user is a vibe coder working with coding agents. Agents should keep enough orientation in the repo that newly spawned agents inherit the same context and do not become narrowly task-focused.

## Current Environment Notes

- The working directory is currently under WSL at `/mnt/c/Users/PerkD/documents/dev/horsey_v2`.
- The user can operate from WSL or Windows PowerShell. Prefer commands and docs that make this dual environment easy to understand.
- This directory is currently not a git repository. If git is initialized later, preserve this guide and the docs directory as project memory.

## Documentation Map

- `docs/PROJECT_SOUL.md` captures durable product intent, collaboration norms, and memory rules.
- `docs/DESIGN_REVIEW.md` summarizes what Claude's design files establish.
- `docs/ARCHITECTURE_FIRST_PASS.md` records the initial high-level system architecture and unresolved decisions.
- `docs/IMPLEMENTATION_PLAN.md` stages the work from project foundation through playable fake-money loop, trust/safety, and real-money readiness.

## Update Rule For Future Agents

At the end of any meaningful work session, review whether the user said something durable about product direction, architecture, workflow, environment, licensing, or team preferences. If yes, update the relevant doc in the same change. Keep updates concise and in spirit.
