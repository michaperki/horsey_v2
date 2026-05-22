# ADR 0001: Dependency-Light Baseline

Status: accepted

## Context

Horsey needs to move from canonical design files into a real project. The project also has unresolved decisions around frontend framework, backend framework, realtime transport, database, chess libraries, licensing, payments, and compliance.

Importing a full stack too early would make hard-to-reverse choices before those decisions are documented.

## Decision

Start with a dependency-light ESM Node baseline:

- built-in Node HTTP server;
- static frontend served by the backend;
- seed-backed API data;
- shared domain helpers in local packages;
- no third-party chess, UI, payment, or realtime dependencies yet.

## Consequences

This keeps the project runnable immediately and leaves stack decisions explicit. It is not the final architecture. Future agents may replace the baseline with a framework-backed monorepo once the stack decision is recorded in a later ADR.

Any third-party chess package must still go through license review before import.
