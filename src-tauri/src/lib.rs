use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tokio::sync::Mutex;
use tauri::{Manager, State};
use redis::{aio::MultiplexedConnection, Client, ConnectionAddr, ConnectionInfo,
            RedisConnectionInfo, Value as RedisValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct ConnectionEntry {
    conn: Arc<Mutex<MultiplexedConnection>>,
    /// Keeps the SSH tunnel alive for the lifetime of this connection.
    #[allow(dead_code)]
    ssh_tunnel: Option<SshTunnel>,
}

pub struct RedisState(Mutex<HashMap<String, ConnectionEntry>>);

impl RedisState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------------------------------------------------
// SSH tunnel
// ---------------------------------------------------------------------------

struct SshTunnel {
    /// Dropping this sender signals the forwarding thread to stop.
    _stop_tx: std::sync::mpsc::SyncSender<()>,
}

fn create_ssh_tunnel(
    ssh_host: &str,
    ssh_port: u16,
    ssh_user: &str,
    ssh_password: Option<&str>,
    ssh_key: Option<&str>,
    ssh_key_passphrase: Option<&str>,
    redis_host: &str,
    redis_port: u16,
) -> Result<(u16, SshTunnel), String> {
    // ── Establish + authenticate SSH session ────────────────────────────────
    let tcp = TcpStream::connect(format!("{}:{}", ssh_host, ssh_port))
        .map_err(|e| format!("SSH TCP connect: {}", e))?;

    let mut sess = ssh2::Session::new()
        .map_err(|e| format!("SSH session: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake: {}", e))?;

    if let Some(key_pem) = ssh_key {
        // Detect key format from PEM header for diagnostic purposes
        let key_format = if key_pem.contains("BEGIN OPENSSH PRIVATE KEY") {
            "OpenSSH format — libssh2 frommemory has limited support; convert with: ssh-keygen -p -m PEM -f <keyfile>"
        } else if key_pem.contains("BEGIN RSA PRIVATE KEY") {
            "RSA PKCS#1"
        } else if key_pem.contains("BEGIN EC PRIVATE KEY") {
            "ECDSA"
        } else if key_pem.contains("BEGIN DSA PRIVATE KEY") {
            "DSA"
        } else {
            "unknown"
        };

        // Ask the server what auth methods it accepts before attempting
        let server_methods = sess.auth_methods(ssh_user)
            .unwrap_or("(could not query)");

        sess.userauth_pubkey_memory(ssh_user, None, key_pem, ssh_key_passphrase)
            .map_err(|e| format!(
                "SSH key auth failed — user: '{}', key format: {}, server accepts: {} — {}",
                ssh_user, key_format, server_methods, e
            ))?;
    } else if let Some(password) = ssh_password {
        sess.userauth_password(ssh_user, password)
            .map_err(|e| format!("SSH password auth: {}", e))?;
    } else {
        // Try SSH agent as a fallback
        if let Ok(mut agent) = sess.agent() {
            if agent.connect().is_ok() {
                let _ = agent.list_identities();
                if let Ok(ids) = agent.identities() {
                    for id in ids {
                        if agent.userauth(ssh_user, &id).is_ok() && sess.authenticated() {
                            break;
                        }
                    }
                }
            }
        }
    }

    if !sess.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    // ── Bind a local ephemeral port ─────────────────────────────────────────
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Local bind: {}", e))?;
    let local_port = listener.local_addr().unwrap().port();

    let (stop_tx, stop_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let redis_host = redis_host.to_string();

    // ── Forwarding thread ───────────────────────────────────────────────────
    thread::spawn(move || {
        // Wait for the Redis client to connect
        let Ok((local_stream, _)) = listener.accept() else { return };
        local_stream.set_nonblocking(true).ok();

        // Open an SSH channel to the target Redis host
        let channel = match sess.channel_direct_tcpip(&redis_host, redis_port, None) {
            Ok(c) => c,
            Err(e) => { eprintln!("SSH channel: {}", e); return; }
        };

        // Switch to non-blocking so the poll loop doesn't stall
        sess.set_blocking(false);

        forward_loop(local_stream, channel, stop_rx);
    });

    Ok((local_port, SshTunnel { _stop_tx: stop_tx }))
}

fn forward_loop(
    mut local: TcpStream,
    mut remote: ssh2::Channel,
    stop_rx: std::sync::mpsc::Receiver<()>,
) {
    let mut buf = [0u8; 8192];
    loop {
        use std::sync::mpsc::TryRecvError;
        match stop_rx.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => break,
            Err(TryRecvError::Empty) => {}
        }

        // local → remote
        match local.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => { if remote.write_all(&buf[..n]).is_err() { break } }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // remote → local
        match remote.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => { if local.write_all(&buf[..n]).is_err() { break } }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        if remote.eof() { break; }

        thread::sleep(Duration::from_micros(200));
    }
    let _ = remote.close();
}

// ---------------------------------------------------------------------------
// JSON ↔ Redis value helpers
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
    // Basic
    host: Option<String>,
    port: Option<u16>,
    password: Option<String>,
    db: Option<i64>,
    // TLS (ca/cert/key reserved for future custom-connector support)
    ssl: Option<bool>,
    #[allow(dead_code)] tls_ca: Option<String>,
    #[allow(dead_code)] tls_cert: Option<String>,
    #[allow(dead_code)] tls_key: Option<String>,
    // SSH tunnel
    ssh: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<u16>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key: Option<String>,
    ssh_key_passphrase: Option<String>,
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
    let host = config.host.clone().unwrap_or_else(|| "localhost".to_string());
    let port = config.port.unwrap_or(6379);
    let db = config.db.unwrap_or(0);
    let ssl = config.ssl.unwrap_or(false);

    // ── SSH tunnel ──────────────────────────────────────────────────────────
    let (redis_host, redis_port, ssh_tunnel) = if config.ssh.unwrap_or(false) {
        let ssh_host = config.ssh_host.clone().unwrap_or_else(|| "localhost".to_string());
        let ssh_port = config.ssh_port.unwrap_or(22);
        let ssh_user = config.ssh_user.clone().unwrap_or_default();
        let ssh_password = config.ssh_password.clone();
        let ssh_key = config.ssh_key.clone();
        let ssh_key_passphrase = config.ssh_key_passphrase.clone();
        let redis_host_inner = host.clone();

        let (local_port, tunnel) = tokio::task::spawn_blocking(move || {
            create_ssh_tunnel(
                &ssh_host, ssh_port, &ssh_user,
                ssh_password.as_deref(),
                ssh_key.as_deref(),
                ssh_key_passphrase.as_deref(),
                &redis_host_inner, port,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        ("127.0.0.1".to_string(), local_port, Some(tunnel))
    } else {
        (host.clone(), port, None)
    };

    // ── Build ConnectionInfo ────────────────────────────────────────────────
    let redis_info = RedisConnectionInfo {
        db,
        username: None,
        password: config.password.filter(|p| !p.is_empty()),
        protocol: Default::default(),
    };

    // The original Electron app used rejectUnauthorized: false so self-signed
    // certificates are accepted. insecure: true matches that behaviour.
    let addr = if ssl {
        ConnectionAddr::TcpTls {
            host: redis_host,
            port: redis_port,
            insecure: true,
            tls_params: None,
        }
    } else {
        ConnectionAddr::Tcp(redis_host, redis_port)
    };

    let conn_info = ConnectionInfo { addr, redis: redis_info };
    let client = Client::open(conn_info).map_err(|e| e.to_string())?;
    let conn = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| e.to_string())?;

    let conn_arc = Arc::new(Mutex::new(conn));

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
        connections.insert(connection_id.clone(), ConnectionEntry { conn: conn_arc, ssh_tunnel });
    }

    Ok(ConnectResult { connection_id, server_info })
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
    for arg in &args { cmd.arg(json_to_bytes(arg)); }

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
    if atomic.unwrap_or(false) { pipe.atomic(); }
    for entry in &commands {
        pipe.cmd(&entry.command);
        for arg in &entry.args { pipe.arg(json_to_bytes(arg)); }
    }

    let results: Vec<RedisValue> = pipe
        .query_async(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(results.into_iter().map(|v| redis_value_to_json(v, false)).collect())
}

/// Read a local file as UTF-8 text (used by Config for TLS/SSH PEM files).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Window size persistence
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct WindowSize { width: f64, height: f64 }

fn window_size_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("window_size.json"))
}

fn load_window_size(app: &tauri::AppHandle) -> Option<WindowSize> {
    let path = window_size_path(app)?;
    let json = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&json).ok()
}

#[tauri::command]
fn save_window_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(path) = window_size_path(&app) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(&WindowSize { width, height }).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    for key in &keys { cmd.arg(key); }
    for arg in &args { cmd.arg(arg); }

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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            if let Some(size) = load_window_size(&app.handle()) {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: size.width,
                    height: size.height,
                }));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            redis_connect,
            redis_disconnect,
            redis_execute,
            redis_pipeline,
            redis_eval,
            read_text_file,
            save_window_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
