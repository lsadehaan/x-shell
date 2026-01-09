# x-shell Session Multiplexing Example

This example demonstrates x-shell's session multiplexing feature - multiple clients can connect to the same terminal session, share output, and collaborate in real-time.

## Features Demonstrated

- **Session Persistence** - Sessions survive client disconnects
- **Multiple Clients** - Up to 10 clients can share a single session
- **History Replay** - New clients receive recent terminal output on join
- **Session Discovery** - List and join existing sessions
- **Docker Attach** - Connect to a container's main process (PID 1)

## Prerequisites

- Node.js 18+
- Docker (optional, for container features)

## Installation

```bash
npm install
```

## Running the Example

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## How to Test Multiplexing

1. Open http://localhost:3000 in your browser (Tab 1)
2. Click "Create Session" to start a new terminal
3. Run some commands to generate history (e.g., `ls -la`, `echo "Hello"`)
4. Open http://localhost:3000 in a new browser tab (Tab 2)
5. Click "Refresh" to see the existing session
6. Click "Join" to connect to the same session
7. Both tabs now share the terminal!
   - Commands typed in either tab appear in both
   - Tab 2 receives the history from before it joined
8. Close Tab 1 - the session survives!
9. Tab 2 can continue using the session

## Testing Docker Attach Mode

Docker attach connects to a container's main process (PID 1) instead of spawning a new shell.

```bash
# Start an interactive container
docker run -it --name demo alpine sh

# In another terminal, run the example server
npm start

# Open http://localhost:3000
# Select "Docker Attach" mode
# Enter "demo" as the container name
# Click "Create Session"
# You're now connected to the same shell as the docker run command!
```

## Server Configuration

Key multiplexing options in `server.js`:

```javascript
const terminalServer = new TerminalServer({
  // Session multiplexing options
  maxClientsPerSession: 10,     // Max clients per session
  orphanTimeout: 120000,        // 2 min before orphan cleanup
  historySize: 100000,          // 100KB history buffer
  historyEnabled: true,         // Enable history replay
  maxSessionsTotal: 50,         // Max concurrent sessions
});
```

## Client API

```javascript
import { TerminalClient } from 'x-shell.js/client';

const client = new TerminalClient({ url: 'ws://localhost:3000/terminal' });
await client.connect();

// List available sessions
const sessions = await client.listSessions();

// Create a new session
const session = await client.spawn({
  label: 'my-session',
  allowJoin: true,
  enableHistory: true,
});

// Join an existing session
const joined = await client.join({
  sessionId: 'term-123...',
  requestHistory: true,
  historyLimit: 50000,
});

// Leave without killing session
client.leave();

// Event handlers
client.onClientJoined((sessionId, count) => {
  console.log(`Client joined, ${count} total`);
});

client.onClientLeft((sessionId, count) => {
  console.log(`Client left, ${count} remaining`);
});

client.onSessionClosed((sessionId, reason) => {
  console.log(`Session closed: ${reason}`);
});
```

## Stats API

The example server provides a stats endpoint:

```bash
curl http://localhost:3000/api/stats
```

Returns:
```json
{
  "stats": {
    "sessionCount": 2,
    "clientCount": 5,
    "orphanedCount": 0
  },
  "sessions": [
    {
      "sessionId": "term-1234...",
      "type": "local",
      "clientCount": 3,
      "accepting": true
    }
  ]
}
```
