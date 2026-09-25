/* eslint-disable no-console, n/no-process-exit */

// Unified booter: runs several Hyperwatch configs side by side.
//
// Hyperwatch is a process-wide singleton, so each config gets its own child
// process. Output is silent by default; stderr is kept in logs/<name>.log.
// If one child exits unexpectedly, the others are stopped and this exits 1.
//
//   npm start                  # api + frontend + images + rest, quiet
//   npm start -- -v            # stream prefixed output
//   npm start -- --stderr      # stream prefixed stderr only (Heroku logs)
//   npm start -- api images    # pick services

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICES = require('./services');

const DEFAULT_SERVICES = Object.keys(SERVICES);

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const stderrOnly = !verbose && args.includes('--stderr');
const names = args.filter((arg) => !arg.startsWith('-'));
const selected = names.length ? names : DEFAULT_SERVICES;

for (const name of selected) {
  if (!SERVICES[name]) {
    console.error(
      `Unknown service: ${name} (available: ${Object.keys(SERVICES).join(
        ', ',
      )})`,
    );
    process.exit(1);
  }
}

const bin = path.join(__dirname, 'node_modules', '.bin', 'hyperwatch');
const logsDir = path.join(__dirname, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const children = new Map();
let shuttingDown = false;
let failed = false;

const prefixLines = (name, stream, target) => {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      target.write(`[${name}] ${line}\n`);
    }
  });
};

for (const name of selected) {
  const { port } = SERVICES[name];
  const logFile = path.join(logsDir, `${name}.log`);
  const stderrFd = fs.openSync(logFile, 'w');

  const child = spawn(bin, [name], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: [
      'ignore',
      verbose ? 'pipe' : 'ignore',
      verbose || stderrOnly ? 'pipe' : stderrFd,
    ],
  });

  if (verbose) {
    prefixLines(name, child.stdout, process.stdout);
  }
  if (verbose || stderrOnly) {
    prefixLines(name, child.stderr, process.stderr);
    child.stderr.on('data', (chunk) => fs.writeSync(stderrFd, chunk));
  }

  child.on('exit', (code, signal) => {
    children.delete(name);
    fs.closeSync(stderrFd);
    if (!shuttingDown) {
      console.error(
        `${name} exited unexpectedly (${
          signal || `code ${code}`
        }), see logs/${name}.log`,
      );
      failed = true;
      shutdown('SIGTERM');
    }
    if (children.size === 0) {
      process.exit(failed ? 1 : 0);
    }
  });

  children.set(name, child);
  console.log(`${name.padEnd(9)} http://localhost:${port}`);
}

// Children persist their aggregators on SIGINT/SIGTERM, so let them finish.
// A second signal kills them outright. One Ctrl+C reaches this process more
// than once (from the terminal, and forwarded by npm and dotenv), so repeats
// within a second don't count as a second signal.
let shuttingDownAt;
const shutdown = (signal) => {
  if (shuttingDown) {
    if (Date.now() - shuttingDownAt < 1000) {
      return;
    }
    for (const child of children.values()) {
      child.kill('SIGKILL');
    }
    return;
  }
  shuttingDown = true;
  shuttingDownAt = Date.now();
  console.log(`Stopping (${signal}), waiting for persistence…`);
  for (const child of children.values()) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
