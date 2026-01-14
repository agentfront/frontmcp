//! State management for the dashboard
//!
//! Manages all dashboard state including sessions, requests, logs, and registry entries.

mod store;

pub use store::{ActivitySubTab, DashboardState, FocusArea, LogLevel, QuitMode, Tab};
