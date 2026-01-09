/**
 * x-shell.js server exports
 */

export { TerminalServer, createTerminalMiddleware } from './terminal-server.js';
export type { TerminalServerOptions } from './terminal-server.js';

// Session multiplexing
export { SessionManager } from './session-manager.js';
export type {
  SessionManagerConfig,
  SharedSession,
  ClientInfo,
} from './session-manager.js';

export { CircularBuffer } from './circular-buffer.js';

export type {
  ServerConfig,
  TerminalOptions,
  SessionInfo,
  SharedSessionInfo,
  SessionType,
  SessionListFilter,
  JoinSessionOptions,
} from '../shared/types.js';
