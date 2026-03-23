use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::State;
use redis::{aio::MultiplexedConnection, Client, Value as RedisValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct ConnectionEntry {
    conn: Arc<Mutex<MultiplexedConnection>>,
    /// Stored for future use when `duplicate()` needs a truly independent connection
    /// (e.g. monitor mode, pub/sub). Currently JS duplicate() reuses the same conn ID.
    #[allow(dead_code)]
    url: String,
}

pub struct RedisState(Mutex<HashMap<String, ConnectionEntry>>);

impl RedisState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn redis_value_to_json(val: RedisValue, binary: bool) -> JsonValue {
    match val {
        RedisValue::Nil => JsonValue::Null,
        RedisValue::Int(n) => json!(n),
        RedisValue::BulkString(bytes) => {
            if binary {
                JsonValue::Array(bytes.into_iter().map(|b| json!(b)).collect())
            } else {
                match String::from_utf8(bytes) {
                    Ok(s) => json!(s),
                    // Invalid UTF-8: return as byte array so JS can Buffer.from() it
                    Err(e) => JsonValue::Array(
                        e.into_bytes().into_iter().map(|b| json!(b)).collect(),
                    ),
                }
            }
        }
        RedisValue::Array(arr) => {
            JsonValue::Array(arr.into_iter().map(|v| redis_value_to_json(v, binary)).collect())
        }
        RedisValue::SimpleString(s) => json!(s),
        RedisValue::Okay => json!("OK"),
        _ => JsonValue::Null,
    }
}

/// Convert a serde_json Value to Redis bytes. Arrays of numbers are treated as
/// raw byte arrays (for binary args coming back from JS Buffer.toJSON()).
fn json_to_bytes(val: &JsonValue) -> Vec<u8> {
    match val {
        JsonValue::String(s) => s.as_bytes().to_vec(),
        JsonValue::Number(n) => n.to_string().into_bytes(),
        JsonValue::Bool(b) => b.to_string().into_bytes(),
        JsonValue::Array(arr) => arr
            .iter()
            .filter_map(|b| b.as_u64())
            .map(|b| b as u8)
            .collect(),
        _ => vec![],
    }
}

fn parse_server_info(info: &str) -> serde_json::Map<String, JsonValue> {
    let mut map = serde_json::Map::new();
    for line in info.lines() {
        if let Some((key, value)) = line.split_once(':') {
            map.insert(key.trim().to_string(), json!(value.trim()));
        }
    }
    map
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectConfig {
    host: Option<String>,
    port: Option<u16>,
    password: Option<String>,
    db: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    connection_id: String,
    server_info: serde_json::Map<String, JsonValue>,
}

#[tauri::command]
async fn redis_connect(
    state: State<'_, RedisState>,
    config: ConnectConfig,
) -> Result<ConnectResult, String> {
    let host = config.host.as_deref().unwrap_or("localhost");
    let port = config.port.unwrap_or(6379);
    let db = config.db.unwrap_or(0);

    let url = match config.password.as_deref() {
        Some(pw) if !pw.is_empty() => format!("redis://:{}@{}:{}/{}", pw, host, port, db),
        _ => format!("redis://{}:{}/{}", host, port, db),
    };

    let client = Client::open(url.as_str()).map_err(|e| e.to_string())?;
    let conn = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| e.to_string())?;

    let conn_arc = Arc::new(Mutex::new(conn));

    // Fetch server info immediately so the JS side can read redis_version etc.
    let server_info = {
        let mut c = conn_arc.lock().await;
        redis::cmd("INFO")
            .query_async::<String>(&mut *c)
            .await
            .map(|s| parse_server_info(&s))
            .unwrap_or_default()
    };

    let connection_id = Uuid::new_v4().to_string();
    {
        let mut connections = state.0.lock().await;
        connections.insert(
            connection_id.clone(),
            ConnectionEntry {
                conn: conn_arc,
                url,
            },
        );
    }

    Ok(ConnectResult {
        connection_id,
        server_info,
    })
}

#[tauri::command]
async fn redis_disconnect(
    state: State<'_, RedisState>,
    connection_id: String,
) -> Result<(), String> {
    let mut connections = state.0.lock().await;
    connections.remove(&connection_id);
    Ok(())
}

#[tauri::command]
async fn redis_execute(
    state: State<'_, RedisState>,
    connection_id: String,
    command: String,
    args: Vec<JsonValue>,
    binary: Option<bool>,
) -> Result<JsonValue, String> {
    let binary = binary.unwrap_or(false);

    let conn_arc = {
        let connections = state.0.lock().await;
        connections
            .get(&connection_id)
            .map(|e| Arc::clone(&e.conn))
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?
    };

    let mut conn = conn_arc.lock().await;

    let mut cmd = redis::cmd(&command);
    for arg in &args {
        cmd.arg(json_to_bytes(arg));
    }

    let result: RedisValue = cmd
        .query_async(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(redis_value_to_json(result, binary))
}

#[derive(Deserialize)]
struct PipelineCommand {
    command: String,
    args: Vec<JsonValue>,
}

#[tauri::command]
async fn redis_pipeline(
    state: State<'_, RedisState>,
    connection_id: String,
    commands: Vec<PipelineCommand>,
    atomic: Option<bool>,
) -> Result<Vec<JsonValue>, String> {
    let conn_arc = {
        let connections = state.0.lock().await;
        connections
            .get(&connection_id)
            .map(|e| Arc::clone(&e.conn))
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?
    };

    let mut conn = conn_arc.lock().await;

    let mut pipe = redis::pipe();
    if atomic.unwrap_or(false) {
        pipe.atomic();
    }

    for entry in &commands {
        pipe.cmd(&entry.command);
        for arg in &entry.args {
            pipe.arg(json_to_bytes(arg));
        }
    }

    let results: Vec<RedisValue> = pipe
        .query_async(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(results
        .into_iter()
        .map(|v| redis_value_to_json(v, false))
        .collect())
}

/// Execute a Lua script via EVAL.
#[tauri::command]
async fn redis_eval(
    state: State<'_, RedisState>,
    connection_id: String,
    script: String,
    keys: Vec<String>,
    args: Vec<String>,
) -> Result<JsonValue, String> {
    let conn_arc = {
        let connections = state.0.lock().await;
        connections
            .get(&connection_id)
            .map(|e| Arc::clone(&e.conn))
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?
    };

    let mut conn = conn_arc.lock().await;

    let mut cmd = redis::cmd("EVAL");
    cmd.arg(&script).arg(keys.len() as i64);
    for key in &keys {
        cmd.arg(key);
    }
    for arg in &args {
        cmd.arg(arg);
    }

    let result: RedisValue = cmd
        .query_async(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(redis_value_to_json(result, false))
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RedisState::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            redis_connect,
            redis_disconnect,
            redis_execute,
            redis_pipeline,
            redis_eval,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
