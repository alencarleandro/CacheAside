import { spawn } from 'node:child_process';
import path from 'node:path';

const node = process.execPath;
const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const detached = process.env.DETACHED_DEV === '1' || process.argv.includes('--detached');
const childStdio = detached ? 'ignore' : 'inherit';

let closing = false;
const processes = [];

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of processes) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

function startProcess(args) {
  const child = spawn(node, args, {
    stdio: childStdio,
    windowsHide: detached
  });

  child.on('error', (error) => {
    if (!detached) {
      console.error(error.message);
    }
    shutdown(1);
  });

  processes.push(child);
  return child;
}

startProcess(['server/index.js']);
startProcess([viteBin, '--host', '127.0.0.1']);

for (const child of processes) {
  child.on('exit', (code) => {
    if (!closing && code !== 0) shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
