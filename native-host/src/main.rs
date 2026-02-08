use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;

// ============ PROTOCOL ============

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Request {
    /// Write content to an absolute path
    Save { path: String, content: String },
    /// Connection test
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Response {
    SaveResult {
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        full_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Pong {
        success: bool,
    },
    Error {
        success: bool,
        error: String,
    },
}

// ============ MESSAGE I/O ============

fn read_message() -> io::Result<Request> {
    let mut len_bytes = [0u8; 4];
    io::stdin().read_exact(&mut len_bytes)?;
    let len = u32::from_ne_bytes(len_bytes) as usize;

    let mut buffer = vec![0u8; len];
    io::stdin().read_exact(&mut buffer)?;

    serde_json::from_slice(&buffer)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn write_message(response: &Response) -> io::Result<()> {
    let json = serde_json::to_vec(response)?;
    let len = json.len() as u32;

    let stdout = io::stdout();
    let mut handle = stdout.lock();

    handle.write_all(&len.to_ne_bytes())?;
    handle.write_all(&json)?;
    handle.flush()?;

    Ok(())
}

// ============ HANDLERS ============

fn handle_save(abs_path: &str, content: &str) -> Response {
    let path = PathBuf::from(abs_path);

    // Basic validation: path must be absolute
    if !path.is_absolute() {
        return Response::SaveResult {
            success: false,
            full_path: None,
            error: Some("Path must be absolute".to_string()),
        };
    }

    // Create parent directories if needed
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Response::SaveResult {
                    success: false,
                    full_path: None,
                    error: Some(format!("Failed to create directories: {}", e)),
                };
            }
        }
    }

    // Write file
    match fs::write(&path, content) {
        Ok(_) => Response::SaveResult {
            success: true,
            full_path: Some(path.to_string_lossy().to_string()),
            error: None,
        },
        Err(e) => Response::SaveResult {
            success: false,
            full_path: None,
            error: Some(format!("Failed to write file: {}", e)),
        },
    }
}

fn handle_ping() -> Response {
    Response::Pong { success: true }
}

// ============ MAIN ============

fn main() {
    loop {
        let request = match read_message() {
            Ok(r) => r,
            Err(_) => break, // EOF or error, exit cleanly
        };

        let response = match request {
            Request::Save { path, content } => handle_save(&path, &content),
            Request::Ping => handle_ping(),
        };

        if write_message(&response).is_err() {
            break;
        }
    }
}
