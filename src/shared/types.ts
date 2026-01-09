/**
 * Shared types for x-shell.js
 */

/**
 * Session type for multiplexing
 */
export type SessionType = 'local' | 'docker-exec' | 'docker-attach';

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

  // Session multiplexing options
  /** Use docker attach instead of docker exec (connects to main process) */
  attachMode?: boolean;
  /** Session label for easier identification */
  label?: string;
  /** Allow other clients to join this session (default: true) */
  allowJoin?: boolean;
  /** Enable history buffer for replay on join (default: true) */
  enableHistory?: boolean;
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

  // Authentication
  /** Authentication provider instance */
  authProvider?: AuthProvider;
  /** Require authentication for all connections (default: false) */
  requireAuth?: boolean;
  /** Allow unauthenticated connections with limited permissions (default: true when authProvider is set) */
  allowAnonymous?: boolean;
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
  | 'serverInfo'
  // Session multiplexing
  | 'listSessions'
  | 'sessionList'
  | 'join'
  | 'joined'
  | 'leave'
  | 'left'
  | 'clientJoined'
  | 'clientLeft'
  | 'sessionClosed'
  // Authentication
  | 'auth'
  | 'authResponse'
  | 'permissionDenied';

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
  | ServerInfoMessage
  // Session multiplexing
  | ListSessionsMessage
  | SessionListMessage
  | JoinMessage
  | JoinedMessage
  | LeaveMessage
  | LeftMessage
  | ClientJoinedMessage
  | ClientLeftMessage
  | SessionClosedMessage
  // Authentication
  | AuthMessage
  | AuthResponseMessage
  | PermissionDeniedMessage;

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

  // Authentication options
  /** Authentication token (JWT, session key, etc.) */
  authToken?: string;
  /** Additional auth headers to send during connection */
  authHeaders?: Record<string, string>;
  /** Custom auth data */
  authData?: Record<string, any>;
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
  /** User who created the session */
  owner?: UserContext;
}

/**
 * Extended session info with multiplexing data
 */
export interface SharedSessionInfo extends SessionInfo {
  /** Type of session */
  type: SessionType;
  /** Number of connected clients */
  clientCount: number;
  /** Whether session accepts new clients */
  accepting: boolean;
  /** Session owner client ID */
  ownerId?: string;
  /** Session label */
  label?: string;
  /** Whether history replay is available */
  historyEnabled: boolean;
}

/**
 * Session list filter options
 */
export interface SessionListFilter {
  /** Filter by session type */
  type?: SessionType;
  /** Filter by container name/ID */
  container?: string;
  /** Show only sessions accepting new clients */
  accepting?: boolean;
}

/**
 * Join session options
 */
export interface JoinSessionOptions {
  /** Session ID to join */
  sessionId: string;
  /** Request recent output history */
  requestHistory?: boolean;
  /** Max history characters to retrieve */
  historyLimit?: number;
}

// =============================================================================
// Session Multiplexing Messages
// =============================================================================

/**
 * List sessions request from client
 */
export interface ListSessionsMessage extends BaseMessage {
  type: 'listSessions';
  filter?: SessionListFilter;
}

/**
 * Session list response from server
 */
export interface SessionListMessage extends BaseMessage {
  type: 'sessionList';
  sessions: SharedSessionInfo[];
}

/**
 * Join session request from client
 */
export interface JoinMessage extends BaseMessage {
  type: 'join';
  options: JoinSessionOptions;
}

/**
 * Joined session response from server
 */
export interface JoinedMessage extends BaseMessage {
  type: 'joined';
  sessionId: string;
  session: SharedSessionInfo;
  /** Recent output history (if requested) */
  history?: string;
}

/**
 * Leave session request from client (without killing the session)
 */
export interface LeaveMessage extends BaseMessage {
  type: 'leave';
  sessionId: string;
}

/**
 * Left session response from server
 */
export interface LeftMessage extends BaseMessage {
  type: 'left';
  sessionId: string;
}

/**
 * Client joined notification (broadcast to other clients in session)
 */
export interface ClientJoinedMessage extends BaseMessage {
  type: 'clientJoined';
  sessionId: string;
  clientCount: number;
}

/**
 * Client left notification (broadcast to other clients in session)
 */
export interface ClientLeftMessage extends BaseMessage {
  type: 'clientLeft';
  sessionId: string;
  clientCount: number;
}

/**
 * Session closed notification
 */
export interface SessionClosedMessage extends BaseMessage {
  type: 'sessionClosed';
  sessionId: string;
  reason: 'orphan_timeout' | 'owner_closed' | 'process_exit' | 'error';
}

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * User context information extracted by authentication
 */
export interface UserContext {
  /** Unique user identifier */
  userId: string;
  /** Human-readable username */
  username?: string;
  /** User's permissions/roles */
  permissions: string[];
  /** Additional metadata from auth provider */
  metadata?: Record<string, any>;
}

/**
 * Authentication request from client
 */
export interface AuthMessage extends BaseMessage {
  type: 'auth';
  /** Authentication token (JWT, session key, etc.) */
  token?: string;
  /** Additional auth headers */
  headers?: Record<string, string>;
  /** Custom auth data */
  data?: Record<string, any>;
}

/**
 * Authentication response from server
 */
export interface AuthResponseMessage extends BaseMessage {
  type: 'authResponse';
  /** Whether authentication was successful */
  success: boolean;
  /** Error message if authentication failed */
  error?: string;
  /** User context if authentication succeeded */
  user?: UserContext;
  /** Server capabilities available to this user */
  capabilities?: string[];
}

/**
 * Permission denied error
 */
export interface PermissionDeniedMessage extends BaseMessage {
  type: 'permissionDenied';
  /** Operation that was denied */
  operation: string;
  /** Required permission */
  permission?: string;
  /** Error message */
  error: string;
}

/**
 * Authentication result from provider
 */
export interface AuthResult {
  /** Whether authentication was successful */
  success: boolean;
  /** User context if successful */
  user?: UserContext;
  /** Error message if failed */
  error?: string;
}

/**
 * Authentication context from WebSocket request
 */
export interface AuthContext {
  /** HTTP request object from WebSocket upgrade */
  request: any;
  /** WebSocket instance */
  websocket: any;
  /** Client IP address */
  clientIp?: string;
  /** User agent string */
  userAgent?: string;
}

/**
 * Permission check request
 */
export interface PermissionRequest {
  /** User context */
  user: UserContext;
  /** Operation being attempted */
  operation: string;
  /** Resource being accessed (session, container, etc.) */
  resource?: string;
  /** Additional context */
  context?: Record<string, any>;
}

/**
 * Pluggable authentication provider interface
 */
export interface AuthProvider {
  /**
   * Authenticate a connection request from HTTP upgrade
   */
  authenticateConnection?(context: AuthContext): Promise<AuthResult>;

  /**
   * Authenticate using credentials from auth message
   */
  authenticateCredentials?(credentials: AuthMessage): Promise<AuthResult>;

  /**
   * Check if user has permission for operation
   */
  checkPermission(request: PermissionRequest): Promise<boolean>;

  /**
   * Get default permissions for anonymous users (if allowed)
   */
  getAnonymousPermissions?(): string[];

  /**
   * Called when user disconnects (cleanup)
   */
  onDisconnect?(user: UserContext): Promise<void>;
}
