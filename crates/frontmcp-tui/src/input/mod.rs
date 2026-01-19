//! Input handling module
//!
//! Handles keyboard input with arrow/enter/esc navigation model.

use crossterm::event::{KeyCode, KeyEvent};

use crate::state::{DashboardState, FocusArea, Tab};
use crate::ui::tabs::graph::{get_node_at_index, GraphNode};

/// Handles keyboard input
pub struct InputHandler;

impl InputHandler {
    pub fn new() -> Self {
        Self
    }

    /// Handle a key event
    pub fn handle_key(&mut self, state: &mut DashboardState, key: KeyEvent) {
        // Help overlay takes priority - any key closes it
        if state.show_help {
            state.show_help = false;
            return;
        }

        match key.code {
            // Help toggle (works everywhere)
            KeyCode::Char('?') => {
                state.toggle_help();
                return;
            }

            // Quick tab switch with number keys (works everywhere)
            KeyCode::Char(c @ '1'..='7') => {
                let idx = (c as u8 - b'1') as usize;
                state.switch_tab_by_index(idx);
                state.focus = FocusArea::TabBar;
                return;
            }

            _ => {}
        }

        // Handle navigation based on current focus area
        match state.focus {
            FocusArea::TabBar => self.handle_tab_bar(state, key),
            FocusArea::Overview => self.handle_overview(state, key),
            FocusArea::List => self.handle_list(state, key),
            FocusArea::Detail => self.handle_detail(state, key),
            FocusArea::SubTab => self.handle_sub_tab(state, key),
            FocusArea::FilterInput => self.handle_filter_input(state, key),
        }
    }

    /// Handle input when focus is on tab bar
    fn handle_tab_bar(&mut self, state: &mut DashboardState, key: KeyEvent) {
        match key.code {
            // Navigate between tabs
            KeyCode::Left => state.prev_tab(),
            KeyCode::Right => state.next_tab(),

            // Enter tab content
            KeyCode::Enter | KeyCode::Char(' ') | KeyCode::Down => {
                state.enter_tab_content();
            }

            // Switch to overview panel with 'o'
            KeyCode::Char('o') => {
                state.focus = FocusArea::Overview;
            }

            _ => {}
        }
    }

    /// Handle input when focus is on overview panel
    fn handle_overview(&mut self, state: &mut DashboardState, key: KeyEvent) {
        match key.code {
            // Scroll overview
            KeyCode::Up => state.scroll_overview_up(),
            KeyCode::Down => state.scroll_overview_down(),

            // Page navigation
            KeyCode::PageUp => {
                for _ in 0..10 {
                    state.scroll_overview_up();
                }
            }
            KeyCode::PageDown => {
                for _ in 0..10 {
                    state.scroll_overview_down();
                }
            }
            KeyCode::Home => state.overview_scroll = 0,

            // Go back to tab bar
            KeyCode::Esc | KeyCode::Right => {
                state.focus = FocusArea::TabBar;
            }

            _ => {}
        }
    }

    /// Handle input when focus is on a list
    fn handle_list(&mut self, state: &mut DashboardState, key: KeyEvent) {
        // Special handling for Logs tab - use scroll instead of selection
        if state.active_tab == Tab::Logs {
            match key.code {
                KeyCode::Up => state.scroll_logs_up(1),
                KeyCode::Down => state.scroll_logs_down(1),
                KeyCode::PageUp => state.scroll_logs_up(10),
                KeyCode::PageDown => state.scroll_logs_down(10),
                KeyCode::Home => state.list_scroll = state.logs.len().saturating_sub(1), // Go to oldest (top)
                KeyCode::End => state.list_scroll = 0, // Go to live tail (newest/bottom)
                KeyCode::Esc => state.focus = FocusArea::TabBar,
                _ => {}
            }
            return;
        }

        // Special handling for Graph tab
        if state.active_tab == Tab::Graph {
            match key.code {
                KeyCode::Up => {
                    state.graph_selected = state.graph_selected.saturating_sub(1);
                }
                KeyCode::Down => {
                    let max = state.graph_tree_len().saturating_sub(1);
                    state.graph_selected = state.graph_selected.saturating_add(1).min(max);
                }
                KeyCode::Enter | KeyCode::Char(' ') => {
                    // Toggle expand/collapse for Scope, App, Plugin, and Adapter nodes
                    if let Some(node) = get_node_at_index(state, state.graph_selected) {
                        match node {
                            GraphNode::Scope { id, .. } => {
                                state.toggle_graph_expand(&format!("scope:{}", id));
                            }
                            GraphNode::App { id, .. } => {
                                state.toggle_graph_expand(&id);
                            }
                            GraphNode::Plugin { name, .. } => {
                                state.toggle_graph_expand(&format!("plugin:{}", name));
                            }
                            GraphNode::Adapter { name, .. } => {
                                state.toggle_graph_expand(&format!("adapter:{}", name));
                            }
                            _ => {
                                // For other nodes, go to detail view
                                state.focus = FocusArea::Detail;
                            }
                        }
                    }
                }
                KeyCode::Right => {
                    // Expand current node if it's expandable (Scope, App, Plugin, Adapter)
                    if let Some(node) = get_node_at_index(state, state.graph_selected) {
                        let expand_key = match node {
                            GraphNode::Scope { id, .. } => Some(format!("scope:{}", id)),
                            GraphNode::App { id, .. } => Some(id),
                            GraphNode::Plugin { name, .. } => Some(format!("plugin:{}", name)),
                            GraphNode::Adapter { name, .. } => Some(format!("adapter:{}", name)),
                            _ => None,
                        };
                        if let Some(key) = expand_key {
                            if !state.graph_expanded.contains(&key) {
                                state.graph_expanded.insert(key);
                            }
                        }
                    }
                }
                KeyCode::Left => {
                    // Collapse current node or parent node, and select the parent
                    if let Some(node) = get_node_at_index(state, state.graph_selected) {
                        let (collapse_key, is_child) = match &node {
                            // Expandable nodes - collapse themselves if expanded (stay selected)
                            GraphNode::Scope { id, .. } => {
                                let scope_key = format!("scope:{}", id);
                                if state.graph_expanded.contains(&scope_key) {
                                    (Some(scope_key), false)
                                } else {
                                    (None, false) // Already collapsed, do nothing
                                }
                            }
                            GraphNode::App { id, scope_id, .. } => {
                                // If app is expanded, collapse it first (stay selected)
                                // Otherwise, collapse parent scope and navigate to it
                                if state.graph_expanded.contains(id) {
                                    (Some(id.clone()), false)
                                } else if let Some(sid) = scope_id {
                                    (Some(format!("scope:{}", sid)), true)
                                } else {
                                    (None, false)
                                }
                            }
                            GraphNode::Plugin { name, owner_app, .. } => {
                                // If plugin is expanded, collapse it first (stay selected)
                                // Otherwise, collapse parent app and navigate to it
                                let plugin_key = format!("plugin:{}", name);
                                if state.graph_expanded.contains(&plugin_key) {
                                    (Some(plugin_key), false)
                                } else {
                                    (Some(owner_app.clone()), true)
                                }
                            }
                            GraphNode::Adapter { name, owner_app, .. } => {
                                // If adapter is expanded, collapse it first (stay selected)
                                // Otherwise, collapse parent app and navigate to it
                                let adapter_key = format!("adapter:{}", name);
                                if state.graph_expanded.contains(&adapter_key) {
                                    (Some(adapter_key), false)
                                } else {
                                    (Some(owner_app.clone()), true)
                                }
                            }
                            // Child nodes - collapse their parent and move selection
                            GraphNode::Tool { owner_kind, owner_id, .. } => {
                                let key = match (owner_kind.as_deref(), owner_id) {
                                    (Some("plugin"), Some(id)) => Some(format!("plugin:{}", id)),
                                    (Some("adapter"), Some(id)) => Some(format!("adapter:{}", id)),
                                    (Some("app") | Some("scope"), Some(id)) => Some(id.clone()),
                                    _ => None,
                                };
                                (key, true)
                            }
                            GraphNode::Resource { owner_kind, owner_id, .. } => {
                                let key = match (owner_kind.as_deref(), owner_id) {
                                    (Some("app") | Some("scope"), Some(id)) => Some(id.clone()),
                                    _ => None,
                                };
                                (key, true)
                            }
                            GraphNode::Prompt { owner_kind, owner_id, .. } => {
                                let key = match (owner_kind.as_deref(), owner_id) {
                                    (Some("app") | Some("scope"), Some(id)) => Some(id.clone()),
                                    _ => None,
                                };
                                (key, true)
                            }
                            _ => (None, false),
                        };
                        if let Some(ref key) = collapse_key {
                            // If we're on a child node, find and select the parent first
                            if is_child {
                                // Search backwards to find the parent node
                                for i in (0..state.graph_selected).rev() {
                                    if let Some(parent) = get_node_at_index(state, i) {
                                        let is_parent = match &parent {
                                            GraphNode::Scope { id, .. } => &format!("scope:{}", id) == key,
                                            GraphNode::App { id, .. } => id == key,
                                            GraphNode::Plugin { name, .. } => &format!("plugin:{}", name) == key,
                                            GraphNode::Adapter { name, .. } => &format!("adapter:{}", name) == key,
                                            _ => false,
                                        };
                                        if is_parent {
                                            state.graph_selected = i;
                                            break;
                                        }
                                    }
                                }
                            }
                            state.graph_expanded.remove(key);
                        }
                    }
                }
                KeyCode::Esc => state.focus = FocusArea::TabBar,
                KeyCode::PageUp => {
                    state.graph_selected = state.graph_selected.saturating_sub(10);
                }
                KeyCode::PageDown => {
                    let max = state.graph_tree_len().saturating_sub(1);
                    state.graph_selected = state.graph_selected.saturating_add(10).min(max);
                }
                KeyCode::Home => state.graph_selected = 0,
                KeyCode::End => {
                    state.graph_selected = state.graph_tree_len().saturating_sub(1);
                }
                _ => {}
            }
            return;
        }

        match key.code {
            // Navigate within list
            KeyCode::Up => state.move_up(),
            KeyCode::Down => state.move_down(),

            // Select item
            KeyCode::Enter | KeyCode::Char(' ') => state.select_item(),

            // Go back to tab bar
            KeyCode::Esc => {
                state.focus = FocusArea::TabBar;
            }

            // Page navigation
            KeyCode::PageUp => state.page_up(),
            KeyCode::PageDown => state.page_down(),
            KeyCode::Home => state.jump_top(),
            KeyCode::End => state.jump_bottom(),

            _ => {}
        }
    }

    /// Handle input when focus is on detail view
    fn handle_detail(&mut self, state: &mut DashboardState, key: KeyEvent) {
        match key.code {
            // Scroll detail view
            KeyCode::Up => state.scroll_detail_up(),
            KeyCode::Down => state.scroll_detail_down(),

            // Go back to list
            KeyCode::Esc | KeyCode::Backspace => state.back_from_detail(),

            // Page navigation for scrolling
            KeyCode::PageUp => {
                for _ in 0..10 {
                    state.scroll_detail_up();
                }
            }
            KeyCode::PageDown => {
                for _ in 0..10 {
                    state.scroll_detail_down();
                }
            }

            _ => {}
        }
    }

    /// Handle input when focus is on sub-tab (Activity tab)
    fn handle_sub_tab(&mut self, state: &mut DashboardState, key: KeyEvent) {
        match key.code {
            // Navigate between sub-tabs
            KeyCode::Left => state.prev_sub_tab(),
            KeyCode::Right => state.next_sub_tab(),

            // Enter list
            KeyCode::Enter | KeyCode::Char(' ') | KeyCode::Down => {
                state.focus = FocusArea::List;
            }

            // Go back to tab bar
            KeyCode::Esc => {
                state.focus = FocusArea::TabBar;
            }

            _ => {}
        }
    }

    /// Handle input when focus is on filter input (Logs tab)
    fn handle_filter_input(&mut self, state: &mut DashboardState, key: KeyEvent) {
        match key.code {
            // Move to list
            KeyCode::Enter | KeyCode::Down => {
                state.focus = FocusArea::List;
            }

            // Go back to tab bar
            KeyCode::Esc => {
                state.focus = FocusArea::TabBar;
            }

            // Clear filter
            KeyCode::Backspace => {
                state.log_filter.clear();
            }

            // TODO: Text input for filters would go here

            _ => {}
        }
    }
}

impl Default for InputHandler {
    fn default() -> Self {
        Self::new()
    }
}
