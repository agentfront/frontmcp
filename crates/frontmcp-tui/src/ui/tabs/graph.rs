//! Dependency injection graph tab component
//!
//! Shows hierarchical view: Server -> Apps -> Plugins -> Tools/Resources/Prompts

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap},
};

use crate::state::{DashboardState, FocusArea};

/// Node type in the graph tree
#[derive(Debug, Clone)]
pub enum GraphNode {
    Server,
    Scope { id: String, name: String },
    App { id: String, name: String, scope_id: Option<String> },
    Plugin { name: String, owner_app: String },
    Adapter { name: String, owner_app: String },
    Tool { name: String, owner_kind: Option<String>, owner_id: Option<String> },
    Resource { name: String, owner_kind: Option<String>, owner_id: Option<String> },
    Prompt { name: String, owner_kind: Option<String>, owner_id: Option<String> },
    DirectHeader,
}

/// Render the graph tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_tree(frame, chunks[0], state);
    render_detail(frame, chunks[1], state);
}

/// Infer apps from tool/resource/prompt owner data
/// Returns (app_id, app_name, scope_id)
fn infer_apps(state: &DashboardState) -> Vec<(String, String, Option<String>)> {
    use std::collections::HashSet;

    let mut app_ids: HashSet<String> = HashSet::new();

    // Collect unique app IDs from tools (both "app" and "scope" owner kinds)
    for tool in &state.tools {
        if matches!(tool.owner_kind.as_deref(), Some("app") | Some("scope")) {
            if let Some(ref id) = tool.owner_id {
                app_ids.insert(id.clone());
            }
        }
    }

    // Collect unique app IDs from resources
    for resource in &state.resources {
        if matches!(resource.owner_kind.as_deref(), Some("app") | Some("scope")) {
            if let Some(ref id) = resource.owner_id {
                app_ids.insert(id.clone());
            }
        }
    }

    // Collect unique app IDs from prompts
    for prompt in &state.prompts {
        if matches!(prompt.owner_kind.as_deref(), Some("app") | Some("scope")) {
            if let Some(ref id) = prompt.owner_id {
                app_ids.insert(id.clone());
            }
        }
    }

    // Collect unique app IDs from plugins
    for plugin in &state.plugins {
        if let Some(ref id) = plugin.owner_id {
            app_ids.insert(id.clone());
        }
    }

    // Collect unique app IDs from adapters
    for adapter in &state.adapters {
        if let Some(ref id) = adapter.owner_id {
            app_ids.insert(id.clone());
        }
    }

    // Convert to (id, name, scope_id) tuples
    // Use app_scope_map to find which scope contains each app
    let mut apps: Vec<_> = app_ids.into_iter().map(|id| {
        // Try to find a friendlier name from the explicit apps list
        let name = state.apps.iter()
            .find(|a| a.id == id)
            .map(|a| a.name.clone())
            .unwrap_or_else(|| id.clone());

        // Look up scope membership from the app_scope_map first
        let scope_id = state.app_scope_map.get(&id).cloned()
            .or_else(|| {
                // Fallback: if app_id matches a scope_id, the app IS the scope
                state.scopes.iter()
                    .find(|s| s.id == id)
                    .map(|s| s.id.clone())
            });

        (id, name, scope_id)
    }).collect();

    // Sort by name for consistent ordering
    apps.sort_by(|a, b| a.1.cmp(&b.1));
    apps
}

/// Build the list of graph nodes for rendering
fn build_graph_nodes(state: &DashboardState) -> Vec<(GraphNode, usize)> {
    let mut nodes: Vec<(GraphNode, usize)> = Vec::new();

    // Root: Server
    nodes.push((GraphNode::Server, 0));

    // Build tree from inferred apps
    let apps = infer_apps(state);

    // Decide whether to show scopes level based on whether we have multiple scopes
    let show_scopes = state.scopes.len() > 1;

    if show_scopes {
        // Multi-scope mode: Server → Scope → App → ...
        for scope in &state.scopes {
            let scope_expand_key = format!("scope:{}", scope.id);
            let scope_expanded = state.graph_expanded.contains(&scope_expand_key);
            nodes.push((
                GraphNode::Scope {
                    id: scope.id.clone(),
                    name: scope.name.clone(),
                },
                1,
            ));

            if scope_expanded {
                // Show apps that belong to this scope
                for (app_id, app_name, app_scope_id) in &apps {
                    if app_scope_id.as_ref() == Some(&scope.id) {
                        add_app_nodes(&mut nodes, state, app_id, app_name, Some(&scope.id), 2);
                    }
                }
            }
        }

        // Show apps that don't belong to any scope (orphans)
        let orphan_apps: Vec<_> = apps.iter()
            .filter(|(_, _, scope_id)| scope_id.is_none())
            .collect();
        if !orphan_apps.is_empty() {
            nodes.push((GraphNode::DirectHeader, 1));
            for (app_id, app_name, _) in orphan_apps {
                add_app_nodes(&mut nodes, state, app_id, app_name, None, 2);
            }
        }
    } else {
        // Single-scope or no scopes: Server → App → ...
        for (app_id, app_name, scope_id) in &apps {
            add_app_nodes(&mut nodes, state, app_id, app_name, scope_id.as_ref(), 1);
        }

        // Direct items (no app owner)
        let direct_tools: Vec<_> = state.tools.iter().filter(|t| t.owner_kind.is_none()).collect();
        let direct_resources: Vec<_> = state.resources.iter().filter(|r| r.owner_kind.is_none()).collect();
        let direct_prompts: Vec<_> = state.prompts.iter().filter(|p| p.owner_kind.is_none()).collect();

        if !direct_tools.is_empty() || !direct_resources.is_empty() || !direct_prompts.is_empty() {
            nodes.push((GraphNode::DirectHeader, 1));

            for tool in direct_tools {
                nodes.push((
                    GraphNode::Tool {
                        name: tool.name.clone(),
                        owner_kind: None,
                        owner_id: None,
                    },
                    2,
                ));
            }

            for resource in direct_resources {
                nodes.push((
                    GraphNode::Resource {
                        name: resource.name.clone(),
                        owner_kind: None,
                        owner_id: None,
                    },
                    2,
                ));
            }

            for prompt in direct_prompts {
                nodes.push((
                    GraphNode::Prompt {
                        name: prompt.name.clone(),
                        owner_kind: None,
                        owner_id: None,
                    },
                    2,
                ));
            }
        }
    }

    nodes
}

/// Add app nodes and its children (adapters, plugins, tools, resources, prompts)
fn add_app_nodes(
    nodes: &mut Vec<(GraphNode, usize)>,
    state: &DashboardState,
    app_id: &str,
    app_name: &str,
    scope_id: Option<&String>,
    base_depth: usize,
) {
    let app_expanded = state.graph_expanded.contains(app_id);
    nodes.push((
        GraphNode::App {
            id: app_id.to_string(),
            name: app_name.to_string(),
            scope_id: scope_id.cloned(),
        },
        base_depth,
    ));

    if app_expanded {
        // Adapters owned by this app (expandable)
        for adapter in state.adapters.iter().filter(|a| a.owner_id.as_deref() == Some(app_id)) {
            let adapter_expand_key = format!("adapter:{}", adapter.name);
            let adapter_expanded = state.graph_expanded.contains(&adapter_expand_key);
            nodes.push((
                GraphNode::Adapter {
                    name: adapter.name.clone(),
                    owner_app: app_id.to_string(),
                },
                base_depth + 1,
            ));

            // If adapter is expanded, show its tools
            if adapter_expanded {
                for tool in state.tools.iter().filter(|t|
                    t.owner_kind.as_deref() == Some("adapter") &&
                    t.owner_id.as_deref() == Some(&adapter.name)
                ) {
                    nodes.push((
                        GraphNode::Tool {
                            name: tool.name.clone(),
                            owner_kind: Some("adapter".to_string()),
                            owner_id: Some(adapter.name.clone()),
                        },
                        base_depth + 2,
                    ));
                }
            }
        }

        // Plugins owned by this app (expandable)
        for plugin in state.plugins.iter().filter(|p| p.owner_id.as_deref() == Some(app_id)) {
            let plugin_expand_key = format!("plugin:{}", plugin.name);
            let plugin_expanded = state.graph_expanded.contains(&plugin_expand_key);
            nodes.push((
                GraphNode::Plugin {
                    name: plugin.name.clone(),
                    owner_app: app_id.to_string(),
                },
                base_depth + 1,
            ));

            // If plugin is expanded, show its tools
            if plugin_expanded {
                for tool in state.tools.iter().filter(|t|
                    t.owner_kind.as_deref() == Some("plugin") &&
                    t.owner_id.as_deref() == Some(&plugin.name)
                ) {
                    nodes.push((
                        GraphNode::Tool {
                            name: tool.name.clone(),
                            owner_kind: Some("plugin".to_string()),
                            owner_id: Some(plugin.name.clone()),
                        },
                        base_depth + 2,
                    ));
                }
            }
        }

        // Tools owned directly by this app/scope (not by adapter/plugin)
        for tool in state.tools.iter().filter(|t|
            matches!(t.owner_kind.as_deref(), Some("app") | Some("scope")) &&
            t.owner_id.as_deref() == Some(app_id)
        ) {
            nodes.push((
                GraphNode::Tool {
                    name: tool.name.clone(),
                    owner_kind: tool.owner_kind.clone(),
                    owner_id: tool.owner_id.clone(),
                },
                base_depth + 1,
            ));
        }

        // Resources owned by this app/scope
        for resource in state.resources.iter().filter(|r|
            matches!(r.owner_kind.as_deref(), Some("app") | Some("scope")) &&
            r.owner_id.as_deref() == Some(app_id)
        ) {
            nodes.push((
                GraphNode::Resource {
                    name: resource.name.clone(),
                    owner_kind: resource.owner_kind.clone(),
                    owner_id: resource.owner_id.clone(),
                },
                base_depth + 1,
            ));
        }

        // Prompts owned by this app/scope
        for prompt in state.prompts.iter().filter(|p|
            matches!(p.owner_kind.as_deref(), Some("app") | Some("scope")) &&
            p.owner_id.as_deref() == Some(app_id)
        ) {
            nodes.push((
                GraphNode::Prompt {
                    name: prompt.name.clone(),
                    owner_kind: prompt.owner_kind.clone(),
                    owner_id: prompt.owner_id.clone(),
                },
                base_depth + 1,
            ));
        }
    }
}

/// Render the tree view
fn render_tree(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let nodes = build_graph_nodes(state);
    let items: Vec<ListItem> = nodes
        .iter()
        .map(|(node, depth)| {
            let indent = "  ".repeat(*depth);
            match node {
                GraphNode::Server => {
                    let server_name = state.server.name.clone().unwrap_or_else(|| "Server".to_string());
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}* ", indent), Style::default().fg(Color::Cyan)),
                        Span::styled(server_name, Style::default().fg(Color::White).bold()),
                    ]))
                }
                GraphNode::Scope { id, name } => {
                    let expand_key = format!("scope:{}", id);
                    let expanded = state.graph_expanded.contains(&expand_key);
                    let prefix = if expanded { "v " } else { "> " };
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}{}", indent, prefix), Style::default().fg(Color::LightCyan)),
                        Span::styled("[S] ", Style::default().fg(Color::LightCyan)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::App { id, name, .. } => {
                    let expanded = state.graph_expanded.contains(id);
                    let prefix = if expanded { "v " } else { "> " };
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}{}", indent, prefix), Style::default().fg(Color::Yellow)),
                        Span::styled(name, Style::default().fg(Color::Yellow)),
                    ]))
                }
                GraphNode::Plugin { name, .. } => {
                    let expand_key = format!("plugin:{}", name);
                    let expanded = state.graph_expanded.contains(&expand_key);
                    let prefix = if expanded { "v " } else { "> " };
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}{}", indent, prefix), Style::default().fg(Color::Magenta)),
                        Span::styled("[P] ", Style::default().fg(Color::Magenta)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::Adapter { name, .. } => {
                    let expand_key = format!("adapter:{}", name);
                    let expanded = state.graph_expanded.contains(&expand_key);
                    let prefix = if expanded { "v " } else { "> " };
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}{}", indent, prefix), Style::default().fg(Color::LightRed)),
                        Span::styled("[A] ", Style::default().fg(Color::LightRed)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::Tool { name, .. } => {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}", indent), Style::default().fg(Color::DarkGray)),
                        Span::styled("[T] ", Style::default().fg(Color::Green)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::Resource { name, .. } => {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}", indent), Style::default().fg(Color::DarkGray)),
                        Span::styled("[R] ", Style::default().fg(Color::Blue)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::Prompt { name, .. } => {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}", indent), Style::default().fg(Color::DarkGray)),
                        Span::styled("[PR] ", Style::default().fg(Color::Cyan)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]))
                }
                GraphNode::DirectHeader => {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{}", indent), Style::default().fg(Color::DarkGray)),
                        Span::styled("-- Direct --", Style::default().fg(Color::DarkGray)),
                    ]))
                }
            }
        })
        .collect();

    let border_style = if state.focus == FocusArea::List {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let list = List::new(items)
        .block(
            Block::default()
                .title(" DI Graph ")
                .borders(Borders::ALL)
                .border_style(border_style),
        )
        .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White))
        .highlight_symbol("> ");

    // Create list state for scrolling
    let mut list_state = ListState::default();
    list_state.select(Some(state.graph_selected));

    frame.render_stateful_widget(list, area, &mut list_state);

    // Render scrollbar if content exceeds visible area
    let visible_height = area.height.saturating_sub(2) as usize;
    let list_len = nodes.len();
    if list_len > visible_height {
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("^"))
            .end_symbol(Some("v"));
        let mut scrollbar_state = ScrollbarState::new(list_len).position(state.graph_selected);
        frame.render_stateful_widget(
            scrollbar,
            area.inner(Margin { vertical: 1, horizontal: 0 }),
            &mut scrollbar_state,
        );
    }
}

/// Render the detail panel
fn render_detail(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let nodes = build_graph_nodes(state);
    let selected_node = nodes.get(state.graph_selected);

    let border_style = if state.focus == FocusArea::Detail {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let content = match selected_node {
        Some((GraphNode::Server, _)) => {
            let server_name = state.server.name.clone().unwrap_or_else(|| "FrontMCP Server".to_string());
            let version = state.server.version.clone().unwrap_or_else(|| "unknown".to_string());
            let address = state.server.address.clone().unwrap_or_else(|| "not started".to_string());
            let status = if state.server.is_ready { "Ready" } else { "Starting..." };

            format!(
                "Server: {}\n\nVersion: {}\nAddress: {}\nStatus: {}\n\nScopes: {}\nApps: {}\nTools: {}\nResources: {}\nPrompts: {}\nPlugins: {}",
                server_name,
                version,
                address,
                status,
                state.scopes.len(),
                state.apps.len(),
                state.tools.len(),
                state.resources.len(),
                state.prompts.len(),
                state.plugins.len(),
            )
        }
        Some((GraphNode::Scope { id, name }, _)) => {
            // Count apps in this scope
            let apps = infer_apps(state);
            let app_count = apps.iter()
                .filter(|(_, _, scope_id)| scope_id.as_ref() == Some(id))
                .count();

            // Count tools/resources/prompts in this scope (via apps)
            let scope_tools: usize = apps.iter()
                .filter(|(_, _, scope_id)| scope_id.as_ref() == Some(id))
                .map(|(app_id, _, _)| state.tools.iter()
                    .filter(|t| matches!(t.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                            t.owner_id.as_deref() == Some(app_id.as_str()))
                    .count())
                .sum();

            let expand_key = format!("scope:{}", id);
            let expanded = state.graph_expanded.contains(&expand_key);
            let expand_hint = if expanded { "Press Enter to collapse" } else { "Press Enter to expand" };

            format!(
                "Scope: {}\n\nID: {}\nApps: {}\nTotal Tools: {}\n\n{}\n\nScopes are containers that group related apps together.",
                name, id, app_count, scope_tools, expand_hint
            )
        }
        Some((GraphNode::App { id, name, scope_id }, _)) => {
            let tool_count = state.tools.iter().filter(|t|
                matches!(t.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                t.owner_id.as_deref() == Some(id)
            ).count();
            let resource_count = state.resources.iter().filter(|r|
                matches!(r.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                r.owner_id.as_deref() == Some(id)
            ).count();
            let prompt_count = state.prompts.iter().filter(|p|
                matches!(p.owner_kind.as_deref(), Some("app") | Some("scope")) &&
                p.owner_id.as_deref() == Some(id)
            ).count();
            let plugin_count = state.plugins.iter().filter(|p|
                p.owner_id.as_deref() == Some(id)
            ).count();
            let adapter_count = state.adapters.iter().filter(|a|
                a.owner_id.as_deref() == Some(id)
            ).count();

            let expanded = state.graph_expanded.contains(id);
            let expand_hint = if expanded { "Press Enter to collapse" } else { "Press Enter to expand" };

            let scope_info = scope_id.as_ref()
                .map(|s| format!("\nScope: {}", s))
                .unwrap_or_default();

            format!(
                "App: {}\n\nID: {}{}\nTools: {}\nResources: {}\nPrompts: {}\nPlugins: {}\nAdapters: {}\n\n{}",
                name, id, scope_info, tool_count, resource_count, prompt_count, plugin_count, adapter_count, expand_hint
            )
        }
        Some((GraphNode::Plugin { name, owner_app }, _)) => {
            let plugin = state.plugins.iter().find(|p| &p.name == name);
            let version = plugin.and_then(|p| p.version.clone()).unwrap_or_else(|| "unknown".to_string());

            // Count tools owned by this plugin
            let tool_count = state.tools.iter().filter(|t|
                t.owner_kind.as_deref() == Some("plugin") &&
                t.owner_id.as_deref() == Some(name)
            ).count();

            let expand_key = format!("plugin:{}", name);
            let expanded = state.graph_expanded.contains(&expand_key);
            let expand_hint = if expanded { "Press Enter to collapse" } else { "Press Enter to expand" };

            format!(
                "Plugin: {}\n\nVersion: {}\nOwner App: {}\nTools: {}\n\n{}\n\nThis plugin provides additional capabilities to its owner app.",
                name, version, owner_app, tool_count, expand_hint
            )
        }
        Some((GraphNode::Adapter { name, owner_app }, _)) => {
            let adapter = state.adapters.iter().find(|a| &a.name == name);
            let description = adapter
                .and_then(|a| a.description.clone())
                .unwrap_or_else(|| "No description".to_string());

            // Count tools owned by this adapter
            let tool_count = state.tools.iter().filter(|t|
                t.owner_kind.as_deref() == Some("adapter") &&
                t.owner_id.as_deref() == Some(name)
            ).count();

            let expand_key = format!("adapter:{}", name);
            let expanded = state.graph_expanded.contains(&expand_key);
            let expand_hint = if expanded { "Press Enter to collapse" } else { "Press Enter to expand" };

            format!(
                "Adapter: {}\n\nDescription: {}\nOwner App: {}\nTools: {}\n\n{}\n\nAdapters provide additional tools from external APIs or services.",
                name, description, owner_app, tool_count, expand_hint
            )
        }
        Some((GraphNode::Tool { name, owner_kind, owner_id }, _)) => {
            let tool = state.tools.iter().find(|t| &t.name == name);
            let description = tool
                .and_then(|t| t.description.clone())
                .unwrap_or_else(|| "No description".to_string());
            let owner_str = match (owner_kind, owner_id) {
                (Some(kind), Some(id)) => format!("{}: {}", kind, id),
                _ => "direct (no owner)".to_string(),
            };

            let mut content = format!(
                "Tool: {}\n\nOwner: {}\n\nDescription:\n{}\n",
                name, owner_str, description
            );

            if let Some(t) = tool {
                if let Some(schema) = &t.input_schema {
                    content.push_str("\nInput Schema:\n");
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(schema) {
                        if let Ok(pretty) = serde_json::to_string_pretty(&json) {
                            content.push_str(&pretty);
                        } else {
                            content.push_str(schema);
                        }
                    } else {
                        content.push_str(schema);
                    }
                }
            }

            content
        }
        Some((GraphNode::Resource { name, owner_kind, owner_id }, _)) => {
            let resource = state.resources.iter().find(|r| &r.name == name);
            let uri = resource.and_then(|r| r.uri.clone()).unwrap_or_else(|| "N/A".to_string());
            let owner_str = match (owner_kind, owner_id) {
                (Some(kind), Some(id)) => format!("{}: {}", kind, id),
                _ => "direct (no owner)".to_string(),
            };

            format!(
                "Resource: {}\n\nOwner: {}\nURI: {}\n\nThis resource is available for MCP clients to read.",
                name, owner_str, uri
            )
        }
        Some((GraphNode::Prompt { name, owner_kind, owner_id }, _)) => {
            let owner_str = match (owner_kind, owner_id) {
                (Some(kind), Some(id)) => format!("{}: {}", kind, id),
                _ => "direct (no owner)".to_string(),
            };

            format!(
                "Prompt: {}\n\nOwner: {}\n\nThis prompt is available for MCP clients to use.",
                name, owner_str
            )
        }
        Some((GraphNode::DirectHeader, _)) => {
            let direct_tools = state.tools.iter().filter(|t| t.owner_kind.is_none()).count();
            let direct_resources = state.resources.iter().filter(|r| r.owner_kind.is_none()).count();
            let direct_prompts = state.prompts.iter().filter(|p| p.owner_kind.is_none()).count();

            format!(
                "Direct Capabilities\n\nThese items are registered directly at the server level,\nnot owned by any specific app.\n\nTools: {}\nResources: {}\nPrompts: {}",
                direct_tools, direct_resources, direct_prompts
            )
        }
        None => "Select an item to view details.".to_string(),
    };

    let detail = Paragraph::new(content)
        .block(
            Block::default()
                .title(" Details ")
                .borders(Borders::ALL)
                .border_style(border_style),
        )
        .wrap(Wrap { trim: false })
        .scroll((state.detail_scroll as u16, 0));

    frame.render_widget(detail, area);
}

/// Get the node at the given index (for input handling)
pub fn get_node_at_index(state: &DashboardState, index: usize) -> Option<GraphNode> {
    let nodes = build_graph_nodes(state);
    nodes.get(index).map(|(node, _)| node.clone())
}
