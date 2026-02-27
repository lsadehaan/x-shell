# x-shell.js Authentication

This document describes the new authentication and authorization features added to x-shell.js.

## Overview

The authentication system provides:
- **Pluggable authentication providers** for different auth methods
- **Role-based permission system** for granular access control
- **Client-side authentication support** with event handlers
- **Backward compatibility** - existing code works without auth
- **Multiple auth strategies** - connection-time, message-based, or both

## Quick Start

### 1. Basic Authentication Setup

```javascript
import { TerminalServer, SimpleAuthProvider, PERMISSIONS } from 'x-shell.js/server';

// Create auth provider
const authProvider = new SimpleAuthProvider();

// Add users with roles
authProvider.addUser('alice', 'Alice Smith', ['admin']);
authProvider.addUser('bob', 'Bob Jones', ['user']);

// Create server with auth
const server = new TerminalServer({
  authProvider,
  requireAuth: true,        // Require authentication
  allowAnonymous: false,    // No anonymous access
});
```

### 2. Client Authentication

```javascript
import { TerminalClient } from 'x-shell.js/client';

// Option 1: Auth token in config (sent as Bearer header + query param)
const client = new TerminalClient({
  url: 'ws://localhost:3000/terminal',
  authToken: 'user-token-here',
});

// Option 2: Authenticate after connecting
await client.connect();
await client.authenticate('user-token-here');

// Check auth status
if (client.isAuth()) {
  const user = client.getUserContext();
  console.log('Authenticated as:', user.username);
}
```

## Authentication Providers

### SimpleAuthProvider

Role-based authentication with in-memory user storage.

```javascript
import { SimpleAuthProvider, PERMISSIONS } from 'x-shell.js/server';

const authProvider = new SimpleAuthProvider();

// Add users
authProvider.addUser('user1', 'John Doe', ['admin'], { department: 'IT' });
authProvider.addUser('user2', 'Jane Smith', ['user', 'docker']);

// Add custom roles
authProvider.addRole('docker', [
  PERMISSIONS.SPAWN_SESSION,
  PERMISSIONS.DOCKER_EXEC,
  PERMISSIONS.LIST_CONTAINERS,
]);
```

**Built-in roles:**
- `admin` - Full access to all operations
- `user` - Can spawn/join/manage own sessions
- `readonly` - Can only join sessions and view

### JWTAuthProvider

JWT token-based authentication with configurable claims.

```javascript
import { JWTAuthProvider } from 'x-shell.js/server';

const jwtProvider = new JWTAuthProvider({
  secretOrKey: 'your-jwt-secret',
  audience: 'x-shell',
  issuer: 'your-app',
});

// JWT payload should include:
// {
//   "sub": "user-id",           // User ID (required)
//   "username": "display-name", // Display name
//   "permissions": ["spawn_session", "join_session"], // Permissions array
//   "aud": "x-shell",
//   "iss": "your-app"
// }
```

**JWT Authentication Methods:**
1. **Authorization header:** `Authorization: Bearer <token>`
2. **Query parameter:** `ws://localhost/terminal?token=<token>`
3. **Auth message:** Send `auth` message with token after connecting

### SessionAuthProvider

Session/cookie-based authentication.

```javascript
import { SessionAuthProvider } from 'x-shell.js/server';

const sessionProvider = new SessionAuthProvider({
  cookieName: 'sessionid', // Default: 'session'
});

// Add session mappings (typically from your app's session store)
sessionProvider.addSession('session-123', {
  userId: 'user1',
  username: 'John Doe',
  permissions: ['spawn_session', 'join_session'],
});
```

### CompositeAuthProvider

Combines multiple auth providers - tries them in order.

```javascript
import { CompositeAuthProvider, JWTAuthProvider, SessionAuthProvider } from 'x-shell.js/server';

const composite = new CompositeAuthProvider([
  new JWTAuthProvider({ secretOrKey: 'jwt-secret' }),
  new SessionAuthProvider({ cookieName: 'sessionid' }),
]);
```

### Custom Auth Provider

Implement the `AuthProvider` interface:

```javascript
class CustomAuthProvider {
  async authenticateConnection(context) {
    // Authenticate from HTTP upgrade request
    const token = context.request.headers.authorization;
    // ... validate token ...
    return {
      success: true,
      user: { userId: 'user1', username: 'John', permissions: ['spawn_session'] }
    };
  }

  async authenticateCredentials(message) {
    // Authenticate from auth message
    return { success: true, user: { ... } };
  }

  async checkPermission(request) {
    // Check if user.permissions includes request.operation
    return request.user.permissions.includes(request.operation);
  }

  getAnonymousPermissions() {
    return []; // No anonymous permissions
  }
}
```

## Permission System

### Available Permissions

```javascript
import { PERMISSIONS } from 'x-shell.js/server';

// Session operations
PERMISSIONS.SPAWN_SESSION     // Create new sessions
PERMISSIONS.JOIN_SESSION      // Join existing sessions
PERMISSIONS.LIST_SESSIONS     // List available sessions
PERMISSIONS.WRITE_SESSION     // Write to session (send commands)
PERMISSIONS.RESIZE_SESSION    // Resize session terminal
PERMISSIONS.CLOSE_SESSION     // Close/kill sessions

// Docker operations
PERMISSIONS.DOCKER_EXEC       // Execute in Docker containers
PERMISSIONS.DOCKER_ATTACH     // Attach to Docker containers
PERMISSIONS.LIST_CONTAINERS   // List Docker containers

// Administrative
PERMISSIONS.VIEW_ALL_SESSIONS // View sessions from other users
PERMISSIONS.ADMIN             // Full administrative access
```

### Permission Checking

The server automatically checks permissions for each operation:

```javascript
// This happens automatically for each client message
const permissionRequest = {
  user: clientUser,           // Current user context
  operation: 'spawn_session', // Operation being attempted
  resource: 'session:abc123', // Optional resource identifier
  context: { message, clientId } // Additional context
};

const allowed = await authProvider.checkPermission(permissionRequest);
```

## Server Configuration

```javascript
const server = new TerminalServer({
  // Authentication settings
  authProvider: myAuthProvider,    // Auth provider instance
  requireAuth: true,               // Require auth for all connections
  allowAnonymous: false,           // Allow unauthenticated users

  // Existing security settings still apply
  allowedShells: ['/bin/bash'],    // Restrict shells
  allowedPaths: ['/home'],         // Restrict directories
  maxSessionsPerClient: 5,         // Limit sessions per user

  // Docker auth is checked per-operation
  allowDockerExec: true,
  allowedContainerPatterns: ['^web-.*'],
});
```

### Authentication Modes

1. **No Auth (default)** - Backward compatible, no authentication
   ```javascript
   new TerminalServer(); // No auth provider
   ```

2. **Optional Auth** - Auth available but not required
   ```javascript
   new TerminalServer({
     authProvider,
     requireAuth: false,
     allowAnonymous: true
   });
   ```

3. **Required Auth** - Authentication mandatory
   ```javascript
   new TerminalServer({
     authProvider,
     requireAuth: true,
     allowAnonymous: false
   });
   ```

4. **Mixed Mode** - Auth required, but anonymous users allowed with limited permissions
   ```javascript
   new TerminalServer({
     authProvider,
     requireAuth: false,
     allowAnonymous: true
   });
   ```

## Client-Side API

### Authentication Methods

```javascript
const client = new TerminalClient({
  url: 'ws://localhost:3000/terminal',
  authToken: 'optional-token',
  authHeaders: { 'X-Custom': 'value' },
});

// Check auth status
client.isAuth()                    // Returns boolean
client.getUserContext()            // Returns UserContext or null

// Authenticate after connecting
await client.authenticate('token', { customData: 'value' });
```

### Event Handlers

```javascript
// Authentication events
client.onAuthResponse((success, error, user) => {
  if (success) {
    console.log('Authenticated as:', user.username);
    console.log('Permissions:', user.permissions);
  } else {
    console.error('Auth failed:', error);
  }
});

// Permission denied events
client.onPermissionDenied((operation, error) => {
  console.warn(`Permission denied for ${operation}: ${error}`);
});

// Server info includes auth status
client.onServerInfo((info) => {
  if (info.authEnabled) {
    console.log('Server requires auth:', info.requireAuth);
    if (info.user) {
      console.log('Already authenticated as:', info.user.username);
    }
  }
});
```

## Migration Guide

### Existing Code (No Changes Required)

```javascript
// This continues to work exactly as before
const server = new TerminalServer();
const client = new TerminalClient({ url: 'ws://localhost:3000/terminal' });
```

### Adding Authentication

1. **Server-side:** Add auth provider to server config
2. **Client-side:** Add auth token to client config or call `authenticate()`
3. **Optional:** Add event handlers for auth feedback

### Common Patterns

#### Express.js Integration

```javascript
const express = require('express');
const { TerminalServer, SimpleAuthProvider } = require('x-shell.js/server');

const app = express();

// Your existing auth middleware
app.use(session({ secret: 'your-secret' }));

const authProvider = new SimpleAuthProvider();
const terminalServer = new TerminalServer({
  authProvider,
  requireAuth: true
});

// Populate auth provider from your user database
app.use((req, res, next) => {
  if (req.session.user) {
    authProvider.addUser(
      req.session.user.id,
      req.session.user.name,
      req.session.user.roles
    );
  }
  next();
});

terminalServer.attach(server);
```

#### JWT Integration

```javascript
// Server setup
const jwtProvider = new JWTAuthProvider({
  secretOrKey: process.env.JWT_SECRET,
  audience: 'myapp',
});

// Client usage
const client = new TerminalClient({
  url: 'ws://localhost:3000/terminal',
  authToken: localStorage.getItem('jwt_token'), // From your app's login
});
```

## Security Considerations

1. **Token Storage:** Store auth tokens securely (httpOnly cookies, secure storage)
2. **Transport Security:** Always use WSS (WebSocket Secure) in production
3. **Token Validation:** Implement proper token expiry and refresh
4. **Permission Granularity:** Use least-privilege principle for permissions
5. **Audit Logging:** Consider logging auth events for security monitoring

```javascript
// Example: Custom auth provider with logging
class AuditedAuthProvider {
  async authenticateConnection(context) {
    const result = await this.baseProvider.authenticateConnection(context);
    console.log(`Auth attempt: ${context.clientIp} - ${result.success ? 'SUCCESS' : 'FAILED'}`);
    return result;
  }

  async checkPermission(request) {
    const allowed = await this.baseProvider.checkPermission(request);
    if (!allowed) {
      console.warn(`Permission denied: ${request.user.userId} attempted ${request.operation}`);
    }
    return allowed;
  }
}
```

## Examples

See the `auth-example.js` file for a complete working example with multiple user roles and a test interface.

## Troubleshooting

### Common Issues

1. **"Authentication required"** - Server has `requireAuth: true` but client didn't provide credentials
2. **"Permission denied"** - User doesn't have required permission for the operation
3. **"Invalid token"** - Auth provider rejected the provided credentials
4. **WebSocket connection fails** - Check if auth headers are properly formatted

### Debug Mode

```javascript
const server = new TerminalServer({
  authProvider,
  verbose: true, // Enable detailed logging
});
```

This will log all authentication attempts and permission checks to help diagnose issues.