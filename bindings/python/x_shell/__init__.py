"""
x-shell Python client bindings.

A Python client for connecting to x-shell WebSocket terminal servers.

Usage:
    from x_shell import TerminalClient

    async with TerminalClient("ws://localhost:3000/terminal") as client:
        session = await client.spawn(shell="/bin/bash")

        client.on_data(lambda data: print(data, end=""))

        await client.write("ls -la\\n")
        await asyncio.sleep(1)
"""

from .client import TerminalClient
from .types import (
    SessionInfo,
    SharedSessionInfo,
    TerminalOptions,
    JoinOptions,
    SessionListFilter,
)

__version__ = "1.0.0"
__all__ = [
    "TerminalClient",
    "SessionInfo",
    "SharedSessionInfo",
    "TerminalOptions",
    "JoinOptions",
    "SessionListFilter",
]
