//! Event handling module
//!
//! Handles reading and parsing DevEvents from stdin or Unix socket.
//! Events are sent by the MCP server process via IPC/stderr or ManagerService socket.

mod reader;
pub mod socket_client;
mod types;

#[cfg(test)]
mod trace_events_test;

#[allow(unused_imports)]
pub use reader::EventReader;
pub use socket_client::{
    spawn_socket_client, ConnectionError, ManagerCommand, ResponseMessage, SocketClientHandle, StateSnapshot,
};
pub use types::*;
