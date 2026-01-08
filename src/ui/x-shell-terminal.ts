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
import type { TerminalOptions, SessionInfo } from '../shared/types.js';

// xterm.js types (loaded dynamically)
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
}

interface IFitAddon {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
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

  // xterm.js module (loaded dynamically)
  private xtermModule: any = null;
  private fitAddonModule: any = null;
  private resizeObserver: ResizeObserver | null = null;

  override connectedCallback() {
    super.connectedCallback();

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
        this.dispatchEvent(
          new CustomEvent('error', { detail: { error: err }, bubbles: true, composed: true })
        );
      });

      this.client.onData((data) => {
        if (this.terminal) {
          this.terminal.write(data);
        }
      });

      this.client.onExit((code) => {
        this.sessionActive = false;
        this.sessionInfo = null;
        if (this.terminal) {
          this.terminal.writeln('');
          this.terminal.writeln(`\x1b[1;33m[Process exited with code: ${code}]\x1b[0m`);
        }
        this.dispatchEvent(
          new CustomEvent('exit', { detail: { exitCode: code }, bubbles: true, composed: true })
        );
      });

      this.client.onSpawned((info) => {
        this.sessionInfo = info;
        this.dispatchEvent(
          new CustomEvent('spawned', { detail: { session: info }, bubbles: true, composed: true })
        );
      });

      await this.client.connect();
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
  async spawn(options?: TerminalOptions): Promise<void> {
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

      // Focus terminal
      if (this.terminal) {
        this.terminal.focus();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to spawn session';
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

    const container = this.shadowRoot?.querySelector('.terminal-container');
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

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon) {
        this.fitAddon.fit();
      }
    });
    this.resizeObserver.observe(container);
  }

  /**
   * Get terminal theme based on component theme
   */
  private getTerminalTheme(): any {
    // These will be overridden by CSS variables in the actual implementation
    // For now, provide sensible defaults based on theme attribute
    if (this.theme === 'light') {
      return {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        selection: '#b4d5fe',
      };
    }

    return {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      selection: '#264f78',
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
                ${!this.connected
                  ? html`<button @click=${this.connect} ?disabled=${this.loading}>
                      ${this.loading ? 'Connecting...' : 'Connect'}
                    </button>`
                  : !this.sessionActive
                  ? html`<button @click=${() => this.spawn()} ?disabled=${this.loading}>
                      ${this.loading ? 'Spawning...' : 'Start'}
                    </button>`
                  : html`<button @click=${this.kill}>Stop</button>`}
                <button @click=${this.clear} ?disabled=${!this.sessionActive}>Clear</button>
                <div class="status">
                  <span class="status-dot ${this.connected ? 'connected' : ''}"></span>
                  <span>${this.connected ? 'Connected' : 'Disconnected'}</span>
                </div>
              </div>
            </div>
          `}

      <div class="terminal-container">
        ${this.loading && !this.terminal
          ? html`<div class="loading"><span class="loading-spinner">⏳</span> Loading...</div>`
          : this.error && !this.terminal
          ? html`<div class="error">❌ ${this.error}</div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'x-shell-terminal': XShellTerminal;
  }
}
