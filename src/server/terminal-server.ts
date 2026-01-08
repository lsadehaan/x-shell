/**
 * Server-side terminal handler using node-pty
 *
 * Manages PTY sessions and WebSocket connections for web-based terminals.
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
} from '../shared/types.js';

/**
 * Terminal session data
 */
interface TerminalSession {
  id: string;
  pty: any; // IPty from node-pty
  ws: WebSocket;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: Date;
  lastActivity: Date;
  /** Container ID if this is a Docker exec session */
  container?: string;
}

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
}

/**
 * Terminal server class
 */
export class TerminalServer {
  private config: Required<Omit<TerminalServerOptions, 'server' | 'port'>>;
  private sessions = new Map<string, TerminalSession>();
  private wss: WebSocketServer | null = null;
  private pty: any = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

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
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
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
    // Load node-pty
    try {
      await this.initPty();
    } catch (error) {
      this.sendError(ws, (error as Error).message);
      ws.close();
      return;
    }

    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as TerminalMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        this.log(`Invalid message: ${error}`, 'error');
      }
    });

    ws.on('close', () => {
      this.log('Client disconnected');
      // Clean up sessions for this WebSocket
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.ws === ws) {
          this.closeSession(sessionId);
        }
      }
    });

    ws.on('error', (error) => {
      this.log(`WebSocket error: ${error.message}`, 'error');
    });
  }

  /**
   * Handle message from client
   */
  private handleMessage(ws: WebSocket, message: TerminalMessage): void {
    switch (message.type) {
      case 'spawn':
        this.spawnSession(ws, message.options || {});
        break;

      case 'data':
        if (message.sessionId) {
          this.writeToSession(message.sessionId, message.data);
        }
        break;

      case 'resize':
        if (message.sessionId) {
          this.resizeSession(message.sessionId, message.cols, message.rows);
        }
        break;

      case 'close':
        if (message.sessionId) {
          this.closeSession(message.sessionId);
        }
        break;

      default:
        this.log(`Unknown message type: ${(message as any).type}`, 'warn');
    }
  }

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

  /**
   * Spawn a Docker exec session
   */
  private spawnDockerSession(
    ws: WebSocket,
    options: TerminalOptions,
    sessionId: string
  ): TerminalSession | null {
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

      const now = new Date();

      // Create session
      const session: TerminalSession = {
        id: sessionId,
        pty: ptyProcess,
        ws,
        shell,
        cwd: options.containerCwd || '/',
        cols,
        rows,
        createdAt: now,
        lastActivity: now,
        container,
      };

      return session;
    } catch (error) {
      this.log(`Failed to spawn Docker exec: ${error}`, 'error');
      this.sendError(ws, `Failed to exec into container: ${(error as Error).message}`, sessionId);
      return null;
    }
  }

  /**
   * Spawn a new terminal session
   */
  private spawnSession(ws: WebSocket, options: TerminalOptions): void {
    // Count sessions for this client
    let clientSessions = 0;
    for (const session of this.sessions.values()) {
      if (session.ws === ws) clientSessions++;
    }

    if (clientSessions >= this.config.maxSessionsPerClient) {
      this.sendError(
        ws,
        `Maximum sessions (${this.config.maxSessionsPerClient}) reached`
      );
      return;
    }

    const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check if this is a Docker exec request
    if (options.container) {
      // Validate container access
      if (!this.isContainerAllowed(options.container)) {
        this.sendError(
          ws,
          `Container access not allowed: ${options.container}. Docker exec ${this.config.allowDockerExec ? 'is enabled but container pattern not matched' : 'is disabled'}.`
        );
        return;
      }

      // Spawn Docker exec session
      const session = this.spawnDockerSession(ws, options, sessionId);
      if (!session) return;

      this.sessions.set(sessionId, session);
      this.setupSessionHandlers(session, ws, sessionId);

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

      this.log(`Docker session spawned: ${sessionId} (container: ${session.container})`);
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

      const now = new Date();

      // Store session
      const session: TerminalSession = {
        id: sessionId,
        pty: ptyProcess,
        ws,
        shell,
        cwd,
        cols,
        rows,
        createdAt: now,
        lastActivity: now,
      };
      this.sessions.set(sessionId, session);

      this.setupSessionHandlers(session, ws, sessionId);

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
  private setupSessionHandlers(
    session: TerminalSession,
    ws: WebSocket,
    sessionId: string
  ): void {
    // Handle PTY output
    session.pty.onData((data: string) => {
      session.lastActivity = new Date();
      ws.send(
        JSON.stringify({
          type: 'data',
          sessionId,
          data,
        })
      );
    });

    // Handle PTY exit
    session.pty.onExit(({ exitCode }: { exitCode: number }) => {
      ws.send(
        JSON.stringify({
          type: 'exit',
          sessionId,
          exitCode,
        })
      );
      this.sessions.delete(sessionId);
      this.log(`Session exited: ${sessionId} (code: ${exitCode})`);
    });
  }

  /**
   * Write data to session
   */
  private writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log(`Session not found: ${sessionId}`, 'warn');
      return;
    }

    session.lastActivity = new Date();
    session.pty.write(data);
  }

  /**
   * Resize session
   */
  private resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log(`Session not found: ${sessionId}`, 'warn');
      return;
    }

    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
  }

  /**
   * Close session
   */
  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.pty.kill();
    } catch (error) {
      this.log(`Error killing PTY: ${error}`, 'error');
    }

    this.sessions.delete(sessionId);
    this.log(`Session closed: ${sessionId}`);
  }

  /**
   * Clean up inactive sessions
   */
  private cleanupSessions(): void {
    if (this.config.idleTimeout === 0) return;

    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActivity.getTime();
      if (idleTime > this.config.idleTimeout) {
        this.log(`Closing inactive session: ${sessionId}`);
        session.ws.send(
          JSON.stringify({
            type: 'exit',
            sessionId,
            exitCode: -1,
          })
        );
        this.closeSession(sessionId);
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
   * Get all active sessions
   */
  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
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
   * Close all sessions and stop server
   */
  close(): void {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.log('Terminal server closed');
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
