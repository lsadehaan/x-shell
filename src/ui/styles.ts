/**
 * Shared styles for x-shell UI components
 */

import { css } from 'lit';

/**
 * Theme styles - sets CSS custom properties based on theme attribute
 */
export const themeStyles = css`
  /* Light theme */
  :host([theme='light']) {
    --xs-bg: #ffffff;
    --xs-bg-header: #f5f5f5;
    --xs-text: #1f2937;
    --xs-text-muted: #6b7280;
    --xs-border: #e5e7eb;
    --xs-terminal-bg: #ffffff;
    --xs-terminal-fg: #1f2937;
    --xs-terminal-cursor: #1f2937;
    --xs-terminal-selection: #b4d5fe;
    --xs-btn-bg: #e5e7eb;
    --xs-btn-text: #374151;
    --xs-btn-hover: #d1d5db;
    --xs-status-connected: #22c55e;
    --xs-status-disconnected: #ef4444;
  }

  /* Dark theme (default) */
  :host,
  :host([theme='dark']) {
    --xs-bg: #1e1e1e;
    --xs-bg-header: #2d2d2d;
    --xs-text: #cccccc;
    --xs-text-muted: #808080;
    --xs-border: #3e3e3e;
    --xs-terminal-bg: #1e1e1e;
    --xs-terminal-fg: #cccccc;
    --xs-terminal-cursor: #ffffff;
    --xs-terminal-selection: #264f78;
    --xs-btn-bg: #3c3c3c;
    --xs-btn-text: #cccccc;
    --xs-btn-hover: #4a4a4a;
    --xs-status-connected: #22c55e;
    --xs-status-disconnected: #ef4444;
  }

  /* Auto theme - follows system preference */
  :host([theme='auto']) {
    --xs-bg: #1e1e1e;
    --xs-bg-header: #2d2d2d;
    --xs-text: #cccccc;
    --xs-text-muted: #808080;
    --xs-border: #3e3e3e;
    --xs-terminal-bg: #1e1e1e;
    --xs-terminal-fg: #cccccc;
    --xs-terminal-cursor: #ffffff;
    --xs-terminal-selection: #264f78;
    --xs-btn-bg: #3c3c3c;
    --xs-btn-text: #cccccc;
    --xs-btn-hover: #4a4a4a;
    --xs-status-connected: #22c55e;
    --xs-status-disconnected: #ef4444;
  }

  @media (prefers-color-scheme: light) {
    :host([theme='auto']) {
      --xs-bg: #ffffff;
      --xs-bg-header: #f5f5f5;
      --xs-text: #1f2937;
      --xs-text-muted: #6b7280;
      --xs-border: #e5e7eb;
      --xs-terminal-bg: #ffffff;
      --xs-terminal-fg: #1f2937;
      --xs-terminal-cursor: #1f2937;
      --xs-terminal-selection: #b4d5fe;
      --xs-btn-bg: #e5e7eb;
      --xs-btn-text: #374151;
      --xs-btn-hover: #d1d5db;
    }
  }
`;

/**
 * Shared base styles
 */
export const sharedStyles = css`
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, sans-serif;
    font-size: 14px;
    color: var(--xs-text);
    background: var(--xs-bg);
  }

  * {
    box-sizing: border-box;
  }
`;

/**
 * Button styles
 */
export const buttonStyles = css`
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    background: var(--xs-btn-bg);
    color: var(--xs-btn-text);
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  button:hover {
    background: var(--xs-btn-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.btn-primary,
  .btn-primary {
    background: var(--xs-status-connected);
    color: #ffffff;
  }

  button.btn-primary:hover,
  .btn-primary:hover {
    background: #16a34a;
  }

  button.btn-danger,
  .btn-danger {
    background: var(--xs-status-disconnected);
    color: #ffffff;
  }

  button.btn-danger:hover,
  .btn-danger:hover {
    background: #dc2626;
  }
`;
