/**
 * Shared types for x-shell.js
 */

/**
 * Terminal spawn options
 */
export interface TerminalOptions {
  /** Shell to use (e.g., 'bash', 'zsh', 'cmd.exe', 'powershell.exe') */
  shell?: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Initial columns (default: 80) */
  cols?: number;
  /** Initial rows (default: 24) */
  rows?: number;

  // Docker container support
  /** Docker container ID or name to exec into */
  container?: string;
  /** Shell to use inside the container (default: /bin/bash) */
  containerShell?: string;
  /** User to run as inside the container */
  containerUser?: string;
  /** Working directory inside the container */
  containerCwd?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Allowed shells (empty = all allowed) */
  allowedShells?: string[];
  /** Allowed working directories (empty = all allowed) */
  allowedPaths?: string[];
  /** Default shell if not specified by client */
  defaultShell?: string;
  /** Default working directory */
  defaultCwd?: string;
  /** Maximum concurrent sessions per client */
  maxSessionsPerClient?: number;
  /** Session idle timeout in ms (0 = no timeout) */
  idleTimeout?: number;

  // Docker container support
  /** Enable Docker exec feature (default: false) */
  allowDockerExec?: boolean;
  /** Regex patterns for allowed container names/IDs (empty = all allowed when Docker exec is enabled) */
  allowedContainerPatterns?: string[];
  /** Default shell to use inside containers */
  defaultContainerShell?: string;
}

/**
 * WebSocket message types
 */
export type MessageType =
  | 'spawn'
  | 'data'
  | 'resize'
  | 'close'
  | 'error'
  | 'exit'
  | 'spawned'
  | 'listContainers'
  | 'containerList'
  | 'serverInfo';

/**
 * Docker container info
 */
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'paused' | 'exited' | 'unknown';
}

/**
 * Server capabilities info
 */
export interface ServerInfo {
  dockerEnabled: boolean;
  allowedShells: string[];
  defaultShell: string;
  defaultContainerShell?: string;
}

/**
 * Base message structure
 */
export interface BaseMessage {
  type: MessageType;
  sessionId?: string;
}

/**
 * Spawn request from client
 */
export interface SpawnMessage extends BaseMessage {
  type: 'spawn';
  options?: TerminalOptions;
}

/**
 * Spawned response from server
 */
export interface SpawnedMessage extends BaseMessage {
  type: 'spawned';
  sessionId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  /** Container ID if this is a Docker exec session */
  container?: string;
}

/**
 * Data message (bidirectional)
 */
export interface DataMessage extends BaseMessage {
  type: 'data';
  sessionId: string;
  data: string;
}

/**
 * Resize request from client
 */
export interface ResizeMessage extends BaseMessage {
  type: 'resize';
  sessionId: string;
  cols: number;
  rows: number;
}

/**
 * Close request from client
 */
export interface CloseMessage extends BaseMessage {
  type: 'close';
  sessionId: string;
}

/**
 * Error message from server
 */
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  sessionId?: string;
  error: string;
}

/**
 * Exit message from server
 */
export interface ExitMessage extends BaseMessage {
  type: 'exit';
  sessionId: string;
  exitCode: number;
}

/**
 * List containers request from client
 */
export interface ListContainersMessage extends BaseMessage {
  type: 'listContainers';
}

/**
 * Container list response from server
 */
export interface ContainerListMessage extends BaseMessage {
  type: 'containerList';
  containers: ContainerInfo[];
}

/**
 * Server info response (sent on connect)
 */
export interface ServerInfoMessage extends BaseMessage {
  type: 'serverInfo';
  info: ServerInfo;
}

/**
 * Union of all message types
 */
export type TerminalMessage =
  | SpawnMessage
  | SpawnedMessage
  | DataMessage
  | ResizeMessage
  | CloseMessage
  | ErrorMessage
  | ExitMessage
  | ListContainersMessage
  | ContainerListMessage
  | ServerInfoMessage;

/**
 * Client configuration
 */
export interface ClientConfig {
  /** WebSocket URL */
  url: string;
  /** Reconnect on disconnect (default: true) */
  reconnect?: boolean;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in ms (default: 1000) */
  reconnectDelay?: number;
}

/**
 * Terminal session info
 */
export interface SessionInfo {
  sessionId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: Date;
  /** Container ID if this is a Docker exec session */
  container?: string;
}
