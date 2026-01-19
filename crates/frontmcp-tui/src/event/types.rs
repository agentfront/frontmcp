//! DevEvent types - mirrors TypeScript definitions
//!
//! These types must exactly match the event structure from:
//! `/libs/cli/src/dashboard/events/types.ts`

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Magic prefix for event messages
pub const DEV_EVENT_MAGIC: &str = "__FRONTMCP_DEV_EVENT__";

// ─────────────────────────────────────────────────────────────────────────────
// Base Event
// ─────────────────────────────────────────────────────────────────────────────

/// Base fields for all events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEventBase {
    pub id: String,
    pub timestamp: u64,
    pub scope_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEventType {
    #[serde(rename = "session:connect")]
    Connect,
    #[serde(rename = "session:disconnect")]
    Disconnect,
    #[serde(rename = "session:idle")]
    Idle,
    #[serde(rename = "session:active")]
    Active,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventData {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_info: Option<ClientInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Auth mode (public, transparent, orchestrated)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_mode: Option<String>,
    /// Authenticated user info
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_user: Option<AuthUser>,
    /// Whether the session is anonymous
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_anonymous: Option<bool>,
    /// Token expiration timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_expires_at: Option<u64>,
}

/// Authenticated user info
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthUser {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: SessionEventType,
    pub data: SessionEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestEventType {
    #[serde(rename = "request:start")]
    Start,
    #[serde(rename = "request:complete")]
    Complete,
    #[serde(rename = "request:error")]
    Error,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestEventData {
    pub flow_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_owner: Option<EntryOwner>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RequestError>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EntryOwner {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RequestError {
    pub name: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: RequestEventType,
    pub data: RequestEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub enum RegistryEventType {
    #[serde(rename = "registry:tool:added")]
    ToolAdded,
    #[serde(rename = "registry:tool:removed")]
    ToolRemoved,
    #[serde(rename = "registry:tool:updated")]
    ToolUpdated,
    #[serde(rename = "registry:tool:reset")]
    ToolReset,
    #[serde(rename = "registry:resource:added")]
    ResourceAdded,
    #[serde(rename = "registry:resource:removed")]
    ResourceRemoved,
    #[serde(rename = "registry:resource:updated")]
    ResourceUpdated,
    #[serde(rename = "registry:resource:reset")]
    ResourceReset,
    #[serde(rename = "registry:prompt:added")]
    PromptAdded,
    #[serde(rename = "registry:prompt:removed")]
    PromptRemoved,
    #[serde(rename = "registry:prompt:updated")]
    PromptUpdated,
    #[serde(rename = "registry:prompt:reset")]
    PromptReset,
    #[serde(rename = "registry:agent:added")]
    AgentAdded,
    #[serde(rename = "registry:agent:removed")]
    AgentRemoved,
    #[serde(rename = "registry:agent:updated")]
    AgentUpdated,
    #[serde(rename = "registry:agent:reset")]
    AgentReset,
    #[serde(rename = "registry:plugin:added")]
    PluginAdded,
    #[serde(rename = "registry:plugin:removed")]
    PluginRemoved,
    #[serde(rename = "registry:plugin:updated")]
    PluginUpdated,
    #[serde(rename = "registry:plugin:reset")]
    PluginReset,
    #[serde(rename = "registry:adapter:added")]
    AdapterAdded,
    #[serde(rename = "registry:adapter:removed")]
    AdapterRemoved,
    #[serde(rename = "registry:adapter:updated")]
    AdapterUpdated,
    #[serde(rename = "registry:adapter:reset")]
    AdapterReset,
}

/// Entry details for enhanced registry events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntryInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<EntryOwner>,
    /// Tool-specific: input schema
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
    /// Resource-specific: URI or URI template
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// Plugin-specific: version
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEventData {
    pub registry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_names: Option<Vec<String>>,
    pub change_kind: String,
    pub change_scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<EntryOwner>,
    pub snapshot_count: u32,
    pub version: u32,
    /// Full entry details (for added/updated/reset events)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<RegistryEntryInfo>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: RegistryEventType,
    pub data: RegistryEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub enum ServerEventType {
    #[serde(rename = "server:starting")]
    Starting,
    #[serde(rename = "server:ready")]
    Ready,
    #[serde(rename = "server:error")]
    Error,
    #[serde(rename = "server:shutdown")]
    Shutdown,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_info: Option<ServerInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: ServerEventType,
    pub data: ServerEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub enum ConfigEventType {
    #[serde(rename = "config:loaded")]
    Loaded,
    #[serde(rename = "config:error")]
    Error,
    #[serde(rename = "config:missing")]
    Missing,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ConfigError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loaded_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConfigError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: ConfigEventType,
    pub data: ConfigEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Graph Events
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeGraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    pub children: Vec<ScopeGraphNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScopeGraphEventData {
    pub root: ScopeGraphNode,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeGraphEvent {
    #[serde(flatten)]
    pub base: DevEventBase,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: ScopeGraphEventData,
}

// ─────────────────────────────────────────────────────────────────────────────
// DevBus Log Transport Events (New Format)
// ─────────────────────────────────────────────────────────────────────────────

/// Trace context from AsyncLocalStorage
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceContext {
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

/// New log transport event format
/// Sent by DevBusLogTransport for both trace events and regular logs
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBusLogEvent {
    pub id: String,
    pub timestamp: u64,
    /// Category: "trace" for TUI state events, "log" for regular logs
    pub category: String,
    /// Event type (e.g., "session:connect", "request:start", "tool:execute")
    /// For logs, this is the level name (e.g., "info", "debug", "error")
    #[serde(rename = "type")]
    pub event_type: String,
    /// Logger prefix for hierarchy/grouping
    pub prefix: String,
    /// Scope ID from context
    pub scope_id: String,
    /// Session ID from context
    pub session_id: String,
    /// Request ID from context
    pub request_id: String,
    /// Trace context from AsyncLocalStorage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_context: Option<TraceContext>,
    /// For trace events: structured data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// For log events: log message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// For log events: log arguments
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<serde_json::Value>>,
    /// For log events: log level number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    /// For log events: log level name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_name: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Union Type
// ─────────────────────────────────────────────────────────────────────────────

/// All possible dev events (legacy format with category discriminator)
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "category", rename_all = "snake_case")]
pub enum DevEvent {
    Session(SessionEvent),
    Request(RequestEvent),
    Registry(RegistryEvent),
    Server(ServerEvent),
    Config(ConfigEvent),
}

/// Unified event enum that handles both legacy and new formats
#[derive(Debug, Clone)]
pub enum UnifiedEvent {
    /// Legacy DevEventBus format
    Legacy(DevEvent),
    /// New DevBusLogTransport format
    LogTransport(DevBusLogEvent),
    /// Error event for displaying parse/connection errors
    Error(String),
}

/// IPC Message wrapper
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DevEventMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub event: DevEvent,
}

impl DevEventMessage {
    /// Check if this is a valid dev event message
    pub fn is_valid(&self) -> bool {
        self.msg_type == DEV_EVENT_MAGIC
    }
}

/// Parse a line that may contain a dev event (legacy format)
pub fn parse_event_line(line: &str) -> Option<DevEvent> {
    match parse_unified_event_line(line) {
        Some(UnifiedEvent::Legacy(event)) => Some(event),
        _ => None,
    }
}

/// Parse a line that may contain a dev event (unified format)
/// Returns UnifiedEvent which can be either legacy DevEvent or new DevBusLogEvent
pub fn parse_unified_event_line(line: &str) -> Option<UnifiedEvent> {
    // Format 1: Stderr format with magic prefix
    // __FRONTMCP_DEV_EVENT__{"id":"...","category":"...","type":"...",...}
    if let Some(json_str) = line.strip_prefix(DEV_EVENT_MAGIC) {
        // Try parsing as DevEventMessage wrapper first (legacy IPC)
        if let Ok(msg) = serde_json::from_str::<DevEventMessage>(json_str) {
            return Some(UnifiedEvent::Legacy(msg.event));
        }

        // Try parsing as new DevBusLogEvent format
        // Check if it has "category": "trace" or "category": "log"
        if let Ok(log_event) = serde_json::from_str::<DevBusLogEvent>(json_str) {
            if log_event.category == "trace" || log_event.category == "log" {
                return Some(UnifiedEvent::LogTransport(log_event));
            }
        }

        // Try parsing as legacy DevEvent directly
        if let Ok(event) = serde_json::from_str::<DevEvent>(json_str) {
            return Some(UnifiedEvent::Legacy(event));
        }

        // Log error for lines that have the prefix but fail to parse
        log_parse_error(line, "Has prefix but JSON parse failed");
        return None;
    }

    // Format 2: IPC format - JSON wrapper with magic type
    // {"type":"__FRONTMCP_DEV_EVENT__","event":{...}}
    // Only try to parse if it looks like JSON and contains the magic string
    if line.starts_with('{') && line.contains(DEV_EVENT_MAGIC) {
        match serde_json::from_str::<DevEventMessage>(line) {
            Ok(msg) => {
                if msg.is_valid() {
                    return Some(UnifiedEvent::Legacy(msg.event));
                }
            }
            Err(e) => {
                log_parse_error(line, &format!("IPC format parse error: {}", e));
            }
        }
    }

    // Not a dev event line - just ignore (don't count as failure)
    None
}

fn log_parse_error(line: &str, error: &str) {
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/frontmcp-tui-parse-errors.log")
    {
        use std::io::Write;
        let _ = writeln!(file, "--- Parse error ---");
        let _ = writeln!(file, "Line: {}", line);
        let _ = writeln!(file, "Error: {}", error);
        let _ = writeln!(file, "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_server_event_with_prefix() {
        let line = r#"__FRONTMCP_DEV_EVENT__{"id":"test-1","timestamp":1705276800000,"category":"server","type":"server:starting","scopeId":"test-scope","data":{}}"#;
        let event = parse_event_line(line);
        assert!(event.is_some(), "Failed to parse server event with prefix");
        if let Some(DevEvent::Server(e)) = event {
            assert_eq!(e.event_type, ServerEventType::Starting);
        } else {
            panic!("Wrong event type");
        }
    }

    #[test]
    fn test_parse_server_ready_event() {
        let line = r#"__FRONTMCP_DEV_EVENT__{"id":"test-2","timestamp":1705276801000,"category":"server","type":"server:ready","scopeId":"test-scope","data":{"serverInfo":{"name":"test","version":"1.0"},"address":"http://localhost:3000"}}"#;
        let event = parse_event_line(line);
        assert!(event.is_some(), "Failed to parse server ready event");
        if let Some(DevEvent::Server(e)) = event {
            assert_eq!(e.event_type, ServerEventType::Ready);
            assert_eq!(e.data.address, Some("http://localhost:3000".to_string()));
        } else {
            panic!("Wrong event type");
        }
    }

    #[test]
    fn test_parse_ipc_wrapped_event() {
        let line = r#"{"type":"__FRONTMCP_DEV_EVENT__","event":{"id":"test-3","timestamp":1705276802000,"category":"registry","type":"registry:tool:added","scopeId":"test-scope","data":{"registryType":"tool","entryNames":["my_tool"],"changeKind":"added","changeScope":"global","snapshotCount":1,"version":1}}}"#;
        let event = parse_event_line(line);
        assert!(event.is_some(), "Failed to parse IPC wrapped event");
    }
}
