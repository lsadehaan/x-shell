# x-shell.js

> WebSocket-based terminal for Node.js - the truth is in your shell

A plug-and-play terminal solution for web applications. Includes a server component (node-pty), client library, and ready-to-use Lit web component.

## Features

- **Server**: WebSocket server with node-pty for real shell sessions
- **Client**: Lightweight WebSocket client with auto-reconnection
- **UI**: `<x-shell-terminal>` Lit web component with xterm.js
- **Docker**: Connect to Docker containers via `docker exec`
- **Themes**: Built-in dark/light/auto theme support
- **Security**: Configurable shell, path, and container allowlists
- **Framework Agnostic**: Works with React, Vue, Angular, Svelte, or vanilla JS

## Installation

```bash
npm install x-shell.js
```

### Server-Side Requirements (node-pty)

The server component requires `node-pty` for spawning terminal processes. Install it as a dev dependency:

```bash
npm install node-pty --save-dev
```

**Important:** `node-pty` requires native compilation. If you encounter installation issues:

```bash
# Linux - install build essentials
sudo apt-get install build-essential python3

# macOS - install Xcode command line tools
xcode-select --install

# If npm install fails, try:
npm install node-pty --save-dev --legacy-peer-deps

# Or rebuild native modules:
npm rebuild node-pty
```

See [node-pty docs](https://github.com/microsoft/node-pty) for platform-specific requirements.

### Client-Side (Browser)

The UI component can be loaded directly from a CDN - no build step required:

```html
<!-- Using unpkg -->
<script type="module" src="https://unpkg.com/x-shell.js/dist/ui/browser-bundle.js"></script>

<!-- Or using jsDelivr -->
<script type="module" src="https://cdn.jsdelivr.net/npm/x-shell.js/dist/ui/browser-bundle.js"></script>

<!-- Pin to a specific version -->
<script type="module" src="https://unpkg.com/x-shell.js@1.0.0-rc.1/dist/ui/browser-bundle.js"></script>
```

The bundle includes the `<x-shell-terminal>` web component with xterm.js built-in.

## Quick Start

### Server Setup

```javascript
import express from 'express';
import { createServer } from 'http';
import { TerminalServer } from 'x-shell.js/server';

const app = express();
const server = createServer(app);

// Create and attach terminal server
const terminalServer = new TerminalServer({
  allowedShells: ['/bin/bash', '/bin/zsh'],
  allowedPaths: ['/home/user'],
  defaultCwd: '/home/user',
  verbose: true,
});

terminalServer.attach(server);

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Client Usage (Web Component)

```html
<!-- Load xterm.js CSS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">

<!-- Load x-shell.js UI bundle -->
<script type="module" src="https://unpkg.com/x-shell.js/dist/ui/browser-bundle.js"></script>

<!-- Use the component -->
<x-shell-terminal
  url="ws://localhost:3000/terminal"
  theme="dark"
  auto-connect
  auto-spawn
></x-shell-terminal>
```

### Client Usage (JavaScript)

```javascript
import { TerminalClient } from 'x-shell.js/client';

const client = new TerminalClient({
  url: 'ws://localhost:3000/terminal'
});

await client.connect();

client.onData((data) => {
  console.log('Output:', data);
});

client.onExit((code) => {
  console.log('Exited with code:', code);
});

await client.spawn({
  shell: '/bin/bash',
  cwd: '/home/user'
});

client.write('ls -la\n');
client.resize(120, 40);
```

## API Reference

### Server

#### `TerminalServer`

```typescript
import { TerminalServer } from 'x-shell.js/server';

const server = new TerminalServer({
  // Allowed shells (empty = all allowed)
  allowedShells: ['/bin/bash', '/bin/zsh', 'cmd.exe'],

  // Allowed working directories (empty = all allowed)
  allowedPaths: ['/home/user', '/var/www'],

  // Default shell if not specified
  defaultShell: '/bin/bash',

  // Default working directory
  defaultCwd: '/home/user',

  // Max sessions per client (default: 5)
  maxSessionsPerClient: 5,

  // Idle timeout in ms (default: 30 minutes, 0 = disabled)
  idleTimeout: 30 * 60 * 1000,

  // WebSocket path (default: '/terminal')
  path: '/terminal',

  // Enable verbose logging
  verbose: false,
});

// Attach to HTTP server
server.attach(httpServer);

// Or start standalone
server.listen(3001);

// Get active sessions
const sessions = server.getSessions();

// Close server
server.close();
```

### Client

#### `TerminalClient`

```typescript
import { TerminalClient } from 'x-shell.js/client';

const client = new TerminalClient({
  url: 'ws://localhost:3000/terminal',
  reconnect: true,           // Auto-reconnect (default: true)
  maxReconnectAttempts: 10,  // Max attempts (default: 10)
  reconnectDelay: 1000,      // Initial delay ms (default: 1000)
});

// Connect to server
await client.connect();

// Spawn terminal session
const sessionInfo = await client.spawn({
  shell: '/bin/bash',
  cwd: '/home/user',
  env: { TERM: 'xterm-256color' },
  cols: 80,
  rows: 24,
});

// Write to terminal
client.write('echo "Hello World"\n');

// Resize terminal
client.resize(120, 40);

// Kill session
client.kill();

// Disconnect
client.disconnect();

// Event handlers
client.onConnect(() => console.log('Connected'));
client.onDisconnect(() => console.log('Disconnected'));
client.onData((data) => console.log('Data:', data));
client.onExit((code) => console.log('Exit:', code));
client.onError((err) => console.log('Error:', err));
client.onSpawned((info) => console.log('Spawned:', info));

// State getters
client.isConnected();      // boolean
client.hasActiveSession(); // boolean
client.getSessionId();     // string | null
client.getSessionInfo();   // SessionInfo | null
```

### UI Component

#### `<x-shell-terminal>`

```html
<x-shell-terminal
  url="ws://localhost:3000/terminal"
  shell="/bin/bash"
  cwd="/home/user"
  theme="dark"
  font-size="14"
  font-family="Menlo, Monaco, monospace"
  cols="80"
  rows="24"
  auto-connect
  auto-spawn
  no-header
  show-connection-panel
  show-settings
  show-status-bar
></x-shell-terminal>
```

**Attributes:**

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | `''` | WebSocket URL |
| `shell` | string | `''` | Shell to use |
| `cwd` | string | `''` | Working directory |
| `theme` | `'dark'` \| `'light'` \| `'auto'` | `'dark'` | Color theme |
| `font-size` | number | `14` | Terminal font size |
| `font-family` | string | `'Menlo, Monaco, ...'` | Terminal font |
| `cols` | number | `80` | Initial columns |
| `rows` | number | `24` | Initial rows |
| `auto-connect` | boolean | `false` | Connect on mount |
| `auto-spawn` | boolean | `false` | Spawn on connect |
| `no-header` | boolean | `false` | Hide header bar |
| `show-connection-panel` | boolean | `false` | Show connection panel with container/shell selector |
| `show-settings` | boolean | `false` | Show settings dropdown (theme, font size) |
| `show-status-bar` | boolean | `false` | Show status bar with connection info and errors |

**Methods:**

```javascript
const terminal = document.querySelector('x-shell-terminal');

await terminal.connect();     // Connect to server
terminal.disconnect();        // Disconnect
await terminal.spawn();       // Spawn session
terminal.kill();              // Kill session
terminal.clear();             // Clear display
terminal.write('text');       // Write to display
terminal.writeln('line');     // Write line to display
terminal.focus();             // Focus terminal
```

**Events:**

```javascript
terminal.addEventListener('connect', () => {});
terminal.addEventListener('disconnect', () => {});
terminal.addEventListener('spawned', (e) => console.log(e.detail.session));
terminal.addEventListener('exit', (e) => console.log(e.detail.exitCode));
terminal.addEventListener('error', (e) => console.log(e.detail.error));
terminal.addEventListener('theme-change', (e) => console.log(e.detail.theme));
```

### Built-in Connection Panel

When `show-connection-panel` is enabled, the terminal component provides a built-in UI for:

- **Mode Selection**: Switch between local shell and Docker container modes
- **Container Picker**: Dropdown of running containers (when Docker is enabled on server)
- **Shell Selection**: Choose from server-allowed shells
- **Connect/Disconnect**: One-click session management

The connection panel automatically queries the server for:
- Docker availability and allowed containers
- Allowed shells and default configuration

```html
<!-- Full-featured terminal with all UI panels -->
<x-shell-terminal
  url="ws://localhost:3000/terminal"
  show-connection-panel
  show-settings
  show-status-bar
></x-shell-terminal>
```

## Theming

The component uses CSS custom properties for theming:

```css
x-shell-terminal {
  --xs-bg: #1e1e1e;
  --xs-bg-header: #2d2d2d;
  --xs-text: #cccccc;
  --xs-text-muted: #808080;
  --xs-border: #3e3e3e;
  --xs-terminal-bg: #1e1e1e;
  --xs-terminal-fg: #cccccc;
  --xs-terminal-cursor: #ffffff;
  --xs-terminal-selection: #264f78;
  --xs-btn-bg: #3c3c3c;
  --xs-btn-text: #cccccc;
  --xs-btn-hover: #4a4a4a;
  --xs-status-connected: #22c55e;
  --xs-status-disconnected: #ef4444;
}
```

## Docker Container Support

x-shell.js can connect to Docker containers, allowing you to exec into running containers directly from the browser.

### Server Configuration

```javascript
const server = new TerminalServer({
  // Enable Docker exec feature
  allowDockerExec: true,

  // Restrict which containers can be accessed (regex patterns)
  allowedContainerPatterns: [
    '^myapp-',           // Containers starting with 'myapp-'
    '^dev-container$',   // Exact match
    'backend',           // Contains 'backend'
  ],

  // Default shell for containers
  defaultContainerShell: '/bin/bash',

  // Path to Docker CLI (default: 'docker')
  dockerPath: '/usr/bin/docker',

  verbose: true,
});
```

### Client Usage

```javascript
// Connect to a Docker container
await client.spawn({
  container: 'my-container-name',  // Container ID or name
  containerShell: '/bin/sh',       // Shell inside container
  containerUser: 'root',           // User to run as
  containerCwd: '/app',            // Working directory in container
  env: { DEBUG: 'true' },          // Environment variables
});
```

### Web Component

```html
<x-shell-terminal
  url="ws://localhost:3000/terminal"
  container="my-container-name"
  container-shell="/bin/bash"
  container-user="node"
  container-cwd="/app"
  theme="dark"
  auto-connect
  auto-spawn
></x-shell-terminal>
```

**Container Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| `container` | string | Docker container ID or name |
| `container-shell` | string | Shell to use inside container |
| `container-user` | string | User to run as in container |
| `container-cwd` | string | Working directory in container |

### Security Considerations

When enabling Docker exec:

1. **Use allowedContainerPatterns** - Always restrict which containers can be accessed
2. **Run x-shell server securely** - The server needs Docker socket access
3. **Network isolation** - Consider running x-shell in the same Docker network
4. **Audit logging** - Enable verbose mode in production for audit trails

```javascript
// Production Docker configuration
const server = new TerminalServer({
  allowDockerExec: true,
  allowedContainerPatterns: ['^prod-app-'],  // Only production app containers
  maxSessionsPerClient: 1,                    // One session at a time
  idleTimeout: 5 * 60 * 1000,                // 5 minute timeout
  verbose: true,                              // Log all activity
});
```

## Security

**Always configure security for production:**

```javascript
const server = new TerminalServer({
  // Restrict allowed shells
  allowedShells: ['/bin/bash'],

  // Restrict working directories
  allowedPaths: ['/home/app', '/var/www'],

  // Limit sessions per client
  maxSessionsPerClient: 2,

  // Set idle timeout
  idleTimeout: 10 * 60 * 1000, // 10 minutes
});
```

## Examples

See the [examples](./examples) directory for complete working examples:

- [**docker-container**](./examples/docker-container) - Connect to Docker containers from the browser

### Running Locally (Development)

```bash
# Clone the repository
git clone https://github.com/lsadehaan/x-shell.git
cd x-shell

# Install dependencies (including node-pty)
npm install
npm install node-pty --save-dev --legacy-peer-deps

# Build the project
npm run build

# Start a test container (optional, for Docker exec testing)
docker run -d --name test-container alpine sleep infinity

# Run the example server
node examples/docker-container/server.js

# Open http://localhost:3000 in your browser
```

### Quick Start with Docker Compose

Run the full demo with Docker Compose (no local node-pty installation required):

```bash
cd docker
docker compose up -d
```

This starts:
- x-shell server on http://localhost:3000
- Two test containers (Alpine and Ubuntu) to exec into

Open http://localhost:3000 and use the connection panel to:
1. Select "Docker Container" mode
2. Choose a container from the dropdown
3. Click "Start Session"

Stop the demo:

```bash
docker compose down
```

## License

MIT
