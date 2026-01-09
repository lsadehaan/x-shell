/**
 * Session manager for multiplexed terminal sessions.
 *
 * Responsibilities:
 * - Manage shared session lifecycle
 * - Track client connections per session
 * - Handle orphan session cleanup
 * - Maintain history buffers
 * - Broadcast messages to session clients
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import { CircularBuffer } from './circular-buffer.js';
import type {
  SessionType,
  SharedSessionInfo,
  SessionListFilter,
  TerminalOptions,
} from '../shared/types.js';

/**
 * Session manager configuration
 */
export interface SessionManagerConfig {
  /** Maximum clients per session (default: 10) */
  maxClientsPerSession?: number;
  /** Orphan timeout in ms before killing session (default: 60000) */
  orphanTimeout?: number;
  /** History buffer size in characters (default: 50000) */
  historySize?: number;
  /** Enable history by default (default: true) */
  historyEnabled?: boolean;
  /** Maximum total sessions (default: 100) */
  maxSessionsTotal?: number;
  /** Verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Client info for session management
 */
export interface ClientInfo {
  id: string;
  ws: WebSocket;
  joinedAt: Date;
  lastActivity: Date;
}

/**
 * Shared terminal session supporting multiple clients
 */
export interface SharedSession {
  id: string;
  type: SessionType;
  pty: any; // IPty from node-pty
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: Date;
  lastActivity: Date;

  // Docker-specific
  container?: string;

  // Multiplexing
  clients: Map<string, ClientInfo>;
  owner: string;
  label?: string;
  accepting: boolean;

  // History
  historyBuffer: CircularBuffer;
  historyEnabled: boolean;

  // Orphan handling
  orphanedAt: Date | null;
}

/**
 * Events emitted by SessionManager
 */
export interface SessionManagerEvents {
  sessionCreated: (session: SharedSession) => void;
  sessionClosed: (sessionId: string, reason: string) => void;
  clientJoined: (sessionId: string, clientId: string, clientCount: number) => void;
  clientLeft: (sessionId: string, clientId: string, clientCount: number) => void;
  sessionOrphaned: (sessionId: string) => void;
  error: (error: Error, context: string) => void;
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, SharedSession>();
  private clientToSessions = new Map<string, Set<string>>(); // clientId -> sessionIds
  private orphanTimers = new Map<string, NodeJS.Timeout>();
  private config: Required<SessionManagerConfig>;

  constructor(config: SessionManagerConfig = {}) {
    super();
    this.config = {
      maxClientsPerSession: config.maxClientsPerSession ?? 10,
      orphanTimeout: config.orphanTimeout ?? 60000,
      historySize: config.historySize ?? 50000,
      historyEnabled: config.historyEnabled ?? true,
      maxSessionsTotal: config.maxSessionsTotal ?? 100,
      verbose: config.verbose ?? false,
    };
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (this.config.verbose || level === 'error') {
      const prefix = `[SessionManager]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  // ==========================================================================
  // Session CRUD
  // ==========================================================================

  /**
   * Create a new shared session.
   */
  createSession(options: {
    id: string;
    type: SessionType;
    pty: any;
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
    ownerId: string;
    ownerWs: WebSocket;
    container?: string;
    label?: string;
    allowJoin?: boolean;
    enableHistory?: boolean;
  }): SharedSession {
    if (this.sessions.size >= this.config.maxSessionsTotal) {
      throw new Error('Maximum number of sessions reached');
    }

    const now = new Date();

    const session: SharedSession = {
      id: options.id,
      type: options.type,
      pty: options.pty,
      shell: options.shell,
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      createdAt: now,
      lastActivity: now,
      container: options.container,
      clients: new Map(),
      owner: options.ownerId,
      label: options.label,
      accepting: options.allowJoin !== false,
      historyBuffer: new CircularBuffer(this.config.historySize),
      historyEnabled: options.enableHistory !== false && this.config.historyEnabled,
      orphanedAt: null,
    };

    // Add owner as first client
    session.clients.set(options.ownerId, {
      id: options.ownerId,
      ws: options.ownerWs,
      joinedAt: now,
      lastActivity: now,
    });

    // Track client -> sessions mapping
    this.trackClientSession(options.ownerId, session.id);

    this.sessions.set(session.id, session);
    this.log(`Created session ${session.id} (type: ${session.type}, owner: ${options.ownerId})`);
    this.emit('sessionCreated', session);

    return session;
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): SharedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions, optionally filtered.
   */
  getSessions(filter?: SessionListFilter): SharedSession[] {
    let sessions = Array.from(this.sessions.values());

    if (filter) {
      if (filter.type) {
        sessions = sessions.filter((s) => s.type === filter.type);
      }
      if (filter.container) {
        sessions = sessions.filter((s) => s.container === filter.container);
      }
      if (filter.accepting !== undefined) {
        sessions = sessions.filter((s) => s.accepting === filter.accepting);
      }
    }

    return sessions;
  }

  /**
   * Close a session and clean up.
   */
  closeSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.log(`Closing session ${sessionId} (reason: ${reason})`);

    // Clear orphan timer if any
    this.clearOrphanTimer(sessionId);

    // Kill PTY
    try {
      session.pty.kill();
    } catch (e) {
      this.log(`Error killing PTY for session ${sessionId}: ${e}`, 'warn');
    }

    // Remove session from all client mappings
    for (const clientId of session.clients.keys()) {
      const clientSessions = this.clientToSessions.get(clientId);
      if (clientSessions) {
        clientSessions.delete(sessionId);
        if (clientSessions.size === 0) {
          this.clientToSessions.delete(clientId);
        }
      }
    }

    // Remove session
    this.sessions.delete(sessionId);
    this.emit('sessionClosed', sessionId, reason);
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session count.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  // ==========================================================================
  // Client Management
  // ==========================================================================

  /**
   * Add a client to a session.
   */
  addClient(sessionId: string, clientId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log(`Cannot add client to non-existent session ${sessionId}`, 'warn');
      return false;
    }

    if (!session.accepting) {
      this.log(`Session ${sessionId} is not accepting new clients`, 'warn');
      return false;
    }

    if (session.clients.size >= this.config.maxClientsPerSession) {
      this.log(`Session ${sessionId} is full`, 'warn');
      return false;
    }

    // If session was orphaned, clear the timer
    if (session.orphanedAt) {
      session.orphanedAt = null;
      this.clearOrphanTimer(sessionId);
      this.log(`Session ${sessionId} is no longer orphaned`);
    }

    const now = new Date();
    session.clients.set(clientId, {
      id: clientId,
      ws,
      joinedAt: now,
      lastActivity: now,
    });

    this.trackClientSession(clientId, sessionId);

    this.log(`Client ${clientId} joined session ${sessionId} (${session.clients.size} clients)`);
    this.emit('clientJoined', sessionId, clientId, session.clients.size);

    return true;
  }

  /**
   * Remove a client from a session.
   */
  removeClient(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!session.clients.has(clientId)) return;

    session.clients.delete(clientId);

    // Update client -> sessions mapping
    const clientSessions = this.clientToSessions.get(clientId);
    if (clientSessions) {
      clientSessions.delete(sessionId);
      if (clientSessions.size === 0) {
        this.clientToSessions.delete(clientId);
      }
    }

    this.log(`Client ${clientId} left session ${sessionId} (${session.clients.size} clients remaining)`);
    this.emit('clientLeft', sessionId, clientId, session.clients.size);

    // Check if session is now orphaned
    if (session.clients.size === 0) {
      this.handleOrphanedSession(session);
    }
  }

  /**
   * Remove a client from all sessions.
   */
  removeClientFromAllSessions(clientId: string): string[] {
    const clientSessions = this.clientToSessions.get(clientId);
    if (!clientSessions) return [];

    const sessionIds = Array.from(clientSessions);
    for (const sessionId of sessionIds) {
      this.removeClient(sessionId, clientId);
    }

    return sessionIds;
  }

  /**
   * Get all clients in a session.
   */
  getSessionClients(sessionId: string): ClientInfo[] {
    const session = this.sessions.get(sessionId);
    return session ? Array.from(session.clients.values()) : [];
  }

  /**
   * Get client count for a session.
   */
  getClientCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session ? session.clients.size : 0;
  }

  /**
   * Check if a client is in a session.
   */
  isClientInSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.clients.has(clientId) : false;
  }

  /**
   * Get all sessions a client is in.
   */
  getClientSessions(clientId: string): string[] {
    const clientSessions = this.clientToSessions.get(clientId);
    return clientSessions ? Array.from(clientSessions) : [];
  }

  private trackClientSession(clientId: string, sessionId: string): void {
    let clientSessions = this.clientToSessions.get(clientId);
    if (!clientSessions) {
      clientSessions = new Set();
      this.clientToSessions.set(clientId, clientSessions);
    }
    clientSessions.add(sessionId);
  }

  // ==========================================================================
  // Broadcasting
  // ==========================================================================

  /**
   * Broadcast a message to all clients in a session.
   */
  broadcastToSession(
    sessionId: string,
    message: object,
    excludeClientId?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const messageStr = JSON.stringify(message);

    for (const [clientId, client] of session.clients) {
      if (clientId === excludeClientId) continue;

      try {
        if (client.ws.readyState === 1) {
          // WebSocket.OPEN
          client.ws.send(messageStr);
        }
      } catch (e) {
        this.log(`Error broadcasting to client ${clientId}: ${e}`, 'warn');
      }
    }
  }

  /**
   * Send a message to a specific client in a session.
   */
  sendToClient(sessionId: string, clientId: string, message: object): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const client = session.clients.get(clientId);
    if (!client) return false;

    try {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
        return true;
      }
    } catch (e) {
      this.log(`Error sending to client ${clientId}: ${e}`, 'warn');
    }

    return false;
  }

  // ==========================================================================
  // History
  // ==========================================================================

  /**
   * Append data to a session's history buffer.
   */
  appendHistory(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.historyEnabled) {
      session.historyBuffer.append(data);
    }
  }

  /**
   * Get history from a session.
   */
  getHistory(sessionId: string, limit?: number): string {
    const session = this.sessions.get(sessionId);
    if (!session || !session.historyEnabled) return '';
    return session.historyBuffer.toString(limit);
  }

  /**
   * Clear history for a session.
   */
  clearHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.historyBuffer.clear();
    }
  }

  // ==========================================================================
  // Activity Tracking
  // ==========================================================================

  /**
   * Update last activity timestamp for a session.
   */
  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Update last activity for a client.
   */
  updateClientActivity(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      const client = session.clients.get(clientId);
      if (client) {
        client.lastActivity = new Date();
      }
    }
  }

  // ==========================================================================
  // Orphan Handling
  // ==========================================================================

  private handleOrphanedSession(session: SharedSession): void {
    session.orphanedAt = new Date();
    this.log(`Session ${session.id} is now orphaned, starting cleanup timer`);
    this.emit('sessionOrphaned', session.id);

    // Start orphan timer
    const timer = setTimeout(() => {
      // Check if still orphaned
      if (session.clients.size === 0) {
        this.log(`Orphan timeout for session ${session.id}, closing`);
        this.closeSession(session.id, 'orphan_timeout');
      }
    }, this.config.orphanTimeout);

    this.orphanTimers.set(session.id, timer);
  }

  private clearOrphanTimer(sessionId: string): void {
    const timer = this.orphanTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.orphanTimers.delete(sessionId);
    }
  }

  // ==========================================================================
  // Session Info
  // ==========================================================================

  /**
   * Convert a session to SharedSessionInfo for client consumption.
   */
  toSharedSessionInfo(session: SharedSession): SharedSessionInfo {
    return {
      sessionId: session.id,
      type: session.type,
      shell: session.shell,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      createdAt: session.createdAt,
      container: session.container,
      clientCount: session.clients.size,
      accepting: session.accepting,
      ownerId: session.owner,
      label: session.label,
      historyEnabled: session.historyEnabled,
    };
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up all sessions and resources.
   */
  cleanup(): void {
    this.log('Cleaning up all sessions');

    // Clear all orphan timers
    for (const timer of this.orphanTimers.values()) {
      clearTimeout(timer);
    }
    this.orphanTimers.clear();

    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId, 'cleanup');
    }

    this.clientToSessions.clear();
  }

  /**
   * Get manager statistics.
   */
  getStats(): {
    sessionCount: number;
    clientCount: number;
    orphanedCount: number;
  } {
    let orphanedCount = 0;
    for (const session of this.sessions.values()) {
      if (session.orphanedAt) orphanedCount++;
    }

    return {
      sessionCount: this.sessions.size,
      clientCount: this.clientToSessions.size,
      orphanedCount,
    };
  }
}
