"""
Type definitions for x-shell Python client.
"""

from dataclasses import dataclass, field
from typing import Optional, Literal
from datetime import datetime


@dataclass
class SessionInfo:
    """Information about a terminal session."""

    session_id: str
    shell: str
    cwd: str
    cols: int
    rows: int
    container: Optional[str] = None
    container_shell: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class SharedSessionInfo:
    """Information about a shared/multiplexed session."""

    session_id: str
    type: Literal["local", "docker-exec", "docker-attach"]
    shell: str
    cwd: str
    cols: int
    rows: int
    client_count: int
    owner: str
    label: Optional[str] = None
    accepting: bool = True
    container: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class TerminalOptions:
    """Options for spawning a terminal session."""

    shell: Optional[str] = None
    cwd: Optional[str] = None
    cols: int = 80
    rows: int = 24
    env: dict = field(default_factory=dict)

    # Docker options
    container: Optional[str] = None
    container_shell: Optional[str] = None
    container_user: Optional[str] = None
    container_cwd: Optional[str] = None
    attach_mode: bool = False

    # Multiplexing options
    label: Optional[str] = None
    allow_join: bool = True
    enable_history: bool = True


@dataclass
class JoinOptions:
    """Options for joining an existing session."""

    session_id: str
    request_history: bool = True
    history_limit: int = 50000


@dataclass
class SessionListFilter:
    """Filter options for listing sessions."""

    type: Optional[Literal["local", "docker-exec", "docker-attach"]] = None
    container: Optional[str] = None
    accepting: Optional[bool] = None
