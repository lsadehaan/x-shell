import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../src/server/session-manager.js';

// Mock WebSocket
function createMockWebSocket(): any {
  return {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
    close: vi.fn(),
  };
}

// Mock PTY
function createMockPty(): any {
  return {
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      maxClientsPerSession: 5,
      orphanTimeout: 1000,
      historySize: 1000,
      historyEnabled: true,
      maxSessionsTotal: 10,
      verbose: false,
    });
  });

  describe('Session Creation', () => {
    it('should create a session', () => {
      const ws = createMockWebSocket();
      const pty = createMockPty();

      const session = manager.createSession({
        id: 'test-session-1',
        type: 'local',
        pty,
        shell: '/bin/bash',
        cwd: '/home/user',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
      });

      expect(session.id).toBe('test-session-1');
      expect(session.type).toBe('local');
      expect(session.shell).toBe('/bin/bash');
      expect(session.clients.size).toBe(1);
      expect(manager.getSessionCount()).toBe(1);
    });

    it('should throw when max sessions reached', () => {
      const ws = createMockWebSocket();
      const pty = createMockPty();

      // Create 10 sessions (max)
      for (let i = 0; i < 10; i++) {
        manager.createSession({
          id: `session-${i}`,
          type: 'local',
          pty: createMockPty(),
          shell: '/bin/bash',
          cwd: '/',
          cols: 80,
          rows: 24,
          ownerId: `client-${i}`,
          ownerWs: createMockWebSocket(),
        });
      }

      expect(() => {
        manager.createSession({
          id: 'session-overflow',
          type: 'local',
          pty,
          shell: '/bin/bash',
          cwd: '/',
          cols: 80,
          rows: 24,
          ownerId: 'client-overflow',
          ownerWs: ws,
        });
      }).toThrow('Maximum number of sessions reached');
    });
  });

  describe('Client Management', () => {
    it('should add a client to a session', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const pty = createMockPty();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty,
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws1,
      });

      const success = manager.addClient('session-1', 'client-2', ws2);
      expect(success).toBe(true);
      expect(manager.getClientCount('session-1')).toBe(2);
    });

    it('should not add client to non-accepting session', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const pty = createMockPty();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty,
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws1,
        allowJoin: false,
      });

      const success = manager.addClient('session-1', 'client-2', ws2);
      expect(success).toBe(false);
    });

    it('should remove client from session', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const pty = createMockPty();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty,
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws1,
      });

      manager.addClient('session-1', 'client-2', ws2);
      expect(manager.getClientCount('session-1')).toBe(2);

      manager.removeClient('session-1', 'client-2');
      expect(manager.getClientCount('session-1')).toBe(1);
    });

    it('should remove client from all sessions', () => {
      const ws = createMockWebSocket();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
      });

      manager.createSession({
        id: 'session-2',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
      });

      expect(manager.getClientSessions('client-1')).toHaveLength(2);

      const removed = manager.removeClientFromAllSessions('client-1');
      expect(removed).toHaveLength(2);
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast to all clients in session', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws1,
      });

      manager.addClient('session-1', 'client-2', ws2);
      manager.addClient('session-1', 'client-3', ws3);

      manager.broadcastToSession('session-1', { type: 'test', data: 'hello' });

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
      expect(ws3.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
    });

    it('should exclude specified client from broadcast', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws1,
      });

      manager.addClient('session-1', 'client-2', ws2);

      manager.broadcastToSession('session-1', { type: 'test' }, 'client-1');

      expect(ws1.send).not.toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalled();
    });
  });

  describe('History', () => {
    it('should append and retrieve history', () => {
      const ws = createMockWebSocket();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
        enableHistory: true,
      });

      manager.appendHistory('session-1', 'hello');
      manager.appendHistory('session-1', ' world');

      expect(manager.getHistory('session-1')).toBe('hello world');
    });

    it('should limit history when requested', () => {
      const ws = createMockWebSocket();

      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
      });

      manager.appendHistory('session-1', 'hello world this is a long string');

      const limited = manager.getHistory('session-1', 10);
      expect(limited.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Session Filtering', () => {
    it('should filter sessions by type', () => {
      manager.createSession({
        id: 'local-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: createMockWebSocket(),
      });

      manager.createSession({
        id: 'docker-1',
        type: 'docker-exec',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-2',
        ownerWs: createMockWebSocket(),
        container: 'test-container',
      });

      const localSessions = manager.getSessions({ type: 'local' });
      expect(localSessions).toHaveLength(1);
      expect(localSessions[0].type).toBe('local');

      const dockerSessions = manager.getSessions({ type: 'docker-exec' });
      expect(dockerSessions).toHaveLength(1);
      expect(dockerSessions[0].type).toBe('docker-exec');
    });

    it('should filter sessions by accepting status', () => {
      manager.createSession({
        id: 'accepting',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: createMockWebSocket(),
        allowJoin: true,
      });

      manager.createSession({
        id: 'not-accepting',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-2',
        ownerWs: createMockWebSocket(),
        allowJoin: false,
      });

      const acceptingSessions = manager.getSessions({ accepting: true });
      expect(acceptingSessions).toHaveLength(1);
      expect(acceptingSessions[0].id).toBe('accepting');
    });
  });

  describe('Session Info Conversion', () => {
    it('should convert session to SharedSessionInfo', () => {
      const ws = createMockWebSocket();

      const session = manager.createSession({
        id: 'session-1',
        type: 'docker-attach',
        pty: createMockPty(),
        shell: 'attach',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: ws,
        container: 'my-container',
        label: 'Test Session',
      });

      const info = manager.toSharedSessionInfo(session);

      expect(info.sessionId).toBe('session-1');
      expect(info.type).toBe('docker-attach');
      expect(info.container).toBe('my-container');
      expect(info.label).toBe('Test Session');
      expect(info.clientCount).toBe(1);
      expect(info.accepting).toBe(true);
      expect(info.ownerId).toBe('client-1');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup all sessions', () => {
      for (let i = 0; i < 3; i++) {
        manager.createSession({
          id: `session-${i}`,
          type: 'local',
          pty: createMockPty(),
          shell: '/bin/bash',
          cwd: '/',
          cols: 80,
          rows: 24,
          ownerId: `client-${i}`,
          ownerWs: createMockWebSocket(),
        });
      }

      expect(manager.getSessionCount()).toBe(3);

      manager.cleanup();

      expect(manager.getSessionCount()).toBe(0);
    });
  });

  describe('Stats', () => {
    it('should report correct stats', () => {
      manager.createSession({
        id: 'session-1',
        type: 'local',
        pty: createMockPty(),
        shell: '/bin/bash',
        cwd: '/',
        cols: 80,
        rows: 24,
        ownerId: 'client-1',
        ownerWs: createMockWebSocket(),
      });

      manager.addClient('session-1', 'client-2', createMockWebSocket());

      const stats = manager.getStats();
      expect(stats.sessionCount).toBe(1);
      expect(stats.clientCount).toBe(2);
      expect(stats.orphanedCount).toBe(0);
    });
  });
});
