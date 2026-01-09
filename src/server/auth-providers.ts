/**
 * Built-in authentication providers for x-shell.js
 */

import type {
  AuthProvider,
  AuthContext,
  AuthMessage,
  AuthResult,
  PermissionRequest,
  UserContext,
} from '../shared/types.js';

/**
 * Standard permission constants
 */
export const PERMISSIONS = {
  // Session management
  SPAWN_SESSION: 'spawn_session',
  JOIN_SESSION: 'join_session',
  LIST_SESSIONS: 'list_sessions',
  WRITE_SESSION: 'write_session',
  RESIZE_SESSION: 'resize_session',
  CLOSE_SESSION: 'close_session',

  // Docker operations
  DOCKER_EXEC: 'docker_exec',
  DOCKER_ATTACH: 'docker_attach',
  LIST_CONTAINERS: 'list_containers',

  // Administrative
  VIEW_ALL_SESSIONS: 'view_all_sessions',
  ADMIN: 'admin',
} as const;

/**
 * No-op authentication provider that allows all operations
 * Useful for development or when auth is handled externally
 */
export class NoAuthProvider implements AuthProvider {
  async checkPermission(request: PermissionRequest): Promise<boolean> {
    return true;
  }

  getAnonymousPermissions(): string[] {
    return Object.values(PERMISSIONS);
  }
}

/**
 * Simple role-based authentication provider
 * Maps users to roles with predefined permissions
 */
export class SimpleAuthProvider implements AuthProvider {
  private users: Map<string, UserContext> = new Map();
  private rolePermissions: Map<string, string[]> = new Map();

  constructor() {
    // Default roles
    this.rolePermissions.set('admin', Object.values(PERMISSIONS));
    this.rolePermissions.set('user', [
      PERMISSIONS.SPAWN_SESSION,
      PERMISSIONS.JOIN_SESSION,
      PERMISSIONS.LIST_SESSIONS,
      PERMISSIONS.WRITE_SESSION,
      PERMISSIONS.RESIZE_SESSION,
      PERMISSIONS.CLOSE_SESSION,
    ]);
    this.rolePermissions.set('readonly', [
      PERMISSIONS.JOIN_SESSION,
      PERMISSIONS.LIST_SESSIONS,
    ]);
  }

  /**
   * Add a user with roles
   */
  addUser(userId: string, username: string, roles: string[], metadata?: Record<string, any>): void {
    const permissions = roles.flatMap(role => this.rolePermissions.get(role) || []);
    const uniquePermissions = [...new Set(permissions)];

    this.users.set(userId, {
      userId,
      username,
      permissions: uniquePermissions,
      metadata: { ...metadata, roles },
    });
  }

  /**
   * Add or update a role with specific permissions
   */
  addRole(role: string, permissions: string[]): void {
    this.rolePermissions.set(role, permissions);
  }

  async authenticateConnection(context: AuthContext): Promise<AuthResult> {
    // Try to get user from Authorization header
    const authHeader = context.request.headers.authorization;
    if (!authHeader) {
      return { success: false, error: 'No authorization header' };
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') {
      return { success: false, error: 'Invalid authorization scheme' };
    }

    // Simple token = userId for this basic provider
    const user = this.users.get(token);
    if (!user) {
      return { success: false, error: 'Invalid token' };
    }

    return { success: true, user };
  }

  async authenticateCredentials(credentials: AuthMessage): Promise<AuthResult> {
    if (!credentials.token) {
      return { success: false, error: 'No token provided' };
    }

    // Simple token = userId for this basic provider
    const user = this.users.get(credentials.token);
    if (!user) {
      return { success: false, error: 'Invalid token' };
    }

    return { success: true, user };
  }

  async checkPermission(request: PermissionRequest): Promise<boolean> {
    return request.user.permissions.includes(request.operation);
  }

  getAnonymousPermissions(): string[] {
    return []; // No anonymous access by default
  }
}

/**
 * JWT-based authentication provider
 * Validates JWT tokens and extracts permissions from claims
 */
export class JWTAuthProvider implements AuthProvider {
  private jwtVerify: any;
  private secretOrKey: string;
  private audience?: string;
  private issuer?: string;

  constructor(options: {
    secretOrKey: string;
    audience?: string;
    issuer?: string;
  }) {
    this.secretOrKey = options.secretOrKey;
    this.audience = options.audience;
    this.issuer = options.issuer;
  }

  /**
   * Lazy load jsonwebtoken (peer dependency)
   */
  private async loadJWT(): Promise<void> {
    if (this.jwtVerify) return;

    try {
      const jwt = await import('jsonwebtoken');
      this.jwtVerify = jwt.verify;
    } catch (error) {
      throw new Error('jsonwebtoken is required for JWTAuthProvider. Install it with: npm install jsonwebtoken');
    }
  }

  private async verifyToken(token: string): Promise<UserContext> {
    await this.loadJWT();

    const decoded = this.jwtVerify(token, this.secretOrKey, {
      audience: this.audience,
      issuer: this.issuer,
    }) as any;

    // Extract user info from JWT claims
    const userId = decoded.sub || decoded.userId || decoded.user_id;
    const username = decoded.username || decoded.name || decoded.preferred_username;
    const permissions = decoded.permissions || decoded.scope?.split(' ') || [];

    if (!userId) {
      throw new Error('JWT missing user identifier (sub, userId, or user_id)');
    }

    return {
      userId,
      username,
      permissions,
      metadata: decoded,
    };
  }

  async authenticateConnection(context: AuthContext): Promise<AuthResult> {
    try {
      // Try Authorization header first
      const authHeader = context.request.headers.authorization;
      if (authHeader) {
        const [scheme, token] = authHeader.split(' ');
        if (scheme === 'Bearer') {
          const user = await this.verifyToken(token);
          return { success: true, user };
        }
      }

      // Try query parameter
      const url = new URL(context.request.url, 'ws://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        const user = await this.verifyToken(token);
        return { success: true, user };
      }

      return { success: false, error: 'No JWT token found' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async authenticateCredentials(credentials: AuthMessage): Promise<AuthResult> {
    try {
      if (!credentials.token) {
        return { success: false, error: 'No token provided' };
      }

      const user = await this.verifyToken(credentials.token);
      return { success: true, user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async checkPermission(request: PermissionRequest): Promise<boolean> {
    // Check if user has the specific permission
    if (request.user.permissions.includes(request.operation)) {
      return true;
    }

    // Check for admin permission (grants everything)
    if (request.user.permissions.includes(PERMISSIONS.ADMIN)) {
      return true;
    }

    return false;
  }

  getAnonymousPermissions(): string[] {
    return []; // No anonymous access for JWT by default
  }
}

/**
 * Session-based authentication provider
 * Validates session cookies and looks up user context
 */
export class SessionAuthProvider implements AuthProvider {
  private sessionStore: Map<string, UserContext> = new Map();
  private cookieName: string;

  constructor(options: { cookieName?: string } = {}) {
    this.cookieName = options.cookieName || 'session';
  }

  /**
   * Add a session with user context
   */
  addSession(sessionId: string, user: UserContext): void {
    this.sessionStore.set(sessionId, user);
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): void {
    this.sessionStore.delete(sessionId);
  }

  private parseCookies(cookieHeader?: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });

    return cookies;
  }

  async authenticateConnection(context: AuthContext): Promise<AuthResult> {
    const cookies = this.parseCookies(context.request.headers.cookie);
    const sessionId = cookies[this.cookieName];

    if (!sessionId) {
      return { success: false, error: 'No session cookie found' };
    }

    const user = this.sessionStore.get(sessionId);
    if (!user) {
      return { success: false, error: 'Invalid session' };
    }

    return { success: true, user };
  }

  async checkPermission(request: PermissionRequest): Promise<boolean> {
    return request.user.permissions.includes(request.operation);
  }

  getAnonymousPermissions(): string[] {
    return []; // No anonymous access by default
  }
}

/**
 * Composite authentication provider
 * Tries multiple providers in order until one succeeds
 */
export class CompositeAuthProvider implements AuthProvider {
  private providers: AuthProvider[];

  constructor(providers: AuthProvider[]) {
    this.providers = providers;
  }

  async authenticateConnection(context: AuthContext): Promise<AuthResult> {
    for (const provider of this.providers) {
      if (provider.authenticateConnection) {
        const result = await provider.authenticateConnection(context);
        if (result.success) {
          return result;
        }
      }
    }
    return { success: false, error: 'Authentication failed with all providers' };
  }

  async authenticateCredentials(credentials: AuthMessage): Promise<AuthResult> {
    for (const provider of this.providers) {
      if (provider.authenticateCredentials) {
        const result = await provider.authenticateCredentials(credentials);
        if (result.success) {
          return result;
        }
      }
    }
    return { success: false, error: 'Authentication failed with all providers' };
  }

  async checkPermission(request: PermissionRequest): Promise<boolean> {
    // User must have been authenticated by one of the providers
    // Use the first provider that can check permissions
    for (const provider of this.providers) {
      try {
        return await provider.checkPermission(request);
      } catch (error) {
        continue;
      }
    }
    return false;
  }

  getAnonymousPermissions(): string[] {
    // Return the union of all anonymous permissions
    const allPermissions = this.providers
      .map(p => p.getAnonymousPermissions?.() || [])
      .flat();
    return [...new Set(allPermissions)];
  }

  async onDisconnect(user: UserContext): Promise<void> {
    // Call onDisconnect for all providers
    await Promise.all(
      this.providers.map(p => p.onDisconnect?.(user))
    );
  }
}