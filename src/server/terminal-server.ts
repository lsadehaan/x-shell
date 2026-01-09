/**
 * Server-side terminal handler using node-pty
 *
 * Manages PTY sessions and WebSocket connections for web-based terminals.
 * Supports session multiplexing - multiple clients can connect to the same session.
 */

import { WebSocket, WebSocketServer } from 'ws';
import * as path from 'path';
import * as os from 'os';
import type { Server as HttpServer } from 'http';
import type {
  ServerConfig,
  TerminalOptions,
  TerminalMessage,
  SessionInfo,
  ContainerInfo,
  ServerInfo,
  SessionType,
  SharedSessionInfo,
  SessionListFilter,
  JoinSessionOptions,
  AuthProvider,
  UserContext,
  AuthContext,
  PermissionRequest,
} from '../shared/types.js';
import { exec } from 'child_process';
import { SessionManager, SessionManagerConfig, SharedSession } from './session-manager.js';

/**
 * Get platform default shell
 */
function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Terminal server options
 */
export interface TerminalServerOptions extends ServerConfig {
  /** HTTP server to attach to (for upgrade handling) */
  server?: HttpServer;
  /** WebSocket path (default: '/terminal') */
  path?: string;
  /** Port for standalone WebSocket server */
  port?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Path to Docker CLI (default: 'docker') */
  dockerPath?: string;

  // Session multiplexing options
  /** Maximum clients per session (default: 10) */
  maxClientsPerSession?: number;
  /** Orphan session timeout in ms (default: 60000) */
  orphanTimeout?: number;
  /** History buffer size in characters (default: 50000) */
  historySize?: number;
  /** Enable session history (default: true) */
  historyEnabled?: boolean;
  /** Maximum total sessions (default: 100) */
  maxSessionsTotal?: number;
}

/**
 * Terminal server class with session multiplexing support
 */
export class TerminalServer {
  private config: Required<Omit<TerminalServerOptions, 'server' | 'port'>>;
  private sessionManager: SessionManager;
  private wss: WebSocketServer | null = null;
  private pty: any = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private clientIds = new WeakMap<WebSocket, string>();

  // Authentication state
  private authProvider: AuthProvider | null = null;
  private clientUsers = new Map<string, UserContext>(); // clientId -> UserContext
  private authPendingClients = new Set<string>(); // Clients waiting for auth

  constructor(options: TerminalServerOptions = {}) {
    this.config = {
      allowedShells: options.allowedShells || [getDefaultShell()],
      allowedPaths: options.allowedPaths || [os.homedir()],
      defaultShell: options.defaultShell || getDefaultShell(),
      defaultCwd: options.defaultCwd || os.homedir(),
      maxSessionsPerClient: options.maxSessionsPerClient || 5,
      idleTimeout: options.idleTimeout || 30 * 60 * 1000, // 30 minutes
      path: options.path || '/terminal',
      verbose: options.verbose || false,
      // Docker options
      allowDockerExec: options.allowDockerExec || false,
      allowedContainerPatterns: options.allowedContainerPatterns || [],
      defaultContainerShell: options.defaultContainerShell || '/bin/bash',
      dockerPath: options.dockerPath || 'docker',
      // Multiplexing options
      maxClientsPerSession: options.maxClientsPerSession || 10,
      orphanTimeout: options.orphanTimeout || 60000,
      historySize: options.historySize || 50000,
      historyEnabled: options.historyEnabled ?? true,
      maxSessionsTotal: options.maxSessionsTotal || 100,
      // Authentication options (add defaults)
      requireAuth: options.requireAuth ?? false,
      allowAnonymous: options.allowAnonymous ?? true,
    };

    // Set up authentication
    this.authProvider = options.authProvider || null;

    // Initialize session manager
    this.sessionManager = new SessionManager({
      maxClientsPerSession: this.config.maxClientsPerSession,
      orphanTimeout: this.config.orphanTimeout,
      historySize: this.config.historySize,
      historyEnabled: this.config.historyEnabled,
      maxSessionsTotal: this.config.maxSessionsTotal,
      verbose: this.config.verbose,
    });

    // Handle session manager events
    this.sessionManager.on('sessionClosed', (sessionId: string, reason: string) => {
      this.log(`Session ${sessionId} closed: ${reason}`);
    });

    // Start cleanup interval for idle sessions
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get or create client ID for a WebSocket
   */
  private getClientId(ws: WebSocket): string {
    let clientId = this.clientIds.get(ws);
    if (!clientId) {
      clientId = this.generateClientId();
      this.clientIds.set(ws, clientId);
    }
    return clientId;
  }

  /**
   * Initialize node-pty (lazy load)
   */
  private async initPty(): Promise<void> {
    if (this.pty) return;

    try {
      // @ts-ignore - node-pty is a peer dependency
      this.pty = await import('node-pty');
    } catch (error) {
      throw new Error(
        'node-pty is required for x-shell. Install it with: npm install node-pty'
      );
    }
  }

  /**
   * Attach to an existing HTTP server
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      path: this.config.path,
    });

    this.setupWebSocketServer();
    this.log(`Terminal WebSocket server listening on ${this.config.path}`);
  }

  /**
   * Start standalone WebSocket server
   */
  listen(port: number): void {
    this.wss = new WebSocketServer({ port });
    this.setupWebSocketServer();
    this.log(`Terminal WebSocket server listening on port ${port}`);
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', async (ws, req) => {
      this.log(`Client connected from ${req.socket.remoteAddress}`);
      await this.handleConnection(ws, req);
    });
  }

  /**
   * Handle WebSocket connection
   * Can be called directly for manual WebSocket upgrade handling
   */
  async handleConnection(ws: WebSocket, req: any): Promise<void> {
    // Generate client ID
    const clientId = this.getClientId(ws);
    this.log(`Assigned client ID: ${clientId}`);

    // Load node-pty
    try {
      await this.initPty();
    } catch (error) {
      this.sendError(ws, (error as Error).message);
      ws.close();
      return;
    }

    // Try authentication if provider is configured
    let user: UserContext | null = null;
    if (this.authProvider) {
      try {
        user = await this.authenticateConnection(ws, req);
        if (!user && this.config.requireAuth) {
          // Auth required but failed, wait for auth message
          this.authPendingClients.add(clientId);
          this.log(`Client ${clientId} pending authentication`);
        }
      } catch (error) {
        if (this.config.requireAuth) {
          this.sendAuthResponse(ws, false, (error as Error).message);
          ws.close();
          return;
        }
        this.log(`Authentication failed for ${clientId}: ${(error as Error).message}`);
      }
    } else if (this.config.requireAuth) {
      // Auth required but no provider
      this.sendError(ws, 'Authentication is required but no provider configured');
      ws.close();
      return;
    }

    // Store user context if authenticated
    if (user) {
      this.clientUsers.set(clientId, user);
      this.log(`Client ${clientId} authenticated as ${user.username || user.userId}`);
    } else if (!this.config.allowAnonymous && this.authProvider) {
      // Anonymous not allowed
      this.sendAuthResponse(ws, false, 'Anonymous access not permitted');
      ws.close();
      return;
    }

    // Send server info to client (includes auth status)
    this.sendServerInfo(ws, user);

    // Handle messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as TerminalMessage;
        await this.handleMessage(ws, clientId, message);
      } catch (error) {
        this.log(`Invalid message: ${error}`, 'error');
      }
    });

    ws.on('close', () => {
      this.log(`Client ${clientId} disconnected`);

      // Clean up auth state
      this.authPendingClients.delete(clientId);
      const user = this.clientUsers.get(clientId);
      this.clientUsers.delete(clientId);

      // Call auth provider disconnect handler
      if (user && this.authProvider?.onDisconnect) {
        this.authProvider.onDisconnect(user).catch(err => {
          this.log(`Auth provider disconnect handler error: ${err.message}`, 'error');
        });
      }

      // Remove client from all sessions (sessions may survive if other clients connected)
      const affectedSessions = this.sessionManager.removeClientFromAllSessions(clientId);
      if (affectedSessions.length > 0) {
        this.log(`Removed client from sessions: ${affectedSessions.join(', ')}`);
      }
    });

    ws.on('error', (error) => {
      this.log(`WebSocket error for client ${clientId}: ${error.message}`, 'error');
    });
  }

  /**
   * Handle message from client
   */
  private async handleMessage(ws: WebSocket, clientId: string, message: TerminalMessage): Promise<void> {
    // Handle authentication message first
    if (message.type === 'auth') {
      await this.handleAuthMessage(ws, clientId, message as any);
      return;
    }

    // Check if client needs authentication
    if (this.authPendingClients.has(clientId)) {
      this.sendAuthResponse(ws, false, 'Authentication required before other operations');
      return;
    }

    // Check authorization for all other operations (except auth)
    if (!(await this.checkPermission(clientId, message))) {
      return; // checkPermission sends the permission denied message
    }

    switch (message.type) {
      case 'spawn':
        this.spawnSession(ws, clientId, message.options || {});
        break;

      case 'data':
        if (message.sessionId) {
          this.writeToSession(message.sessionId, clientId, message.data);
        }
        break;

      case 'resize':
        if (message.sessionId) {
          this.resizeSession(message.sessionId, message.cols, message.rows);
        }
        break;

      case 'close':
        if (message.sessionId) {
          this.closeSession(message.sessionId, clientId);
        }
        break;

      case 'listContainers':
        this.listContainers(ws);
        break;

      // Session multiplexing messages
      case 'listSessions':
        this.handleListSessions(ws, (message as any).filter);
        break;

      case 'join':
        this.handleJoinSession(ws, clientId, (message as any).options);
        break;

      case 'leave':
        this.handleLeaveSession(ws, clientId, message.sessionId!);
        break;

      default:
        this.log(`Unknown message type: ${(message as any).type}`, 'warn');
    }
  }

  // ===========================================================================
  // Session Multiplexing Handlers
  // ===========================================================================

  /**
   * Handle list sessions request
   */
  private handleListSessions(ws: WebSocket, filter?: SessionListFilter): void {
    const sessions = this.sessionManager.getSessions(filter);
    const sessionInfos: SharedSessionInfo[] = sessions.map((s) =>
      this.sessionManager.toSharedSessionInfo(s)
    );

    ws.send(
      JSON.stringify({
        type: 'sessionList',
        sessions: sessionInfos,
      })
    );
  }

  /**
   * Handle join session request
   */
  private handleJoinSession(
    ws: WebSocket,
    clientId: string,
    options: JoinSessionOptions
  ): void {
    const session = this.sessionManager.getSession(options.sessionId);

    if (!session) {
      this.sendError(ws, `Session not found: ${options.sessionId}`);
      return;
    }

    if (!session.accepting) {
      this.sendError(ws, `Session is not accepting new clients`);
      return;
    }

    // Add client to session
    const success = this.sessionManager.addClient(options.sessionId, clientId, ws);
    if (!success) {
      this.sendError(ws, `Failed to join session: ${options.sessionId}`);
      return;
    }

    // Get history if requested
    let history: string | undefined;
    if (options.requestHistory && session.historyEnabled) {
      history = this.sessionManager.getHistory(
        options.sessionId,
        options.historyLimit
      );
    }

    // Send joined response
    ws.send(
      JSON.stringify({
        type: 'joined',
        sessionId: options.sessionId,
        session: this.sessionManager.toSharedSessionInfo(session),
        history,
      })
    );

    // Broadcast to other clients
    this.sessionManager.broadcastToSession(
      options.sessionId,
      {
        type: 'clientJoined',
        sessionId: options.sessionId,
        clientCount: session.clients.size,
      },
      clientId
    );

    // Send a newline to trigger a fresh prompt for the joining client
    // This ensures the prompt is visible immediately after joining
    if (session.pty) {
      session.pty.write('\n');
    }

    this.log(`Client ${clientId} joined session ${options.sessionId}`);
  }

  /**
   * Handle leave session request
   */
  private handleLeaveSession(
    ws: WebSocket,
    clientId: string,
    sessionId: string
  ): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      this.sendError(ws, `Session not found: ${sessionId}`);
      return;
    }

    // Remove client from session
    this.sessionManager.removeClient(sessionId, clientId);

    // Send left response
    ws.send(
      JSON.stringify({
        type: 'left',
        sessionId,
      })
    );

    // Broadcast to remaining clients
    if (this.sessionManager.hasSession(sessionId)) {
      const updatedSession = this.sessionManager.getSession(sessionId)!;
      this.sessionManager.broadcastToSession(sessionId, {
        type: 'clientLeft',
        sessionId,
        clientCount: updatedSession.clients.size,
      });
    }

    this.log(`Client ${clientId} left session ${sessionId}`);
  }

  // ===========================================================================
  // Validation Methods
  // ===========================================================================

  /**
   * Validate shell path
   */
  private isShellAllowed(shell: string): boolean {
    if (this.config.allowedShells.length === 0) return true;

    const normalizedShell = path.normalize(shell);
    const shellBasename = path.basename(normalizedShell).toLowerCase();

    return this.config.allowedShells.some((allowedShell) => {
      const normalizedAllowed = path.normalize(allowedShell);
      const allowedBasename = path.basename(normalizedAllowed).toLowerCase();
      return (
        normalizedShell === normalizedAllowed ||
        shellBasename === allowedBasename
      );
    });
  }

  /**
   * Validate working directory
   */
  private isCwdAllowed(cwd: string): boolean {
    if (this.config.allowedPaths.length === 0) return true;

    const normalizedCwd = path.normalize(path.resolve(cwd));
    return this.config.allowedPaths.some((allowedPath) =>
      normalizedCwd.startsWith(path.normalize(path.resolve(allowedPath)))
    );
  }

  /**
   * Validate container name/ID against allowed patterns
   */
  private isContainerAllowed(container: string): boolean {
    // Docker exec must be enabled
    if (!this.config.allowDockerExec) return false;

    // If no patterns specified, all containers allowed (when Docker exec is enabled)
    if (this.config.allowedContainerPatterns.length === 0) return true;

    // Check against allowed patterns
    return this.config.allowedContainerPatterns.some((pattern) => {
      try {
        const regex = new RegExp(pattern);
        return regex.test(container);
      } catch {
        // If pattern is invalid regex, treat as literal string match
        return container === pattern || container.startsWith(pattern);
      }
    });
  }

  // ===========================================================================
  // Session Spawning
  // ===========================================================================

  /**
   * Spawn a Docker exec session
   */
  private spawnDockerExecSession(
    ws: WebSocket,
    clientId: string,
    options: TerminalOptions,
    sessionId: string
  ): SharedSession | null {
    const container = options.container!;
    const shell = options.containerShell || this.config.defaultContainerShell;
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Build docker exec args
    const args = ['exec', '-it'];

    // Add user if specified
    if (options.containerUser) {
      args.push('-u', options.containerUser);
    }

    // Add working directory if specified
    if (options.containerCwd) {
      args.push('-w', options.containerCwd);
    }

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add container and shell
    args.push(container, shell);

    this.log(`Spawning Docker exec: ${this.config.dockerPath} ${args.join(' ')}`);

    try {
      // Spawn PTY with docker exec
      const ptyProcess = this.pty.spawn(this.config.dockerPath, args, {
        name: 'xterm-256color',
        cols,
        rows,
        env: process.env,
      });

      // Create session via SessionManager
      const session = this.sessionManager.createSession({
        id: sessionId,
        type: 'docker-exec',
        pty: ptyProcess,
        shell,
        cwd: options.containerCwd || '/',
        cols,
        rows,
        ownerId: clientId,
        ownerWs: ws,
        container,
        label: options.label,
        allowJoin: options.allowJoin,
        enableHistory: options.enableHistory,
      });

      return session;
    } catch (error) {
      this.log(`Failed to spawn Docker exec: ${error}`, 'error');
      this.sendError(
        ws,
        `Failed to exec into container: ${(error as Error).message}`,
        sessionId
      );
      return null;
    }
  }

  /**
   * Spawn a Docker attach session (connects to container's main process)
   */
  private spawnDockerAttachSession(
    ws: WebSocket,
    clientId: string,
    options: TerminalOptions,
    sessionId: string
  ): SharedSession | null {
    const container = options.container!;
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Build docker attach args
    // --sig-proxy=false prevents signals from being proxied to the container
    // --detach-keys allows detaching without killing the session
    const args = [
      'attach',
      '--sig-proxy=false',
      '--detach-keys=ctrl-p,ctrl-q',
      container,
    ];

    this.log(`Spawning Docker attach: ${this.config.dockerPath} ${args.join(' ')}`);

    try {
      // Spawn PTY with docker attach
      const ptyProcess = this.pty.spawn(this.config.dockerPath, args, {
        name: 'xterm-256color',
        cols,
        rows,
        env: process.env,
      });

      // Create session via SessionManager
      const session = this.sessionManager.createSession({
        id: sessionId,
        type: 'docker-attach',
        pty: ptyProcess,
        shell: 'attach',
        cwd: '/',
        cols,
        rows,
        ownerId: clientId,
        ownerWs: ws,
        container,
        label: options.label,
        allowJoin: options.allowJoin,
        enableHistory: options.enableHistory,
      });

      return session;
    } catch (error) {
      this.log(`Failed to spawn Docker attach: ${error}`, 'error');
      this.sendError(
        ws,
        `Failed to attach to container: ${(error as Error).message}`,
        sessionId
      );
      return null;
    }
  }

  /**
   * Spawn a new terminal session
   */
  private spawnSession(
    ws: WebSocket,
    clientId: string,
    options: TerminalOptions
  ): void {
    // Check client session limit
    const clientSessions = this.sessionManager.getClientSessions(clientId);
    if (clientSessions.length >= this.config.maxSessionsPerClient) {
      this.sendError(
        ws,
        `Maximum sessions (${this.config.maxSessionsPerClient}) reached`
      );
      return;
    }

    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check if this is a Docker request
    if (options.container) {
      // Validate container access
      if (!this.isContainerAllowed(options.container)) {
        this.sendError(
          ws,
          `Container access not allowed: ${options.container}. Docker exec ${this.config.allowDockerExec ? 'is enabled but container pattern not matched' : 'is disabled'}.`
        );
        return;
      }

      let session: SharedSession | null;

      // Check if attach mode requested
      if (options.attachMode) {
        session = this.spawnDockerAttachSession(ws, clientId, options, sessionId);
      } else {
        session = this.spawnDockerExecSession(ws, clientId, options, sessionId);
      }

      if (!session) return;

      this.setupSessionHandlers(session);

      // Notify client
      ws.send(
        JSON.stringify({
          type: 'spawned',
          sessionId,
          shell: session.shell,
          cwd: session.cwd,
          cols: session.cols,
          rows: session.rows,
          container: session.container,
        })
      );

      this.log(
        `Docker ${options.attachMode ? 'attach' : 'exec'} session spawned: ${sessionId} (container: ${session.container})`
      );
      return;
    }

    // Regular local shell session
    const shell = options.shell || this.config.defaultShell;
    const cwd = options.cwd || this.config.defaultCwd;
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const env = options.env || {};

    // Validate shell
    if (!this.isShellAllowed(shell)) {
      this.sendError(
        ws,
        `Shell not allowed: ${shell}. Allowed: ${this.config.allowedShells.join(', ')}`
      );
      return;
    }

    // Validate cwd
    if (!this.isCwdAllowed(cwd)) {
      this.sendError(ws, `Working directory not allowed: ${cwd}`);
      return;
    }

    try {
      // Spawn PTY
      const ptyProcess = this.pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, ...env },
      });

      // Create session via SessionManager
      const session = this.sessionManager.createSession({
        id: sessionId,
        type: 'local',
        pty: ptyProcess,
        shell,
        cwd,
        cols,
        rows,
        ownerId: clientId,
        ownerWs: ws,
        label: options.label,
        allowJoin: options.allowJoin,
        enableHistory: options.enableHistory,
      });

      this.setupSessionHandlers(session);

      // Notify client
      ws.send(
        JSON.stringify({
          type: 'spawned',
          sessionId,
          shell,
          cwd,
          cols,
          rows,
        })
      );

      this.log(`Session spawned: ${sessionId} (shell: ${shell}, cwd: ${cwd})`);
    } catch (error) {
      this.log(`Failed to spawn session: ${error}`, 'error');
      this.sendError(ws, (error as Error).message);
    }
  }

  /**
   * Setup PTY event handlers for a session
   */
  private setupSessionHandlers(session: SharedSession): void {
    const sessionId = session.id;

    // Handle PTY output
    session.pty.onData((data: string) => {
      // Update activity
      this.sessionManager.updateSessionActivity(sessionId);

      // Store in history buffer
      this.sessionManager.appendHistory(sessionId, data);

      // Broadcast to all connected clients
      this.sessionManager.broadcastToSession(sessionId, {
        type: 'data',
        sessionId,
        data,
      });
    });

    // Handle PTY exit
    session.pty.onExit(({ exitCode }: { exitCode: number }) => {
      // Broadcast exit to all clients
      this.sessionManager.broadcastToSession(sessionId, {
        type: 'exit',
        sessionId,
        exitCode,
      });

      // Also broadcast session closed
      this.sessionManager.broadcastToSession(sessionId, {
        type: 'sessionClosed',
        sessionId,
        reason: 'process_exit',
      });

      // Close the session
      this.sessionManager.closeSession(sessionId, 'process_exit');
      this.log(`Session exited: ${sessionId} (code: ${exitCode})`);
    });
  }

  /**
   * Write data to session
   */
  private writeToSession(sessionId: string, clientId: string, data: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      this.log(`Session not found: ${sessionId}`, 'warn');
      return;
    }

    // Verify client is in session
    if (!this.sessionManager.isClientInSession(sessionId, clientId)) {
      this.log(`Client ${clientId} not in session ${sessionId}`, 'warn');
      return;
    }

    this.sessionManager.updateClientActivity(sessionId, clientId);
    session.pty.write(data);
  }

  /**
   * Resize session
   */
  private resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      this.log(`Session not found: ${sessionId}`, 'warn');
      return;
    }

    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
  }

  /**
   * Close session (only owner can close, or force close)
   */
  private closeSession(sessionId: string, clientId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    // Check if client is the owner
    if (session.owner !== clientId) {
      this.log(`Client ${clientId} attempted to close session owned by ${session.owner}`, 'warn');
      // Just remove the client from the session instead
      this.sessionManager.removeClient(sessionId, clientId);
      return;
    }

    // Broadcast session closed to all clients
    this.sessionManager.broadcastToSession(sessionId, {
      type: 'sessionClosed',
      sessionId,
      reason: 'owner_closed',
    });

    // Close the session
    this.sessionManager.closeSession(sessionId, 'owner_closed');
    this.log(`Session closed by owner: ${sessionId}`);
  }

  /**
   * Clean up inactive sessions
   */
  private cleanupSessions(): void {
    if (this.config.idleTimeout === 0) return;

    const now = Date.now();
    for (const session of this.sessionManager.getSessions()) {
      const idleTime = now - session.lastActivity.getTime();
      if (idleTime > this.config.idleTimeout) {
        this.log(`Closing inactive session: ${session.id}`);

        // Broadcast to all clients
        this.sessionManager.broadcastToSession(session.id, {
          type: 'exit',
          sessionId: session.id,
          exitCode: -1,
        });

        this.sessionManager.closeSession(session.id, 'idle_timeout');
      }
    }
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, error: string, sessionId?: string): void {
    ws.send(
      JSON.stringify({
        type: 'error',
        sessionId,
        error,
      })
    );
  }

  /**
   * Log message
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.verbose && level === 'info') return;

    const prefix = '[x-shell]';
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }


  /**
   * List available Docker containers
   */
  private listContainers(ws: WebSocket): void {
    if (!this.config.allowDockerExec) {
      ws.send(
        JSON.stringify({
          type: 'containerList',
          containers: [],
        })
      );
      return;
    }

    // Run docker ps to get running containers
    exec(
      `${this.config.dockerPath} ps --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}"`,
      (error, stdout, stderr) => {
        if (error) {
          this.log(`Failed to list containers: ${error.message}`, 'error');
          ws.send(
            JSON.stringify({
              type: 'containerList',
              containers: [],
            })
          );
          return;
        }

        const containers: ContainerInfo[] = [];
        const lines = stdout.trim().split('\n').filter((line) => line.trim());

        for (const line of lines) {
          const [id, name, image, status, state] = line.split('\t');
          if (!id) continue;

          // Check if container matches allowed patterns
          if (this.isContainerAllowed(name) || this.isContainerAllowed(id)) {
            containers.push({
              id,
              name,
              image,
              status,
              state: (state as ContainerInfo['state']) || 'unknown',
            });
          }
        }

        ws.send(
          JSON.stringify({
            type: 'containerList',
            containers,
          })
        );

        this.log(`Listed ${containers.length} containers`);
      }
    );
  }

  /**
   * Get all active sessions (for external access)
   */
  getSessions(): SessionInfo[] {
    return this.sessionManager.getSessions().map((session) => ({
      sessionId: session.id,
      shell: session.shell,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      createdAt: session.createdAt,
      container: session.container,
    }));
  }

  /**
   * Get all active sessions with multiplexing info
   */
  getSharedSessions(filter?: SessionListFilter): SharedSessionInfo[] {
    return this.sessionManager
      .getSessions(filter)
      .map((s) => this.sessionManager.toSharedSessionInfo(s));
  }

  /**
   * Get session manager statistics
   */
  getStats(): { sessionCount: number; clientCount: number; orphanedCount: number } {
    return this.sessionManager.getStats();
  }

  /**
   * Close all sessions and stop server
   */
  close(): void {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Cleanup session manager
    this.sessionManager.cleanup();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.log('Terminal server closed');
  }

  // ===========================================================================
  // Authentication Methods
  // ===========================================================================

  /**
   * Authenticate a WebSocket connection using auth provider
   */
  private async authenticateConnection(ws: WebSocket, req: any): Promise<UserContext | null> {
    if (!this.authProvider || !this.authProvider.authenticateConnection) {
      return null;
    }

    const context: AuthContext = {
      request: req,
      websocket: ws,
      clientIp: req.socket.remoteAddress || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
    };

    const result = await this.authProvider.authenticateConnection(context);
    return result.success ? result.user! : null;
  }

  /**
   * Handle authentication message from client
   */
  private async handleAuthMessage(ws: WebSocket, clientId: string, message: any): Promise<void> {
    if (!this.authProvider || !this.authProvider.authenticateCredentials) {
      this.sendAuthResponse(ws, false, 'Authentication not supported');
      return;
    }

    try {
      const result = await this.authProvider.authenticateCredentials(message);
      if (result.success && result.user) {
        // Authentication successful
        this.clientUsers.set(clientId, result.user);
        this.authPendingClients.delete(clientId);
        this.log(`Client ${clientId} authenticated as ${result.user.username || result.user.userId}`);

        // Send updated server info with user context
        this.sendServerInfo(ws, result.user);
        this.sendAuthResponse(ws, true, undefined, result.user);
      } else {
        // Authentication failed
        this.sendAuthResponse(ws, false, result.error || 'Authentication failed');
        if (this.config.requireAuth) {
          ws.close();
        }
      }
    } catch (error) {
      this.sendAuthResponse(ws, false, (error as Error).message);
      if (this.config.requireAuth) {
        ws.close();
      }
    }
  }

  /**
   * Check if user has permission for the operation
   */
  private async checkPermission(clientId: string, message: TerminalMessage): Promise<boolean> {
    // If no auth provider, allow all operations (backward compatibility)
    if (!this.authProvider) {
      return true;
    }

    // Get user context (could be null for anonymous users)
    let user = this.clientUsers.get(clientId);

    // If no user context and anonymous not allowed, deny
    if (!user && !this.config.allowAnonymous) {
      this.sendPermissionDenied(clientId, message.type, 'Authentication required');
      return false;
    }

    // Create anonymous user context if needed
    if (!user && this.config.allowAnonymous) {
      const anonymousPermissions = this.authProvider.getAnonymousPermissions?.() || [];
      user = {
        userId: 'anonymous',
        username: 'Anonymous',
        permissions: anonymousPermissions,
      };
    }

    if (!user) {
      this.sendPermissionDenied(clientId, message.type, 'User context not found');
      return false;
    }

    // Map message types to operations
    const operation = this.getOperationFromMessage(message);
    const resource = this.getResourceFromMessage(message);

    const permissionRequest: PermissionRequest = {
      user,
      operation,
      resource,
      context: {
        message,
        clientId,
      },
    };

    try {
      const hasPermission = await this.authProvider.checkPermission(permissionRequest);
      if (!hasPermission) {
        this.sendPermissionDenied(clientId, message.type, `Permission denied for ${operation}`, operation);
      }
      return hasPermission;
    } catch (error) {
      this.log(`Permission check error: ${(error as Error).message}`, 'error');
      this.sendPermissionDenied(clientId, message.type, 'Permission check failed');
      return false;
    }
  }

  /**
   * Map message type to operation string
   */
  private getOperationFromMessage(message: TerminalMessage): string {
    switch (message.type) {
      case 'spawn':
        return 'spawn_session';
      case 'data':
        return 'write_session';
      case 'resize':
        return 'resize_session';
      case 'close':
        return 'close_session';
      case 'join':
        return 'join_session';
      case 'leave':
        return 'leave_session';
      case 'listSessions':
        return 'list_sessions';
      case 'listContainers':
        return 'list_containers';
      default:
        return message.type;
    }
  }

  /**
   * Extract resource identifier from message
   */
  private getResourceFromMessage(message: TerminalMessage): string | undefined {
    if ('sessionId' in message && message.sessionId) {
      return `session:${message.sessionId}`;
    }
    if ('container' in message && message.container) {
      return `container:${message.container}`;
    }
    return undefined;
  }

  /**
   * Get user context for client
   */
  private getUserContext(clientId: string): UserContext | null {
    return this.clientUsers.get(clientId) || null;
  }

  /**
   * Send authentication response
   */
  private sendAuthResponse(
    ws: WebSocket,
    success: boolean,
    error?: string,
    user?: UserContext,
    capabilities?: string[]
  ): void {
    ws.send(
      JSON.stringify({
        type: 'authResponse',
        success,
        error,
        user: success ? user : undefined,
        capabilities,
      })
    );
  }

  /**
   * Send permission denied message
   */
  private sendPermissionDenied(
    clientId: string,
    operation: string,
    error: string,
    permission?: string
  ): void {
    const ws = this.getWebSocketByClientId(clientId);
    if (ws) {
      ws.send(
        JSON.stringify({
          type: 'permissionDenied',
          operation,
          error,
          permission,
        })
      );
    }
  }

  /**
   * Get WebSocket connection by client ID
   */
  private getWebSocketByClientId(clientId: string): WebSocket | null {
    if (!this.wss) return null;

    for (const ws of this.wss.clients) {
      if (this.clientIds.get(ws) === clientId) {
        return ws;
      }
    }
    return null;
  }

  /**
   * Update sendServerInfo to include auth status
   */
  private sendServerInfo(ws: WebSocket, user?: UserContext | null): void {
    const serverInfo: ServerInfo & {
      authEnabled?: boolean;
      requireAuth?: boolean;
      user?: UserContext;
    } = {
      dockerEnabled: this.config.allowDockerExec,
      allowedShells: this.config.allowedShells,
      defaultShell: this.config.defaultShell,
      defaultContainerShell: this.config.defaultContainerShell,
    };

    // Add auth info if auth provider is configured
    if (this.authProvider) {
      serverInfo.authEnabled = true;
      serverInfo.requireAuth = this.config.requireAuth;
      if (user) {
        serverInfo.user = user;
      }
    }

    ws.send(
      JSON.stringify({
        type: 'serverInfo',
        info: serverInfo,
      })
    );
  }
}

/**
 * Express middleware to attach terminal server
 */
export function createTerminalMiddleware(
  options: Omit<TerminalServerOptions, 'server' | 'port'> = {}
): {
  server: TerminalServer;
  attach: (httpServer: HttpServer) => void;
} {
  const server = new TerminalServer(options);
  return {
    server,
    attach: (httpServer: HttpServer) => server.attach(httpServer),
  };
}
