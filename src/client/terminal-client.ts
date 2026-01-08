/**
 * Terminal client for connecting to x-shell server
 *
 * Example usage:
 * ```typescript
 * import { TerminalClient } from 'x-shell.js/client';
 *
 * const client = new TerminalClient({ url: 'ws://localhost:3000/terminal' });
 * await client.connect();
 *
 * client.onData((data) => console.log(data));
 * client.onExit((code) => console.log('Exited with code:', code));
 *
 * await client.spawn({ shell: '/bin/bash', cwd: '/home/user' });
 * client.write('ls -la\n');
 * client.resize(120, 40);
 * client.kill();
 * ```
 */

import type {
  ClientConfig,
  TerminalOptions,
  TerminalMessage,
  SessionInfo,
  ContainerInfo,
  ServerInfo,
} from '../shared/types.js';

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * Terminal client class
 */
export class TerminalClient {
  private config: Required<ClientConfig>;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private sessionId: string | null = null;
  private sessionInfo: SessionInfo | null = null;
  private serverInfo: ServerInfo | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Event handlers
  private connectHandlers: (() => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];
  private dataHandlers: ((data: string) => void)[] = [];
  private exitHandlers: ((code: number) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private spawnedHandlers: ((info: SessionInfo) => void)[] = [];
  private serverInfoHandlers: ((info: ServerInfo) => void)[] = [];
  private containerListHandlers: ((containers: ContainerInfo[]) => void)[] = [];

  // Promise resolvers for spawn
  private spawnResolve: ((info: SessionInfo) => void) | null = null;
  private spawnReject: ((error: Error) => void) | null = null;

  constructor(config: ClientConfig) {
    this.config = {
      url: config.url,
      reconnect: config.reconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectDelay: config.reconnectDelay ?? 1000,
    };
  }

  /**
   * Connect to the terminal server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === 'connected') {
        resolve();
        return;
      }

      this.state = 'connecting';

      try {
        this.ws = new WebSocket(this.config.url);
      } catch (error) {
        this.state = 'disconnected';
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        this.state = 'connected';
        this.reconnectAttempts = 0;
        this.connectHandlers.forEach((handler) => handler());
        resolve();
      };

      this.ws.onclose = () => {
        const wasConnected = this.state === 'connected';
        this.state = 'disconnected';
        this.sessionId = null;
        this.sessionInfo = null;

        if (wasConnected) {
          this.disconnectHandlers.forEach((handler) => handler());
        }

        // Attempt reconnection
        if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (event) => {
        const error = new Error('WebSocket error');
        this.errorHandlers.forEach((handler) => handler(error));

        if (this.state === 'connecting') {
          reject(error);
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * Disconnect from the terminal server
   */
  disconnect(): void {
    this.config.reconnect = false; // Prevent auto-reconnect

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state = 'disconnected';
    this.sessionId = null;
    this.sessionInfo = null;
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    const maxDelay = 30000; // 30 seconds max

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Error handled by onclose
      });
    }, Math.min(delay, maxDelay));
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    let message: TerminalMessage;

    try {
      message = JSON.parse(data);
    } catch {
      console.error('[x-shell] Invalid message:', data);
      return;
    }

    switch (message.type) {
      case 'spawned':
        this.sessionId = message.sessionId;
        this.sessionInfo = {
          sessionId: message.sessionId,
          shell: message.shell,
          cwd: message.cwd,
          cols: message.cols,
          rows: message.rows,
          createdAt: new Date(),
          container: message.container,
        };
        this.spawnedHandlers.forEach((handler) => handler(this.sessionInfo!));
        if (this.spawnResolve) {
          this.spawnResolve(this.sessionInfo);
          this.spawnResolve = null;
          this.spawnReject = null;
        }
        break;

      case 'data':
        this.dataHandlers.forEach((handler) => handler(message.data));
        break;

      case 'exit':
        const exitCode = message.exitCode;
        this.exitHandlers.forEach((handler) => handler(exitCode));
        this.sessionId = null;
        this.sessionInfo = null;
        break;

      case 'error':
        const error = new Error(message.error);
        this.errorHandlers.forEach((handler) => handler(error));
        if (this.spawnReject) {
          this.spawnReject(error);
          this.spawnResolve = null;
          this.spawnReject = null;
        }
        break;

      case 'serverInfo':
        this.serverInfo = message.info;
        this.serverInfoHandlers.forEach((handler) => handler(message.info));
        break;

      case 'containerList':
        this.containerListHandlers.forEach((handler) => handler(message.containers));
        break;
    }
  }

  /**
   * Spawn a terminal session
   */
  spawn(options: TerminalOptions = {}): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      if (this.state !== 'connected' || !this.ws) {
        reject(new Error('Not connected to server'));
        return;
      }

      if (this.sessionId) {
        reject(new Error('Session already spawned. Call kill() first.'));
        return;
      }

      this.spawnResolve = resolve;
      this.spawnReject = reject;

      this.ws.send(
        JSON.stringify({
          type: 'spawn',
          options,
        })
      );
    });
  }

  /**
   * Write data to the terminal
   */
  write(data: string): void {
    if (!this.ws || this.state !== 'connected') {
      console.error('[x-shell] Cannot write: not connected');
      return;
    }

    if (!this.sessionId) {
      console.error('[x-shell] Cannot write: no active session');
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'data',
        sessionId: this.sessionId,
        data,
      })
    );
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    if (!this.ws || this.state !== 'connected') {
      console.error('[x-shell] Cannot resize: not connected');
      return;
    }

    if (!this.sessionId) {
      console.error('[x-shell] Cannot resize: no active session');
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'resize',
        sessionId: this.sessionId,
        cols,
        rows,
      })
    );
  }

  /**
   * Kill the terminal session
   */
  kill(): void {
    if (!this.ws || this.state !== 'connected') {
      return;
    }

    if (!this.sessionId) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'close',
        sessionId: this.sessionId,
      })
    );

    this.sessionId = null;
    this.sessionInfo = null;
  }

  // ==========================================
  // Event handlers
  // ==========================================

  /**
   * Called when connected to server
   */
  onConnect(handler: () => void): void {
    this.connectHandlers.push(handler);
  }

  /**
   * Called when disconnected from server
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  /**
   * Called when data is received from the terminal
   */
  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  /**
   * Called when the terminal session exits
   */
  onExit(handler: (code: number) => void): void {
    this.exitHandlers.push(handler);
  }

  /**
   * Called when an error occurs
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Called when a session is spawned
   */
  onSpawned(handler: (info: SessionInfo) => void): void {
    this.spawnedHandlers.push(handler);
  }

  /**
   * Called when server info is received
   */
  onServerInfo(handler: (info: ServerInfo) => void): void {
    this.serverInfoHandlers.push(handler);
    // If we already have server info, call immediately
    if (this.serverInfo) {
      handler(this.serverInfo);
    }
  }

  /**
   * Called when container list is received
   */
  onContainerList(handler: (containers: ContainerInfo[]) => void): void {
    this.containerListHandlers.push(handler);
  }

  /**
   * Request list of available containers
   */
  requestContainerList(): void {
    if (!this.ws || this.state !== 'connected') {
      console.error('[x-shell] Cannot request containers: not connected');
      return;
    }

    this.ws.send(JSON.stringify({ type: 'listContainers' }));
  }

  // ==========================================
  // Getters
  // ==========================================

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get current session info
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Check if a session is active
   */
  hasActiveSession(): boolean {
    return this.sessionId !== null;
  }

  /**
   * Get server info
   */
  getServerInfo(): ServerInfo | null {
    return this.serverInfo;
  }
}
