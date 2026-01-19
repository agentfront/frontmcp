//! Dashboard state store

use std::collections::{HashMap, HashSet};

use crate::event::{
    ConfigEvent, DevBusLogEvent, DevEvent, RegistryEntryInfo, RegistryEvent, RegistryEventData,
    RegistryEventType, RequestEvent, RequestEventData, ResponseMessage, ServerEvent,
    ServerEventData, SessionEvent, SessionEventData, StateSnapshot, UnifiedEvent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab System
// ─────────────────────────────────────────────────────────────────────────────

/// Active tab in the dashboard
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tab {
    #[default]
    Sessions,
    Capabilities,
    Logs,
    Metrics,
    Playground,
    AiInsight,
    Graph,
}

impl Tab {
    pub fn all() -> &'static [Tab] {
        &[
            Tab::Sessions,
            Tab::Capabilities,
            Tab::Logs,
            Tab::Metrics,
            Tab::Playground,
            Tab::AiInsight,
            Tab::Graph,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            Tab::Sessions => "Sessions",
            Tab::Capabilities => "Capabilities",
            Tab::Logs => "Logs",
            Tab::Metrics => "Metrics",
            Tab::Playground => "Playground",
            Tab::AiInsight => "AI Insight",
            Tab::Graph => "Graph",
        }
    }

    pub fn index(&self) -> usize {
        match self {
            Tab::Sessions => 0,
            Tab::Capabilities => 1,
            Tab::Logs => 2,
            Tab::Metrics => 3,
            Tab::Playground => 4,
            Tab::AiInsight => 5,
            Tab::Graph => 6,
        }
    }

    pub fn from_index(index: usize) -> Self {
        match index {
            0 => Tab::Sessions,
            1 => Tab::Capabilities,
            2 => Tab::Logs,
            3 => Tab::Metrics,
            4 => Tab::Playground,
            5 => Tab::AiInsight,
            6 => Tab::Graph,
            _ => Tab::Sessions,
        }
    }
}

/// Sub-tab for Capabilities tab
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActivitySubTab {
    #[default]
    Tools,
    Resources,
    Prompts,
    Plugins,
}

impl ActivitySubTab {
    pub fn all() -> &'static [ActivitySubTab] {
        &[
            ActivitySubTab::Tools,
            ActivitySubTab::Resources,
            ActivitySubTab::Prompts,
            ActivitySubTab::Plugins,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            ActivitySubTab::Tools => "Tools",
            ActivitySubTab::Resources => "Resources",
            ActivitySubTab::Prompts => "Prompts",
            ActivitySubTab::Plugins => "Plugins",
        }
    }

    pub fn index(&self) -> usize {
        match self {
            ActivitySubTab::Tools => 0,
            ActivitySubTab::Resources => 1,
            ActivitySubTab::Prompts => 2,
            ActivitySubTab::Plugins => 3,
        }
    }

    pub fn from_index(index: usize) -> Self {
        match index {
            0 => ActivitySubTab::Tools,
            1 => ActivitySubTab::Resources,
            2 => ActivitySubTab::Prompts,
            3 => ActivitySubTab::Plugins,
            _ => ActivitySubTab::Tools,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus and Navigation
// ─────────────────────────────────────────────────────────────────────────────

/// Focus area in the UI for navigation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FocusArea {
    #[default]
    TabBar,
    Overview,
    List,
    Detail,
    SubTab,
    FilterInput,
}

/// Quit mode for exit confirmation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum QuitMode {
    #[default]
    None,        // Not quitting
    Confirming,  // Showing confirmation dialog
    KillAll,     // Exit TUI and kill server
}

/// Selected button in quit dialog
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum QuitDialogSelection {
    #[default]
    Cancel,
    Kill,
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview Data
// ─────────────────────────────────────────────────────────────────────────────

/// Summary of a tool call for overview display
#[derive(Debug, Clone)]
pub struct ToolCallSummary {
    pub name: String,
    pub timestamp: u64,
    pub success: bool,
    pub duration_ms: Option<u64>,
}

/// Overview panel data (always visible)
#[derive(Debug, Clone, Default)]
pub struct OverviewData {
    pub registered_apps: usize,
    pub scope_count: usize,
    pub server_address: Option<String>,
    pub server_port: Option<u16>,
    pub active_sessions: usize,
    pub total_sessions: usize,
    pub last_tool_calls: Vec<ToolCallSummary>,
}

impl OverviewData {
    /// Maximum number of tool calls to keep in overview
    const MAX_TOOL_CALLS: usize = 5;

    pub fn add_tool_call(&mut self, name: String, success: bool, duration_ms: Option<u64>) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        self.last_tool_calls.insert(
            0,
            ToolCallSummary {
                name,
                timestamp,
                success,
                duration_ms,
            },
        );

        if self.last_tool_calls.len() > Self::MAX_TOOL_CALLS {
            self.last_tool_calls.truncate(Self::MAX_TOOL_CALLS);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log System
// ─────────────────────────────────────────────────────────────────────────────

/// A log entry for display
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: LogLevel,
    pub message: String,
    pub source: String,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

/// Parse a structured log line: [HH:MM:SS.mmm] [source] LEVEL message
/// Returns (level, source, message) if successful
fn parse_structured_log(line: &str) -> Option<(LogLevel, String, String)> {
    // Must start with [timestamp]
    if !line.starts_with('[') {
        return None;
    }

    // Find end of timestamp
    let ts_end = line.find(']')?;

    // Find source brackets after timestamp
    let rest = line[ts_end + 1..].trim_start();
    if !rest.starts_with('[') {
        return None;
    }

    let source_end = rest.find(']')?;
    let source = rest[1..source_end].to_string();

    // Rest after source
    let after_source = rest[source_end + 1..].trim_start();

    // Parse level and message
    let (level, message) = if after_source.starts_with("ERROR") {
        (LogLevel::Error, after_source[5..].trim_start().to_string())
    } else if after_source.starts_with("WARN") {
        (LogLevel::Warn, after_source[4..].trim_start().to_string())
    } else if after_source.starts_with("INFO") {
        (LogLevel::Info, after_source[4..].trim_start().to_string())
    } else if after_source.starts_with("DEBUG") {
        (LogLevel::Debug, after_source[5..].trim_start().to_string())
    } else if after_source.starts_with("VERBOSE") {
        (LogLevel::Debug, after_source[7..].trim_start().to_string())
    } else {
        // Unknown level, treat as info
        (LogLevel::Info, after_source.to_string())
    };

    Some((level, source, message))
}

/// Log filter state
#[derive(Debug, Clone, Default)]
pub struct LogFilter {
    pub app_id: Option<String>,
    pub tool_id: Option<String>,
    pub session_id: Option<String>,
    pub level: Option<LogLevel>,
}

impl LogFilter {
    pub fn is_active(&self) -> bool {
        self.app_id.is_some()
            || self.tool_id.is_some()
            || self.session_id.is_some()
            || self.level.is_some()
    }

    pub fn matches(&self, entry: &LogEntry) -> bool {
        if let Some(ref session_id) = self.session_id {
            if entry.session_id.as_ref() != Some(session_id) {
                return false;
            }
        }
        if let Some(level) = self.level {
            if entry.level != level {
                return false;
            }
        }
        // app_id and tool_id filtering would need additional log entry fields
        true
    }

    pub fn clear(&mut self) {
        self.app_id = None;
        self.tool_id = None;
        self.session_id = None;
        self.level = None;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Data
// ─────────────────────────────────────────────────────────────────────────────

/// Session info for display
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub transport_type: Option<String>,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub user_agent: Option<String>,
    pub connected_at: u64,
    pub is_active: bool,
    /// Auth mode (public, transparent, orchestrated)
    pub auth_mode: Option<String>,
    /// Authenticated user name
    pub auth_user_name: Option<String>,
    /// Authenticated user email
    pub auth_user_email: Option<String>,
    /// Whether the session is anonymous
    pub is_anonymous: Option<bool>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Data (Tools, Resources, Prompts)
// ─────────────────────────────────────────────────────────────────────────────

/// Tool info for display
#[derive(Debug, Clone)]
pub struct ToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub owner_kind: Option<String>,
    pub owner_id: Option<String>,
}

/// Resource info for display
#[derive(Debug, Clone)]
pub struct ResourceInfo {
    pub name: String,
    pub uri: Option<String>,
    pub owner_kind: Option<String>,
    pub owner_id: Option<String>,
}

/// Prompt info for display
#[derive(Debug, Clone)]
pub struct PromptInfo {
    pub name: String,
    pub owner_kind: Option<String>,
    pub owner_id: Option<String>,
}

/// Plugin info for display
#[derive(Debug, Clone)]
pub struct PluginInfo {
    pub name: String,
    pub version: Option<String>,
    pub owner_id: Option<String>,
}

/// Adapter info for display
#[derive(Debug, Clone)]
pub struct AdapterInfo {
    pub name: String,
    pub description: Option<String>,
    pub owner_id: Option<String>,
}

/// App info for DI graph display
#[derive(Debug, Clone)]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub tool_count: usize,
    pub resource_count: usize,
    pub prompt_count: usize,
    pub plugin_count: usize,
}

/// Scope info for hierarchical graph display
/// Scopes are top-level containers that hold apps
#[derive(Debug, Clone)]
pub struct ScopeInfo {
    pub id: String,
    pub name: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Data
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum history samples for sparklines (~60 seconds at 1 sample/sec)
pub const METRICS_HISTORY_SIZE: usize = 60;

/// Metrics data for display
#[derive(Debug, Clone)]
pub struct MetricsData {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_duration_ms: u64,
    pub tool_usage: HashMap<String, u64>,

    // Traffic tracking
    pub inbound_bytes: u64,
    pub outbound_bytes: u64,

    // Token tracking (placeholder until SDK emits token events)
    pub total_tokens: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,

    // System metrics
    pub current_cpu: f32,
    pub current_memory: u64,
    pub cpu_history: Vec<f32>,
    pub memory_history: Vec<u64>,
}

impl Default for MetricsData {
    fn default() -> Self {
        Self {
            total_requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            total_duration_ms: 0,
            tool_usage: HashMap::new(),
            inbound_bytes: 0,
            outbound_bytes: 0,
            total_tokens: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            current_cpu: 0.0,
            current_memory: 0,
            cpu_history: Vec::with_capacity(METRICS_HISTORY_SIZE),
            memory_history: Vec::with_capacity(METRICS_HISTORY_SIZE),
        }
    }
}

impl MetricsData {
    pub fn avg_duration_ms(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            self.total_duration_ms as f64 / self.total_requests as f64
        }
    }

    pub fn success_rate(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            (self.successful_requests as f64 / self.total_requests as f64) * 100.0
        }
    }

    pub fn record_request(&mut self, success: bool, duration_ms: Option<u64>, tool_name: Option<&str>) {
        self.total_requests += 1;
        if success {
            self.successful_requests += 1;
        } else {
            self.failed_requests += 1;
        }
        if let Some(d) = duration_ms {
            self.total_duration_ms += d;
        }
        if let Some(name) = tool_name {
            *self.tool_usage.entry(name.to_string()).or_insert(0) += 1;
        }
    }

    /// Record traffic bytes for a request
    pub fn record_traffic(&mut self, inbound: u64, outbound: u64) {
        self.inbound_bytes += inbound;
        self.outbound_bytes += outbound;

        // Estimate tokens from text size (~4 characters per token, rough heuristic)
        // Inbound typically contains prompt/request data
        // Outbound typically contains response/completion data
        let inbound_tokens = inbound / 4;
        let outbound_tokens = outbound / 4;

        self.prompt_tokens += inbound_tokens;
        self.completion_tokens += outbound_tokens;
        self.total_tokens += inbound_tokens + outbound_tokens;
    }

    /// Update system metrics (CPU and memory)
    pub fn update_system_metrics(&mut self, cpu: f32, memory: u64) {
        self.current_cpu = cpu;
        self.current_memory = memory;

        // Add to history, maintaining fixed size
        self.cpu_history.push(cpu);
        self.memory_history.push(memory);

        // Keep only last N samples
        if self.cpu_history.len() > METRICS_HISTORY_SIZE {
            self.cpu_history.remove(0);
        }
        if self.memory_history.len() > METRICS_HISTORY_SIZE {
            self.memory_history.remove(0);
        }
    }

    /// Get average inbound request size in bytes
    pub fn avg_inbound_bytes(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            self.inbound_bytes as f64 / self.total_requests as f64
        }
    }

    /// Get average outbound response size in bytes
    pub fn avg_outbound_bytes(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            self.outbound_bytes as f64 / self.total_requests as f64
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Request Data
// ─────────────────────────────────────────────────────────────────────────────

/// API request for display
#[derive(Debug, Clone)]
pub struct ApiRequest {
    pub id: String,
    pub flow_name: String,
    pub method: Option<String>,
    pub entry_name: Option<String>,
    pub started_at: u64,
    pub duration_ms: Option<u64>,
    pub is_error: bool,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Server and Config Status
// ─────────────────────────────────────────────────────────────────────────────

/// Server status
#[derive(Debug, Clone, Default)]
pub struct ServerStatus {
    pub is_ready: bool,
    pub name: Option<String>,
    pub version: Option<String>,
    pub address: Option<String>,
    pub uptime_ms: Option<u64>,
    pub error: Option<String>,
}

/// Config status
#[derive(Debug, Clone, Default)]
pub struct ConfigStatus {
    pub is_loaded: bool,
    pub config_path: Option<String>,
    pub loaded_keys: Vec<String>,
    pub missing_keys: Vec<String>,
    pub errors: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard State
// ─────────────────────────────────────────────────────────────────────────────

/// Main dashboard state
#[derive(Debug, Default)]
pub struct DashboardState {
    // Navigation state
    pub active_tab: Tab,
    pub focus: FocusArea,
    pub show_help: bool,
    pub quit_mode: QuitMode,
    pub quit_dialog_selection: QuitDialogSelection,

    // Debug: event counter and connection info
    pub events_received: u64,
    pub lines_read: u64,
    pub parse_failures: u64,
    pub pipe_path: Option<String>,
    pub pipe_connected: bool,
    pub socket_path: Option<String>,
    pub socket_connected: bool,
    /// Connection error message (shown when socket/pipe fails)
    pub connection_error: Option<String>,
    /// Timestamp when TUI started waiting for connection
    pub connection_started_at: Option<u64>,
    /// Recent errors for display (max 5)
    pub recent_errors: Vec<String>,

    // Overview (always visible)
    pub overview: OverviewData,

    // Sessions tab data
    pub sessions: HashMap<String, SessionInfo>,
    pub session_logs: HashMap<String, Vec<LogEntry>>,
    pub selected_session: Option<String>,

    // Capabilities tab data (formerly Activity)
    pub tools: Vec<ToolInfo>,
    pub resources: Vec<ResourceInfo>,
    pub prompts: Vec<PromptInfo>,
    pub plugins: Vec<PluginInfo>,
    pub adapters: Vec<AdapterInfo>,
    pub activity_sub_tab: ActivitySubTab,

    // Logs tab data
    pub logs: Vec<LogEntry>,
    pub log_filter: LogFilter,

    // Metrics tab data
    pub metrics: MetricsData,

    // API requests (for history)
    pub requests: Vec<ApiRequest>,

    // Server status
    pub server: ServerStatus,

    // Config status
    pub config: ConfigStatus,

    // Selection/scroll state
    pub list_selected: usize,
    pub list_scroll: usize,
    pub detail_scroll: usize,
    pub overview_scroll: usize,

    // Graph tab state
    pub scopes: Vec<ScopeInfo>,
    pub apps: Vec<AppInfo>,
    pub graph_expanded: HashSet<String>,
    pub graph_selected: usize,
    /// Maps app_id to scope_id (which scope contains which apps)
    pub app_scope_map: HashMap<String, String>,
}

impl DashboardState {
    // ─────────────────────────────────────────────────────────────────────────
    // Event Handling
    // ─────────────────────────────────────────────────────────────────────────

    /// Handle a unified event (either legacy or new format)
    pub fn handle_unified_event(&mut self, event: UnifiedEvent) {
        match event {
            UnifiedEvent::Legacy(e) => self.handle_event(e),
            UnifiedEvent::LogTransport(e) => self.handle_log_transport_event(e),
            UnifiedEvent::Error(msg) => self.add_error(msg),
        }
    }

    /// Handle initial state snapshot from ManagerService
    ///
    /// This populates the TUI with the current server state when connecting via Unix socket.
    /// Called once when the TUI first connects to receive the initial snapshot of:
    /// - Registered tools, resources, prompts, and agents
    /// - Active sessions
    /// - Server information
    pub fn handle_state_snapshot(&mut self, snapshot: StateSnapshot) {
        // Update server info
        self.server.name = Some(snapshot.server.name);
        self.server.version = Some(snapshot.server.version);
        self.server.is_ready = true;

        // Clear and populate tools, resources, prompts, plugins, adapters from scopes
        self.tools.clear();
        self.resources.clear();
        self.prompts.clear();
        self.plugins.clear();
        self.adapters.clear();
        self.scopes.clear();
        self.app_scope_map.clear();

        for scope in snapshot.scopes {
            // Track scope for graph display
            self.scopes.push(ScopeInfo {
                id: scope.id.clone(),
                name: scope.id.clone(),
            });
            // Get counts before consuming vectors
            let tool_count = scope.tools.len();
            let resource_count = scope.resources.len();
            let prompt_count = scope.prompts.len();

            // Add tools from this scope and track app→scope mapping
            for tool in scope.tools {
                // Use actual owner from snapshot, fall back to scope if not present
                let (owner_kind, owner_id) = if let Some(ref owner) = tool.owner {
                    // Track app→scope mapping: if owner.kind is "app" and owner.id differs from scope.id
                    if owner.kind == "app" && owner.id != scope.id {
                        self.app_scope_map.insert(owner.id.clone(), scope.id.clone());
                    }
                    (Some(owner.kind.clone()), Some(owner.id.clone()))
                } else {
                    (Some("scope".to_string()), Some(scope.id.clone()))
                };
                self.tools.push(ToolInfo {
                    name: tool.name,
                    description: tool.description,
                    input_schema: None,
                    output_schema: None,
                    owner_kind,
                    owner_id,
                });
            }

            // Add resources from this scope and track app→scope mapping
            for resource in scope.resources {
                // Use actual owner from snapshot, fall back to scope if not present
                let (owner_kind, owner_id) = if let Some(ref owner) = resource.owner {
                    // Track app→scope mapping
                    if owner.kind == "app" && owner.id != scope.id {
                        self.app_scope_map.insert(owner.id.clone(), scope.id.clone());
                    }
                    (Some(owner.kind.clone()), Some(owner.id.clone()))
                } else {
                    (Some("scope".to_string()), Some(scope.id.clone()))
                };
                self.resources.push(ResourceInfo {
                    name: resource.name,
                    uri: Some(resource.uri),
                    owner_kind,
                    owner_id,
                });
            }

            // Add prompts from this scope and track app→scope mapping
            for prompt in scope.prompts {
                // Use actual owner from snapshot, fall back to scope if not present
                let (owner_kind, owner_id) = if let Some(ref owner) = prompt.owner {
                    // Track app→scope mapping
                    if owner.kind == "app" && owner.id != scope.id {
                        self.app_scope_map.insert(owner.id.clone(), scope.id.clone());
                    }
                    (Some(owner.kind.clone()), Some(owner.id.clone()))
                } else {
                    (Some("scope".to_string()), Some(scope.id.clone()))
                };
                self.prompts.push(PromptInfo {
                    name: prompt.name,
                    owner_kind,
                    owner_id,
                });
            }

            // Add plugins from this scope and track app→scope mapping
            let plugin_count = scope.plugins.len();
            for plugin in scope.plugins {
                let owner_id = plugin.owner.as_ref().map(|o| {
                    // Track app→scope mapping for plugin owner
                    if o.kind == "app" && o.id != scope.id {
                        self.app_scope_map.insert(o.id.clone(), scope.id.clone());
                    }
                    o.id.clone()
                });
                self.plugins.push(PluginInfo {
                    name: plugin.name,
                    version: plugin.version,
                    owner_id,
                });
            }

            // Add adapters from this scope and track app→scope mapping
            for adapter in scope.adapters {
                let owner_id = adapter.owner.as_ref().map(|o| {
                    // Track app→scope mapping for adapter owner
                    if o.kind == "app" && o.id != scope.id {
                        self.app_scope_map.insert(o.id.clone(), scope.id.clone());
                    }
                    o.id.clone()
                });
                self.adapters.push(AdapterInfo {
                    name: adapter.name,
                    description: adapter.description,
                    owner_id,
                });
            }

            // Populate apps from scopes for graph display
            self.apps.push(AppInfo {
                id: scope.id.clone(),
                name: scope.id.clone(),
                tool_count,
                resource_count,
                prompt_count,
                plugin_count,
            });
        }

        // Populate sessions from snapshot
        for session in snapshot.sessions {
            let session_info = SessionInfo {
                id: session.session_id.clone(),
                transport_type: Some(session.transport_type),
                client_name: session.client_info.as_ref().map(|c| c.name.clone()),
                client_version: session.client_info.as_ref().map(|c| c.version.clone()),
                user_agent: None,
                connected_at: session.connected_at,
                is_active: true,
                auth_mode: session.auth_mode,
                auth_user_name: session.auth_user.as_ref().and_then(|u| u.name.clone()),
                auth_user_email: session.auth_user.as_ref().and_then(|u| u.email.clone()),
                is_anonymous: session.is_anonymous,
            };
            self.sessions.insert(session.session_id.clone(), session_info);
            self.session_logs.insert(session.session_id, Vec::new());
        }

        // Update overview
        self.update_overview_sessions();
        self.update_overview_registry();
        self.overview.server_address = self.server.address.clone();

        // Log that we received the snapshot
        self.add_log(
            LogLevel::Info,
            format!(
                "Connected to server: {} tools, {} resources, {} prompts, {} plugins, {} adapters, {} sessions",
                self.tools.len(),
                self.resources.len(),
                self.prompts.len(),
                self.plugins.len(),
                self.adapters.len(),
                self.sessions.len()
            ),
            "system",
        );
    }

    /// Handle command response from ManagerService
    ///
    /// This is called when we receive a response to a command we sent via the socket.
    pub fn handle_command_response(&mut self, response: ResponseMessage) {
        if response.success {
            // Log successful response
            let data_summary = response
                .data
                .as_ref()
                .map(|d| {
                    if d.is_object() {
                        format!("{} fields", d.as_object().map(|o| o.len()).unwrap_or(0))
                    } else {
                        d.to_string().chars().take(50).collect::<String>()
                    }
                })
                .unwrap_or_else(|| "no data".to_string());

            self.add_log(
                LogLevel::Info,
                format!(
                    "Command {} succeeded: {}",
                    response.command_id, data_summary
                ),
                "socket",
            );
        } else {
            // Log error response
            let error_msg = response
                .error
                .as_ref()
                .map(|e| format!("{}: {}", e.code, e.message))
                .unwrap_or_else(|| "unknown error".to_string());

            self.add_log(
                LogLevel::Error,
                format!("Command {} failed: {}", response.command_id, error_msg),
                "socket",
            );
        }
    }

    /// Handle an incoming dev event (legacy format)
    pub fn handle_event(&mut self, event: DevEvent) {
        self.events_received += 1;
        match event {
            DevEvent::Session(e) => self.handle_session_event(e),
            DevEvent::Request(e) => self.handle_request_event(e),
            DevEvent::Registry(e) => self.handle_registry_event(e),
            DevEvent::Server(e) => self.handle_server_event(e),
            DevEvent::Config(e) => self.handle_config_event(e),
        }
    }

    /// Handle a new format log transport event
    fn handle_log_transport_event(&mut self, event: DevBusLogEvent) {
        self.events_received += 1;

        // Debug: dump all trace events to file for inspection
        Self::dump_trace_event(&event);

        if event.category == "trace" {
            // Handle trace events (for TUI state construction)
            self.handle_trace_event(&event);
        } else if event.category == "log" {
            // Handle regular log events (for Logs tab)
            self.handle_log_event(&event);
        }
    }

    /// Dump events to file for debugging
    /// Events are written to /tmp/frontmcp-tui-trace.log (trace) and /tmp/frontmcp-tui-logs.log (log)
    fn dump_trace_event(event: &DevBusLogEvent) {
        use std::io::Write;

        let log_file = if event.category == "trace" {
            "/tmp/frontmcp-tui-trace.log"
        } else if event.category == "log" {
            "/tmp/frontmcp-tui-logs.log"
        } else {
            return;
        };

        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file)
        {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f");

            if event.category == "log" {
                // For log events, show message and level
                let msg = event.message.as_deref().unwrap_or("<no message>");
                let level = event.level_name.as_deref().unwrap_or("unknown");
                let _ = writeln!(
                    file,
                    "[{}] [{}] [{}] {} | session={} request={}",
                    timestamp,
                    level,
                    event.prefix,
                    msg,
                    event.session_id,
                    event.request_id,
                );
            } else {
                // For trace events, show data
                let data_str = event
                    .data
                    .as_ref()
                    .map(|d| serde_json::to_string_pretty(d).unwrap_or_default())
                    .unwrap_or_else(|| "null".to_string());

                let _ = writeln!(
                    file,
                    "[{}] {} | session={} request={}\n  data: {}\n",
                    timestamp,
                    event.event_type,
                    event.session_id,
                    event.request_id,
                    data_str
                );
            }
        }
    }

    /// Handle trace events from the new log transport format
    fn handle_trace_event(&mut self, event: &DevBusLogEvent) {
        let event_type = event.event_type.as_str();
        let data = event.data.as_ref();
        let session_id = if event.session_id != "unknown" {
            Some(event.session_id.clone())
        } else {
            None
        };
        let request_id = if event.request_id != "unknown" {
            Some(event.request_id.clone())
        } else {
            None
        };

        match event_type {
            // Session events
            "session:connect" => {
                let transport_type = data
                    .and_then(|d| d.get("transportType"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(ref sid) = session_id {
                    // Extract auth fields from trace event data
                    let auth_mode = data
                        .and_then(|d| d.get("authMode"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let auth_user_name = data
                        .and_then(|d| d.get("authUser"))
                        .and_then(|u| u.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let auth_user_email = data
                        .and_then(|d| d.get("authUser"))
                        .and_then(|u| u.get("email"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let is_anonymous = data
                        .and_then(|d| d.get("isAnonymous"))
                        .and_then(|v| v.as_bool());

                    let session = SessionInfo {
                        id: sid.clone(),
                        transport_type,
                        client_name: None,
                        client_version: None,
                        user_agent: None,
                        connected_at: event.timestamp,
                        is_active: true,
                        auth_mode,
                        auth_user_name,
                        auth_user_email,
                        is_anonymous,
                    };
                    self.sessions.insert(sid.clone(), session);
                    self.session_logs.insert(sid.clone(), Vec::new());
                    self.update_overview_sessions();
                    self.add_log_with_context(
                        LogLevel::Info,
                        format!("Session connected: {}", sid),
                        "session",
                        session_id.clone(),
                        None,
                    );
                }
            }
            "session:disconnect" => {
                if let Some(ref sid) = session_id {
                    if let Some(session) = self.sessions.get_mut(sid) {
                        session.is_active = false;
                    }
                    self.update_overview_sessions();
                    self.add_log_with_context(
                        LogLevel::Info,
                        format!("Session disconnected: {}", sid),
                        "session",
                        session_id.clone(),
                        None,
                    );
                }
            }

            // Request events
            "request:start" => {
                let flow_name = data
                    .and_then(|d| d.get("flowName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let method = data
                    .and_then(|d| d.get("method"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let entry_name = data
                    .and_then(|d| d.get("entryName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Build detail string showing entry_name or method
                let detail = entry_name.as_deref()
                    .or(method.as_deref())
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();

                let request = ApiRequest {
                    id: request_id.clone().unwrap_or_default(),
                    flow_name: flow_name.clone(),
                    method,
                    entry_name,
                    started_at: event.timestamp,
                    duration_ms: None,
                    is_error: false,
                    error_message: None,
                    session_id: session_id.clone(),
                };
                self.requests.push(request);
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Request started: {}{}", flow_name, detail),
                    "api",
                    session_id,
                    request_id,
                );
            }
            "request:complete" => {
                let flow_name = data
                    .and_then(|d| d.get("flowName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let duration_ms = data
                    .and_then(|d| d.get("durationMs"))
                    .and_then(|v| v.as_u64());
                let entry_name = data
                    .and_then(|d| d.get("entryName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Update existing request if found
                let tool_name = if let Some(ref rid) = request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == rid) {
                        req.duration_ms = duration_ms;
                        if entry_name.is_some() {
                            req.entry_name = entry_name.clone();
                        }
                        req.entry_name.clone()
                    } else {
                        entry_name.clone()
                    }
                } else {
                    entry_name.clone()
                };

                // Update metrics
                let is_tool_flow = flow_name.contains("tool");
                self.metrics.record_request(
                    true,
                    duration_ms,
                    if is_tool_flow { tool_name.as_deref() } else { None },
                );

                // Update overview with tool call
                if let Some(name) = &tool_name {
                    if is_tool_flow {
                        self.overview.add_tool_call(name.clone(), true, duration_ms);
                    }
                }

                // Build detail string showing entry name if available
                let detail = tool_name.as_deref()
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();
                let duration_str = duration_ms.map(|d| format!(" ({}ms)", d)).unwrap_or_default();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Request complete: {}{}{}", flow_name, detail, duration_str),
                    "api",
                    session_id,
                    request_id,
                );
            }
            "request:error" => {
                let flow_name = data
                    .and_then(|d| d.get("flowName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let duration_ms = data
                    .and_then(|d| d.get("durationMs"))
                    .and_then(|v| v.as_u64());
                let error_msg = data
                    .and_then(|d| d.get("error"))
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();
                let entry_name = data
                    .and_then(|d| d.get("entryName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Update existing request if found
                let tool_name = if let Some(ref rid) = request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == rid) {
                        req.duration_ms = duration_ms;
                        req.is_error = true;
                        req.error_message = Some(error_msg.clone());
                        if entry_name.is_some() {
                            req.entry_name = entry_name.clone();
                        }
                        req.entry_name.clone()
                    } else {
                        entry_name.clone()
                    }
                } else {
                    entry_name.clone()
                };

                // Update metrics
                let is_tool_flow = flow_name.contains("tool");
                self.metrics.record_request(
                    false,
                    duration_ms,
                    if is_tool_flow { tool_name.as_deref() } else { None },
                );

                // Update overview with failed tool call
                if let Some(name) = &tool_name {
                    if is_tool_flow {
                        self.overview.add_tool_call(name.clone(), false, duration_ms);
                    }
                }

                // Build detail string showing entry name if available
                let detail = tool_name.as_deref()
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();
                self.add_log_with_context(
                    LogLevel::Error,
                    format!("Request error: {}{} - {}", flow_name, detail, error_msg),
                    "api",
                    session_id,
                    request_id,
                );
            }

            // Tool events
            "tool:execute" => {
                let entry_name = data
                    .and_then(|d| d.get("entryName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Tool executing: {}", entry_name),
                    "tool",
                    session_id,
                    request_id,
                );
            }
            "tool:complete" => {
                let entry_name = data
                    .and_then(|d| d.get("entryName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let duration_ms = data
                    .and_then(|d| d.get("durationMs"))
                    .and_then(|v| v.as_u64());

                // Update metrics for tool completion
                self.metrics.record_request(true, duration_ms, Some(&entry_name));

                // Update overview with tool call
                self.overview.add_tool_call(entry_name.clone(), true, duration_ms);

                let duration_str = duration_ms.map(|d| format!(" ({}ms)", d)).unwrap_or_default();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Tool complete: {}{}", entry_name, duration_str),
                    "tool",
                    session_id,
                    request_id,
                );
            }

            // Server events
            "server:starting" => {
                self.server.is_ready = false;
                self.add_log(LogLevel::Info, "Server starting...".to_string(), "server");
            }
            "server:ready" => {
                self.server.is_ready = true;
                let address = data
                    .and_then(|d| d.get("address"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                self.server.address = address.clone();
                self.overview.server_address = address.clone();
                if let Some(addr) = &address {
                    if let Some(port_str) = addr.rsplit(':').next() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            self.overview.server_port = Some(port);
                        }
                    }
                }
                self.add_log(LogLevel::Info, "Server ready".to_string(), "server");
            }
            "server:shutdown" => {
                self.server.is_ready = false;
                let uptime_ms = data.and_then(|d| d.get("uptimeMs")).and_then(|v| v.as_u64());
                self.server.uptime_ms = uptime_ms;
                self.add_log(LogLevel::Info, "Server shutdown".to_string(), "server");
            }

            // Config events
            "config:loaded" => {
                self.config.is_loaded = true;
                self.add_log(LogLevel::Info, "Config loaded".to_string(), "config");
            }
            "config:error" => {
                self.add_log(LogLevel::Error, "Config error".to_string(), "config");
            }

            // Registry events - Tools
            "registry:tool:added" | "registry:tool:reset" => {
                let entries = Self::extract_tool_entries(data);
                let owner = Self::extract_owner(data);
                // For reset, clear existing tools first
                if event_type == "registry:tool:reset" {
                    self.tools.clear();
                }
                let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
                for entry in entries {
                    // Avoid duplicates
                    if !self.tools.iter().any(|t| t.name == entry.name) {
                        self.tools.push(ToolInfo {
                            name: entry.name,
                            description: entry.description,
                            input_schema: entry.input_schema,
                            output_schema: None,
                            owner_kind: owner.as_ref().map(|(k, _)| k.clone()),
                            owner_id: owner.as_ref().map(|(_, id)| id.clone()),
                        });
                    }
                }
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Tools registered: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:tool:removed" => {
                let names = Self::extract_entry_names(data);
                self.tools.retain(|t| !names.contains(&t.name));
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Tools removed: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:tool:updated" => {
                let names = Self::extract_entry_names(data);
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Tools updated: {}", names.join(", ")),
                        "registry",
                    );
                }
            }

            // Registry events - Resources
            "registry:resource:added" | "registry:resource:reset" => {
                let names = Self::extract_entry_names(data);
                let owner = Self::extract_owner(data);
                // For reset, clear existing resources first
                if event_type == "registry:resource:reset" {
                    self.resources.clear();
                }
                for name in &names {
                    // Avoid duplicates
                    if !self.resources.iter().any(|r| &r.name == name) {
                        self.resources.push(ResourceInfo {
                            name: name.clone(),
                            uri: None,
                            owner_kind: owner.as_ref().map(|(k, _)| k.clone()),
                            owner_id: owner.as_ref().map(|(_, id)| id.clone()),
                        });
                    }
                }
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Resources registered: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:resource:removed" => {
                let names = Self::extract_entry_names(data);
                self.resources.retain(|r| !names.contains(&r.name));
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Resources removed: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:resource:updated" => {
                let names = Self::extract_entry_names(data);
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Resources updated: {}", names.join(", ")),
                        "registry",
                    );
                }
            }

            // Registry events - Prompts
            "registry:prompt:added" | "registry:prompt:reset" => {
                let names = Self::extract_entry_names(data);
                let owner = Self::extract_owner(data);
                // For reset, clear existing prompts first
                if event_type == "registry:prompt:reset" {
                    self.prompts.clear();
                }
                for name in &names {
                    // Avoid duplicates
                    if !self.prompts.iter().any(|p| &p.name == name) {
                        self.prompts.push(PromptInfo {
                            name: name.clone(),
                            owner_kind: owner.as_ref().map(|(k, _)| k.clone()),
                            owner_id: owner.as_ref().map(|(_, id)| id.clone()),
                        });
                    }
                }
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Prompts registered: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:prompt:removed" => {
                let names = Self::extract_entry_names(data);
                self.prompts.retain(|p| !names.contains(&p.name));
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Prompts removed: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:prompt:updated" => {
                let names = Self::extract_entry_names(data);
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Prompts updated: {}", names.join(", ")),
                        "registry",
                    );
                }
            }

            // Registry events - Plugins
            "registry:plugin:added" | "registry:plugin:reset" => {
                let entries = Self::extract_plugin_entries(data);
                let owner = Self::extract_owner(data);
                // For reset, clear existing plugins first
                if event_type == "registry:plugin:reset" {
                    self.plugins.clear();
                }
                for entry in &entries {
                    // Avoid duplicates
                    if !self.plugins.iter().any(|p| p.name == entry.name) {
                        self.plugins.push(PluginInfo {
                            name: entry.name.clone(),
                            version: entry.version.clone(),
                            owner_id: owner.as_ref().map(|(_, id)| id.clone()),
                        });
                    }
                }
                let names: Vec<_> = entries.iter().map(|e| e.name.clone()).collect();
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Plugins registered: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:plugin:removed" => {
                let names = Self::extract_entry_names(data);
                self.plugins.retain(|p| !names.contains(&p.name));
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Plugins removed: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }

            // Registry events - Adapters
            "registry:adapter:added" | "registry:adapter:reset" => {
                let entries = Self::extract_adapter_entries(data);
                let owner = Self::extract_owner(data);
                // For reset, clear existing adapters first
                if event_type == "registry:adapter:reset" {
                    self.adapters.clear();
                }
                for entry in &entries {
                    // Avoid duplicates
                    if !self.adapters.iter().any(|a| a.name == entry.name) {
                        self.adapters.push(AdapterInfo {
                            name: entry.name.clone(),
                            description: entry.description.clone(),
                            owner_id: owner.as_ref().map(|(_, id)| id.clone()),
                        });
                    }
                }
                let names: Vec<_> = entries.iter().map(|e| e.name.clone()).collect();
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Adapters registered: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }
            "registry:adapter:removed" => {
                let names = Self::extract_entry_names(data);
                self.adapters.retain(|a| !names.contains(&a.name));
                if !names.is_empty() {
                    self.add_log(
                        LogLevel::Info,
                        format!("Adapters removed: {}", names.join(", ")),
                        "registry",
                    );
                }
                self.update_overview_registry();
            }

            // Unknown trace events - just log them
            _ => {
                self.add_log_with_context(
                    LogLevel::Debug,
                    format!("Trace event: {}", event_type),
                    "trace",
                    session_id,
                    request_id,
                );
            }
        }
    }

    /// Handle regular log events from the new log transport format
    fn handle_log_event(&mut self, event: &DevBusLogEvent) {
        let level = match event.level_name.as_deref() {
            Some("error") => LogLevel::Error,
            Some("warn") => LogLevel::Warn,
            Some("debug") | Some("verbose") => LogLevel::Debug,
            _ => LogLevel::Info,
        };

        let message = event.message.clone().unwrap_or_default();
        let source = if event.prefix.is_empty() {
            "sdk".to_string()
        } else {
            event.prefix.clone()
        };

        let session_id = if event.session_id != "unknown" {
            Some(event.session_id.clone())
        } else {
            None
        };
        let request_id = if event.request_id != "unknown" {
            Some(event.request_id.clone())
        } else {
            None
        };

        self.add_log_with_context(level, message, &source, session_id, request_id);
    }

    fn handle_session_event(&mut self, event: SessionEvent) {
        let SessionEventData {
            session_id,
            transport_type,
            client_info,
            auth_mode,
            auth_user,
            is_anonymous,
            ..
        } = event.data;

        match event.event_type {
            crate::event::SessionEventType::Connect => {
                let session = SessionInfo {
                    id: session_id.clone(),
                    transport_type,
                    client_name: client_info.as_ref().map(|c| c.name.clone()),
                    client_version: client_info.as_ref().map(|c| c.version.clone()),
                    user_agent: None,
                    connected_at: event.base.timestamp,
                    is_active: true,
                    auth_mode,
                    auth_user_name: auth_user.as_ref().and_then(|u| u.name.clone()),
                    auth_user_email: auth_user.as_ref().and_then(|u| u.email.clone()),
                    is_anonymous,
                };
                self.sessions.insert(session_id.clone(), session);
                self.session_logs.insert(session_id.clone(), Vec::new());
                self.update_overview_sessions();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Session connected: {session_id}"),
                    "session",
                    Some(session_id),
                    None,
                );
            }
            crate::event::SessionEventType::Disconnect => {
                if let Some(session) = self.sessions.get_mut(&session_id) {
                    session.is_active = false;
                }
                self.update_overview_sessions();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Session disconnected: {session_id}"),
                    "session",
                    Some(session_id),
                    None,
                );
            }
            crate::event::SessionEventType::Idle => {
                self.add_log_with_context(
                    LogLevel::Debug,
                    format!("Session idle: {session_id}"),
                    "session",
                    Some(session_id),
                    None,
                );
            }
            crate::event::SessionEventType::Active => {
                self.add_log_with_context(
                    LogLevel::Debug,
                    format!("Session active: {session_id}"),
                    "session",
                    Some(session_id),
                    None,
                );
            }
        }
    }

    fn handle_request_event(&mut self, event: RequestEvent) {
        let RequestEventData {
            flow_name,
            method,
            entry_name,
            duration_ms,
            is_error,
            error,
            request_body,
            response_body,
            ..
        } = event.data;

        let session_id = event.base.session_id.clone();
        let request_id = event.base.request_id.clone();

        match event.event_type {
            crate::event::RequestEventType::Start => {
                // Build detail string showing entry_name or method
                let detail = entry_name.as_deref()
                    .or(method.as_deref())
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();

                let request = ApiRequest {
                    id: request_id.clone().unwrap_or_default(),
                    flow_name: flow_name.clone(),
                    method,
                    entry_name,
                    started_at: event.base.timestamp,
                    duration_ms: None,
                    is_error: false,
                    error_message: None,
                    session_id: session_id.clone(),
                };
                self.requests.push(request);
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Request started: {flow_name}{detail}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
            crate::event::RequestEventType::Complete => {
                // Prefer entry_name from event data over stored request
                let tool_name = if let Some(request_id) = &event.base.request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == request_id) {
                        req.duration_ms = duration_ms;
                        req.is_error = is_error.unwrap_or(false);
                        // Update entry_name if event provides one (e.g., from tools:call-tool)
                        if entry_name.is_some() {
                            req.entry_name = entry_name.clone();
                        }
                        req.entry_name.clone()
                    } else {
                        // No stored request found - use event's entry_name directly
                        entry_name.clone()
                    }
                } else {
                    entry_name.clone()
                };

                // Update metrics - only pass tool_name for actual tool flows
                let success = !is_error.unwrap_or(false);
                let is_tool_flow = flow_name.contains("tool");
                self.metrics.record_request(
                    success,
                    duration_ms,
                    if is_tool_flow { tool_name.as_deref() } else { None },
                );

                // Track traffic bytes
                let inbound = request_body
                    .as_ref()
                    .and_then(|b| serde_json::to_string(b).ok())
                    .map(|s| s.len() as u64)
                    .unwrap_or(0);
                let outbound = response_body
                    .as_ref()
                    .and_then(|b| serde_json::to_string(b).ok())
                    .map(|s| s.len() as u64)
                    .unwrap_or(0);
                self.metrics.record_traffic(inbound, outbound);

                // Update overview with tool call
                if let Some(name) = &tool_name {
                    if is_tool_flow {
                        self.overview.add_tool_call(name.clone(), success, duration_ms);
                    }
                }

                // Build detail string showing entry name if available
                let detail = tool_name.as_deref()
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();
                let duration_str = duration_ms.map(|d| format!(" ({d}ms)")).unwrap_or_default();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Request complete: {flow_name}{detail}{duration_str}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
            crate::event::RequestEventType::Error => {
                // Prefer entry_name from event data over stored request
                let tool_name = if let Some(request_id) = &event.base.request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == request_id) {
                        req.duration_ms = duration_ms;
                        req.is_error = true;
                        req.error_message = error.as_ref().map(|e| e.message.clone());
                        // Update entry_name if event provides one (e.g., from tools:call-tool)
                        if entry_name.is_some() {
                            req.entry_name = entry_name.clone();
                        }
                        req.entry_name.clone()
                    } else {
                        // No stored request found - use event's entry_name directly
                        entry_name.clone()
                    }
                } else {
                    entry_name.clone()
                };

                // Update metrics - only pass tool_name for actual tool flows
                let is_tool_flow = flow_name.contains("tool");
                self.metrics.record_request(
                    false,
                    duration_ms,
                    if is_tool_flow { tool_name.as_deref() } else { None },
                );

                // Update overview with failed tool call
                if let Some(name) = &tool_name {
                    if is_tool_flow {
                        self.overview.add_tool_call(name.clone(), false, duration_ms);
                    }
                }

                // Build detail string showing entry name if available
                let detail = tool_name.as_deref()
                    .map(|d| format!(" [{}]", d))
                    .unwrap_or_default();
                let error_msg = error.map(|e| e.message).unwrap_or_else(|| "Unknown error".to_string());
                self.add_log_with_context(
                    LogLevel::Error,
                    format!("Request error: {flow_name}{detail} - {error_msg}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
        }
    }

    fn handle_registry_event(&mut self, event: RegistryEvent) {
        let RegistryEventData {
            entry_names,
            change_kind,
            owner,
            ..
        } = event.data;

        let names = entry_names.unwrap_or_default();

        match event.event_type {
            // Tools
            RegistryEventType::ToolAdded => {
                for name in &names {
                    self.tools.push(ToolInfo {
                        name: name.clone(),
                        description: None,
                        input_schema: None,
                        output_schema: None,
                        owner_kind: owner.as_ref().map(|o| o.kind.clone()),
                        owner_id: owner.as_ref().map(|o| o.id.clone()),
                    });
                }
                self.add_log(LogLevel::Info, format!("Tools added: {}", names.join(", ")), "registry");
            }
            RegistryEventType::ToolRemoved => {
                self.tools.retain(|t| !names.contains(&t.name));
                self.add_log(LogLevel::Info, format!("Tools removed: {}", names.join(", ")), "registry");
            }
            RegistryEventType::ToolReset => {
                // For reset events, use the entries field to populate tools with full details
                if let Some(entries) = &event.data.entries {
                    self.tools.clear();
                    for entry in entries {
                        // Convert serde_json::Value to String for display
                        let input_schema = entry.input_schema.as_ref().map(|v| v.to_string());
                        self.tools.push(ToolInfo {
                            name: entry.name.clone(),
                            description: entry.description.clone(),
                            input_schema,
                            output_schema: None,
                            owner_kind: entry.owner.as_ref().map(|o| o.kind.clone()),
                            owner_id: entry.owner.as_ref().map(|o| o.id.clone()),
                        });
                    }
                } else {
                    self.tools.clear();
                }
                self.add_log(LogLevel::Info, "Tools reset".to_string(), "registry");
            }
            RegistryEventType::ToolUpdated => {
                self.add_log(LogLevel::Info, format!("Tools updated: {}", names.join(", ")), "registry");
            }

            // Resources
            RegistryEventType::ResourceAdded => {
                for name in &names {
                    self.resources.push(ResourceInfo {
                        name: name.clone(),
                        uri: None,
                        owner_kind: owner.as_ref().map(|o| o.kind.clone()),
                        owner_id: owner.as_ref().map(|o| o.id.clone()),
                    });
                }
                self.add_log(LogLevel::Info, format!("Resources added: {}", names.join(", ")), "registry");
            }
            RegistryEventType::ResourceRemoved => {
                self.resources.retain(|r| !names.contains(&r.name));
                self.add_log(LogLevel::Info, format!("Resources removed: {}", names.join(", ")), "registry");
            }
            RegistryEventType::ResourceReset => {
                // For reset events, use the entries field to populate resources with full details
                if let Some(entries) = &event.data.entries {
                    self.resources.clear();
                    for entry in entries {
                        self.resources.push(ResourceInfo {
                            name: entry.name.clone(),
                            uri: entry.uri.clone(),
                            owner_kind: entry.owner.as_ref().map(|o| o.kind.clone()),
                            owner_id: entry.owner.as_ref().map(|o| o.id.clone()),
                        });
                    }
                } else {
                    self.resources.clear();
                }
                self.add_log(LogLevel::Info, "Resources reset".to_string(), "registry");
            }
            RegistryEventType::ResourceUpdated => {
                self.add_log(LogLevel::Info, format!("Resources updated: {}", names.join(", ")), "registry");
            }

            // Prompts
            RegistryEventType::PromptAdded => {
                for name in &names {
                    self.prompts.push(PromptInfo {
                        name: name.clone(),
                        owner_kind: owner.as_ref().map(|o| o.kind.clone()),
                        owner_id: owner.as_ref().map(|o| o.id.clone()),
                    });
                }
                self.add_log(LogLevel::Info, format!("Prompts added: {}", names.join(", ")), "registry");
            }
            RegistryEventType::PromptRemoved => {
                self.prompts.retain(|p| !names.contains(&p.name));
                self.add_log(LogLevel::Info, format!("Prompts removed: {}", names.join(", ")), "registry");
            }
            RegistryEventType::PromptReset => {
                // For reset events, use the entries field to populate prompts with full details
                if let Some(entries) = &event.data.entries {
                    self.prompts.clear();
                    for entry in entries {
                        self.prompts.push(PromptInfo {
                            name: entry.name.clone(),
                            owner_kind: entry.owner.as_ref().map(|o| o.kind.clone()),
                            owner_id: entry.owner.as_ref().map(|o| o.id.clone()),
                        });
                    }
                } else {
                    self.prompts.clear();
                }
                self.add_log(LogLevel::Info, "Prompts reset".to_string(), "registry");
            }
            RegistryEventType::PromptUpdated => {
                self.add_log(LogLevel::Info, format!("Prompts updated: {}", names.join(", ")), "registry");
            }

            // Agents (log only)
            RegistryEventType::AgentAdded
            | RegistryEventType::AgentRemoved
            | RegistryEventType::AgentReset
            | RegistryEventType::AgentUpdated => {
                self.add_log(
                    LogLevel::Info,
                    format!("Agent {change_kind}: {}", names.join(", ")),
                    "registry",
                );
            }

            // Plugins
            RegistryEventType::PluginAdded => {
                for name in &names {
                    self.plugins.push(PluginInfo {
                        name: name.clone(),
                        version: None,
                        owner_id: owner.as_ref().map(|o| o.id.clone()),
                    });
                }
                self.add_log(LogLevel::Info, format!("Plugins added: {}", names.join(", ")), "registry");
            }
            RegistryEventType::PluginRemoved => {
                self.plugins.retain(|p| !names.contains(&p.name));
                self.add_log(LogLevel::Info, format!("Plugins removed: {}", names.join(", ")), "registry");
            }
            RegistryEventType::PluginReset => {
                // For reset events, use the entries field to populate plugins
                if let Some(entries) = &event.data.entries {
                    self.plugins.clear();
                    for entry in entries {
                        self.plugins.push(PluginInfo {
                            name: entry.name.clone(),
                            version: entry.version.clone(),
                            owner_id: entry.owner.as_ref().map(|o| o.id.clone()),
                        });
                    }
                } else {
                    self.plugins.clear();
                }
                self.add_log(LogLevel::Info, "Plugins reset".to_string(), "registry");
            }
            RegistryEventType::PluginUpdated => {
                self.add_log(LogLevel::Info, format!("Plugins updated: {}", names.join(", ")), "registry");
            }

            // Adapters
            RegistryEventType::AdapterAdded => {
                for name in &names {
                    self.adapters.push(AdapterInfo {
                        name: name.clone(),
                        description: None,
                        owner_id: owner.as_ref().map(|o| o.id.clone()),
                    });
                }
                self.add_log(LogLevel::Info, format!("Adapters added: {}", names.join(", ")), "registry");
            }
            RegistryEventType::AdapterRemoved => {
                self.adapters.retain(|a| !names.contains(&a.name));
                self.add_log(LogLevel::Info, format!("Adapters removed: {}", names.join(", ")), "registry");
            }
            RegistryEventType::AdapterReset => {
                // For reset events, use the entries field to populate adapters
                if let Some(entries) = &event.data.entries {
                    self.adapters.clear();
                    for entry in entries {
                        self.adapters.push(AdapterInfo {
                            name: entry.name.clone(),
                            description: entry.description.clone(),
                            owner_id: entry.owner.as_ref().map(|o| o.id.clone()),
                        });
                    }
                } else {
                    self.adapters.clear();
                }
                self.add_log(LogLevel::Info, "Adapters reset".to_string(), "registry");
            }
            RegistryEventType::AdapterUpdated => {
                self.add_log(LogLevel::Info, format!("Adapters updated: {}", names.join(", ")), "registry");
            }
        }

        // Update overview counts
        self.update_overview_registry();
    }

    fn handle_server_event(&mut self, event: ServerEvent) {
        let ServerEventData {
            server_info,
            address,
            uptime_ms,
            error,
            ..
        } = event.data;

        match event.event_type {
            crate::event::ServerEventType::Starting => {
                self.server.is_ready = false;
                self.add_log(LogLevel::Info, "Server starting...".to_string(), "server");
            }
            crate::event::ServerEventType::Ready => {
                self.server.is_ready = true;
                self.server.name = server_info.as_ref().map(|s| s.name.clone());
                self.server.version = server_info.as_ref().map(|s| s.version.clone());
                self.server.address = address.clone();

                // Update overview with server address
                self.overview.server_address = address.clone();
                if let Some(addr) = &address {
                    // Extract port from address like "http://localhost:3000"
                    if let Some(port_str) = addr.rsplit(':').next() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            self.overview.server_port = Some(port);
                        }
                    }
                }

                self.add_log(LogLevel::Info, "Server ready".to_string(), "server");
            }
            crate::event::ServerEventType::Error => {
                self.server.error = error.clone();
                self.add_log(
                    LogLevel::Error,
                    format!("Server error: {}", error.unwrap_or_else(|| "Unknown".to_string())),
                    "server",
                );
            }
            crate::event::ServerEventType::Shutdown => {
                self.server.is_ready = false;
                self.server.uptime_ms = uptime_ms;
                self.add_log(LogLevel::Info, "Server shutdown".to_string(), "server");
            }
        }
    }

    fn handle_config_event(&mut self, event: ConfigEvent) {
        match event.event_type {
            crate::event::ConfigEventType::Loaded => {
                self.config.is_loaded = true;
                self.config.config_path = event.data.config_path;
                self.config.loaded_keys = event.data.loaded_keys.unwrap_or_default();
                self.add_log(LogLevel::Info, "Config loaded".to_string(), "config");
            }
            crate::event::ConfigEventType::Error => {
                self.config.errors = event
                    .data
                    .errors
                    .map(|e| e.iter().map(|err| err.message.clone()).collect())
                    .unwrap_or_default();
                self.add_log(LogLevel::Error, "Config error".to_string(), "config");
            }
            crate::event::ConfigEventType::Missing => {
                self.config.missing_keys = event.data.missing_keys.unwrap_or_default();
                self.add_log(LogLevel::Warn, "Config missing keys".to_string(), "config");
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Logging
    // ─────────────────────────────────────────────────────────────────────────

    pub fn add_log(&mut self, level: LogLevel, message: String, source: &str) {
        self.add_log_with_context(level, message, source, None, None);
    }

    /// Add an error message for display in the UI
    pub fn add_error(&mut self, error: String) {
        self.parse_failures += 1;
        // Keep only last 5 errors
        if self.recent_errors.len() >= 5 {
            self.recent_errors.remove(0);
        }
        self.recent_errors.push(error.clone());
        // Also log it
        self.add_log(LogLevel::Error, error, "system");
    }

    fn add_log_with_context(
        &mut self,
        level: LogLevel,
        message: String,
        source: &str,
        session_id: Option<String>,
        request_id: Option<String>,
    ) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let entry = LogEntry {
            timestamp,
            level,
            message,
            source: source.to_string(),
            session_id: session_id.clone(),
            request_id,
        };

        // Add to session-specific logs if applicable
        // Use entry().or_insert_with() to create the Vec if session not yet initialized
        // This ensures logs are never silently discarded
        if let Some(ref sid) = session_id {
            let logs = self.session_logs.entry(sid.clone()).or_insert_with(Vec::new);
            logs.push(entry.clone());
            // Keep last 500 per session
            if logs.len() > 500 {
                logs.remove(0);
            }
        }

        // Add to global logs
        self.logs.push(entry);

        // Keep last 1000 global logs
        if self.logs.len() > 1000 {
            self.logs.remove(0);
        }
    }

    /// Add a raw log line from stderr (non-event output)
    /// Format: [HH:MM:SS.mmm] [source] LEVEL message
    /// Lines without this format are treated as continuation of previous log
    pub fn add_raw_log(&mut self, line: String) {
        // Try to parse structured log format: [timestamp] [source] LEVEL message
        if let Some((level, source, message)) = parse_structured_log(&line) {
            self.add_log(level, message, &source);
        } else if !line.trim().is_empty() {
            // Continuation line - append to previous log or create new one
            if let Some(last) = self.logs.last_mut() {
                // Append to previous log message
                last.message.push('\n');
                last.message.push_str(&line);
            } else {
                // No previous log, create new one
                self.add_log(LogLevel::Info, line, "output");
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Overview Updates
    // ─────────────────────────────────────────────────────────────────────────

    fn update_overview_sessions(&mut self) {
        // Count all sessions (both stateful and stateless are now in sessions HashMap)
        self.overview.total_sessions = self.sessions.len();
        self.overview.active_sessions = self.sessions.values().filter(|s| s.is_active).count();
    }

    fn update_overview_registry(&mut self) {
        // Count unique app owners as registered apps
        let mut apps: std::collections::HashSet<String> = std::collections::HashSet::new();
        for tool in &self.tools {
            if tool.owner_kind.as_deref() == Some("app") {
                if let Some(ref id) = tool.owner_id {
                    apps.insert(id.clone());
                }
            }
        }
        for resource in &self.resources {
            if resource.owner_kind.as_deref() == Some("app") {
                if let Some(ref id) = resource.owner_id {
                    apps.insert(id.clone());
                }
            }
        }
        self.overview.registered_apps = apps.len();

        // Count scopes from the scopes list
        self.overview.scope_count = self.scopes.len();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tab Navigation
    // ─────────────────────────────────────────────────────────────────────────

    /// Move to next tab
    pub fn next_tab(&mut self) {
        let idx = self.active_tab.index();
        let next = (idx + 1) % Tab::all().len();
        self.active_tab = Tab::from_index(next);
        self.reset_list_selection();
    }

    /// Move to previous tab
    pub fn prev_tab(&mut self) {
        let idx = self.active_tab.index();
        let prev = if idx == 0 { Tab::all().len() - 1 } else { idx - 1 };
        self.active_tab = Tab::from_index(prev);
        self.reset_list_selection();
    }

    /// Switch to tab by index (1-6 keys)
    pub fn switch_tab_by_index(&mut self, index: usize) {
        if index < Tab::all().len() {
            self.active_tab = Tab::from_index(index);
            self.reset_list_selection();
        }
    }

    /// Enter tab content from tab bar
    pub fn enter_tab_content(&mut self) {
        match self.active_tab {
            Tab::Capabilities => self.focus = FocusArea::SubTab,
            Tab::Logs if self.log_filter.is_active() => self.focus = FocusArea::FilterInput,
            _ => self.focus = FocusArea::List,
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Activity Sub-Tab Navigation
    // ─────────────────────────────────────────────────────────────────────────

    /// Move to next sub-tab
    pub fn next_sub_tab(&mut self) {
        let idx = self.activity_sub_tab.index();
        let next = (idx + 1) % ActivitySubTab::all().len();
        self.activity_sub_tab = ActivitySubTab::from_index(next);
        self.reset_list_selection();
    }

    /// Move to previous sub-tab
    pub fn prev_sub_tab(&mut self) {
        let idx = self.activity_sub_tab.index();
        let prev = if idx == 0 {
            ActivitySubTab::all().len() - 1
        } else {
            idx - 1
        };
        self.activity_sub_tab = ActivitySubTab::from_index(prev);
        self.reset_list_selection();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // List Navigation
    // ─────────────────────────────────────────────────────────────────────────

    /// Toggle help overlay
    pub fn toggle_help(&mut self) {
        self.show_help = !self.show_help;
    }

    /// Move selection down
    pub fn move_down(&mut self) {
        let max = self.current_list_len().saturating_sub(1);
        self.list_selected = self.list_selected.saturating_add(1).min(max);
    }

    /// Move selection up
    pub fn move_up(&mut self) {
        self.list_selected = self.list_selected.saturating_sub(1);
    }

    /// Jump to top
    pub fn jump_top(&mut self) {
        self.list_selected = 0;
        self.list_scroll = 0;
    }

    /// Jump to bottom
    pub fn jump_bottom(&mut self) {
        let max = self.current_list_len().saturating_sub(1);
        self.list_selected = max;
    }

    /// Page down
    pub fn page_down(&mut self) {
        let max = self.current_list_len().saturating_sub(1);
        self.list_selected = self.list_selected.saturating_add(10).min(max);
    }

    /// Page up
    pub fn page_up(&mut self) {
        self.list_selected = self.list_selected.saturating_sub(10);
    }

    /// Select current item (Enter)
    pub fn select_item(&mut self) {
        match self.active_tab {
            Tab::Sessions => {
                let sessions: Vec<_> = self.sessions.values().collect();
                if let Some(session) = sessions.get(self.list_selected) {
                    self.selected_session = Some(session.id.clone());
                    self.detail_scroll = 0; // Reset scroll when switching sessions
                    self.focus = FocusArea::Detail;
                }
            }
            _ => {
                self.focus = FocusArea::Detail;
            }
        }
    }

    /// Go back from detail view
    pub fn back_from_detail(&mut self) {
        self.selected_session = None;
        self.focus = FocusArea::List;
        self.detail_scroll = 0;
    }

    /// Scroll detail view up
    pub fn scroll_detail_up(&mut self) {
        self.detail_scroll = self.detail_scroll.saturating_sub(1);
    }

    /// Scroll detail view down
    pub fn scroll_detail_down(&mut self) {
        self.detail_scroll = self.detail_scroll.saturating_add(1);
    }

    /// Scroll overview up
    pub fn scroll_overview_up(&mut self) {
        self.overview_scroll = self.overview_scroll.saturating_sub(1);
    }

    /// Scroll overview down
    pub fn scroll_overview_down(&mut self) {
        self.overview_scroll = self.overview_scroll.saturating_add(1);
    }

    /// Scroll logs up (see older content, away from live tail)
    /// list_scroll = how many lines scrolled UP from the bottom (0 = live tail)
    pub fn scroll_logs_up(&mut self, amount: usize) {
        let max_scroll = self.logs.len().saturating_sub(1);
        self.list_scroll = self.list_scroll.saturating_add(amount).min(max_scroll);
    }

    /// Scroll logs down (see newer content, toward live tail)
    /// When list_scroll reaches 0, we're back to live tail mode
    pub fn scroll_logs_down(&mut self, amount: usize) {
        self.list_scroll = self.list_scroll.saturating_sub(amount);
    }

    fn reset_list_selection(&mut self) {
        self.list_selected = 0;
        self.list_scroll = 0;
    }

    fn current_list_len(&self) -> usize {
        match self.active_tab {
            Tab::Sessions => self.sessions.len(),
            Tab::Capabilities => match self.activity_sub_tab {
                ActivitySubTab::Tools => self.tools.len(),
                ActivitySubTab::Resources => self.resources.len(),
                ActivitySubTab::Prompts => self.prompts.len(),
                ActivitySubTab::Plugins => self.plugins.len(),
            },
            Tab::Logs => {
                if self.log_filter.is_active() {
                    self.logs.iter().filter(|l| self.log_filter.matches(l)).count()
                } else {
                    self.logs.len()
                }
            }
            Tab::Metrics => 0, // No list
            Tab::Playground => 0,
            Tab::AiInsight => 0,
            Tab::Graph => self.graph_tree_len(),
        }
    }

    /// Calculate the number of items in the graph tree view
    /// Must match the logic in graph.rs build_graph_nodes()
    pub fn graph_tree_len(&self) -> usize {
        use std::collections::HashSet;

        let mut count = 1; // Server root

        // Infer apps from owners (same logic as graph.rs infer_apps)
        let mut app_ids: HashSet<String> = HashSet::new();
        for tool in &self.tools {
            if matches!(tool.owner_kind.as_deref(), Some("app") | Some("scope")) {
                if let Some(ref id) = tool.owner_id {
                    app_ids.insert(id.clone());
                }
            }
        }
        for resource in &self.resources {
            if matches!(resource.owner_kind.as_deref(), Some("app") | Some("scope")) {
                if let Some(ref id) = resource.owner_id {
                    app_ids.insert(id.clone());
                }
            }
        }
        for prompt in &self.prompts {
            if matches!(prompt.owner_kind.as_deref(), Some("app") | Some("scope")) {
                if let Some(ref id) = prompt.owner_id {
                    app_ids.insert(id.clone());
                }
            }
        }
        for plugin in &self.plugins {
            if let Some(ref id) = plugin.owner_id {
                app_ids.insert(id.clone());
            }
        }
        for adapter in &self.adapters {
            if let Some(ref id) = adapter.owner_id {
                app_ids.insert(id.clone());
            }
        }

        // Multi-scope mode check (same as graph.rs)
        let show_scopes = self.scopes.len() > 1;

        if show_scopes {
            // Multi-scope mode: count scope nodes
            for scope in &self.scopes {
                count += 1; // Scope node

                let scope_expand_key = format!("scope:{}", scope.id);
                if self.graph_expanded.contains(&scope_expand_key) {
                    // Count apps that belong to this scope
                    for app_id in app_ids.iter().filter(|id| self.scopes.iter().any(|s| &s.id == *id && s.id == scope.id)) {
                        count += self.count_app_nodes(app_id);
                    }
                }
            }

            // Count orphan apps (not in any scope)
            let orphan_apps: Vec<_> = app_ids.iter()
                .filter(|id| !self.scopes.iter().any(|s| &s.id == *id))
                .collect();
            if !orphan_apps.is_empty() {
                count += 1; // "Direct" header for orphans
                for app_id in orphan_apps {
                    count += self.count_app_nodes(app_id);
                }
            }
        } else {
            // Single-scope or no scopes: count app nodes directly
            for app_id in &app_ids {
                count += self.count_app_nodes(app_id);
            }

            // Direct items (no app owner)
            let direct_tools = self.tools.iter().filter(|t| t.owner_kind.is_none()).count();
            let direct_resources = self.resources.iter().filter(|r| r.owner_kind.is_none()).count();
            let direct_prompts = self.prompts.iter().filter(|p| p.owner_kind.is_none()).count();

            if direct_tools > 0 || direct_resources > 0 || direct_prompts > 0 {
                count += 1; // "Direct" header
                count += direct_tools + direct_resources + direct_prompts;
            }
        }

        count
    }

    /// Helper to count nodes for a single app (including children if expanded)
    fn count_app_nodes(&self, app_id: &str) -> usize {
        let mut count = 1; // App node itself

        if self.graph_expanded.contains(app_id) {
            // Count adapters owned by this app (and their children if expanded)
            for adapter in self.adapters.iter().filter(|a| a.owner_id.as_deref() == Some(app_id)) {
                count += 1; // Adapter node
                let adapter_key = format!("adapter:{}", adapter.name);
                if self.graph_expanded.contains(&adapter_key) {
                    // Count tools owned by this adapter
                    count += self.tools.iter().filter(|t|
                        t.owner_kind.as_deref() == Some("adapter") &&
                        t.owner_id.as_deref() == Some(&adapter.name)
                    ).count();
                }
            }

            // Count plugins owned by this app (and their children if expanded)
            for plugin in self.plugins.iter().filter(|p| p.owner_id.as_deref() == Some(app_id)) {
                count += 1; // Plugin node
                let plugin_key = format!("plugin:{}", plugin.name);
                if self.graph_expanded.contains(&plugin_key) {
                    // Count tools owned by this plugin
                    count += self.tools.iter().filter(|t|
                        t.owner_kind.as_deref() == Some("plugin") &&
                        t.owner_id.as_deref() == Some(&plugin.name)
                    ).count();
                }
            }

            // Count tools owned directly by this app/scope
            count += self.tools.iter().filter(|t|
                matches!(t.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                t.owner_id.as_deref() == Some(app_id)
            ).count();

            // Count resources owned by this app/scope
            count += self.resources.iter().filter(|r|
                matches!(r.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                r.owner_id.as_deref() == Some(app_id)
            ).count();

            // Count prompts owned by this app/scope
            count += self.prompts.iter().filter(|p|
                matches!(p.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                p.owner_id.as_deref() == Some(app_id)
            ).count();
        }

        count
    }

    /// Toggle expand/collapse of a graph node
    pub fn toggle_graph_expand(&mut self, id: &str) {
        if self.graph_expanded.contains(id) {
            self.graph_expanded.remove(id);
        } else {
            self.graph_expanded.insert(id.to_string());
        }
    }

    /// Get filtered logs
    pub fn filtered_logs(&self) -> Vec<&LogEntry> {
        if self.log_filter.is_active() {
            self.logs.iter().filter(|l| self.log_filter.matches(l)).collect()
        } else {
            self.logs.iter().collect()
        }
    }

    /// Get session logs for selected session
    pub fn selected_session_logs(&self) -> Vec<&LogEntry> {
        if let Some(ref sid) = self.selected_session {
            if let Some(logs) = self.session_logs.get(sid) {
                return logs.iter().collect();
            }
        }
        Vec::new()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper methods for trace event parsing
    // ─────────────────────────────────────────────────────────────────────────

    /// Extract entry names from trace event data
    fn extract_entry_names(data: Option<&serde_json::Value>) -> Vec<String> {
        data.and_then(|d| d.get("entryNames"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Extract owner (kind, id) from trace event data
    fn extract_owner(data: Option<&serde_json::Value>) -> Option<(String, String)> {
        data.and_then(|d| d.get("owner")).and_then(|owner| {
            let kind = owner.get("kind").and_then(|v| v.as_str())?;
            let id = owner.get("id").and_then(|v| v.as_str())?;
            Some((kind.to_string(), id.to_string()))
        })
    }

    /// Extract tool entries with description and schema from trace event data
    fn extract_tool_entries(data: Option<&serde_json::Value>) -> Vec<ParsedToolEntry> {
        // Try new format with "entries" array first
        if let Some(entries) = data.and_then(|d| d.get("entries")).and_then(|v| v.as_array()) {
            return entries
                .iter()
                .filter_map(|entry| {
                    let name = entry.get("name").and_then(|v| v.as_str())?.to_string();
                    let description = entry
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let input_schema = entry
                        .get("inputSchema")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ParsedToolEntry {
                        name,
                        description,
                        input_schema,
                    })
                })
                .collect();
        }

        // Fall back to old format with "entryNames" array
        Self::extract_entry_names(data)
            .into_iter()
            .map(|name| ParsedToolEntry {
                name,
                description: None,
                input_schema: None,
            })
            .collect()
    }

    /// Extract plugin entries with version from trace event data
    fn extract_plugin_entries(data: Option<&serde_json::Value>) -> Vec<ParsedPluginEntry> {
        if let Some(entries) = data.and_then(|d| d.get("entries")).and_then(|v| v.as_array()) {
            return entries
                .iter()
                .filter_map(|entry| {
                    let name = entry.get("name").and_then(|v| v.as_str())?.to_string();
                    let version = entry
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ParsedPluginEntry { name, version })
                })
                .collect();
        }

        // Fall back to extracting just names
        Self::extract_entry_names(data)
            .into_iter()
            .map(|name| ParsedPluginEntry {
                name,
                version: None,
            })
            .collect()
    }

    /// Extract adapter entries with description from trace event data
    fn extract_adapter_entries(data: Option<&serde_json::Value>) -> Vec<ParsedAdapterEntry> {
        if let Some(entries) = data.and_then(|d| d.get("entries")).and_then(|v| v.as_array()) {
            return entries
                .iter()
                .filter_map(|entry| {
                    let name = entry.get("name").and_then(|v| v.as_str())?.to_string();
                    let description = entry
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ParsedAdapterEntry { name, description })
                })
                .collect();
        }

        // Fall back to extracting just names
        Self::extract_entry_names(data)
            .into_iter()
            .map(|name| ParsedAdapterEntry {
                name,
                description: None,
            })
            .collect()
    }
}

/// Parsed tool entry from trace event data
struct ParsedToolEntry {
    name: String,
    description: Option<String>,
    input_schema: Option<String>,
}

/// Parsed plugin entry from trace event data
struct ParsedPluginEntry {
    name: String,
    version: Option<String>,
}

/// Parsed adapter entry from trace event data
struct ParsedAdapterEntry {
    name: String,
    description: Option<String>,
}
