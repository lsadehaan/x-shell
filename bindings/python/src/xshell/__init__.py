"""X-Shell Python Client - WebSocket terminal client for x-shell.js server.

This package provides a Python client for connecting to x-shell terminal servers.
It supports both local shell sessions and Docker container exec sessions.

Example:
    async with XShellClient("ws://localhost:3000/terminal") as client:
        session = await client.spawn(shell="/bin/bash")
        await client.write("echo hello\\n")
        output = await client.read_until("$", timeout=5.0)
        print(output)
"""

from .client import XShellClient, XShellClientSync
from .models import (
    ContainerInfo,
    MessageType,
    ServerInfo,
    SessionInfo,
    SpawnOptions,
)

__version__ = "1.0.0"
__all__ = [
    "XShellClient",
    "XShellClientSync",
    "SpawnOptions",
    "SessionInfo",
    "ContainerInfo",
    "ServerInfo",
    "MessageType",
]
