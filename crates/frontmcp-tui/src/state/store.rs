//! Dashboard state store

use std::collections::HashMap;

use crate::event::{
    ConfigEvent, DevEvent, RegistryEvent, RegistryEventData, RegistryEventType, RequestEvent,
    RequestEventData, ServerEvent, ServerEventData, SessionEvent, SessionEventData,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab System
// ─────────────────────────────────────────────────────────────────────────────

/// Active tab in the dashboard
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tab {
    #[default]
    Sessions,
    Activity,
    Logs,
    Metrics,
    Playground,
    AiInsight,
}

impl Tab {
    pub fn all() -> &'static [Tab] {
        &[
            Tab::Sessions,
            Tab::Activity,
            Tab::Logs,
            Tab::Metrics,
            Tab::Playground,
            Tab::AiInsight,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            Tab::Sessions => "Sessions",
            Tab::Activity => "Activity",
            Tab::Logs => "Logs",
            Tab::Metrics => "Metrics",
            Tab::Playground => "Playground",
            Tab::AiInsight => "AI Insight",
        }
    }

    pub fn index(&self) -> usize {
        match self {
            Tab::Sessions => 0,
            Tab::Activity => 1,
            Tab::Logs => 2,
            Tab::Metrics => 3,
            Tab::Playground => 4,
            Tab::AiInsight => 5,
        }
    }

    pub fn from_index(index: usize) -> Self {
        match index {
            0 => Tab::Sessions,
            1 => Tab::Activity,
            2 => Tab::Logs,
            3 => Tab::Metrics,
            4 => Tab::Playground,
            5 => Tab::AiInsight,
            _ => Tab::Sessions,
        }
    }
}

/// Sub-tab for Activity tab
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActivitySubTab {
    #[default]
    Tools,
    Resources,
    Prompts,
}

impl ActivitySubTab {
    pub fn all() -> &'static [ActivitySubTab] {
        &[
            ActivitySubTab::Tools,
            ActivitySubTab::Resources,
            ActivitySubTab::Prompts,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            ActivitySubTab::Tools => "Tools",
            ActivitySubTab::Resources => "Resources",
            ActivitySubTab::Prompts => "Prompts",
        }
    }

    pub fn index(&self) -> usize {
        match self {
            ActivitySubTab::Tools => 0,
            ActivitySubTab::Resources => 1,
            ActivitySubTab::Prompts => 2,
        }
    }

    pub fn from_index(index: usize) -> Self {
        match index {
            0 => ActivitySubTab::Tools,
            1 => ActivitySubTab::Resources,
            2 => ActivitySubTab::Prompts,
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
    pub connected_at: u64,
    pub is_active: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Data (Tools, Resources, Prompts)
// ─────────────────────────────────────────────────────────────────────────────

/// Tool info for display
#[derive(Debug, Clone)]
pub struct ToolInfo {
    pub name: String,
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

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Data
// ─────────────────────────────────────────────────────────────────────────────

/// Metrics data for display
#[derive(Debug, Clone, Default)]
pub struct MetricsData {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_duration_ms: u64,
    pub tool_usage: HashMap<String, u64>,
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

    // Debug: event counter and pipe info
    pub events_received: u64,
    pub lines_read: u64,
    pub parse_failures: u64,
    pub pipe_path: Option<String>,
    pub pipe_connected: bool,

    // Overview (always visible)
    pub overview: OverviewData,

    // Sessions tab data
    pub sessions: HashMap<String, SessionInfo>,
    pub session_logs: HashMap<String, Vec<LogEntry>>,
    pub selected_session: Option<String>,

    // Activity tab data
    pub tools: Vec<ToolInfo>,
    pub resources: Vec<ResourceInfo>,
    pub prompts: Vec<PromptInfo>,
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
}

impl DashboardState {
    // ─────────────────────────────────────────────────────────────────────────
    // Event Handling
    // ─────────────────────────────────────────────────────────────────────────

    /// Handle an incoming dev event
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

    fn handle_session_event(&mut self, event: SessionEvent) {
        let SessionEventData {
            session_id,
            transport_type,
            client_info,
            ..
        } = event.data;

        match event.event_type {
            crate::event::SessionEventType::Connect => {
                let session = SessionInfo {
                    id: session_id.clone(),
                    transport_type,
                    client_name: client_info.as_ref().map(|c| c.name.clone()),
                    client_version: client_info.as_ref().map(|c| c.version.clone()),
                    connected_at: event.base.timestamp,
                    is_active: true,
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
            ..
        } = event.data;

        let session_id = event.base.session_id.clone();
        let request_id = event.base.request_id.clone();

        match event.event_type {
            crate::event::RequestEventType::Start => {
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
                    format!("Request started: {flow_name}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
            crate::event::RequestEventType::Complete => {
                let tool_name = if let Some(request_id) = &event.base.request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == request_id) {
                        req.duration_ms = duration_ms;
                        req.is_error = is_error.unwrap_or(false);
                        req.entry_name.clone()
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Update metrics
                let success = !is_error.unwrap_or(false);
                self.metrics.record_request(success, duration_ms, tool_name.as_deref());

                // Update overview with tool call
                if let Some(name) = &tool_name {
                    if flow_name.contains("tool") {
                        self.overview.add_tool_call(name.clone(), success, duration_ms);
                    }
                }

                let duration_str = duration_ms.map(|d| format!(" ({d}ms)")).unwrap_or_default();
                self.add_log_with_context(
                    LogLevel::Info,
                    format!("Request complete: {flow_name}{duration_str}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
            crate::event::RequestEventType::Error => {
                let tool_name = if let Some(request_id) = &event.base.request_id {
                    if let Some(req) = self.requests.iter_mut().find(|r| &r.id == request_id) {
                        req.duration_ms = duration_ms;
                        req.is_error = true;
                        req.error_message = error.as_ref().map(|e| e.message.clone());
                        req.entry_name.clone()
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Update metrics
                self.metrics.record_request(false, duration_ms, tool_name.as_deref());

                // Update overview with failed tool call
                if let Some(name) = &tool_name {
                    if flow_name.contains("tool") {
                        self.overview.add_tool_call(name.clone(), false, duration_ms);
                    }
                }

                let error_msg = error.map(|e| e.message).unwrap_or_else(|| "Unknown error".to_string());
                self.add_log_with_context(
                    LogLevel::Error,
                    format!("Request error: {flow_name} - {error_msg}"),
                    "api",
                    session_id,
                    request_id,
                );
            }
        }
    }

    fn handle_registry_event(&mut self, event: RegistryEvent) {
        let RegistryEventData {
            registry_type,
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
                self.tools.clear();
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
                self.resources.clear();
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
                self.prompts.clear();
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

    fn add_log(&mut self, level: LogLevel, message: String, source: &str) {
        self.add_log_with_context(level, message, source, None, None);
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
        if let Some(ref sid) = session_id {
            if let Some(logs) = self.session_logs.get_mut(sid) {
                logs.push(entry.clone());
                // Keep last 500 per session
                if logs.len() > 500 {
                    logs.remove(0);
                }
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
    pub fn add_raw_log(&mut self, line: String) {
        // Parse the log level from the line if present
        let level = if line.contains("ERROR") || line.contains("error:") {
            LogLevel::Error
        } else if line.contains("WARN") || line.contains("warning:") {
            LogLevel::Warn
        } else if line.contains("DEBUG") {
            LogLevel::Debug
        } else {
            LogLevel::Info
        };

        // Extract source from log line if it matches pattern [timestamp] [source] ...
        let source = if let Some(start) = line.find("] [") {
            if let Some(end) = line[start + 3..].find(']') {
                line[start + 3..start + 3 + end].to_string()
            } else {
                "stderr".to_string()
            }
        } else {
            "stderr".to_string()
        };

        self.add_log(level, line, &source);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Overview Updates
    // ─────────────────────────────────────────────────────────────────────────

    fn update_overview_sessions(&mut self) {
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

        // Scope count would need scope graph events
        self.overview.scope_count = 1 + apps.len(); // Root + apps
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
            Tab::Activity => self.focus = FocusArea::SubTab,
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
            Tab::Activity => match self.activity_sub_tab {
                ActivitySubTab::Tools => self.tools.len(),
                ActivitySubTab::Resources => self.resources.len(),
                ActivitySubTab::Prompts => self.prompts.len(),
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
}
