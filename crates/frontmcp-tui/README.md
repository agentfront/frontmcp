# frontmcp-tui

A high-performance terminal UI for the FrontMCP development server, built with [Ratatui](https://ratatui.rs/).

## Features

- **Fast startup**: ~50ms vs ~500ms with Ink
- **Smooth 60fps rendering**: Native terminal performance
- **Vim-style navigation**: hjkl, gg, G, Ctrl+D/U
- **Five tabs**: Logs, Sessions, Tools, API, Config
- **Two-panel layout**: List on left, details on right
- **Help overlay**: Press `?` for keyboard shortcuts

## Building

```bash
cd crates
cargo build --release -p frontmcp-tui
```

The binary will be at `target/release/frontmcp-tui`.

## Usage

The TUI reads DevEvents from stdin. Events should be in JSON format with the magic prefix `__FRONTMCP_DEV_EVENT__`.

```bash
# Example: pipe events from the MCP server
./frontmcp-tui < events.jsonl
```

## Keyboard Shortcuts

| Key                 | Action                |
| ------------------- | --------------------- |
| `q` / `Ctrl+C`      | Quit                  |
| `Tab` / `Shift+Tab` | Next/Previous tab     |
| `1-5`               | Jump to tab by number |
| `j` / `↓`           | Move down             |
| `k` / `↑`           | Move up               |
| `gg`                | Jump to top           |
| `G`                 | Jump to bottom        |
| `Ctrl+D`            | Page down             |
| `Ctrl+U`            | Page up               |
| `?`                 | Toggle help           |

## Event Types

The TUI supports the following event categories:

- **Session**: Connect, disconnect, idle, active
- **Request**: Start, complete, error
- **Registry**: Tool/resource/prompt added/removed/updated
- **Server**: Starting, ready, error, shutdown
- **Config**: Loaded, error, missing

## License

Apache-2.0
