//! Comprehensive tests for all trace events sent to the TUI
//!
//! This module documents and tests every trace event type that the SDK emits
//! and the TUI handles. Run these tests to verify event parsing and state handling.

#[cfg(test)]
mod tests {
    use crate::event::types::{parse_unified_event_line, DevBusLogEvent, UnifiedEvent, DEV_EVENT_MAGIC};
    use crate::state::DashboardState;
    use serde_json::json;

    // ─────────────────────────────────────────────────────────────────────────────
    // Helper Functions
    // ─────────────────────────────────────────────────────────────────────────────

    /// Create a trace event JSON string with the magic prefix
    fn make_trace_event(event_type: &str, data: serde_json::Value) -> String {
        let event = json!({
            "id": format!("test-{}", uuid_v4()),
            "timestamp": 1705276800000_u64,
            "category": "trace",
            "type": event_type,
            "prefix": "test",
            "scopeId": "test-scope",
            "sessionId": "test-session",
            "requestId": "test-request",
            "data": data
        });
        format!("{}{}", DEV_EVENT_MAGIC, event)
    }

    /// Simple UUID v4 generator for test IDs
    fn uuid_v4() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{:032x}", nanos)
    }

    /// Parse a trace event and return the DevBusLogEvent
    fn parse_trace_event(line: &str) -> DevBusLogEvent {
        match parse_unified_event_line(line) {
            Some(UnifiedEvent::LogTransport(event)) => event,
            other => panic!("Expected LogTransport event, got: {:?}", other),
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SESSION EVENTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_session_connect_event() {
        let line = make_trace_event(
            "session:connect",
            json!({
                "sessionId": "sess-123",
                "transportType": "sse"
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "session:connect");
        assert_eq!(event.category, "trace");

        let data = event.data.unwrap();
        assert_eq!(data["transportType"], "sse");
    }

    #[test]
    fn test_session_connect_updates_state() {
        let mut state = DashboardState::default();
        let line = make_trace_event(
            "session:connect",
            json!({
                "sessionId": "sess-123",
                "transportType": "sse"
            }),
        );

        let event = parse_trace_event(&line);
        state.handle_unified_event(UnifiedEvent::LogTransport(event));

        assert_eq!(state.sessions.len(), 1);
        let session = state.sessions.get("test-session").unwrap();
        assert!(session.is_active);
        assert_eq!(session.transport_type, Some("sse".to_string()));
    }

    #[test]
    fn test_session_disconnect_event() {
        let line = make_trace_event(
            "session:disconnect",
            json!({
                "sessionId": "sess-123",
                "transportType": "sse",
                "reason": "client closed"
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "session:disconnect");
    }

    #[test]
    fn test_session_disconnect_updates_state() {
        let mut state = DashboardState::default();

        // First connect
        let connect = make_trace_event("session:connect", json!({"transportType": "sse"}));
        let event = parse_trace_event(&connect);
        state.handle_unified_event(UnifiedEvent::LogTransport(event));

        assert!(state.sessions.get("test-session").unwrap().is_active);

        // Then disconnect
        let disconnect = make_trace_event("session:disconnect", json!({}));
        let event = parse_trace_event(&disconnect);
        state.handle_unified_event(UnifiedEvent::LogTransport(event));

        assert!(!state.sessions.get("test-session").unwrap().is_active);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REQUEST EVENTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_request_start_event() {
        let line = make_trace_event(
            "request:start",
            json!({
                "flowName": "tools:call-tool",
                "method": "tools/call",
                "entryName": "get_weather"
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "request:start");

        let data = event.data.unwrap();
        assert_eq!(data["flowName"], "tools:call-tool");
        assert_eq!(data["method"], "tools/call");
        assert_eq!(data["entryName"], "get_weather");
    }

    #[test]
    fn test_request_start_updates_state() {
        let mut state = DashboardState::default();
        let line = make_trace_event(
            "request:start",
            json!({
                "flowName": "tools:call-tool",
                "method": "tools/call",
                "entryName": "get_weather"
            }),
        );

        let event = parse_trace_event(&line);
        state.handle_unified_event(UnifiedEvent::LogTransport(event));

        assert_eq!(state.requests.len(), 1);
        assert_eq!(state.requests[0].entry_name, Some("get_weather".to_string()));
    }

    #[test]
    fn test_request_complete_event() {
        let line = make_trace_event(
            "request:complete",
            json!({
                "flowName": "tools:call-tool",
                "method": "tools/call",
                "entryName": "get_weather",
                "durationMs": 150
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "request:complete");

        let data = event.data.unwrap();
        assert_eq!(data["durationMs"], 150);
    }

    #[test]
    fn test_request_complete_updates_metrics() {
        let mut state = DashboardState::default();

        // Start request
        let start = make_trace_event(
            "request:start",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "get_weather"
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&start)));

        // Complete request
        let complete = make_trace_event(
            "request:complete",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "get_weather",
                "durationMs": 150
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&complete)));

        assert_eq!(state.metrics.total_requests, 1);
        assert_eq!(state.metrics.successful_requests, 1);
        assert_eq!(state.metrics.failed_requests, 0);
        assert!(state.metrics.tool_usage.contains_key("get_weather"));
    }

    #[test]
    fn test_request_error_event() {
        let line = make_trace_event(
            "request:error",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "failing_tool",
                "durationMs": 50,
                "error": {
                    "name": "ToolError",
                    "message": "Tool execution failed",
                    "code": -32603
                }
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "request:error");

        let data = event.data.unwrap();
        assert_eq!(data["error"]["message"], "Tool execution failed");
    }

    #[test]
    fn test_request_error_updates_metrics() {
        let mut state = DashboardState::default();

        let error = make_trace_event(
            "request:error",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "failing_tool",
                "durationMs": 50,
                "error": {
                    "message": "Tool execution failed"
                }
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&error)));

        assert_eq!(state.metrics.total_requests, 1);
        assert_eq!(state.metrics.successful_requests, 0);
        assert_eq!(state.metrics.failed_requests, 1);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TOOL EVENTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_tool_execute_event() {
        let line = make_trace_event(
            "tool:execute",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "get_weather",
                "entryOwner": {
                    "kind": "app",
                    "id": "WeatherMcpApp"
                }
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "tool:execute");

        let data = event.data.unwrap();
        assert_eq!(data["entryName"], "get_weather");
        assert_eq!(data["entryOwner"]["kind"], "app");
        assert_eq!(data["entryOwner"]["id"], "WeatherMcpApp");
    }

    #[test]
    fn test_tool_complete_event() {
        let line = make_trace_event(
            "tool:complete",
            json!({
                "flowName": "tools:call-tool",
                "entryName": "get_weather",
                "durationMs": 120,
                "entryOwner": {
                    "kind": "app",
                    "id": "WeatherMcpApp"
                }
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "tool:complete");

        let data = event.data.unwrap();
        assert_eq!(data["durationMs"], 120);
    }

    #[test]
    fn test_tool_complete_updates_overview() {
        let mut state = DashboardState::default();

        let complete = make_trace_event(
            "tool:complete",
            json!({
                "entryName": "get_weather",
                "durationMs": 120
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&complete)));

        assert_eq!(state.overview.last_tool_calls.len(), 1);
        assert_eq!(state.overview.last_tool_calls[0].name, "get_weather");
        assert!(state.overview.last_tool_calls[0].success);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REGISTRY EVENTS - TOOLS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_registry_tool_added_event() {
        let line = make_trace_event(
            "registry:tool:added",
            json!({
                "registryType": "tool",
                "changeKind": "added",
                "changeScope": "global",
                "entryNames": ["get_weather", "get_forecast"],
                "owner": {
                    "kind": "app",
                    "id": "WeatherMcpApp"
                },
                "snapshotCount": 2,
                "version": 1
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "registry:tool:added");

        let data = event.data.unwrap();
        let entry_names = data["entryNames"].as_array().unwrap();
        assert_eq!(entry_names.len(), 2);
    }

    #[test]
    fn test_registry_tool_added_updates_state() {
        let mut state = DashboardState::default();

        let added = make_trace_event(
            "registry:tool:added",
            json!({
                "registryType": "tool",
                "changeKind": "added",
                "entryNames": ["get_weather", "get_forecast"],
                "owner": {
                    "kind": "app",
                    "id": "WeatherMcpApp"
                },
                "snapshotCount": 2,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));

        assert_eq!(state.tools.len(), 2);
        assert!(state.tools.iter().any(|t| t.name == "get_weather"));
        assert!(state.tools.iter().any(|t| t.name == "get_forecast"));

        // Check owner info
        let tool = state.tools.iter().find(|t| t.name == "get_weather").unwrap();
        assert_eq!(tool.owner_kind, Some("app".to_string()));
        assert_eq!(tool.owner_id, Some("WeatherMcpApp".to_string()));
    }

    #[test]
    fn test_registry_tool_added_with_entries_format() {
        // Test the newer "entries" format with description and inputSchema
        let line = make_trace_event(
            "registry:tool:added",
            json!({
                "registryType": "tool",
                "changeKind": "added",
                "entries": [
                    {
                        "name": "get_weather",
                        "description": "Get current weather for a location",
                        "inputSchema": "{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}}}"
                    }
                ],
                "owner": {
                    "kind": "app",
                    "id": "WeatherMcpApp"
                },
                "snapshotCount": 1,
                "version": 1
            }),
        );

        let mut state = DashboardState::default();
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&line)));

        assert_eq!(state.tools.len(), 1);
        let tool = &state.tools[0];
        assert_eq!(tool.name, "get_weather");
        assert_eq!(tool.description, Some("Get current weather for a location".to_string()));
        assert!(tool.input_schema.is_some());
    }

    #[test]
    fn test_registry_tool_removed_event() {
        let mut state = DashboardState::default();

        // First add tools
        let added = make_trace_event(
            "registry:tool:added",
            json!({
                "entryNames": ["tool_a", "tool_b"],
                "owner": { "kind": "app", "id": "TestApp" },
                "snapshotCount": 2,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));
        assert_eq!(state.tools.len(), 2);

        // Then remove one
        let removed = make_trace_event(
            "registry:tool:removed",
            json!({
                "entryNames": ["tool_a"],
                "snapshotCount": 1,
                "version": 2
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&removed)));

        assert_eq!(state.tools.len(), 1);
        assert!(state.tools.iter().any(|t| t.name == "tool_b"));
        assert!(!state.tools.iter().any(|t| t.name == "tool_a"));
    }

    #[test]
    fn test_registry_tool_reset_event() {
        let mut state = DashboardState::default();

        // First add some tools
        let added = make_trace_event(
            "registry:tool:added",
            json!({
                "entryNames": ["old_tool"],
                "snapshotCount": 1,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));
        assert_eq!(state.tools.len(), 1);

        // Reset with new tools
        let reset = make_trace_event(
            "registry:tool:reset",
            json!({
                "entryNames": ["new_tool_1", "new_tool_2"],
                "owner": { "kind": "app", "id": "NewApp" },
                "snapshotCount": 2,
                "version": 2
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&reset)));

        // Old tools should be cleared, new tools added
        assert_eq!(state.tools.len(), 2);
        assert!(!state.tools.iter().any(|t| t.name == "old_tool"));
        assert!(state.tools.iter().any(|t| t.name == "new_tool_1"));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REGISTRY EVENTS - RESOURCES
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_registry_resource_added_event() {
        let line = make_trace_event(
            "registry:resource:added",
            json!({
                "registryType": "resource",
                "changeKind": "added",
                "entryNames": ["config://app/settings", "file://data/users.json"],
                "owner": {
                    "kind": "app",
                    "id": "ConfigApp"
                },
                "snapshotCount": 2,
                "version": 1
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "registry:resource:added");
    }

    #[test]
    fn test_registry_resource_added_updates_state() {
        let mut state = DashboardState::default();

        let added = make_trace_event(
            "registry:resource:added",
            json!({
                "entryNames": ["config://settings"],
                "owner": { "kind": "app", "id": "ConfigApp" },
                "snapshotCount": 1,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));

        assert_eq!(state.resources.len(), 1);
        assert_eq!(state.resources[0].name, "config://settings");
        assert_eq!(state.resources[0].owner_kind, Some("app".to_string()));
        assert_eq!(state.resources[0].owner_id, Some("ConfigApp".to_string()));
    }

    #[test]
    fn test_registry_resource_reset_clears_existing() {
        let mut state = DashboardState::default();

        // Add initial
        let added = make_trace_event(
            "registry:resource:added",
            json!({ "entryNames": ["old://resource"], "snapshotCount": 1, "version": 1 }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));

        // Reset
        let reset = make_trace_event(
            "registry:resource:reset",
            json!({ "entryNames": ["new://resource"], "snapshotCount": 1, "version": 2 }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&reset)));

        assert_eq!(state.resources.len(), 1);
        assert_eq!(state.resources[0].name, "new://resource");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REGISTRY EVENTS - PROMPTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_registry_prompt_added_event() {
        let line = make_trace_event(
            "registry:prompt:added",
            json!({
                "registryType": "prompt",
                "changeKind": "added",
                "entryNames": ["code_review", "summarize_doc"],
                "owner": {
                    "kind": "app",
                    "id": "AssistantApp"
                },
                "snapshotCount": 2,
                "version": 1
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "registry:prompt:added");
    }

    #[test]
    fn test_registry_prompt_added_updates_state() {
        let mut state = DashboardState::default();

        let added = make_trace_event(
            "registry:prompt:added",
            json!({
                "entryNames": ["code_review", "summarize"],
                "owner": { "kind": "app", "id": "AssistantApp" },
                "snapshotCount": 2,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));

        assert_eq!(state.prompts.len(), 2);
        assert!(state.prompts.iter().any(|p| p.name == "code_review"));
        assert!(state.prompts.iter().any(|p| p.name == "summarize"));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REGISTRY EVENTS - PLUGINS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_registry_plugin_added_event() {
        let line = make_trace_event(
            "registry:plugin:added",
            json!({
                "registryType": "plugin",
                "changeKind": "added",
                "entries": [
                    { "name": "CachePlugin", "version": "1.0.0" },
                    { "name": "AuthPlugin", "version": "2.1.0" }
                ],
                "owner": {
                    "kind": "app",
                    "id": "MainApp"
                },
                "snapshotCount": 2,
                "version": 1
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "registry:plugin:added");
    }

    #[test]
    fn test_registry_plugin_added_updates_state() {
        let mut state = DashboardState::default();

        let added = make_trace_event(
            "registry:plugin:added",
            json!({
                "entries": [
                    { "name": "CachePlugin", "version": "1.0.0" }
                ],
                "owner": { "kind": "app", "id": "MainApp" },
                "snapshotCount": 1,
                "version": 1
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&added)));

        assert_eq!(state.plugins.len(), 1);
        assert_eq!(state.plugins[0].name, "CachePlugin");
        assert_eq!(state.plugins[0].version, Some("1.0.0".to_string()));
        assert_eq!(state.plugins[0].owner_id, Some("MainApp".to_string()));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SERVER EVENTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_server_starting_event() {
        let line = make_trace_event("server:starting", json!({}));

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "server:starting");
    }

    #[test]
    fn test_server_starting_updates_state() {
        let mut state = DashboardState::default();
        state.server.is_ready = true; // Pre-set to verify it changes

        let starting = make_trace_event("server:starting", json!({}));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&starting)));

        assert!(!state.server.is_ready);
    }

    #[test]
    fn test_server_ready_event() {
        let line = make_trace_event(
            "server:ready",
            json!({
                "address": "http://localhost:3000",
                "serverInfo": {
                    "name": "Demo Server",
                    "version": "1.0.0"
                },
                "capabilities": {
                    "tools": { "listChanged": true },
                    "resources": { "listChanged": true }
                }
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "server:ready");

        let data = event.data.unwrap();
        assert_eq!(data["address"], "http://localhost:3000");
    }

    #[test]
    fn test_server_ready_updates_state() {
        let mut state = DashboardState::default();

        let ready = make_trace_event(
            "server:ready",
            json!({
                "address": "http://localhost:3000"
            }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&ready)));

        assert!(state.server.is_ready);
        assert_eq!(state.server.address, Some("http://localhost:3000".to_string()));
        assert_eq!(state.overview.server_address, Some("http://localhost:3000".to_string()));
        assert_eq!(state.overview.server_port, Some(3000));
    }

    #[test]
    fn test_server_shutdown_event() {
        let line = make_trace_event(
            "server:shutdown",
            json!({
                "uptimeMs": 3600000
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "server:shutdown");

        let data = event.data.unwrap();
        assert_eq!(data["uptimeMs"], 3600000);
    }

    #[test]
    fn test_server_shutdown_updates_state() {
        let mut state = DashboardState::default();
        state.server.is_ready = true;

        let shutdown = make_trace_event("server:shutdown", json!({ "uptimeMs": 3600000 }));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&shutdown)));

        assert!(!state.server.is_ready);
        assert_eq!(state.server.uptime_ms, Some(3600000));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CONFIG EVENTS
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_config_loaded_event() {
        let line = make_trace_event(
            "config:loaded",
            json!({
                "configPath": "/app/.env",
                "loadedKeys": ["DATABASE_URL", "API_KEY"]
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "config:loaded");
    }

    #[test]
    fn test_config_loaded_updates_state() {
        let mut state = DashboardState::default();

        let loaded = make_trace_event("config:loaded", json!({}));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&loaded)));

        assert!(state.config.is_loaded);
    }

    #[test]
    fn test_config_error_event() {
        let line = make_trace_event(
            "config:error",
            json!({
                "errors": [
                    { "path": "DATABASE_URL", "message": "Required variable not set" }
                ]
            }),
        );

        let event = parse_trace_event(&line);
        assert_eq!(event.event_type, "config:error");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // LOG EVENTS (category: "log")
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_log_event_info() {
        let event = json!({
            "id": "log-1",
            "timestamp": 1705276800000_u64,
            "category": "log",
            "type": "info",
            "prefix": "app",
            "scopeId": "test-scope",
            "sessionId": "test-session",
            "requestId": "test-request",
            "message": "Application started successfully",
            "level": 30,
            "levelName": "info"
        });
        let line = format!("{}{}", DEV_EVENT_MAGIC, event);

        match parse_unified_event_line(&line) {
            Some(UnifiedEvent::LogTransport(event)) => {
                assert_eq!(event.category, "log");
                assert_eq!(event.message, Some("Application started successfully".to_string()));
                assert_eq!(event.level_name, Some("info".to_string()));
            }
            other => panic!("Expected LogTransport, got: {:?}", other),
        }
    }

    #[test]
    fn test_log_event_error() {
        let event = json!({
            "id": "log-2",
            "timestamp": 1705276800000_u64,
            "category": "log",
            "type": "error",
            "prefix": "database",
            "scopeId": "test-scope",
            "sessionId": "unknown",
            "requestId": "unknown",
            "message": "Connection failed",
            "level": 50,
            "levelName": "error"
        });
        let line = format!("{}{}", DEV_EVENT_MAGIC, event);

        let mut state = DashboardState::default();
        if let Some(UnifiedEvent::LogTransport(event)) = parse_unified_event_line(&line) {
            state.handle_unified_event(UnifiedEvent::LogTransport(event));
        }

        // Should add to logs
        assert!(!state.logs.is_empty());
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // EDGE CASES AND INTEGRATION
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_unknown_trace_event_logged() {
        let mut state = DashboardState::default();

        let unknown = make_trace_event(
            "custom:unknown:event",
            json!({ "some": "data" }),
        );
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&unknown)));

        // Should be logged as debug
        assert!(!state.logs.is_empty());
    }

    #[test]
    fn test_event_counter_increments() {
        let mut state = DashboardState::default();
        assert_eq!(state.events_received, 0);

        let event1 = make_trace_event("session:connect", json!({}));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&event1)));
        assert_eq!(state.events_received, 1);

        let event2 = make_trace_event("server:ready", json!({}));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&event2)));
        assert_eq!(state.events_received, 2);
    }

    #[test]
    fn test_multiple_apps_from_owner_data() {
        let mut state = DashboardState::default();

        // Add tools from different apps
        let tools1 = make_trace_event(
            "registry:tool:added",
            json!({
                "entryNames": ["weather_tool"],
                "owner": { "kind": "app", "id": "WeatherApp" },
                "snapshotCount": 1,
                "version": 1
            }),
        );
        let tools2 = make_trace_event(
            "registry:tool:added",
            json!({
                "entryNames": ["crm_tool"],
                "owner": { "kind": "app", "id": "CrmApp" },
                "snapshotCount": 1,
                "version": 2
            }),
        );

        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&tools1)));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&tools2)));

        // Overview should count 2 registered apps
        assert_eq!(state.overview.registered_apps, 2);
    }

    #[test]
    fn test_no_duplicate_tools_on_multiple_adds() {
        let mut state = DashboardState::default();

        // Add same tool twice
        let add1 = make_trace_event(
            "registry:tool:added",
            json!({ "entryNames": ["my_tool"], "snapshotCount": 1, "version": 1 }),
        );
        let add2 = make_trace_event(
            "registry:tool:added",
            json!({ "entryNames": ["my_tool"], "snapshotCount": 1, "version": 2 }),
        );

        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&add1)));
        state.handle_unified_event(UnifiedEvent::LogTransport(parse_trace_event(&add2)));

        // Should only have 1 tool (no duplicates)
        assert_eq!(state.tools.len(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT DOCUMENTATION: Complete Event Type Reference
    // ─────────────────────────────────────────────────────────────────────────────

    /// This test documents all trace event types the TUI handles
    #[test]
    fn document_all_event_types() {
        let event_types = vec![
            // Session Events
            ("session:connect", "A client session connected"),
            ("session:disconnect", "A client session disconnected"),

            // Request Events
            ("request:start", "An MCP request started processing"),
            ("request:complete", "An MCP request completed successfully"),
            ("request:error", "An MCP request failed with error"),

            // Tool Events
            ("tool:execute", "A tool began execution"),
            ("tool:complete", "A tool finished execution"),

            // Registry Events - Tools
            ("registry:tool:added", "Tools were added to registry"),
            ("registry:tool:removed", "Tools were removed from registry"),
            ("registry:tool:updated", "Tools were updated in registry"),
            ("registry:tool:reset", "Tool registry was reset"),

            // Registry Events - Resources
            ("registry:resource:added", "Resources were added to registry"),
            ("registry:resource:removed", "Resources were removed from registry"),
            ("registry:resource:updated", "Resources were updated in registry"),
            ("registry:resource:reset", "Resource registry was reset"),

            // Registry Events - Prompts
            ("registry:prompt:added", "Prompts were added to registry"),
            ("registry:prompt:removed", "Prompts were removed from registry"),
            ("registry:prompt:updated", "Prompts were updated in registry"),
            ("registry:prompt:reset", "Prompt registry was reset"),

            // Registry Events - Plugins
            ("registry:plugin:added", "Plugins were added to registry"),
            ("registry:plugin:removed", "Plugins were removed from registry"),

            // Server Events
            ("server:starting", "Server is starting up"),
            ("server:ready", "Server is ready to accept connections"),
            ("server:shutdown", "Server is shutting down"),

            // Config Events
            ("config:loaded", "Configuration was loaded"),
            ("config:error", "Configuration had errors"),
        ];

        // Print documentation (visible in test output with --nocapture)
        println!("\n=== TUI Trace Event Types ===\n");
        for (event_type, description) in &event_types {
            println!("  {:<30} - {}", event_type, description);
        }
        println!("\nTotal event types: {}\n", event_types.len());

        // Test passes - this is documentation
        assert!(event_types.len() >= 20, "Should document at least 20 event types");
    }
}
