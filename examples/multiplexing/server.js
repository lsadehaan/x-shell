/**
 * x-shell Session Multiplexing Example
 *
 * This example demonstrates session multiplexing - multiple clients can
 * connect to the same terminal session, share output, and collaborate.
 *
 * Features demonstrated:
 * - Session persistence (sessions survive client disconnects)
 * - Multiple clients per session
 * - Session history replay on join
 * - Session listing and joining
 * - Docker attach mode (connecting to container's main process)
 *
 * Usage:
 * 1. Run this server: node server.js
 * 2. Open index.html in multiple browser tabs
 * 3. Create a session in one tab, join it from another
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TerminalServer } from '../../dist/server/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

// Create HTTP server
const server = createServer((req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dirname, 'index.html')));
  }
  // Serve dist files
  else if (req.url.startsWith('/dist/')) {
    const file = join(rootDir, req.url);
    if (existsSync(file)) {
      const contentType = req.url.endsWith('.js') ? 'application/javascript' :
                         req.url.endsWith('.map') ? 'application/json' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
  }
  // API endpoint to get server stats
  else if (req.url === '/api/stats') {
    const stats = terminalServer.getStats();
    const sessions = terminalServer.getSharedSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stats, sessions }, null, 2));
  }
  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create terminal server with multiplexing enabled
const terminalServer = new TerminalServer({
  // Allow local shells
  allowedShells: ['/bin/bash', '/bin/sh', '/bin/zsh'],
  allowedPaths: [process.env.HOME || '/root', '/tmp'],
  defaultCwd: process.env.HOME || '/root',

  // Docker support (optional)
  allowDockerExec: true,
  allowedContainerPatterns: ['.*'], // Allow all containers for demo
  defaultContainerShell: '/bin/sh',

  // Session multiplexing options
  maxClientsPerSession: 10,        // Up to 10 clients per session
  orphanTimeout: 120000,           // 2 minute timeout before orphaned sessions are killed
  historySize: 100000,             // 100KB history buffer per session
  historyEnabled: true,            // Enable history replay on join
  maxSessionsTotal: 50,            // Maximum concurrent sessions

  // General settings
  maxSessionsPerClient: 5,
  idleTimeout: 30 * 60 * 1000,     // 30 minutes

  // Enable logging
  verbose: true,
});

// Attach to HTTP server
terminalServer.attach(server);

// Log session events
setInterval(() => {
  const stats = terminalServer.getStats();
  if (stats.sessionCount > 0) {
    console.log(`[Stats] Sessions: ${stats.sessionCount}, Clients: ${stats.clientCount}, Orphaned: ${stats.orphanedCount}`);
  }
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║           x-shell Session Multiplexing Example                      ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  Server running at: http://localhost:${PORT}                         ║
║  WebSocket endpoint: ws://localhost:${PORT}/terminal                 ║
║  Stats API: http://localhost:${PORT}/api/stats                       ║
║                                                                    ║
║  How to test multiplexing:                                         ║
║                                                                    ║
║  1. Open http://localhost:${PORT} in your browser                    ║
║  2. Click "New Session" to create a terminal                       ║
║  3. Run some commands to generate history                          ║
║  4. Open another browser tab to http://localhost:${PORT}             ║
║  5. Click "Refresh Sessions" to see the existing session           ║
║  6. Click "Join" to connect to the same session                    ║
║  7. Both tabs now share the same terminal!                         ║
║                                                                    ║
║  To test Docker attach mode:                                       ║
║  1. Start a container: docker run -it --name demo alpine sh        ║
║  2. Select "Docker Attach" mode and enter container name           ║
║  3. You'll connect to the container's main process (PID 1)         ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});
