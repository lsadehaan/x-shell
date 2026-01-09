# x-shell Python Client

Python client bindings for [x-shell](https://github.com/lsadehaan/x-shell) WebSocket terminal servers.

## Installation

```bash
pip install x-shell
```

Or install from source:

```bash
cd bindings/python
pip install -e .
```

## Quick Start

```python
import asyncio
from x_shell import TerminalClient

async def main():
    async with TerminalClient("ws://localhost:3000/terminal") as client:
        # Spawn a new terminal session
        session = await client.spawn(shell="/bin/bash")
        print(f"Session started: {session.session_id}")

        # Handle terminal output
        client.on_data(lambda data: print(data, end=""))

        # Write commands
        await client.write("echo 'Hello from Python!'\n")
        await asyncio.sleep(1)

asyncio.run(main())
```

## Features

- **Async/await** - Built on asyncio and websockets
- **Session multiplexing** - Multiple clients can share the same terminal
- **Docker support** - Connect to Docker containers via exec or attach
- **History replay** - Get terminal output history when joining sessions
- **Event handlers** - React to data, exit, errors, and multiplexing events

## API

### Connection

```python
client = TerminalClient("ws://localhost:3000/terminal")
await client.connect()

# Or use context manager
async with TerminalClient(url) as client:
    ...
```

### Spawning Sessions

```python
# Basic
session = await client.spawn(shell="/bin/bash")

# Docker exec
session = await client.spawn(container="my-container")

# Docker attach
session = await client.spawn(container="my-container", attach_mode=True)
```

### Multiplexing

```python
# List sessions
sessions = await client.list_sessions()

# Join session
session = await client.join(session_id="term-abc123", request_history=True)

# Leave (keep session running)
client.leave()
```

### I/O

```python
await client.write("ls -la\n")
await client.resize(120, 40)
client.on_data(lambda d: print(d, end=""))
```

## License

MIT
