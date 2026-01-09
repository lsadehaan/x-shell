/**
 * x-shell-terminal web component
 *
 * A ready-to-use terminal component that wraps xterm.js and
 * connects to an x-shell server via WebSocket.
 *
 * Usage:
 * ```html
 * <x-shell-terminal
 *   url="ws://localhost:3000/terminal"
 *   shell="/bin/bash"
 *   cwd="/home/user"
 *   theme="dark"
 * ></x-shell-terminal>
 * ```
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles, buttonStyles, themeStyles } from './styles.js';
import { TerminalClient } from '../client/terminal-client.js';
import type { TerminalOptions, SessionInfo, ContainerInfo, ServerInfo, SharedSessionInfo } from '../shared/types.js';

// xterm.js types (loaded dynamically)
interface ITerminalOptions {
  theme?: {
    background?: string;
    foreground?: string;
    cursor?: string;
    cursorAccent?: string;
    selection?: string;
    selectionForeground?: string;
  };
  fontSize?: number;
  fontFamily?: string;
  cursorBlink?: boolean;
}

interface ITerminal {
  open(parent: HTMLElement): void;
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  focus(): void;
  dispose(): void;
  onData(handler: (data: string) => void): { dispose(): void };
  onResize(handler: (size: { cols: number; rows: number }) => void): { dispose(): void };
  loadAddon(addon: any): void;
  cols: number;
  rows: number;
  options: ITerminalOptions;
}

interface IFitAddon {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}

// Tab interface for multi-tab support
interface Tab {
  id: string;
  label: string;
  client: TerminalClient | null;
  terminal: ITerminal | null;
  fitAddon: IFitAddon | null;
  connected: boolean;
  sessionActive: boolean;
  sessionInfo: SessionInfo | null;
  clientCount: number;
  containerEl: HTMLElement | null;
}

@customElement('x-shell-terminal')
export class XShellTerminal extends LitElement {
  static override styles = [
    sharedStyles,
    themeStyles,
    buttonStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 200px;
        border: 1px solid var(--xs-border);
        border-radius: 4px;
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: var(--xs-bg-header);
        border-bottom: 1px solid var(--xs-border);
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
      }

      .header-actions {
        display: flex;
        gap: 8px;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--xs-text-muted);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--xs-status-disconnected);
      }

      .status-dot.connected {
        background: var(--xs-status-connected);
      }

      .terminal-container {
        flex: 1;
        padding: 4px;
        background: var(--xs-terminal-bg);
        overflow: hidden;
      }

      .terminal-container .xterm {
        height: 100%;
      }

      .terminal-container .xterm-viewport {
        overflow-y: auto;
      }

      .loading,
      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 20px;
        text-align: center;
        color: var(--xs-text-muted);
      }

      .error {
        color: #ef4444;
      }

      .loading-spinner {
        animation: spin 1s linear infinite;
        margin-right: 8px;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      /* Hide header if requested */
      :host([no-header]) .header {
        display: none;
      }

      /* Connection panel */
      .connection-panel {
        padding: 12px;
        background: var(--xs-bg-header);
        border-bottom: 1px solid var(--xs-border);
      }

      .connection-panel-title {
        font-weight: 600;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .connection-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        align-items: end;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .form-group label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--xs-text-muted);
        letter-spacing: 0.5px;
      }

      .form-group select,
      .form-group input {
        padding: 6px 10px;
        border: 1px solid var(--xs-border);
        border-radius: 4px;
        background: var(--xs-bg);
        color: var(--xs-text);
        font-size: 13px;
      }

      .form-group select:focus,
      .form-group input:focus {
        outline: none;
        border-color: var(--xs-status-connected);
      }

      /* Settings dropdown */
      .settings-dropdown {
        position: relative;
      }

      .settings-menu {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 180px;
        background: var(--xs-bg-header);
        border: 1px solid var(--xs-border);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 100;
        padding: 8px 0;
      }

      .settings-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        font-size: 13px;
        cursor: pointer;
      }

      .settings-menu-item:hover {
        background: var(--xs-btn-hover);
      }

      .settings-menu-item select {
        padding: 4px 8px;
        border: 1px solid var(--xs-border);
        border-radius: 3px;
        background: var(--xs-bg);
        color: var(--xs-text);
        font-size: 12px;
      }

      .settings-divider {
        height: 1px;
        background: var(--xs-border);
        margin: 4px 0;
      }

      /* Status bar */
      .status-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
        background: var(--xs-bg-header);
        border-top: 1px solid var(--xs-border);
        font-size: 12px;
        color: var(--xs-text-muted);
      }

      .status-bar-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .status-bar-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status-bar-error {
        color: #ef4444;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .status-bar-success {
        color: var(--xs-status-connected);
      }

      /* Tab bar styles */
      .tab-bar {
        display: flex;
        align-items: center;
        background: var(--xs-bg-header);
        border-bottom: 1px solid var(--xs-border);
        padding: 0 4px;
        gap: 2px;
        min-height: 32px;
        overflow-x: auto;
      }

      .tab-bar::-webkit-scrollbar {
        height: 4px;
      }

      .tab-bar::-webkit-scrollbar-thumb {
        background: var(--xs-border);
        border-radius: 2px;
      }

      .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--xs-text-muted);
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }

      .tab:hover {
        background: var(--xs-btn-hover);
        color: var(--xs-text);
      }

      .tab.active {
        color: var(--xs-text);
        border-bottom-color: var(--xs-status-connected);
        background: var(--xs-bg);
      }

      .tab-status {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--xs-status-disconnected);
      }

      .tab-status.connected {
        background: var(--xs-status-connected);
      }

      .tab-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        background: none;
        border: none;
        color: var(--xs-text-muted);
        font-size: 14px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      .tab:hover .tab-close {
        opacity: 1;
      }

      .tab-close:hover {
        background: var(--xs-btn-hover);
        color: var(--xs-text);
      }

      .tab-add {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        background: none;
        border: none;
        color: var(--xs-text-muted);
        font-size: 18px;
        cursor: pointer;
        margin-left: 4px;
      }

      .tab-add:hover {
        background: var(--xs-btn-hover);
        color: var(--xs-text);
      }

      /* Multi-terminal container */
      .terminals-wrapper {
        flex: 1;
        position: relative;
        overflow: hidden;
      }

      .tab-terminal-container {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 4px;
        background: var(--xs-terminal-bg);
        display: none;
      }

      .tab-terminal-container.active {
        display: block;
      }

      .tab-terminal-container .xterm {
        height: 100%;
      }
    `,
  ];

  // Connection properties
  @property({ type: String }) url = '';
  @property({ type: String }) shell = '';
  @property({ type: String }) cwd = '';
  @property({ type: Number }) cols = 80;
  @property({ type: Number }) rows = 24;
  @property({ type: String, reflect: true }) theme: 'dark' | 'light' | 'auto' = 'dark';
  @property({ type: Boolean, attribute: 'no-header' }) noHeader = false;
  @property({ type: Boolean, attribute: 'auto-connect' }) autoConnect = false;
  @property({ type: Boolean, attribute: 'auto-spawn' }) autoSpawn = false;

  // Docker container properties
  @property({ type: String }) container = '';
  @property({ type: String, attribute: 'container-shell' }) containerShell = '';
  @property({ type: String, attribute: 'container-user' }) containerUser = '';
  @property({ type: String, attribute: 'container-cwd' }) containerCwd = '';

  // UI panel options
  @property({ type: Boolean, attribute: 'show-connection-panel' }) showConnectionPanel = false;
  @property({ type: Boolean, attribute: 'show-settings' }) showSettings = false;
  @property({ type: Boolean, attribute: 'show-status-bar' }) showStatusBar = false;
  @property({ type: Boolean, attribute: 'show-tabs' }) showTabs = false;

  // Terminal appearance
  @property({ type: Number, attribute: 'font-size' }) fontSize = 14;
  @property({ type: String, attribute: 'font-family' }) fontFamily =
    'Menlo, Monaco, "Courier New", monospace';

  // State
  @state() private client: TerminalClient | null = null;
  @state() private terminal: ITerminal | null = null;
  @state() private fitAddon: IFitAddon | null = null;
  @state() private connected = false;
  @state() private sessionActive = false;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private sessionInfo: SessionInfo | null = null;

  // Connection panel state
  @state() private containers: ContainerInfo[] = [];
  @state() private serverInfo: ServerInfo | null = null;
  @state() private selectedContainer = '';
  @state() private selectedShell = '/bin/sh';
  @state() private connectionMode: 'local' | 'docker' | 'join' = 'local';

  // Session multiplexing state
  @state() private availableSessions: SharedSessionInfo[] = [];
  @state() private selectedSessionId = '';
  @state() private clientCount = 1;

  // Settings state
  @state() private settingsMenuOpen = false;

  // Status bar state
  @state() private statusMessage = '';
  @state() private statusType: 'info' | 'error' | 'success' = 'info';

  // Tab state
  @state() private tabs: Tab[] = [];
  @state() private activeTabId = '';
  private tabCounter = 0;

  // xterm.js module (loaded dynamically)
  private xtermModule: any = null;
  private fitAddonModule: any = null;
  private resizeObserver: ResizeObserver | null = null;

  override connectedCallback() {
    super.connectedCallback();

    // Create initial tab if tabs are enabled
    if (this.showTabs && this.tabs.length === 0) {
      this.createTab();
    }

    if (this.autoConnect && this.url) {
      this.connect();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup();
  }

  /**
   * Load xterm.js dynamically
   */
  private async loadXterm(): Promise<void> {
    if (this.xtermModule) return;

    try {
      // Try to import from CDN
      // @ts-ignore - Dynamic import from CDN
      this.xtermModule = await import('https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm');
      // @ts-ignore - Dynamic import from CDN
      this.fitAddonModule = await import('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm');
    } catch (e) {
      // Fallback to npm package if available
      try {
        // @ts-ignore - Optional peer dependency
        this.xtermModule = await import('xterm');
        // @ts-ignore - Optional peer dependency
        this.fitAddonModule = await import('xterm-addon-fit');
      } catch {
        throw new Error('Failed to load xterm.js. Make sure it is available.');
      }
    }

    // Inject xterm CSS into shadow DOM (required because CSS doesn't cross shadow boundaries)
    await this.injectXtermCSS();
  }

  /**
   * Inject xterm.js CSS into shadow DOM
   */
  private async injectXtermCSS(): Promise<void> {
    if (!this.shadowRoot) return;

    // Check if already injected
    if (this.shadowRoot.querySelector('#xterm-styles')) return;

    try {
      // Fetch xterm CSS from CDN
      const response = await fetch('https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css');
      const css = await response.text();

      // Create style element and inject into shadow DOM
      const style = document.createElement('style');
      style.id = 'xterm-styles';
      style.textContent = css;
      this.shadowRoot.prepend(style);
    } catch (e) {
      console.warn('[x-shell] Failed to load xterm CSS:', e);
    }
  }

  /**
   * Connect to the terminal server
   */
  async connect(): Promise<void> {
    if (!this.url) {
      this.error = 'No URL specified';
      return;
    }

    this.loading = true;
    this.error = null;

    try {
      // Load xterm.js
      await this.loadXterm();

      // Create client
      this.client = new TerminalClient({ url: this.url });

      this.client.onConnect(() => {
        this.connected = true;
        this.dispatchEvent(new CustomEvent('connect', { bubbles: true, composed: true }));

        if (this.autoSpawn) {
          this.spawn();
        }
      });

      this.client.onDisconnect(() => {
        this.connected = false;
        this.sessionActive = false;
        this.dispatchEvent(new CustomEvent('disconnect', { bubbles: true, composed: true }));
      });

      this.client.onError((err) => {
        this.error = err.message;
        this.setStatus(err.message, 'error');
        this.dispatchEvent(
          new CustomEvent('error', { detail: { error: err }, bubbles: true, composed: true })
        );
      });

      // Capture reference to this client for use in closures
      const client = this.client;

      this.client.onData((data) => {
        // Find the terminal that belongs to this client (for multi-tab support)
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client);
          if (tab?.terminal) {
            tab.terminal.write(data);
          }
        } else if (this.terminal) {
          this.terminal.write(data);
        }
      });

      this.client.onExit((code) => {
        // Find the tab that belongs to this client
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client);
          if (tab) {
            tab.sessionActive = false;
            tab.sessionInfo = null;
            if (tab.terminal) {
              tab.terminal.writeln('');
              tab.terminal.writeln(`\x1b[1;33m[Process exited with code: ${code}]\x1b[0m`);
            }
            // Update component state if this is the active tab
            if (tab.id === this.activeTabId) {
              this.sessionActive = false;
              this.sessionInfo = null;
            }
            this.tabs = [...this.tabs]; // Trigger re-render
          }
        } else {
          this.sessionActive = false;
          this.sessionInfo = null;
          if (this.terminal) {
            this.terminal.writeln('');
            this.terminal.writeln(`\x1b[1;33m[Process exited with code: ${code}]\x1b[0m`);
          }
        }
        this.dispatchEvent(
          new CustomEvent('exit', { detail: { exitCode: code }, bubbles: true, composed: true })
        );
      });

      this.client.onSpawned((info) => {
        // Update tab-specific state
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client);
          if (tab) {
            tab.sessionInfo = info;
            tab.sessionActive = true;
            // Update label to show shell/container
            tab.label = info.container || info.shell.split('/').pop() || 'Terminal';
            this.tabs = [...this.tabs];
          }
        }
        this.sessionInfo = info;
        this.setStatus(`Session started: ${info.container || info.shell}`, 'success');
        this.dispatchEvent(
          new CustomEvent('spawned', { detail: { session: info }, bubbles: true, composed: true })
        );
      });

      // Server info and container list handlers
      this.client.onServerInfo((info) => {
        this.serverInfo = info;
        if (info.dockerEnabled) {
          this.connectionMode = 'docker';
          this.client?.requestContainerList();
        }
        this.selectedShell = info.defaultShell;
      });

      this.client.onContainerList((containers) => {
        this.containers = containers;
        if (containers.length > 0 && !this.selectedContainer) {
          this.selectedContainer = containers[0].name;
        }
      });

      // Multiplexing event handlers
      this.client.onSessionList((sessions) => {
        this.availableSessions = sessions;
        if (sessions.length > 0 && !this.selectedSessionId) {
          this.selectedSessionId = sessions[0].sessionId;
        }
      });

      this.client.onClientJoined((sessionId, count) => {
        // Update tab-specific state
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client);
          if (tab) {
            tab.clientCount = count;
            this.tabs = [...this.tabs];
          }
        }
        this.clientCount = count;
        this.setStatus(`Client joined (${count} total)`, 'info');
      });

      this.client.onClientLeft((sessionId, count) => {
        // Update tab-specific state
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client);
          if (tab) {
            tab.clientCount = count;
            this.tabs = [...this.tabs];
          }
        }
        this.clientCount = count;
        this.setStatus(`Client left (${count} remaining)`, 'info');
      });

      this.client.onSessionClosed((sessionId, reason) => {
        // Update tab-specific state
        if (this.showTabs) {
          const tab = this.tabs.find((t) => t.client === client && t.sessionInfo?.sessionId === sessionId);
          if (tab) {
            tab.sessionActive = false;
            tab.sessionInfo = null;
            this.tabs = [...this.tabs];
          }
        }
        if (this.sessionInfo?.sessionId === sessionId) {
          this.sessionActive = false;
          this.sessionInfo = null;
          this.setStatus(`Session closed: ${reason}`, 'info');
        }
        // Refresh session list
        client.requestSessionList();
      });

      await this.client.connect();

      // Request session list after connecting
      this.client.requestSessionList();

      // Sync state to active tab
      if (this.showTabs) {
        this.syncStateToActiveTab();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Connection failed';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.connected = false;
    this.sessionActive = false;
  }

  /**
   * Spawn a terminal session
   */
  async spawn(options?: TerminalOptions): Promise<SessionInfo> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to server');
    }

    this.loading = true;
    this.error = null;

    try {
      // Initialize terminal UI if needed
      await this.initTerminalUI();

      // Spawn session
      const spawnOptions: TerminalOptions = {
        shell: options?.shell || this.shell || undefined,
        cwd: options?.cwd || this.cwd || undefined,
        cols: this.terminal?.cols || this.cols,
        rows: this.terminal?.rows || this.rows,
        env: options?.env,
        // Docker container options
        container: options?.container || this.container || undefined,
        containerShell: options?.containerShell || this.containerShell || undefined,
        containerUser: options?.containerUser || this.containerUser || undefined,
        containerCwd: options?.containerCwd || this.containerCwd || undefined,
      };

      const info = await this.client.spawn(spawnOptions);
      this.sessionActive = true;
      this.sessionInfo = info;

      // Sync state to active tab
      if (this.showTabs) {
        this.syncStateToActiveTab();
      }

      // Refresh session list so other tabs can see this session
      this.client.requestSessionList();

      // Focus terminal
      if (this.terminal) {
        this.terminal.focus();
      }

      return info;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to spawn session';
      throw err;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Initialize xterm.js UI
   */
  private async initTerminalUI(): Promise<void> {
    if (this.terminal) return;

    await this.loadXterm();
    await this.updateComplete;

    // Get the correct container (either single terminal or tab-specific)
    let container: Element | null = null;
    if (this.showTabs && this.activeTabId) {
      container = this.shadowRoot?.querySelector(`.tab-terminal-container[data-tab-id="${this.activeTabId}"]`) ?? null;
    } else {
      container = this.shadowRoot?.querySelector('.terminal-container') ?? null;
    }
    if (!container) return;

    // Get theme colors
    const terminalTheme = this.getTerminalTheme();

    // Create terminal
    const Terminal = this.xtermModule.Terminal;
    const term: ITerminal = new Terminal({
      cursorBlink: true,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      theme: terminalTheme,
      cols: this.cols,
      rows: this.rows,
    });

    // Create fit addon
    const FitAddon = this.fitAddonModule.FitAddon;
    const fit: IFitAddon = new FitAddon();

    // Store references
    this.terminal = term;
    this.fitAddon = fit;

    term.loadAddon(fit);

    // Open terminal
    term.open(container as HTMLElement);
    fit.fit();

    // Handle user input
    term.onData((data: string) => {
      if (this.client && this.sessionActive) {
        this.client.write(data);
      }
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      if (this.client && this.sessionActive) {
        this.client.resize(cols, rows);
      }
    });

    // Setup resize observer for this container
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        // Fit all visible terminals
        if (this.showTabs) {
          const activeTab = this.getActiveTab();
          if (activeTab?.fitAddon) {
            activeTab.fitAddon.fit();
          }
        } else if (this.fitAddon) {
          this.fitAddon.fit();
        }
      });
    }
    this.resizeObserver.observe(container);

    // Sync to active tab if in tab mode
    if (this.showTabs) {
      this.syncStateToActiveTab();
    }
  }

  /**
   * Get terminal theme based on component theme
   */
  private getTerminalTheme(): any {
    // Determine effective theme (handle 'auto' by checking system preference)
    let effectiveTheme = this.theme;
    if (this.theme === 'auto') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    if (effectiveTheme === 'light') {
      return {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        cursorAccent: '#ffffff',
        selection: '#b4d5fe',
        selectionForeground: '#1f2937',
      };
    }

    // Dark theme
    return {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      cursorAccent: '#1e1e1e',
      selection: '#264f78',
      selectionForeground: '#ffffff',
    };
  }

  /**
   * Kill the current session
   */
  kill(): void {
    if (this.client) {
      this.client.kill();
    }
    this.sessionActive = false;
    this.sessionInfo = null;
  }

  /**
   * Clear the terminal
   */
  clear(): void {
    if (this.terminal) {
      this.terminal.clear();
    }
  }

  /**
   * Write data to the terminal (display only, not sent to server)
   */
  write(data: string): void {
    if (this.terminal) {
      this.terminal.write(data);
    }
  }

  /**
   * Write line to the terminal (display only, not sent to server)
   */
  writeln(data: string): void {
    if (this.terminal) {
      this.terminal.writeln(data);
    }
  }

  /**
   * Focus the terminal
   */
  override focus(): void {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.fitAddon = null;
  }

  // ==================== Tab Management Methods ====================

  /**
   * Get the active tab
   */
  private getActiveTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  /**
   * Create a new tab
   */
  createTab(label?: string): Tab {
    this.tabCounter++;
    const tab: Tab = {
      id: `tab-${this.tabCounter}`,
      label: label || `Terminal ${this.tabCounter}`,
      client: null,
      terminal: null,
      fitAddon: null,
      connected: false,
      sessionActive: false,
      sessionInfo: null,
      clientCount: 1,
      containerEl: null,
    };

    this.tabs = [...this.tabs, tab];

    // Switch to the new tab
    this.switchTab(tab.id);

    return tab;
  }

  /**
   * Switch to a tab
   */
  switchTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    this.activeTabId = tabId;

    // Sync state from tab to component (for backward compatibility with single-terminal code)
    this.client = tab.client;
    this.terminal = tab.terminal;
    this.fitAddon = tab.fitAddon;
    this.connected = tab.connected;
    this.sessionActive = tab.sessionActive;
    this.sessionInfo = tab.sessionInfo;
    this.clientCount = tab.clientCount;

    // Focus the terminal and fit it
    this.updateComplete.then(() => {
      if (tab.terminal) {
        tab.terminal.focus();
      }
      if (tab.fitAddon) {
        tab.fitAddon.fit();
      }
    });
  }

  /**
   * Close a tab
   */
  closeTab(tabId: string): void {
    const tabIndex = this.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];

    // Cleanup tab resources
    if (tab.terminal) {
      tab.terminal.dispose();
    }
    if (tab.client) {
      tab.client.disconnect();
    }

    // Remove tab
    this.tabs = this.tabs.filter((t) => t.id !== tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId && this.tabs.length > 0) {
      // Switch to previous tab, or first if we were first
      const newIndex = Math.max(0, tabIndex - 1);
      this.switchTab(this.tabs[newIndex].id);
    }

    // If no tabs left, clear state
    if (this.tabs.length === 0) {
      this.activeTabId = '';
      this.client = null;
      this.terminal = null;
      this.fitAddon = null;
      this.connected = false;
      this.sessionActive = false;
      this.sessionInfo = null;
    }
  }

  /**
   * Update the active tab's state from component state
   */
  private syncStateToActiveTab(): void {
    const tab = this.getActiveTab();
    if (tab) {
      tab.client = this.client;
      tab.terminal = this.terminal;
      tab.fitAddon = this.fitAddon;
      tab.connected = this.connected;
      tab.sessionActive = this.sessionActive;
      tab.sessionInfo = this.sessionInfo;
      tab.clientCount = this.clientCount;
      // Trigger re-render
      this.tabs = [...this.tabs];
    }
  }

  /**
   * Render the tab bar
   */
  private renderTabBar() {
    if (!this.showTabs) return nothing;

    return html`
      <div class="tab-bar">
        ${this.tabs.map(
          (tab) => html`
            <button
              class="tab ${tab.id === this.activeTabId ? 'active' : ''}"
              @click=${() => this.switchTab(tab.id)}
            >
              <span class="tab-status ${tab.sessionActive ? 'connected' : ''}"></span>
              <span>${tab.label}</span>
              ${this.tabs.length > 1
                ? html`
                    <button
                      class="tab-close"
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this.closeTab(tab.id);
                      }}
                      title="Close tab"
                    >
                      ×
                    </button>
                  `
                : nothing}
            </button>
          `
        )}
        <button class="tab-add" @click=${() => this.createTab()} title="New tab">
          +
        </button>
      </div>
    `;
  }

  // ==================== End Tab Management Methods ====================

  /**
   * Set status message
   */
  private setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    this.statusMessage = message;
    this.statusType = type;

    // Auto-clear success/info messages after 5 seconds
    if (type !== 'error') {
      setTimeout(() => {
        if (this.statusMessage === message) {
          this.statusMessage = '';
        }
      }, 5000);
    }
  }

  /**
   * Clear status message
   */
  clearStatus(): void {
    this.statusMessage = '';
    this.statusType = 'info';
  }

  /**
   * Handle theme change
   */
  private handleThemeChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.theme = select.value as 'dark' | 'light' | 'auto';

    // Apply theme to xterm.js terminal
    this.applyTerminalTheme();

    this.dispatchEvent(new CustomEvent('theme-change', {
      detail: { theme: this.theme },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Apply current theme to xterm.js terminal
   */
  private applyTerminalTheme(): void {
    if (!this.terminal) return;

    const terminalTheme = this.getTerminalTheme();
    this.terminal.options.theme = terminalTheme;
  }

  /**
   * Apply current font size to xterm.js terminal
   */
  private applyTerminalFontSize(): void {
    if (!this.terminal) return;

    this.terminal.options.fontSize = this.fontSize;

    // Re-fit the terminal after font size change
    if (this.fitAddon) {
      this.fitAddon.fit();
    }
  }

  /**
   * Handle connection mode change
   */
  private handleModeChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.connectionMode = select.value as 'local' | 'docker' | 'join';

    if (this.connectionMode === 'docker' && this.client && this.connected) {
      this.client.requestContainerList();
    }
    if (this.connectionMode === 'join' && this.client && this.connected) {
      this.client.requestSessionList();
    }
  }

  /**
   * Refresh session list
   */
  private refreshSessions(): void {
    if (this.client && this.connected) {
      this.client.requestSessionList();
    }
  }

  /**
   * Join an existing session
   */
  async join(sessionId: string, requestHistory = true): Promise<SharedSessionInfo> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to server');
    }

    this.loading = true;
    this.error = null;

    try {
      // Initialize terminal UI if needed
      await this.initTerminalUI();

      const session = await this.client.join({
        sessionId,
        requestHistory,
        historyLimit: 50000,
      });

      this.sessionActive = true;
      this.sessionInfo = {
        sessionId: session.sessionId,
        shell: session.shell,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        createdAt: session.createdAt || new Date(),
        container: session.container,
      };
      this.clientCount = session.clientCount;

      // Sync state to active tab
      if (this.showTabs) {
        this.syncStateToActiveTab();
      }

      this.setStatus(`Joined session (${session.clientCount} clients)`, 'success');

      // Focus terminal
      if (this.terminal) {
        this.terminal.focus();
      }

      return session;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to join session';
      throw err;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Leave current session without killing it
   */
  leave(): void {
    if (this.client && this.sessionInfo) {
      this.client.leave(this.sessionInfo.sessionId);
      this.sessionActive = false;
      this.sessionInfo = null;
      this.setStatus('Left session', 'info');
    }
  }

  /**
   * Handle connect from connection panel
   */
  private async handlePanelConnect(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.connected) {
      if (this.connectionMode === 'join' && this.selectedSessionId) {
        // Join existing session
        await this.join(this.selectedSessionId);
      } else {
        // Spawn new session
        const options: TerminalOptions = {};

        if (this.connectionMode === 'docker' && this.selectedContainer) {
          options.container = this.selectedContainer;
          options.containerShell = this.selectedShell || '/bin/sh';
        } else {
          options.shell = this.selectedShell || undefined;
        }

        await this.spawn(options);
      }
    }
  }

  /**
   * Toggle settings menu
   */
  private toggleSettingsMenu(): void {
    this.settingsMenuOpen = !this.settingsMenuOpen;
  }

  /**
   * Render connection panel
   */
  private renderConnectionPanel() {
    if (!this.showConnectionPanel) return nothing;

    const runningContainers = this.containers.filter(c => c.state === 'running');
    const acceptingSessions = this.availableSessions.filter(s => s.accepting);

    return html`
      <div class="connection-panel">
        <div class="connection-panel-title">
          <span>Connection</span>
          ${this.availableSessions.length > 0
            ? html`<span style="font-size: 11px; color: var(--xs-status-connected);">${this.availableSessions.length} session(s) available</span>`
            : nothing}
          ${this.serverInfo?.dockerEnabled
            ? html`<span style="font-size: 11px; color: var(--xs-text-muted);">Docker enabled</span>`
            : nothing}
        </div>
        <div class="connection-form">
          <div class="form-group">
            <label>Mode</label>
            <select
              .value=${this.connectionMode}
              @change=${this.handleModeChange}
              ?disabled=${this.sessionActive}
            >
              <option value="local">New Local Shell</option>
              ${this.serverInfo?.dockerEnabled
                ? html`<option value="docker">New Docker Session</option>`
                : nothing}
              ${acceptingSessions.length > 0
                ? html`<option value="join">Join Existing Session</option>`
                : nothing}
            </select>
          </div>

          ${this.connectionMode === 'join' ? html`
            <div class="form-group">
              <label style="display: flex; justify-content: space-between; align-items: center;">
                <span>Session</span>
                <button
                  style="font-size: 10px; padding: 2px 6px;"
                  @click=${this.refreshSessions}
                  ?disabled=${!this.connected}
                >Refresh</button>
              </label>
              <select
                .value=${this.selectedSessionId}
                @change=${(e: Event) => this.selectedSessionId = (e.target as HTMLSelectElement).value}
                ?disabled=${this.sessionActive}
              >
                ${acceptingSessions.length === 0
                  ? html`<option value="">No sessions available</option>`
                  : acceptingSessions.map(s => html`
                      <option value=${s.sessionId}>
                        ${s.label || s.sessionId.substring(0, 12)}
                        (${s.type === 'local' ? s.shell : s.container || s.type})
                        - ${s.clientCount} client(s)
                      </option>
                    `)}
              </select>
            </div>
          ` : this.connectionMode === 'docker' ? html`
            <div class="form-group">
              <label>Container</label>
              <select
                .value=${this.selectedContainer}
                @change=${(e: Event) => this.selectedContainer = (e.target as HTMLSelectElement).value}
                ?disabled=${this.sessionActive}
              >
                ${runningContainers.length === 0
                  ? html`<option value="">No containers running</option>`
                  : runningContainers.map(c => html`
                      <option value=${c.name}>${c.name} (${c.image})</option>
                    `)}
              </select>
            </div>
          ` : nothing}

          ${this.connectionMode !== 'join' ? html`
            <div class="form-group">
              <label>Shell</label>
              <select
                .value=${this.selectedShell}
                @change=${(e: Event) => this.selectedShell = (e.target as HTMLSelectElement).value}
                ?disabled=${this.sessionActive}
              >
                ${this.serverInfo?.allowedShells.length
                  ? this.serverInfo.allowedShells.map(s => html`<option value=${s}>${s}</option>`)
                  : html`
                      <option value="/bin/bash">/bin/bash</option>
                      <option value="/bin/sh">/bin/sh</option>
                      <option value="/bin/zsh">/bin/zsh</option>
                    `}
              </select>
            </div>
          ` : nothing}

          <div class="form-group">
            ${!this.connected
              ? html`<button class="btn-primary" @click=${this.handlePanelConnect} ?disabled=${this.loading}>
                  ${this.loading ? 'Connecting...' : 'Connect'}
                </button>`
              : !this.sessionActive
              ? html`<button class="btn-primary" @click=${this.handlePanelConnect} ?disabled=${this.loading || (this.connectionMode === 'join' && !this.selectedSessionId)}>
                  ${this.loading ? 'Starting...' : this.connectionMode === 'join' ? 'Join Session' : 'Start Session'}
                </button>`
              : html`<button class="btn-danger" @click=${this.kill}>
                  ${this.clientCount > 1 ? 'Leave Session' : 'Stop Session'}
                </button>`}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render settings dropdown
   */
  private renderSettingsDropdown() {
    if (!this.showSettings) return nothing;

    return html`
      <div class="settings-dropdown">
        <button @click=${this.toggleSettingsMenu} title="Settings">
          ⚙️
        </button>
        ${this.settingsMenuOpen ? html`
          <div class="settings-menu">
            <div class="settings-menu-item">
              <span>Theme</span>
              <select
                .value=${this.theme}
                @change=${this.handleThemeChange}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-menu-item">
              <span>Font Size</span>
              <select
                .value=${String(this.fontSize)}
                @change=${(e: Event) => {
                  this.fontSize = parseInt((e.target as HTMLSelectElement).value);
                  this.applyTerminalFontSize();
                }}
              >
                <option value="12">12px</option>
                <option value="14">14px</option>
                <option value="16">16px</option>
                <option value="18">18px</option>
              </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-menu-item" @click=${this.clear}>
              <span>Clear Terminal</span>
            </div>
          </div>
        ` : nothing}
      </div>
    `;
  }

  /**
   * Render status bar
   */
  private renderStatusBar() {
    if (!this.showStatusBar) return nothing;

    return html`
      <div class="status-bar">
        <div class="status-bar-left">
          <span class="status-dot ${this.connected ? 'connected' : ''}"></span>
          <span>${this.connected
            ? (this.sessionActive ? 'Session active' : 'Connected')
            : 'Disconnected'}</span>
          ${this.sessionInfo ? html`
            <span style="color: var(--xs-text-muted)">|</span>
            <span>${this.sessionInfo.container || this.sessionInfo.shell}</span>
            <span style="color: var(--xs-text-muted)">${this.sessionInfo.cols}x${this.sessionInfo.rows}</span>
          ` : nothing}
        </div>
        <div class="status-bar-right">
          ${this.statusMessage ? html`
            <span class="${this.statusType === 'error' ? 'status-bar-error' : this.statusType === 'success' ? 'status-bar-success' : ''}">
              ${this.statusType === 'error' ? '⚠️' : this.statusType === 'success' ? '✓' : ''}
              ${this.statusMessage}
            </span>
            <button
              style="background: none; border: none; cursor: pointer; padding: 0; font-size: 10px;"
              @click=${this.clearStatus}
              title="Dismiss"
            >✕</button>
          ` : nothing}
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      ${this.noHeader
        ? nothing
        : html`
            <div class="header">
              <div class="header-title">
                <span>Terminal</span>
                ${this.sessionInfo
                  ? html`<span style="font-weight: normal; font-size: 12px; color: var(--xs-text-muted)">
                      ${this.sessionInfo.container
                        ? `${this.sessionInfo.container} (${this.sessionInfo.shell})`
                        : this.sessionInfo.shell}
                    </span>`
                  : nothing}
              </div>
              <div class="header-actions">
                ${!this.showConnectionPanel ? html`
                  ${!this.connected
                    ? html`<button @click=${this.connect} ?disabled=${this.loading}>
                        ${this.loading ? 'Connecting...' : 'Connect'}
                      </button>`
                    : !this.sessionActive
                    ? html`<button @click=${() => this.spawn()} ?disabled=${this.loading}>
                        ${this.loading ? 'Spawning...' : 'Start'}
                      </button>`
                    : html`<button @click=${this.kill}>Stop</button>`}
                ` : nothing}
                <button @click=${this.clear} ?disabled=${!this.sessionActive}>Clear</button>
                ${this.renderSettingsDropdown()}
                ${!this.showStatusBar ? html`
                  <div class="status">
                    <span class="status-dot ${this.connected ? 'connected' : ''}"></span>
                    <span>${this.connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                ` : nothing}
              </div>
            </div>
          `}

      ${this.renderConnectionPanel()}
      ${this.renderTabBar()}

      ${this.showTabs && this.tabs.length > 0
        ? html`
            <div class="terminals-wrapper">
              ${this.tabs.map(
                (tab) => html`
                  <div
                    class="tab-terminal-container ${tab.id === this.activeTabId ? 'active' : ''}"
                    data-tab-id=${tab.id}
                  >
                    ${this.loading && tab.id === this.activeTabId && !tab.terminal
                      ? html`<div class="loading"><span class="loading-spinner">⏳</span> Loading...</div>`
                      : this.error && tab.id === this.activeTabId && !tab.terminal
                      ? html`<div class="error">❌ ${this.error}</div>`
                      : nothing}
                  </div>
                `
              )}
            </div>
          `
        : html`
            <div class="terminal-container">
              ${this.loading && !this.terminal
                ? html`<div class="loading"><span class="loading-spinner">⏳</span> Loading...</div>`
                : this.error && !this.terminal
                ? html`<div class="error">❌ ${this.error}</div>`
                : nothing}
            </div>
          `}

      ${this.renderStatusBar()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x-shell-terminal': XShellTerminal;
  }
}
