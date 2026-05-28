// Thin UCI wrapper around a Stockfish subprocess (ADR 0008).
// No SDK — Stockfish speaks a stable text protocol over stdin/stdout.
//
// One long-running process per worker. Startup, NNUE load, and tt-allocation
// cost real wall time; per-game spawning would dominate the actual search.
//
// Public surface:
//   startEngine({ path, depth, threads, hashMb }) -> {
//     analyze(fen) -> { bestMoveUci, evalCp, mateIn },
//     version,
//     close()
//   }

import { spawn } from "node:child_process";

const DEFAULT_DEPTH = 18;
const DEFAULT_THREADS = 1;
const DEFAULT_HASH_MB = 64;

export async function startEngine({
  path,
  depth = DEFAULT_DEPTH,
  threads = DEFAULT_THREADS,
  hashMb = DEFAULT_HASH_MB
} = {}) {
  if (!path) {
    const e = new Error("STOCKFISH_PATH not configured");
    e.code = "engine_not_configured";
    throw e;
  }

  let child;
  try {
    child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (cause) {
    const e = new Error(`Failed to spawn engine at ${path}: ${cause?.message || cause}`);
    e.code = "engine_spawn_failed";
    throw e;
  }

  let stdoutBuffer = "";
  let activeWaiter = null;
  const lineQueue = [];

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let idx;
    while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, idx).trimEnd();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (activeWaiter) {
        activeWaiter(line);
      } else {
        lineQueue.push(line);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", () => { /* swallow — engine logs are noisy */ });

  function nextLine() {
    return new Promise((resolve) => {
      if (lineQueue.length > 0) return resolve(lineQueue.shift());
      activeWaiter = (line) => {
        activeWaiter = null;
        resolve(line);
      };
    });
  }

  function send(cmd) {
    child.stdin.write(`${cmd}\n`);
  }

  async function waitFor(predicate) {
    // Collects lines until predicate(line) returns truthy. Returns the matching
    // line plus everything seen along the way.
    const collected = [];
    while (true) {
      const line = await nextLine();
      collected.push(line);
      if (predicate(line)) return { match: line, lines: collected };
    }
  }

  // UCI handshake.
  send("uci");
  const handshake = await waitFor((l) => l === "uciok");
  const idLine = handshake.lines.find((l) => l.startsWith("id name "));
  const version = idLine ? idLine.slice("id name ".length) : "stockfish-unknown";

  send(`setoption name Threads value ${threads}`);
  send(`setoption name Hash value ${hashMb}`);
  send(`setoption name MultiPV value 1`);
  send("isready");
  await waitFor((l) => l === "readyok");

  async function analyze(fen) {
    send(`position fen ${fen}`);
    send(`go depth ${depth}`);

    let evalCp = null;
    let mateIn = null;
    let bestMoveUci = null;

    const { lines } = await waitFor((l) => l.startsWith("bestmove "));
    // Walk lines: latest `info` line at our target depth wins for the eval,
    // and `bestmove` for the move.
    for (const line of lines) {
      if (line.startsWith("info ") && line.includes(" score ")) {
        const parsed = parseInfoLine(line);
        if (parsed && parsed.depth >= depth) {
          // Keep the deepest score we saw at-or-past target depth.
          evalCp = parsed.evalCp;
          mateIn = parsed.mateIn;
        } else if (parsed && evalCp == null && mateIn == null) {
          // Fall back to the latest score even if we never crossed target depth.
          evalCp = parsed.evalCp;
          mateIn = parsed.mateIn;
        }
      } else if (line.startsWith("bestmove ")) {
        const parts = line.split(/\s+/);
        bestMoveUci = parts[1] === "(none)" ? null : parts[1] || null;
      }
    }

    return { bestMoveUci, evalCp, mateIn };
  }

  async function close() {
    try { send("quit"); } catch { /* ignore */ }
    return new Promise((resolve) => {
      child.once("exit", () => resolve());
      // Hard stop after 1s if the process won't quit cleanly.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 1000).unref?.();
    });
  }

  return { analyze, version, close, depth };
}

function parseInfoLine(line) {
  // Example: "info depth 20 seldepth 27 multipv 1 score cp 34 nodes ... pv e2e4 e7e5"
  const tokens = line.split(/\s+/);
  let depth = null;
  let evalCp = null;
  let mateIn = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") depth = Number(tokens[i + 1]);
    else if (t === "score") {
      const kind = tokens[i + 1];
      const value = Number(tokens[i + 2]);
      if (kind === "cp") evalCp = value;
      else if (kind === "mate") mateIn = value;
    }
  }
  return { depth, evalCp, mateIn };
}
