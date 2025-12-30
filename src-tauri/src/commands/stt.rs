use anyhow::{Context, Result};
use chrono::Utc;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;
use crate::commands::agents::AgentDb;
use base64::{Engine as _, engine::general_purpose};

/// Global state for active recording process
pub struct RecordingProcess(pub Mutex<Option<(Child, PathBuf)>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResponse {
    pub model: String,
    pub text: String,
    pub language: Option<String>,
    #[serde(default)]
    pub usage: Option<TranscriptionUsage>,
    #[serde(default)]
    pub segments: Vec<serde_json::Value>,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionUsage {
    pub prompt_audio_seconds: f64,
    pub prompt_tokens: u64,
    pub total_tokens: u64,
    pub completion_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SttSettings {
    pub provider: String, // "mistral", "openai", "local"
    pub api_key: Option<String>,
    pub model: String,
    pub language: Option<String>,
}

/// Start recording audio using subprocess (Linux fallback for WebKitGTK issues)
#[tauri::command]
pub async fn start_subprocess_recording(
    recording_state: State<'_, RecordingProcess>,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(format!("recording_{}.wav", Utc::now().timestamp()));

    log::info!("Starting subprocess recording to: {:?}", file_path);

    // Use arecord to capture audio
    // -f S16_LE: 16-bit signed little-endian PCM
    // -r 16000: 16kHz sample rate (good for speech)
    // -c 1: mono
    let child = Command::new("arecord")
        .args([
            "-f", "S16_LE",
            "-r", "16000",
            "-c", "1",
            file_path.to_str().unwrap(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start arecord: {}. Is arecord installed?", e))?;

    let mut state = recording_state.0.lock().map_err(|e| e.to_string())?;
    *state = Some((child, file_path.clone()));

    log::info!("Recording started successfully");
    Ok(file_path.to_string_lossy().to_string())
}

/// Stop the active recording and return the file path
#[tauri::command]
pub async fn stop_subprocess_recording(
    recording_state: State<'_, RecordingProcess>,
) -> Result<String, String> {
    let mut state = recording_state.0.lock().map_err(|e| e.to_string())?;

    if let Some((mut child, file_path)) = state.take() {
        log::info!("Stopping recording process...");

        // Send SIGTERM to arecord to stop recording gracefully
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let pid = child.id();
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }

        // Wait for process to finish (with timeout)
        let _ = child.wait();

        log::info!("Recording stopped, file saved to: {:?}", file_path);

        // Check if file exists and has content
        if file_path.exists() {
            let metadata = std::fs::metadata(&file_path)
                .map_err(|e| format!("Failed to read file metadata: {}", e))?;

            if metadata.len() > 0 {
                return Ok(file_path.to_string_lossy().to_string());
            } else {
                return Err("Recording file is empty".to_string());
            }
        } else {
            return Err("Recording file was not created".to_string());
        }
    }

    Err("No active recording to stop".to_string())
}

/// Cancel the active recording without saving
#[tauri::command]
pub async fn cancel_subprocess_recording(
    recording_state: State<'_, RecordingProcess>,
) -> Result<(), String> {
    let mut state = recording_state.0.lock().map_err(|e| e.to_string())?;

    if let Some((mut child, file_path)) = state.take() {
        log::info!("Cancelling recording...");

        // Kill the process
        let _ = child.kill();
        let _ = child.wait();

        // Delete the file
        let _ = std::fs::remove_file(&file_path);

        log::info!("Recording cancelled");
    }

    Ok(())
}

/// Save audio data from base64 to temporary file
#[tauri::command]
pub async fn save_audio_temp_file(
    audio_data: String,
    file_name: String,
) -> Result<String, String> {
    // Decode base64 audio data
    let audio_bytes = general_purpose::STANDARD
        .decode(&audio_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Create temp file path
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(file_name);

    // Write audio data to file
    std::fs::write(&file_path, audio_bytes)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;

    log::info!("Saved audio file to: {:?}", file_path);

    Ok(file_path.to_string_lossy().to_string())
}

/// Transcribe audio file using Mistral Voxtral API
#[tauri::command]
pub async fn transcribe_audio(
    audio_path: String,
    api_key: String,
    language: Option<String>,
) -> Result<String, String> {
    log::info!("transcribe_audio called with path: {}", audio_path);
    let path = PathBuf::from(&audio_path);

    // Check if file exists
    if !path.exists() {
        let err = format!("Audio file does not exist: {}", audio_path);
        log::error!("{}", err);
        return Err(err);
    }

    // Check file size
    match std::fs::metadata(&path) {
        Ok(metadata) => {
            log::info!("Audio file size: {} bytes", metadata.len());
            if metadata.len() == 0 {
                let err = "Audio file is empty".to_string();
                log::error!("{}", err);
                return Err(err);
            }
        }
        Err(e) => {
            let err = format!("Failed to read file metadata: {}", e);
            log::error!("{}", err);
            return Err(err);
        }
    }

    transcribe_with_mistral(path, api_key, language)
        .await
        .map_err(|e| {
            let err_msg = format!("Transcription failed: {}", e);
            log::error!("{}", err_msg);
            err_msg
        })
}

async fn transcribe_with_mistral(
    audio_path: PathBuf,
    api_key: String,
    language: Option<String>,
) -> Result<String> {
    log::info!("Starting Mistral transcription...");
    let client = reqwest::Client::new();

    // Read audio file
    let audio_data = tokio::fs::read(&audio_path)
        .await
        .context("Failed to read audio file")?;

    let file_name = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.wav")
        .to_string();

    log::info!("Transcribing audio file: {} ({} bytes)", file_name, audio_data.len());

    // Build multipart form
    log::info!("Building multipart form...");
    let mime_result = multipart::Part::bytes(audio_data.clone())
        .file_name(file_name.clone())
        .mime_str("audio/wav");

    let file_part = match mime_result {
        Ok(part) => {
            log::info!("MIME type set successfully to audio/wav");
            part
        }
        Err(e) => {
            log::error!("Failed to set MIME type: {}", e);
            return Err(anyhow::anyhow!("Failed to set MIME type: {}", e));
        }
    };

    let mut form = multipart::Form::new()
        .text("model", "voxtral-mini-latest")
        .part("file", file_part);

    if let Some(lang) = &language {
        log::info!("Setting language: {}", lang);
        form = form.text("language", lang.clone());
    }

    // Make API request
    log::info!("Sending request to Mistral API...");
    log::info!("API key present: {}", !api_key.is_empty());

    let response = client
        .post("https://api.mistral.ai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .context("Failed to send transcription request")?;

    log::info!("Received response with status: {}", response.status());

    let status = response.status();

    // Get raw response text first for debugging
    let response_text = response.text().await
        .context("Failed to read response body")?;

    log::info!("Raw API response (status {}): {}", status, response_text);

    if !status.is_success() {
        log::error!("Mistral API error ({}): {}", status, response_text);
        anyhow::bail!("Mistral API error ({}): {}", status, response_text);
    }

    // Try to parse the JSON response
    let transcription: TranscriptionResponse = serde_json::from_str(&response_text)
        .context(format!("Failed to parse transcription response. Raw response: {}", response_text))?;

    log::info!("Transcription successful: {} characters", transcription.text.len());

    Ok(transcription.text)
}

/// Get STT settings from database
#[tauri::command]
pub async fn get_stt_settings(db: State<'_, AgentDb>) -> Result<SttSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let provider = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_provider'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "mistral".to_string());

    let api_key = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_api_key'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let model = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_model'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "voxtral-mini-latest".to_string());

    let language = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_language'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(SttSettings {
        provider,
        api_key,
        model,
        language,
    })
}

/// Save STT settings to database
#[tauri::command]
pub async fn save_stt_settings(
    db: State<'_, AgentDb>,
    settings: SttSettings,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_provider', ?1)",
        [&settings.provider],
    )
    .map_err(|e| e.to_string())?;

    if let Some(api_key) = &settings.api_key {
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_api_key', ?1)",
            [api_key],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_model', ?1)",
        [&settings.model],
    )
    .map_err(|e| e.to_string())?;

    if let Some(language) = &settings.language {
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_language', ?1)",
            [language],
        )
        .map_err(|e| e.to_string())?;
    }

    log::info!("STT settings saved successfully");

    Ok(())
}
