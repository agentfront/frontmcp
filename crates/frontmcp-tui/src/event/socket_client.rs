//! Unix socket client for ManagerService connection
//!
//! Connects to the FrontMCP server's ManagerService via Unix socket
//! and provides bidirectional communication:
//! - Receives real-time events from the server
//! - Sends commands to the server (callTool, simulateClient, etc.)

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

use super::{DevBusLogEvent, DevEvent, UnifiedEvent};

// ─────────────────────────────────────────────────────────────────────────────
// Manager Protocol Types
// ─────────────────────────────────────────────────────────────────────────────

/// Welcome message sent on connection
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub server_id: String,
    pub server_version: String,
    pub protocol_version: String,
}

/// State snapshot message
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub timestamp: u64,
    pub state: StateSnapshot,
}

/// State snapshot data
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSnapshot {
    pub scopes: Vec<ScopeState>,
    pub sessions: Vec<SessionState>,
    pub server: ServerState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeState {
    pub id: String,
    pub tools: Vec<ToolInfo>,
    pub resources: Vec<ResourceInfo>,
    pub prompts: Vec<PromptInfo>,
    pub agents: Vec<AgentInfo>,
    #[serde(default)]
    pub plugins: Vec<PluginInfoSnapshot>,
    #[serde(default)]
    pub adapters: Vec<AdapterInfoSnapshot>,
}

/// Plugin info from state snapshot
#[derive(Debug, Deserialize)]
pub struct PluginInfoSnapshot {
    pub name: String,
    pub version: Option<String>,
    pub owner: Option<OwnerInfo>,
}

/// Adapter info from state snapshot
#[derive(Debug, Deserialize)]
pub struct AdapterInfoSnapshot {
    pub name: String,
    pub description: Option<String>,
    pub owner: Option<OwnerInfo>,
}

/// Owner info for entries
#[derive(Debug, Deserialize, Clone)]
pub struct OwnerInfo {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub owner: Option<OwnerInfo>,
}

#[derive(Debug, Deserialize)]
pub struct ResourceInfo {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub owner: Option<OwnerInfo>,
}

#[derive(Debug, Deserialize)]
pub struct PromptInfo {
    pub name: String,
    pub description: Option<String>,
    pub owner: Option<OwnerInfo>,
}

#[derive(Debug, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub description: Option<String>,
    pub owner: Option<OwnerInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub scope_id: String,
    pub session_id: String,
    pub transport_type: String,
    pub client_info: Option<ClientInfoState>,
    pub connected_at: u64,
    /// Auth mode (public, transparent, orchestrated)
    pub auth_mode: Option<String>,
    /// Authenticated user info
    pub auth_user: Option<AuthUserState>,
    /// Whether the session is anonymous
    pub is_anonymous: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AuthUserState {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClientInfoState {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub name: String,
    pub version: String,
    pub started_at: u64,
    pub capabilities: serde_json::Value,
}

/// Event message from server
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub timestamp: u64,
    pub event: DevEvent,
}

/// Raw event message for flexible parsing (handles tool:execute, tool:complete, etc.)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEventMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub timestamp: u64,
    pub event: serde_json::Value,
}

/// Generic message for type detection
#[derive(Debug, Deserialize)]
struct MessageType {
    #[serde(rename = "type")]
    msg_type: String,
}

/// Response message from server
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub command_id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<ResponseError>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ResponseError {
    pub code: String,
    pub message: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Types (Client -> Server)
// ─────────────────────────────────────────────────────────────────────────────

/// Command message to send to server
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub command: ManagerCommand,
}

/// Available commands
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "name", rename_all = "camelCase")]
pub enum ManagerCommand {
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "getState")]
    GetState,
    #[serde(rename = "listTools")]
    ListTools { scope_id: String },
    #[serde(rename = "callTool")]
    CallTool {
        scope_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<serde_json::Value>,
    },
    #[serde(rename = "simulateClient")]
    SimulateClient {
        scope_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<SimulateClientOptions>,
    },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulateClientOptions {
    pub client_name: Option<String>,
    pub client_version: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket Client Handle
// ─────────────────────────────────────────────────────────────────────────────

/// Handle for sending commands to the server
#[derive(Clone)]
pub struct SocketClientHandle {
    writer: Arc<Mutex<Option<UnixStream>>>,
    command_counter: Arc<std::sync::atomic::AtomicU64>,
}

impl SocketClientHandle {
    fn new(stream: UnixStream) -> Self {
        Self {
            writer: Arc::new(Mutex::new(Some(stream))),
            command_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Send a command to the server
    pub fn send_command(&self, command: ManagerCommand) -> Option<String> {
        let mut writer = self.writer.lock().ok()?;
        let stream = writer.as_mut()?;

        let id = self.command_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let command_id = format!("cmd-{}", id);

        let msg = CommandMessage {
            msg_type: "command".to_string(),
            id: command_id.clone(),
            command,
        };

        let json = serde_json::to_string(&msg).ok()?;
        writeln!(stream, "{}", json).ok()?;
        stream.flush().ok()?;

        Some(command_id)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket Client
// ─────────────────────────────────────────────────────────────────────────────

/// Connection error type for socket client
#[derive(Debug, Clone)]
pub struct ConnectionError {
    pub message: String,
    pub socket_path: String,
}

impl std::fmt::Display for ConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Connects to Unix socket and streams events to channel.
/// Returns a handle that can be used to send commands to the server.
/// Returns an error with details if connection fails.
pub fn spawn_socket_client(
    socket_path: String,
    tx: mpsc::Sender<UnifiedEvent>,
    state_tx: mpsc::Sender<StateSnapshot>,
) -> Result<(SocketClientHandle, mpsc::Receiver<ResponseMessage>), ConnectionError> {
    // Create channel for responses
    let (response_tx, response_rx) = mpsc::channel::<ResponseMessage>(32);

    // Try to connect synchronously first to return the handle
    // Wait for socket to exist
    let mut attempts = 0;
    while !std::path::Path::new(&socket_path).exists() {
        std::thread::sleep(Duration::from_millis(100));
        attempts += 1;
        if attempts > 50 {
            let msg = format!(
                "Socket not found after 5s. Server may not be running.\nPath: {}",
                socket_path
            );
            eprintln!("{}", msg);
            return Err(ConnectionError {
                message: msg,
                socket_path,
            });
        }
    }

    // Connect to socket
    let stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(e) => {
            let msg = format!(
                "Failed to connect to server socket: {}\nPath: {}",
                e, socket_path
            );
            eprintln!("{}", msg);
            return Err(ConnectionError {
                message: msg,
                socket_path,
            });
        }
    };

    // Clone stream for reading (the original will be used for writing)
    let read_stream = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("Failed to clone socket for reading: {}", e);
            eprintln!("{}", msg);
            return Err(ConnectionError {
                message: msg,
                socket_path,
            });
        }
    };

    // Create handle for sending commands
    let handle = SocketClientHandle::new(stream);

    // Spawn reader task
    tokio::task::spawn_blocking(move || {
        // Set read timeout to allow periodic checking
        let _ = read_stream.set_read_timeout(Some(Duration::from_millis(100)));

        let mut reader = BufReader::new(read_stream);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    // Connection closed
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // First detect message type
                    if let Ok(msg_type) = serde_json::from_str::<MessageType>(trimmed) {
                        match msg_type.msg_type.as_str() {
                            "welcome" => {
                                // Parse and log welcome message
                                if let Ok(welcome) = serde_json::from_str::<WelcomeMessage>(trimmed)
                                {
                                    eprintln!(
                                        "Connected to FrontMCP {} (protocol {})",
                                        welcome.server_version, welcome.protocol_version
                                    );
                                }
                            }
                            "state" => {
                                // Parse and send initial state
                                match serde_json::from_str::<StateMessage>(trimmed) {
                                    Ok(state_msg) => {
                                        let _ = state_tx.blocking_send(state_msg.state);
                                    }
                                    Err(e) => {
                                        // Log parse error to stderr and debug file
                                        let err_msg = format!("State parse error: {}", e);
                                        eprintln!("{}", err_msg);
                                        // Send error through event channel for display in TUI
                                        let _ = tx.blocking_send(UnifiedEvent::Error(err_msg.clone()));
                                        // Also write to debug file for inspection
                                        if let Ok(mut f) = std::fs::OpenOptions::new()
                                            .create(true)
                                            .append(true)
                                            .open("/tmp/frontmcp-tui-errors.log")
                                        {
                                            use std::io::Write;
                                            let _ = writeln!(f, "=== STATE PARSE ERROR ===");
                                            let _ = writeln!(f, "Error: {}", e);
                                            let _ = writeln!(f, "Raw JSON:\n{}", trimmed);
                                            let _ = writeln!(f, "=========================\n");
                                        }
                                    }
                                }
                            }
                            "event" => {
                                // Debug: dump all incoming events
                                dump_raw_event(trimmed);

                                // Try parsing as structured DevEvent first
                                match serde_json::from_str::<EventMessage>(trimmed) {
                                    Ok(event_msg) => {
                                        let _ = tx.blocking_send(UnifiedEvent::Legacy(event_msg.event));
                                    }
                                    Err(e1) => {
                                        // Fallback: parse as raw event and convert to DevBusLogEvent
                                        // This handles tool:execute, tool:complete, log events, etc.
                                        match serde_json::from_str::<RawEventMessage>(trimmed) {
                                            Ok(raw_msg) => {
                                                if let Some(log_event) = raw_event_to_log_event(&raw_msg) {
                                                    let _ = tx.blocking_send(UnifiedEvent::LogTransport(log_event));
                                                }
                                            }
                                            Err(e2) => {
                                                // Both parsing methods failed - log to file for debugging
                                                if let Ok(mut f) = std::fs::OpenOptions::new()
                                                    .create(true)
                                                    .append(true)
                                                    .open("/tmp/frontmcp-tui-errors.log")
                                                {
                                                    use std::io::Write;
                                                    let _ = writeln!(f, "=== EVENT PARSE ERROR ===");
                                                    let _ = writeln!(f, "Error 1 (EventMessage): {}", e1);
                                                    let _ = writeln!(f, "Error 2 (RawEventMessage): {}", e2);
                                                    let _ = writeln!(f, "Raw: {}", &trimmed[..trimmed.len().min(500)]);
                                                    let _ = writeln!(f, "=========================\n");
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "response" => {
                                // Parse and send response
                                if let Ok(response) =
                                    serde_json::from_str::<ResponseMessage>(trimmed)
                                {
                                    let _ = response_tx.blocking_send(response);
                                }
                            }
                            _ => {
                                // Unknown message type
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Timeout, continue loop
                    continue;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Timeout, continue loop
                    continue;
                }
                Err(_) => {
                    // Connection error
                    break;
                }
            }
        }
    });

    Ok((handle, response_rx))
}

/// Legacy version that doesn't return a handle (for backward compatibility)
pub fn spawn_socket_client_simple(
    socket_path: String,
    tx: mpsc::Sender<UnifiedEvent>,
    state_tx: mpsc::Sender<StateSnapshot>,
) {
    let _ = spawn_socket_client(socket_path, tx, state_tx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Conversion Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Dump raw event JSON to file for debugging
fn dump_raw_event(json: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/frontmcp-tui-raw-events.log")
    {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] {}", timestamp, json);
    }
}

/// Convert a RawEventMessage to DevBusLogEvent.
/// This handles custom event types like tool:execute and tool:complete that
/// don't fit the standard DevEvent enum structure.
fn raw_event_to_log_event(raw: &RawEventMessage) -> Option<DevBusLogEvent> {
    // The raw.event contains the ManagerEvent structure:
    // { id, timestamp, category, type, scopeId, sessionId?, requestId?, traceContext?, data }
    let event = &raw.event;

    // Extract required fields
    let event_type = event.get("type")?.as_str()?.to_string();
    let scope_id = event.get("scopeId")?.as_str()?.to_string();

    // Extract optional fields
    let session_id = event
        .get("sessionId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let request_id = event
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let category = event
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("request")
        .to_string();

    // Extract trace context if present
    let trace_context = event.get("traceContext").and_then(|tc| {
        let trace_id = tc.get("traceId")?.as_str()?.to_string();
        let parent_id = tc.get("parentId").and_then(|v| v.as_str()).map(String::from);
        Some(super::TraceContext { trace_id, parent_id })
    });

    // Extract data
    let data = event.get("data").cloned();

    // For log events, extract message, level, and prefix from data
    let (message, level_name, prefix) = if category == "log" {
        let msg = data.as_ref().and_then(|d| d.get("message")).and_then(|v| v.as_str()).map(String::from);
        let lvl = data.as_ref().and_then(|d| d.get("level")).and_then(|v| v.as_str()).map(|s| s.to_lowercase());
        let pfx = data.as_ref().and_then(|d| d.get("prefix")).and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| "sdk".to_string());
        (msg, lvl, pfx)
    } else {
        (None, None, "manager".to_string())
    };

    Some(DevBusLogEvent {
        id: raw.id.clone(),
        timestamp: raw.timestamp,
        category,
        event_type,
        prefix,
        scope_id,
        session_id,
        request_id,
        trace_context,
        data,
        message,
        args: None,
        level: None,
        level_name,
    })
}
