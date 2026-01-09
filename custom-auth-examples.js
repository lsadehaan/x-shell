/**
 * Additional Custom Authentication Provider Examples for x-shell.js
 *
 * This file demonstrates how to create custom authentication providers
 * for various authentication scenarios not covered by the built-in providers.
 */

import { PERMISSIONS } from './dist/server/index.js';

/**
 * OAuth2/OpenID Connect Authentication Provider
 * Validates OAuth2 access tokens from external providers (Google, GitHub, etc.)
 */
export class OAuth2AuthProvider {
  constructor(config) {
    this.tokenValidationUrl = config.tokenValidationUrl; // e.g., https://oauth2.googleapis.com/tokeninfo
    this.clientId = config.clientId;
    this.permissionMapping = config.permissionMapping || {};
  }

  async authenticateConnection(context) {
    // Check for Bearer token in Authorization header
    const authHeader = context.request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return { success: false, error: 'Missing or invalid Authorization header' };
    }

    const token = authHeader.substring(7);
    return await this.validateOAuth2Token(token);
  }

  async authenticateCredentials(message) {
    if (!message.token) {
      return { success: false, error: 'Missing token in auth message' };
    }
    return await this.validateOAuth2Token(message.token);
  }

  async validateOAuth2Token(token) {
    try {
      // Validate token with OAuth2 provider
      const response = await fetch(`${this.tokenValidationUrl}?access_token=${token}`);
      if (!response.ok) {
        return { success: false, error: 'Invalid OAuth2 token' };
      }

      const tokenInfo = await response.json();

      // Check if token is for our app
      if (tokenInfo.aud !== this.clientId) {
        return { success: false, error: 'Token audience mismatch' };
      }

      // Extract user info
      const user = {
        userId: tokenInfo.sub || tokenInfo.user_id,
        username: tokenInfo.email || tokenInfo.name,
        permissions: this.mapPermissions(tokenInfo),
        metadata: {
          email: tokenInfo.email,
          scope: tokenInfo.scope,
          expires_in: tokenInfo.exp
        }
      };

      return { success: true, user };
    } catch (error) {
      return { success: false, error: `OAuth2 validation failed: ${error.message}` };
    }
  }

  mapPermissions(tokenInfo) {
    const scopes = tokenInfo.scope?.split(' ') || [];
    const permissions = [];

    // Map OAuth2 scopes to x-shell permissions
    if (scopes.includes('admin')) {
      return Object.values(PERMISSIONS);
    }
    if (scopes.includes('terminal:spawn')) {
      permissions.push(PERMISSIONS.SPAWN_SESSION);
    }
    if (scopes.includes('terminal:join')) {
      permissions.push(PERMISSIONS.JOIN_SESSION);
    }
    if (scopes.includes('terminal:write')) {
      permissions.push(PERMISSIONS.WRITE_SESSION);
    }
    if (scopes.includes('docker:exec')) {
      permissions.push(PERMISSIONS.DOCKER_EXEC);
    }

    return permissions;
  }

  async checkPermission(request) {
    return request.user.permissions.includes(request.operation) ||
           request.user.permissions.includes(PERMISSIONS.ADMIN);
  }

  getAnonymousPermissions() {
    return []; // No anonymous permissions for OAuth2
  }
}

/**
 * API Key Authentication Provider
 * Uses long-lived API keys with optional rate limiting
 */
export class ApiKeyAuthProvider {
  constructor(config = {}) {
    this.apiKeys = new Map(); // keyId -> { userId, permissions, rateLimit }
    this.rateLimitWindowMs = config.rateLimitWindowMs || 60000; // 1 minute
    this.requestCounts = new Map(); // keyId -> { count, windowStart }
  }

  addApiKey(keyId, userId, username, permissions, rateLimit = null) {
    this.apiKeys.set(keyId, {
      userId,
      username,
      permissions,
      rateLimit, // requests per window, null = no limit
      createdAt: new Date()
    });
  }

  revokeApiKey(keyId) {
    this.apiKeys.delete(keyId);
    this.requestCounts.delete(keyId);
  }

  async authenticateConnection(context) {
    // Check for API key in header or query parameter
    const apiKey = context.request.headers['x-api-key'] ||
                  context.request.url?.searchParams.get('api_key');

    if (!apiKey) {
      return { success: false, error: 'Missing API key' };
    }

    return this.validateApiKey(apiKey);
  }

  async authenticateCredentials(message) {
    if (!message.apiKey) {
      return { success: false, error: 'Missing apiKey in auth message' };
    }
    return this.validateApiKey(message.apiKey);
  }

  validateApiKey(keyId) {
    const keyInfo = this.apiKeys.get(keyId);
    if (!keyInfo) {
      return { success: false, error: 'Invalid API key' };
    }

    // Check rate limit
    if (keyInfo.rateLimit && !this.checkRateLimit(keyId, keyInfo.rateLimit)) {
      return { success: false, error: 'Rate limit exceeded' };
    }

    const user = {
      userId: keyInfo.userId,
      username: keyInfo.username,
      permissions: keyInfo.permissions,
      metadata: {
        apiKeyId: keyId,
        createdAt: keyInfo.createdAt
      }
    };

    return { success: true, user };
  }

  checkRateLimit(keyId, limit) {
    const now = Date.now();
    const currentCount = this.requestCounts.get(keyId);

    if (!currentCount) {
      this.requestCounts.set(keyId, { count: 1, windowStart: now });
      return true;
    }

    // Reset window if needed
    if (now - currentCount.windowStart >= this.rateLimitWindowMs) {
      this.requestCounts.set(keyId, { count: 1, windowStart: now });
      return true;
    }

    // Check if under limit
    if (currentCount.count < limit) {
      currentCount.count++;
      return true;
    }

    return false; // Rate limit exceeded
  }

  async checkPermission(request) {
    return request.user.permissions.includes(request.operation) ||
           request.user.permissions.includes(PERMISSIONS.ADMIN);
  }

  getAnonymousPermissions() {
    return []; // No anonymous permissions for API keys
  }
}

/**
 * LDAP/Active Directory Authentication Provider
 * Integrates with LDAP servers for enterprise authentication
 */
export class LDAPAuthProvider {
  constructor(config) {
    this.ldapUrl = config.ldapUrl; // ldap://ldap.company.com
    this.baseDN = config.baseDN; // dc=company,dc=com
    this.userFilter = config.userFilter || '(uid={username})';
    this.groupMapping = config.groupMapping || {}; // LDAP group -> permissions
  }

  async authenticateCredentials(message) {
    if (!message.username || !message.password) {
      return { success: false, error: 'Missing username or password' };
    }

    try {
      // This would integrate with an LDAP client library like 'ldapjs'
      // const user = await this.ldapBind(message.username, message.password);

      // Simulated LDAP response for example
      const user = await this.simulateLDAPAuth(message.username, message.password);
      return { success: true, user };
    } catch (error) {
      return { success: false, error: `LDAP authentication failed: ${error.message}` };
    }
  }

  async simulateLDAPAuth(username, password) {
    // Simulate LDAP authentication (replace with real LDAP client)
    if (username === 'ldapuser' && password === 'ldappass') {
      return {
        userId: username,
        username: 'LDAP User',
        permissions: [
          PERMISSIONS.SPAWN_SESSION,
          PERMISSIONS.JOIN_SESSION,
          PERMISSIONS.WRITE_SESSION
        ],
        metadata: {
          ldapDN: `uid=${username},ou=users,${this.baseDN}`,
          groups: ['developers', 'terminal-users']
        }
      };
    }
    throw new Error('Invalid credentials');
  }

  async checkPermission(request) {
    return request.user.permissions.includes(request.operation) ||
           request.user.permissions.includes(PERMISSIONS.ADMIN);
  }

  getAnonymousPermissions() {
    return []; // No anonymous permissions for LDAP
  }
}

/**
 * Multi-Factor Authentication Provider
 * Wraps another provider and adds TOTP/SMS verification
 */
export class MFAAuthProvider {
  constructor(baseProvider, mfaConfig) {
    this.baseProvider = baseProvider;
    this.requireMFA = mfaConfig.require || false;
    this.totpSecret = mfaConfig.totpSecret;
    this.mfaVerifiedSessions = new Set();
  }

  async authenticateConnection(context) {
    return this.baseProvider.authenticateConnection?.(context) ||
           { success: false, error: 'Base provider does not support connection auth' };
  }

  async authenticateCredentials(message) {
    // First, authenticate with base provider
    const baseResult = await this.baseProvider.authenticateCredentials(message);
    if (!baseResult.success) {
      return baseResult;
    }

    // Check if MFA is required and not yet verified
    if (this.requireMFA && !this.isMFAVerified(baseResult.user.userId)) {
      if (!message.mfaCode) {
        return {
          success: false,
          error: 'MFA code required',
          requireMFA: true,
          user: baseResult.user
        };
      }

      // Verify MFA code
      if (!this.verifyTOTP(message.mfaCode)) {
        return { success: false, error: 'Invalid MFA code' };
      }

      // Mark session as MFA verified
      this.markMFAVerified(baseResult.user.userId);
    }

    return baseResult;
  }

  verifyTOTP(code) {
    // Simplified TOTP verification (would use a library like 'otplib' in real implementation)
    return code === '123456'; // Simulated valid code
  }

  isMFAVerified(userId) {
    return this.mfaVerifiedSessions.has(userId);
  }

  markMFAVerified(userId) {
    this.mfaVerifiedSessions.add(userId);
    // In real implementation, you'd want to expire this after some time
  }

  async checkPermission(request) {
    return this.baseProvider.checkPermission(request);
  }

  getAnonymousPermissions() {
    return this.baseProvider.getAnonymousPermissions?.() || [];
  }

  async onDisconnect(user) {
    // Clean up MFA verification on disconnect
    this.mfaVerifiedSessions.delete(user.userId);
    return this.baseProvider.onDisconnect?.(user);
  }
}

// Example usage:
export function createAuthExamples() {
  console.log('🔐 Custom Authentication Provider Examples');
  console.log('');
  console.log('1. OAuth2/OpenID Connect Provider');
  console.log('2. API Key Provider with Rate Limiting');
  console.log('3. LDAP/Active Directory Provider');
  console.log('4. Multi-Factor Authentication Wrapper');
  console.log('');
  console.log('See custom-auth-examples.js for implementation details.');

  // Example instantiation
  const oauth2Provider = new OAuth2AuthProvider({
    tokenValidationUrl: 'https://oauth2.googleapis.com/tokeninfo',
    clientId: 'your-google-client-id.googleusercontent.com'
  });

  const apiKeyProvider = new ApiKeyAuthProvider({
    rateLimitWindowMs: 60000 // 1 minute windows
  });

  // Add some API keys
  apiKeyProvider.addApiKey('dev-key-123', 'dev1', 'Developer 1', [
    PERMISSIONS.SPAWN_SESSION,
    PERMISSIONS.JOIN_SESSION,
    PERMISSIONS.WRITE_SESSION
  ], 100); // 100 requests per minute

  apiKeyProvider.addApiKey('admin-key-456', 'admin1', 'Admin User',
    Object.values(PERMISSIONS), 1000); // 1000 requests per minute

  const ldapProvider = new LDAPAuthProvider({
    ldapUrl: 'ldap://ldap.company.com',
    baseDN: 'dc=company,dc=com'
  });

  return {
    oauth2Provider,
    apiKeyProvider,
    ldapProvider
  };
}