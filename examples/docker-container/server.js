/**
 * x-shell Docker Container Example
 *
 * This example demonstrates how to use x-shell to connect to Docker containers.
 *
 * Prerequisites:
 * - Docker installed and running
 * - node-pty installed: npm install node-pty
 *
 * Usage:
 * 1. Start a test container: docker run -d --name test-container alpine sleep infinity
 * 2. Run this server: node server.js
 * 3. Open index.html in your browser
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TerminalServer } from 'x-shell.js/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

// Create HTTP server
const server = createServer((req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dirname, 'index.html')));
  }
  // Serve local x-shell bundles
  else if (req.url === '/dist/ui/browser-bundle.js') {
    const file = join(rootDir, 'dist/ui/browser-bundle.js');
    if (existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('Bundle not found - run npm run build first');
    }
  }
  // Serve xterm.js CSS from node_modules
  else if (req.url === '/xterm.css') {
    const file = join(rootDir, 'node_modules/xterm/css/xterm.css');
    if (existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('xterm.css not found');
    }
  }
  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create terminal server with Docker support enabled
const terminalServer = new TerminalServer({
  // Enable Docker exec feature
  allowDockerExec: true,

  // Allow containers matching these patterns
  // Empty array means all containers are allowed
  allowedContainerPatterns: [
    '^test-',        // Containers starting with 'test-'
    'demo',          // Containers containing 'demo'
    '^alpine$',      // Exact match 'alpine'
  ],

  // Default shell for containers
  defaultContainerShell: '/bin/sh',

  // Also allow local shell for comparison
  allowedShells: ['/bin/bash', '/bin/sh'],
  allowedPaths: [process.cwd()],

  // Session settings
  maxSessionsPerClient: 3,
  idleTimeout: 10 * 60 * 1000, // 10 minutes

  // Enable logging
  verbose: true,
});

// Attach to HTTP server
terminalServer.attach(server);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           x-shell Docker Container Example                     ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Server running at: http://localhost:${PORT}                    ║
║  WebSocket endpoint: ws://localhost:${PORT}/terminal            ║
║                                                               ║
║  To test Docker exec:                                         ║
║  1. Start a test container:                                   ║
║     docker run -d --name test-container alpine sleep infinity ║
║                                                               ║
║  2. Open http://localhost:${PORT} in your browser               ║
║                                                               ║
║  3. Enter 'test-container' as the container name              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
