"""X-Shell data models and types."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class MessageType(str, Enum):
    """X-Shell WebSocket message types."""

    # Client -> Server
    SPAWN = "spawn"
    DATA = "data"
    RESIZE = "resize"
    CLOSE = "close"
    LIST_CONTAINERS = "listContainers"

    # Server -> Client
    SPAWNED = "spawned"
    EXIT = "exit"
    ERROR = "error"
    SERVER_INFO = "serverInfo"
    CONTAINER_LIST = "containerList"


@dataclass
class SpawnOptions:
    """Options for spawning a terminal session."""

    shell: Optional[str] = None
    cwd: Optional[str] = None
    env: Optional[dict[str, str]] = None
    cols: int = 80
    rows: int = 24
    # Docker-specific options
    container: Optional[str] = None
    container_shell: Optional[str] = None
    container_user: Optional[str] = None
    container_cwd: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        opts: dict = {"cols": self.cols, "rows": self.rows}
        if self.shell:
            opts["shell"] = self.shell
        if self.cwd:
            opts["cwd"] = self.cwd
        if self.env:
            opts["env"] = self.env
        if self.container:
            opts["container"] = self.container
        if self.container_shell:
            opts["containerShell"] = self.container_shell
        if self.container_user:
            opts["containerUser"] = self.container_user
        if self.container_cwd:
            opts["containerCwd"] = self.container_cwd
        return opts


@dataclass
class SessionInfo:
    """Information about an active terminal session."""

    session_id: str
    shell: str
    cwd: str
    cols: int
    rows: int
    container: Optional[str] = None


@dataclass
class ContainerInfo:
    """Information about a Docker container."""

    id: str
    name: str
    image: str
    status: str
    state: str


@dataclass
class ServerInfo:
    """X-Shell server capabilities."""

    docker_enabled: bool = False
    allowed_shells: list[str] = field(default_factory=list)
    default_shell: str = "/bin/bash"
    default_container_shell: str = "/bin/bash"
