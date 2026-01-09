"""X-Shell WebSocket Client for Python.

This module provides the main client class for connecting to x-shell servers.
"""

import asyncio
import json
import logging
from typing import Callable, Optional

import websockets
from websockets.asyncio.client import ClientConnection

from .models import (
    ContainerInfo,
    MessageType,
    ServerInfo,
    SessionInfo,
    SpawnOptions,
)

logger = logging.getLogger(__name__)


class XShellClient:
    """WebSocket client for x-shell terminal server.

    Provides methods to:
    - Connect to x-shell server
    - Spawn local or Docker container sessions
    - Send input and receive output
    - Manage multiple sessions

    Example:
        async with XShellClient("ws://localhost:3000/terminal") as client:
            session = await client.spawn(shell="/bin/bash")
            await client.write("echo hello\\n")
            output = await client.read_until("$", timeout=5.0)
            print(output)

    Args:
        url: WebSocket URL (e.g., "ws://localhost:3000/terminal")
        on_data: Callback for terminal output (session_id, data)
        on_exit: Callback for session exit (session_id, exit_code)
        on_error: Callback for errors (error_message, session_id)
    """

    def __init__(
        self,
        url: str,
        on_data: Optional[Callable[[str, str], None]] = None,
        on_exit: Optional[Callable[[str, int], None]] = None,
        on_error: Optional[Callable[[str, Optional[str]], None]] = None,
    ):
        """Initialize the client."""
        self.url = url
        self.ws: Optional[ClientConnection] = None
        self.server_info: Optional[ServerInfo] = None
        self.sessions: dict[str, SessionInfo] = {}
        self.current_session_id: Optional[str] = None

        # Callbacks
        self.on_data = on_data
        self.on_exit = on_exit
        self.on_error = on_error

        # Output buffer for synchronous reads
        self._output_buffer: dict[str, str] = {}
        self._read_events: dict[str, asyncio.Event] = {}

        # Background reader task
        self._reader_task: Optional[asyncio.Task] = None
        self._running = False

    async def connect(self) -> ServerInfo:
        """Connect to the x-shell server.

        Returns:
            ServerInfo with server capabilities

        Raises:
            RuntimeError: If connection fails or unexpected message received
        """
        logger.info(f"Connecting to x-shell at {self.url}")
        self.ws = await websockets.connect(self.url)

        # Receive serverInfo message
        msg = await self.ws.recv()
        data = json.loads(msg)

        if data.get("type") != MessageType.SERVER_INFO:
            raise RuntimeError(f"Expected serverInfo, got: {data.get('type')}")

        info = data.get("info", {})
        self.server_info = ServerInfo(
            docker_enabled=info.get("dockerEnabled", False),
            allowed_shells=info.get("allowedShells", []),
            default_shell=info.get("defaultShell", "/bin/bash"),
            default_container_shell=info.get("defaultContainerShell", "/bin/bash"),
        )

        logger.info(
            f"Connected to x-shell. Docker enabled: {self.server_info.docker_enabled}"
        )
        return self.server_info

    async def __aenter__(self) -> "XShellClient":
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    async def spawn(
        self,
        shell: Optional[str] = None,
        cwd: Optional[str] = None,
        env: Optional[dict[str, str]] = None,
        container: Optional[str] = None,
        container_shell: Optional[str] = None,
        container_user: Optional[str] = None,
        container_cwd: Optional[str] = None,
        cols: int = 80,
        rows: int = 24,
    ) -> SessionInfo:
        """Spawn a new terminal session.

        Args:
            shell: Shell to use for local sessions
            cwd: Working directory for local sessions
            env: Environment variables
            container: Docker container name/id for exec sessions
            container_shell: Shell for container sessions
            container_user: User for container sessions
            container_cwd: Working directory in container
            cols: Terminal width
            rows: Terminal height

        Returns:
            SessionInfo for the new session

        Raises:
            RuntimeError: If not connected or spawn fails
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        options = SpawnOptions(
            shell=shell,
            cwd=cwd,
            env=env,
            container=container,
            container_shell=container_shell,
            container_user=container_user,
            container_cwd=container_cwd,
            cols=cols,
            rows=rows,
        )

        await self.ws.send(
            json.dumps(
                {
                    "type": MessageType.SPAWN,
                    "options": options.to_dict(),
                }
            )
        )

        # Wait for spawned response
        msg = await self.ws.recv()
        data = json.loads(msg)

        if data.get("type") == MessageType.ERROR:
            raise RuntimeError(f"Spawn failed: {data.get('error')}")

        if data.get("type") != MessageType.SPAWNED:
            raise RuntimeError(f"Expected spawned message, got: {data.get('type')}")

        session = SessionInfo(
            session_id=data["sessionId"],
            shell=data.get("shell", ""),
            cwd=data.get("cwd", ""),
            cols=data.get("cols", cols),
            rows=data.get("rows", rows),
            container=data.get("container"),
        )

        self.sessions[session.session_id] = session
        self.current_session_id = session.session_id
        self._output_buffer[session.session_id] = ""
        self._read_events[session.session_id] = asyncio.Event()

        logger.info(f"Spawned session: {session.session_id}")
        return session

    async def write(self, data: str, session_id: Optional[str] = None) -> None:
        """Send input to a terminal session.

        Args:
            data: Input data to send (include \\n for newlines)
            session_id: Session to send to (defaults to current session)

        Raises:
            RuntimeError: If not connected or no active session
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        sid = session_id or self.current_session_id
        if not sid:
            raise RuntimeError("No active session")

        await self.ws.send(
            json.dumps(
                {
                    "type": MessageType.DATA,
                    "sessionId": sid,
                    "data": data,
                }
            )
        )

    async def read(
        self, timeout: float = 5.0, session_id: Optional[str] = None
    ) -> str:
        """Read available output from a session.

        This reads a single message from the terminal. For reading until
        a specific pattern, use read_until().

        Args:
            timeout: Maximum time to wait for output
            session_id: Session to read from (defaults to current session)

        Returns:
            Terminal output data

        Raises:
            RuntimeError: If not connected, no session, or session exits
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        sid = session_id or self.current_session_id
        if not sid:
            raise RuntimeError("No active session")

        try:
            msg = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            data = json.loads(msg)

            if data.get("type") == MessageType.DATA:
                if data.get("sessionId") == sid:
                    return data.get("data", "")
            elif data.get("type") == MessageType.EXIT:
                exit_code = data.get("exitCode", 0)
                if self.on_exit:
                    self.on_exit(sid, exit_code)
                raise RuntimeError(f"Session exited with code: {exit_code}")
            elif data.get("type") == MessageType.ERROR:
                error_msg = data.get("error", "Unknown error")
                if self.on_error:
                    self.on_error(error_msg, sid)
                raise RuntimeError(f"Terminal error: {error_msg}")

            return ""
        except asyncio.TimeoutError:
            return ""

    async def read_until(
        self,
        pattern: str,
        timeout: float = 30.0,
        session_id: Optional[str] = None,
        include_pattern: bool = True,
    ) -> str:
        """Read output until a pattern is found.

        Args:
            pattern: String pattern to wait for
            timeout: Maximum time to wait
            session_id: Session to read from
            include_pattern: Include the pattern in returned output

        Returns:
            All output up to (and optionally including) the pattern

        Raises:
            asyncio.TimeoutError: If pattern not found within timeout
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        sid = session_id or self.current_session_id
        if not sid:
            raise RuntimeError("No active session")

        buffer = ""
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            remaining = timeout - elapsed
            if remaining <= 0:
                raise asyncio.TimeoutError(f"Timeout waiting for pattern: {pattern}")

            output = await self.read(timeout=remaining, session_id=sid)
            buffer += output

            if pattern in buffer:
                if include_pattern:
                    idx = buffer.index(pattern) + len(pattern)
                    return buffer[:idx]
                else:
                    return buffer[: buffer.index(pattern)]

    async def read_all(
        self,
        timeout: float = 5.0,
        session_id: Optional[str] = None,
    ) -> str:
        """Read all available output until timeout.

        Keeps reading until no more output is received within
        the timeout period.

        Args:
            timeout: Time to wait for more output
            session_id: Session to read from

        Returns:
            All collected output
        """
        buffer = ""
        while True:
            try:
                output = await self.read(timeout=timeout, session_id=session_id)
                if output:
                    buffer += output
                else:
                    break
            except asyncio.TimeoutError:
                break
        return buffer

    async def execute(
        self,
        command: str,
        timeout: float = 30.0,
        session_id: Optional[str] = None,
        prompt_pattern: str = "$ ",
    ) -> str:
        """Execute a command and return its output.

        Sends the command and waits for the shell prompt to return.

        Args:
            command: Command to execute (without trailing newline)
            timeout: Maximum time to wait for completion
            session_id: Session to execute in
            prompt_pattern: Shell prompt pattern to wait for

        Returns:
            Command output (without the prompt)
        """
        await self.write(command + "\n", session_id)

        # Skip the echoed command
        output = await self.read_until(
            prompt_pattern,
            timeout=timeout,
            session_id=session_id,
        )

        # Remove the echoed command from the beginning
        lines = output.split("\n")
        if lines and command in lines[0]:
            lines = lines[1:]

        # Remove the prompt from the end
        result = "\n".join(lines)
        if result.endswith(prompt_pattern):
            result = result[: -len(prompt_pattern)]

        return result.strip()

    async def resize(
        self,
        cols: int,
        rows: int,
        session_id: Optional[str] = None,
    ) -> None:
        """Resize a terminal session.

        Args:
            cols: New terminal width
            rows: New terminal height
            session_id: Session to resize
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        sid = session_id or self.current_session_id
        if not sid:
            raise RuntimeError("No active session")

        await self.ws.send(
            json.dumps(
                {
                    "type": MessageType.RESIZE,
                    "sessionId": sid,
                    "cols": cols,
                    "rows": rows,
                }
            )
        )

    async def close_session(self, session_id: Optional[str] = None) -> None:
        """Close a terminal session.

        Args:
            session_id: Session to close (defaults to current session)
        """
        if not self.ws:
            return

        sid = session_id or self.current_session_id
        if not sid:
            return

        await self.ws.send(
            json.dumps(
                {
                    "type": MessageType.CLOSE,
                    "sessionId": sid,
                }
            )
        )

        # Clean up
        self.sessions.pop(sid, None)
        self._output_buffer.pop(sid, None)
        self._read_events.pop(sid, None)

        if self.current_session_id == sid:
            self.current_session_id = None

        logger.info(f"Closed session: {sid}")

    async def list_containers(self) -> list[ContainerInfo]:
        """List available Docker containers.

        Returns:
            List of container information

        Raises:
            RuntimeError: If not connected or request fails
        """
        if not self.ws:
            raise RuntimeError("Not connected to x-shell server")

        await self.ws.send(
            json.dumps(
                {
                    "type": MessageType.LIST_CONTAINERS,
                }
            )
        )

        msg = await self.ws.recv()
        data = json.loads(msg)

        if data.get("type") == MessageType.ERROR:
            raise RuntimeError(f"List containers failed: {data.get('error')}")

        if data.get("type") != MessageType.CONTAINER_LIST:
            raise RuntimeError(f"Expected containerList, got: {data.get('type')}")

        containers = []
        for c in data.get("containers", []):
            containers.append(
                ContainerInfo(
                    id=c.get("id", ""),
                    name=c.get("name", ""),
                    image=c.get("image", ""),
                    status=c.get("status", ""),
                    state=c.get("state", ""),
                )
            )

        return containers

    async def close(self) -> None:
        """Close the connection to x-shell server."""
        self._running = False

        # Close all sessions
        for sid in list(self.sessions.keys()):
            try:
                await self.close_session(sid)
            except Exception:
                pass

        # Cancel reader task if running
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        # Close WebSocket
        if self.ws:
            await self.ws.close()
            self.ws = None

        logger.info("Disconnected from x-shell")


class XShellClientSync:
    """Synchronous wrapper for XShellClient.

    Provides blocking methods for terminal interaction.
    Useful for simpler use cases where async is not needed.

    Example:
        client = XShellClientSync("ws://localhost:3000/terminal")
        client.connect()
        client.spawn(shell="/bin/bash")
        client.write("echo hello\\n")
        output = client.read_until("$")
        print(output)
        client.close()
    """

    def __init__(self, url: str):
        """Initialize the sync client.

        Args:
            url: WebSocket URL for x-shell server
        """
        self.url = url
        self._client: Optional[XShellClient] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        """Get or create event loop."""
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
        return self._loop

    def connect(self) -> ServerInfo:
        """Connect to x-shell server."""
        loop = self._get_loop()
        self._client = XShellClient(self.url)
        return loop.run_until_complete(self._client.connect())

    def spawn(self, **kwargs) -> SessionInfo:
        """Spawn a terminal session."""
        if not self._client:
            raise RuntimeError("Not connected")
        return self._get_loop().run_until_complete(self._client.spawn(**kwargs))

    def write(self, data: str, session_id: Optional[str] = None) -> None:
        """Write to terminal."""
        if not self._client:
            raise RuntimeError("Not connected")
        self._get_loop().run_until_complete(self._client.write(data, session_id))

    def read(
        self, timeout: float = 5.0, session_id: Optional[str] = None
    ) -> str:
        """Read from terminal."""
        if not self._client:
            raise RuntimeError("Not connected")
        return self._get_loop().run_until_complete(
            self._client.read(timeout, session_id)
        )

    def read_until(
        self,
        pattern: str,
        timeout: float = 30.0,
        session_id: Optional[str] = None,
    ) -> str:
        """Read until pattern."""
        if not self._client:
            raise RuntimeError("Not connected")
        return self._get_loop().run_until_complete(
            self._client.read_until(pattern, timeout, session_id)
        )

    def execute(
        self,
        command: str,
        timeout: float = 30.0,
        session_id: Optional[str] = None,
    ) -> str:
        """Execute a command."""
        if not self._client:
            raise RuntimeError("Not connected")
        return self._get_loop().run_until_complete(
            self._client.execute(command, timeout, session_id)
        )

    def close(self) -> None:
        """Close the connection."""
        if self._client:
            self._get_loop().run_until_complete(self._client.close())
            self._client = None
