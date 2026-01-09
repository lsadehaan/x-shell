"""
x-shell Terminal Client for Python.

Async WebSocket client for connecting to x-shell terminal servers.
"""

import asyncio
import json
import logging
from typing import Optional, Callable, List, Any
from dataclasses import asdict

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:
    raise ImportError(
        "websockets package is required. Install with: pip install websockets"
    )

from .types import (
    SessionInfo,
    SharedSessionInfo,
    TerminalOptions,
    JoinOptions,
    SessionListFilter,
)

logger = logging.getLogger(__name__)


class TerminalClient:
    """
    Async WebSocket client for x-shell terminal servers.

    Usage:
        async with TerminalClient("ws://localhost:3000/terminal") as client:
            session = await client.spawn(shell="/bin/bash")
            client.on_data(print)
            await client.write("ls\\n")

    Or without context manager:
        client = TerminalClient("ws://localhost:3000/terminal")
        await client.connect()
        # ... use client ...
        await client.disconnect()
    """

    def __init__(
        self,
        url: str,
        reconnect: bool = True,
        max_reconnect_attempts: int = 10,
        reconnect_delay: float = 1.0,
    ):
        """
        Initialize the terminal client.

        Args:
            url: WebSocket URL (e.g., "ws://localhost:3000/terminal")
            reconnect: Whether to auto-reconnect on disconnect
            max_reconnect_attempts: Maximum reconnection attempts
            reconnect_delay: Initial delay between reconnection attempts (seconds)
        """
        self.url = url
        self.reconnect = reconnect
        self.max_reconnect_attempts = max_reconnect_attempts
        self.reconnect_delay = reconnect_delay

        self._ws: Optional[WebSocketClientProtocol] = None
        self._connected = False
        self._session_id: Optional[str] = None
        self._session_info: Optional[SessionInfo] = None
        self._reconnect_attempts = 0
        self._receive_task: Optional[asyncio.Task] = None
        self._pending_requests: dict[str, asyncio.Future] = {}
        self._request_id = 0

        # Event handlers
        self._on_connect: List[Callable[[], None]] = []
        self._on_disconnect: List[Callable[[], None]] = []
        self._on_data: List[Callable[[str], None]] = []
        self._on_exit: List[Callable[[int], None]] = []
        self._on_error: List[Callable[[Exception], None]] = []
        self._on_spawned: List[Callable[[SessionInfo], None]] = []
        self._on_client_joined: List[Callable[[str, int], None]] = []
        self._on_client_left: List[Callable[[str, int], None]] = []
        self._on_session_closed: List[Callable[[str, str], None]] = []

    async def __aenter__(self) -> "TerminalClient":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.disconnect()

    # =========================================================================
    # Connection Management
    # =========================================================================

    async def connect(self) -> None:
        """Connect to the terminal server."""
        if self._connected:
            return

        try:
            self._ws = await websockets.connect(self.url)
            self._connected = True
            self._reconnect_attempts = 0

            # Start receive loop
            self._receive_task = asyncio.create_task(self._receive_loop())

            # Notify handlers
            for handler in self._on_connect:
                try:
                    handler()
                except Exception as e:
                    logger.error(f"Error in connect handler: {e}")

            logger.info(f"Connected to {self.url}")

        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            for handler in self._on_error:
                try:
                    handler(e)
                except Exception:
                    pass
            raise

    async def disconnect(self) -> None:
        """Disconnect from the terminal server."""
        self._connected = False

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        if self._ws:
            await self._ws.close()
            self._ws = None

        self._session_id = None
        self._session_info = None

        # Notify handlers
        for handler in self._on_disconnect:
            try:
                handler()
            except Exception as e:
                logger.error(f"Error in disconnect handler: {e}")

        logger.info("Disconnected")

    def is_connected(self) -> bool:
        """Check if connected to the server."""
        return self._connected and self._ws is not None

    def has_active_session(self) -> bool:
        """Check if there's an active terminal session."""
        return self._session_id is not None

    def get_session_id(self) -> Optional[str]:
        """Get the current session ID."""
        return self._session_id

    def get_session_info(self) -> Optional[SessionInfo]:
        """Get information about the current session."""
        return self._session_info

    # =========================================================================
    # Session Management
    # =========================================================================

    async def spawn(
        self,
        shell: Optional[str] = None,
        cwd: Optional[str] = None,
        cols: int = 80,
        rows: int = 24,
        env: Optional[dict] = None,
        container: Optional[str] = None,
        container_shell: Optional[str] = None,
        container_user: Optional[str] = None,
        container_cwd: Optional[str] = None,
        attach_mode: bool = False,
        label: Optional[str] = None,
        allow_join: bool = True,
        enable_history: bool = True,
    ) -> SessionInfo:
        """
        Spawn a new terminal session.

        Args:
            shell: Shell to use (e.g., "/bin/bash")
            cwd: Working directory
            cols: Terminal columns
            rows: Terminal rows
            env: Environment variables
            container: Docker container name/ID
            container_shell: Shell to use inside container
            container_user: User to run as in container
            container_cwd: Working directory in container
            attach_mode: Use docker attach instead of exec
            label: Session label for identification
            allow_join: Allow other clients to join
            enable_history: Enable history buffer

        Returns:
            SessionInfo with session details
        """
        if not self.is_connected():
            raise RuntimeError("Not connected to server")

        options = {
            "cols": cols,
            "rows": rows,
        }

        if shell:
            options["shell"] = shell
        if cwd:
            options["cwd"] = cwd
        if env:
            options["env"] = env
        if container:
            options["container"] = container
        if container_shell:
            options["containerShell"] = container_shell
        if container_user:
            options["containerUser"] = container_user
        if container_cwd:
            options["containerCwd"] = container_cwd
        if attach_mode:
            options["attachMode"] = attach_mode
        if label:
            options["label"] = label
        if not allow_join:
            options["allowJoin"] = allow_join
        if not enable_history:
            options["enableHistory"] = enable_history

        response = await self._send_request("spawn", {"options": options})

        self._session_id = response.get("sessionId")
        self._session_info = SessionInfo(
            session_id=response.get("sessionId", ""),
            shell=response.get("shell", ""),
            cwd=response.get("cwd", ""),
            cols=response.get("cols", cols),
            rows=response.get("rows", rows),
            container=response.get("container"),
        )

        # Notify handlers
        for handler in self._on_spawned:
            try:
                handler(self._session_info)
            except Exception as e:
                logger.error(f"Error in spawned handler: {e}")

        return self._session_info

    async def kill(self) -> None:
        """Kill the current terminal session."""
        if not self.is_connected():
            return

        await self._send_message({"type": "kill"})
        self._session_id = None
        self._session_info = None

    # =========================================================================
    # Multiplexing
    # =========================================================================

    async def list_sessions(
        self,
        type: Optional[str] = None,
        container: Optional[str] = None,
        accepting: Optional[bool] = None,
    ) -> List[SharedSessionInfo]:
        """
        List available sessions.

        Args:
            type: Filter by session type ("local", "docker-exec", "docker-attach")
            container: Filter by container name
            accepting: Filter by whether session is accepting new clients

        Returns:
            List of SharedSessionInfo
        """
        if not self.is_connected():
            raise RuntimeError("Not connected to server")

        filter_opts = {}
        if type:
            filter_opts["type"] = type
        if container:
            filter_opts["container"] = container
        if accepting is not None:
            filter_opts["accepting"] = accepting

        response = await self._send_request(
            "listSessions",
            {"filter": filter_opts} if filter_opts else {}
        )

        sessions = []
        for s in response.get("sessions", []):
            sessions.append(SharedSessionInfo(
                session_id=s.get("sessionId", ""),
                type=s.get("type", "local"),
                shell=s.get("shell", ""),
                cwd=s.get("cwd", ""),
                cols=s.get("cols", 80),
                rows=s.get("rows", 24),
                client_count=s.get("clientCount", 1),
                owner=s.get("owner", ""),
                label=s.get("label"),
                accepting=s.get("accepting", True),
                container=s.get("container"),
            ))

        return sessions

    async def join(
        self,
        session_id: str,
        request_history: bool = True,
        history_limit: int = 50000,
    ) -> SharedSessionInfo:
        """
        Join an existing session.

        Args:
            session_id: ID of the session to join
            request_history: Whether to request output history
            history_limit: Maximum history characters to receive

        Returns:
            SharedSessionInfo with session details and optional history
        """
        if not self.is_connected():
            raise RuntimeError("Not connected to server")

        response = await self._send_request("join", {
            "options": {
                "sessionId": session_id,
                "requestHistory": request_history,
                "historyLimit": history_limit,
            }
        })

        self._session_id = session_id

        session = SharedSessionInfo(
            session_id=response.get("sessionId", session_id),
            type=response.get("session", {}).get("type", "local"),
            shell=response.get("session", {}).get("shell", ""),
            cwd=response.get("session", {}).get("cwd", ""),
            cols=response.get("session", {}).get("cols", 80),
            rows=response.get("session", {}).get("rows", 24),
            client_count=response.get("session", {}).get("clientCount", 1),
            owner=response.get("session", {}).get("owner", ""),
            label=response.get("session", {}).get("label"),
            accepting=response.get("session", {}).get("accepting", True),
            container=response.get("session", {}).get("container"),
        )

        # If history was returned, emit it as data
        history = response.get("history")
        if history:
            for handler in self._on_data:
                try:
                    handler(history)
                except Exception as e:
                    logger.error(f"Error in data handler: {e}")

        return session

    def leave(self, session_id: Optional[str] = None) -> None:
        """
        Leave the current session without killing it.

        The session will continue running and can be rejoined later
        (subject to orphan timeout).

        Args:
            session_id: Session ID to leave (defaults to current session)
        """
        if not self.is_connected():
            return

        asyncio.create_task(self._send_message({
            "type": "leave",
            "sessionId": session_id or self._session_id,
        }))

        self._session_id = None
        self._session_info = None

    # =========================================================================
    # Terminal I/O
    # =========================================================================

    async def write(self, data: str) -> None:
        """
        Write data to the terminal.

        Args:
            data: Data to write (e.g., "ls\\n" for ls command)
        """
        if not self.is_connected() or not self._session_id:
            return

        await self._send_message({
            "type": "data",
            "data": data,
        })

    async def resize(self, cols: int, rows: int) -> None:
        """
        Resize the terminal.

        Args:
            cols: New column count
            rows: New row count
        """
        if not self.is_connected() or not self._session_id:
            return

        await self._send_message({
            "type": "resize",
            "cols": cols,
            "rows": rows,
        })

    # =========================================================================
    # Event Handlers
    # =========================================================================

    def on_connect(self, handler: Callable[[], None]) -> None:
        """Register a handler for connection events."""
        self._on_connect.append(handler)

    def on_disconnect(self, handler: Callable[[], None]) -> None:
        """Register a handler for disconnection events."""
        self._on_disconnect.append(handler)

    def on_data(self, handler: Callable[[str], None]) -> None:
        """Register a handler for terminal output data."""
        self._on_data.append(handler)

    def on_exit(self, handler: Callable[[int], None]) -> None:
        """Register a handler for session exit events."""
        self._on_exit.append(handler)

    def on_error(self, handler: Callable[[Exception], None]) -> None:
        """Register a handler for error events."""
        self._on_error.append(handler)

    def on_spawned(self, handler: Callable[[SessionInfo], None]) -> None:
        """Register a handler for session spawned events."""
        self._on_spawned.append(handler)

    def on_client_joined(self, handler: Callable[[str, int], None]) -> None:
        """Register a handler for client joined events (multiplexing)."""
        self._on_client_joined.append(handler)

    def on_client_left(self, handler: Callable[[str, int], None]) -> None:
        """Register a handler for client left events (multiplexing)."""
        self._on_client_left.append(handler)

    def on_session_closed(self, handler: Callable[[str, str], None]) -> None:
        """Register a handler for session closed events."""
        self._on_session_closed.append(handler)

    # =========================================================================
    # Internal Methods
    # =========================================================================

    async def _send_message(self, message: dict) -> None:
        """Send a message to the server."""
        if not self._ws:
            raise RuntimeError("Not connected")

        await self._ws.send(json.dumps(message))

    async def _send_request(self, type: str, data: dict = None) -> dict:
        """Send a request and wait for response."""
        if not self._ws:
            raise RuntimeError("Not connected")

        self._request_id += 1
        request_id = f"req-{self._request_id}"

        message = {
            "type": type,
            "requestId": request_id,
            **(data or {}),
        }

        # Create future for response
        future = asyncio.get_event_loop().create_future()
        self._pending_requests[request_id] = future

        try:
            await self._ws.send(json.dumps(message))
            response = await asyncio.wait_for(future, timeout=30.0)
            return response
        finally:
            self._pending_requests.pop(request_id, None)

    async def _receive_loop(self) -> None:
        """Receive and process messages from the server."""
        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    await self._handle_message(data)
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received: {message[:100]}")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
        except websockets.ConnectionClosed:
            logger.info("Connection closed")
        except Exception as e:
            logger.error(f"Receive loop error: {e}")
        finally:
            if self._connected:
                self._connected = False
                for handler in self._on_disconnect:
                    try:
                        handler()
                    except Exception:
                        pass

    async def _handle_message(self, data: dict) -> None:
        """Handle an incoming message."""
        msg_type = data.get("type")

        # Handle request responses
        request_id = data.get("requestId")
        if request_id and request_id in self._pending_requests:
            future = self._pending_requests[request_id]
            if data.get("error"):
                future.set_exception(RuntimeError(data["error"]))
            else:
                future.set_result(data)
            return

        # Handle events
        if msg_type == "data":
            output = data.get("data", "")
            for handler in self._on_data:
                try:
                    handler(output)
                except Exception as e:
                    logger.error(f"Error in data handler: {e}")

        elif msg_type == "exit":
            code = data.get("code", 0)
            self._session_id = None
            self._session_info = None
            for handler in self._on_exit:
                try:
                    handler(code)
                except Exception as e:
                    logger.error(f"Error in exit handler: {e}")

        elif msg_type == "error":
            error_msg = data.get("message", "Unknown error")
            error = RuntimeError(error_msg)
            for handler in self._on_error:
                try:
                    handler(error)
                except Exception as e:
                    logger.error(f"Error in error handler: {e}")

        elif msg_type == "spawned":
            # Already handled via request response
            pass

        elif msg_type == "clientJoined":
            session_id = data.get("sessionId", "")
            count = data.get("clientCount", 0)
            for handler in self._on_client_joined:
                try:
                    handler(session_id, count)
                except Exception as e:
                    logger.error(f"Error in clientJoined handler: {e}")

        elif msg_type == "clientLeft":
            session_id = data.get("sessionId", "")
            count = data.get("clientCount", 0)
            for handler in self._on_client_left:
                try:
                    handler(session_id, count)
                except Exception as e:
                    logger.error(f"Error in clientLeft handler: {e}")

        elif msg_type == "sessionClosed":
            session_id = data.get("sessionId", "")
            reason = data.get("reason", "unknown")
            if session_id == self._session_id:
                self._session_id = None
                self._session_info = None
            for handler in self._on_session_closed:
                try:
                    handler(session_id, reason)
                except Exception as e:
                    logger.error(f"Error in sessionClosed handler: {e}")
