//! Event handling module
//!
//! Handles reading and parsing DevEvents from stdin.
//! Events are sent by the MCP server process via IPC/stderr.

mod reader;
mod types;

#[allow(unused_imports)]
pub use reader::EventReader;
pub use types::*;
