/**
 * x-shell.js Authentication Example
 *
 * This example demonstrates how to set up authentication for x-shell.js
 */

const express = require('express');
const { createServer } = require('http');
const { TerminalServer, SimpleAuthProvider, PERMISSIONS } = require('./dist/server/index.js');

const app = express();
const server = createServer(app);

// Create authentication provider
const authProvider = new SimpleAuthProvider();

// Add users with different roles
authProvider.addUser('admin', 'Administrator', ['admin'], { department: 'IT' });
authProvider.addUser('dev1', 'Developer 1', ['user'], { department: 'Engineering' });
authProvider.addUser('dev2', 'Developer 2', ['user'], { department: 'Engineering' });
authProvider.addUser('viewer', 'Read-only User', ['readonly'], { department: 'QA' });

// Add custom role for restricted users
authProvider.addRole('restricted', [
  PERMISSIONS.JOIN_SESSION,
  PERMISSIONS.LIST_SESSIONS,
]);

authProvider.addUser('temp', 'Temporary User', ['restricted'], { temporary: true });

console.log('Authentication Setup:');
console.log('- admin: Full access (admin role)');
console.log('- dev1, dev2: Can spawn/join/write sessions (user role)');
console.log('- viewer: Can only join sessions and view (readonly role)');
console.log('- temp: Limited to joining existing sessions (restricted role)');

// Create terminal server with authentication
const terminalServer = new TerminalServer({
  // Authentication configuration
  authProvider,
  requireAuth: true,        // Authentication is mandatory
  allowAnonymous: false,    // No anonymous access

  // Security configuration
  allowedShells: ['/bin/bash', '/bin/zsh'],
  allowedPaths: ['/home', '/tmp'],
  maxSessionsPerClient: 3,

  // Optional: Docker support with auth
  allowDockerExec: true,
  allowedContainerPatterns: ['^web-.*', '^app-.*'],

  verbose: true,
});

// Attach to HTTP server
terminalServer.attach(server);

// Serve static client example
app.use(express.static('public'));

// Basic web page for testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>x-shell.js Authentication Example</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .user-section { margin: 20px 0; padding: 20px; border: 1px solid #ccc; }
            button { margin: 5px; padding: 10px; }
        </style>
    </head>
    <body>
        <h1>x-shell.js Authentication Demo</h1>

        <div class="user-section">
            <h3>Available Test Users:</h3>
            <p><strong>Admin:</strong> Token "admin" - Full access to all operations</p>
            <p><strong>Developer:</strong> Token "dev1" or "dev2" - Can spawn and manage sessions</p>
            <p><strong>Viewer:</strong> Token "viewer" - Read-only access, can join sessions</p>
            <p><strong>Restricted:</strong> Token "temp" - Can only join existing sessions</p>
        </div>

        <div class="user-section">
            <h3>Test Authentication:</h3>
            <button onclick="testAuth('admin')">Test as Admin</button>
            <button onclick="testAuth('dev1')">Test as Developer</button>
            <button onclick="testAuth('viewer')">Test as Viewer</button>
            <button onclick="testAuth('temp')">Test as Restricted</button>
            <button onclick="testAuth('invalid')">Test Invalid Token</button>
        </div>

        <div id="output"></div>

        <script>
            async function testAuth(token) {
                const output = document.getElementById('output');
                output.innerHTML = '<p>Testing authentication with token: ' + token + '</p>';

                try {
                    // Import x-shell client (you would normally load from CDN or bundle)
                    const { TerminalClient } = await import('./dist/client/index.js');

                    const client = new TerminalClient({
                        url: 'ws://localhost:3000/terminal',
                        authToken: token,
                    });

                    // Set up event handlers
                    client.onAuthResponse((success, error, user) => {
                        if (success) {
                            output.innerHTML += '<p style="color: green">✓ Authenticated as: ' + user.username + ' (' + user.userId + ')</p>';
                            output.innerHTML += '<p>Permissions: ' + user.permissions.join(', ') + '</p>';
                        } else {
                            output.innerHTML += '<p style="color: red">✗ Authentication failed: ' + error + '</p>';
                        }
                    });

                    client.onPermissionDenied((operation, error) => {
                        output.innerHTML += '<p style="color: orange">⚠ Permission denied for ' + operation + ': ' + error + '</p>';
                    });

                    // Connect
                    await client.connect();
                    output.innerHTML += '<p>Connected to server</p>';

                    // Try to list sessions (should work for most users)
                    try {
                        const sessions = await client.listSessions();
                        output.innerHTML += '<p>✓ Listed ' + sessions.length + ' sessions</p>';
                    } catch (err) {
                        output.innerHTML += '<p style="color: red">✗ List sessions failed: ' + err.message + '</p>';
                    }

                    // Try to spawn a session (should work only for admin/dev users)
                    try {
                        const sessionInfo = await client.spawn({ shell: '/bin/bash', cwd: '/tmp' });
                        output.innerHTML += '<p>✓ Spawned session: ' + sessionInfo.sessionId + '</p>';

                        // Clean up
                        await client.close(sessionInfo.sessionId);
                        output.innerHTML += '<p>✓ Closed session</p>';
                    } catch (err) {
                        output.innerHTML += '<p style="color: red">✗ Spawn session failed: ' + err.message + '</p>';
                    }

                    client.disconnect();
                    output.innerHTML += '<p>Disconnected</p>';

                } catch (error) {
                    output.innerHTML += '<p style="color: red">Connection error: ' + error.message + '</p>';
                }

                output.innerHTML += '<hr>';
            }
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(\`
🚀 x-shell.js Authentication Demo running on port \${PORT}

Open http://localhost:\${PORT} in your browser to test authentication.

API Endpoints:
- WebSocket: ws://localhost:\${PORT}/terminal
- Web Interface: http://localhost:\${PORT}

Authentication:
- Use Bearer tokens in Authorization header
- Or pass 'token' query parameter: ws://localhost:\${PORT}/terminal?token=admin
- Or send auth message after connecting

Example client usage:
  const client = new TerminalClient({
    url: 'ws://localhost:\${PORT}/terminal',
    authToken: 'admin'
  });
  await client.connect();
  const user = client.getUserContext();
  console.log('Authenticated as:', user.username);
\`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  terminalServer.close();
  server.close();
});