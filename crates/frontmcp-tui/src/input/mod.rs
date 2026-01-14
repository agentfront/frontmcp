//! Input handling module
//!
//! Handles keyboard input with arrow/enter/esc navigation model.

use crossterm::event::{KeyCode, KeyEvent};

use crate::state::{DashboardState, FocusArea, Tab};

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
            KeyCode::Char(c @ '1'..='6') => {
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
                KeyCode::Home => state.list_scroll = 0,
                KeyCode::End => state.list_scroll = state.logs.len().saturating_sub(1),
                KeyCode::Esc => state.focus = FocusArea::TabBar,
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
