'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = path.join(root, 'buzzer-server');
try {
  require.resolve('socket.io', { paths: [server] });
  require.resolve('react-scripts/scripts/start', { paths: [root] });
} catch {
  console.error('Instale as dependências com npm run setup antes de iniciar.');
  process.exit(1);
}

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => { if (!child.killed) child.kill(); });
  process.exitCode = code;
}
for (const [file, cwd, env] of [
  [path.join(server, 'index.js'), server, process.env],
  [require.resolve('react-scripts/scripts/start', { paths: [root] }), root, { ...process.env, BROWSER: process.env.BROWSER || 'none' }],
]) {
  const child = spawn(process.execPath, [file], { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 0); });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
process.once('exit', () => children.forEach((child) => { if (!child.killed) child.kill(); }));
