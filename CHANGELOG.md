# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-09

### Added

- **Tabbed Terminals**: New `show-tabs` attribute enables multiple terminal tabs in a single component
  - Each tab has independent WebSocket connection and terminal session
  - Tab bar with status indicators and add/close buttons
  - Dynamic labels showing shell or container name
  - `createTab()`, `switchTab()`, `closeTab()` methods
- **Join Existing Session**: Connection panel now shows "Join Existing Session" mode when sessions are available
- **Prompt Refresh on Join**: Joining a session now triggers a fresh prompt display

### Fixed

- Fixed duplicate output when multiple tabs join the same session
- Fixed session list not updating after spawning a session
- Each client's data handler now correctly writes to its own tab's terminal

## [1.0.0] - 2025-01-08

### Added

- Initial release
- WebSocket-based terminal server with node-pty
- Lightweight client library with auto-reconnection
- `<x-shell-terminal>` Lit web component with xterm.js
- Docker exec support for connecting to containers
- Docker attach mode for connecting to container's main process (PID 1)
- Session multiplexing - multiple clients sharing the same terminal
- Session persistence with configurable orphan timeout
- History replay for clients joining existing sessions
- Built-in connection panel with container/shell selector
- Settings dropdown (theme, font size)
- Status bar with connection info
- Dark/light/auto theme support
- Security features: shell, path, and container allowlists
- Python client bindings (`bindings/python/`)
- Example projects for Docker containers and multiplexing
