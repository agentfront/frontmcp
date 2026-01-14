//! Event reader for stdin
//!
//! Reads lines from stdin and parses DevEvents.

use std::io::BufRead;

use tokio::sync::mpsc;

use super::types::{parse_event_line, DevEvent};

/// Reads events from stdin
#[derive(Clone)]
pub struct EventReader {
    _marker: std::marker::PhantomData<()>,
}

impl EventReader {
    pub fn new() -> Self {
        Self {
            _marker: std::marker::PhantomData,
        }
    }

    /// Read events from stdin and send to channel
    pub async fn read_events(&self, tx: mpsc::Sender<DevEvent>) -> anyhow::Result<()> {
        // Spawn blocking task for stdin reading
        let handle = tokio::task::spawn_blocking(move || {
            let stdin = std::io::stdin();
            let reader = stdin.lock();

            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if let Some(event) = parse_event_line(&line) {
                            // Try to send, ignore if receiver dropped
                            if tx.blocking_send(event).is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        handle.await?;
        Ok(())
    }
}

impl Default for EventReader {
    fn default() -> Self {
        Self::new()
    }
}
