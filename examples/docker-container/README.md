# Docker Container Example

This example demonstrates how to use x-shell to connect to Docker containers directly from the browser.

## Prerequisites

- Node.js 18+
- Docker installed and running
- node-pty installed (requires native compilation)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start a test container:

```bash
docker run -d --name test-container alpine sleep infinity
```

3. Start the server:

```bash
npm start
```

4. Open http://localhost:3000 in your browser

## How It Works

The server is configured with `allowDockerExec: true` and a list of allowed container patterns:

```javascript
const terminalServer = new TerminalServer({
  allowDockerExec: true,
  allowedContainerPatterns: [
    '^test-',    // Containers starting with 'test-'
    'demo',      // Containers containing 'demo'
  ],
  defaultContainerShell: '/bin/sh',
  verbose: true,
});
```

When a client requests a Docker session, x-shell spawns `docker exec -it <container> <shell>` behind the scenes, giving you a full PTY session inside the container.

## Security Notes

- Always use `allowedContainerPatterns` to restrict which containers can be accessed
- The server needs access to the Docker socket (`/var/run/docker.sock`)
- Consider running x-shell in the same Docker network as your containers
- Enable `verbose: true` for audit logging in production

## Cleanup

Stop and remove the test container:

```bash
docker stop test-container && docker rm test-container
```
