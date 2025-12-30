# Speech-to-Text (PTT) Implementation Plan

## Overview
Add Push-To-Talk (PTT) button to message input that records audio and transcribes it using Mistral AI's Voxtral API, pasting the result into the message field.

## Mistral API Details

### Endpoint
- **URL**: `https://api.mistral.ai/v1/audio/transcriptions`
- **Method**: POST
- **Auth**: Bearer token via `Authorization: Bearer YOUR_API_KEY`

### Request Format
```http
POST https://api.mistral.ai/v1/audio/transcriptions
Content-Type: multipart/form-data
Authorization: Bearer YOUR_API_KEY

{
  "file": [audio file],
  "model": "voxtral-mini-latest",
  "language": "en" (optional),
  "timestamp_granularities": ["segment"] (optional)
}
```

### Response Format
```json
{
  "model": "voxtral-mini-2507",
  "text": "Transcribed text content here",
  "language": "en",
  "segments": [],
  "usage": {
    "prompt_audio_seconds": 5.2,
    "prompt_tokens": 1234,
    "total_tokens": 1234,
    "completion_tokens": 0
  }
}
```

### Audio Support
- **Formats**: `.mp3`, `.wav` (others likely supported but not documented)
- **Max length**: Up to 30 minutes for transcription
- **Context**: 32k token context window

## Implementation Plan

### Phase 1: Backend (Rust/Tauri)

#### 1.1 Add Dependencies to `src-tauri/Cargo.toml`
```toml
[dependencies]
# Already have reqwest with json feature
# May need to add multipart support
reqwest = { version = "0.12", features = ["json", "native-tls-vendored", "multipart"] }
```

#### 1.2 Create STT Command Module
**File**: `src-tauri/src/commands/stt.rs`

```rust
use anyhow::{Context, Result};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResponse {
    pub model: String,
    pub text: String,
    pub language: String,
    pub usage: TranscriptionUsage,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionUsage {
    pub prompt_audio_seconds: f64,
    pub prompt_tokens: u64,
    pub total_tokens: u64,
    pub completion_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SttSettings {
    pub provider: String, // "mistral", "openai", "local"
    pub api_key: Option<String>,
    pub model: String,
    pub language: Option<String>,
}

/// Transcribe audio file using Mistral Voxtral API
#[tauri::command]
pub async fn transcribe_audio(
    audio_path: PathBuf,
    api_key: String,
    language: Option<String>,
) -> Result<String, String> {
    transcribe_with_mistral(audio_path, api_key, language)
        .await
        .map_err(|e| e.to_string())
}

async fn transcribe_with_mistral(
    audio_path: PathBuf,
    api_key: String,
    language: Option<String>,
) -> Result<String> {
    let client = reqwest::Client::new();

    // Read audio file
    let audio_data = tokio::fs::read(&audio_path)
        .await
        .context("Failed to read audio file")?;

    let file_name = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.webm")
        .to_string();

    // Build multipart form
    let mut form = multipart::Form::new()
        .text("model", "voxtral-mini-latest")
        .part(
            "file",
            multipart::Part::bytes(audio_data)
                .file_name(file_name)
                .mime_str("audio/webm")?,
        );

    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    // Make API request
    let response = client
        .post("https://api.mistral.ai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .context("Failed to send transcription request")?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        anyhow::bail!("Mistral API error ({}): {}", status, error_text);
    }

    let transcription: TranscriptionResponse = response
        .json()
        .await
        .context("Failed to parse transcription response")?;

    Ok(transcription.text)
}

/// Get STT settings from database
#[tauri::command]
pub async fn get_stt_settings(app: tauri::AppHandle) -> Result<SttSettings, String> {
    let db = crate::commands::agents::get_db(&app).map_err(|e| e.to_string())?;

    let provider = db
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_provider'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "mistral".to_string());

    let api_key = db
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_api_key'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let model = db
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'stt_model'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "voxtral-mini-latest".to_string());

    let language = db
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
    app: tauri::AppHandle,
    settings: SttSettings,
) -> Result<(), String> {
    let db = crate::commands::agents::get_db(&app).map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_provider', ?1)",
        [&settings.provider],
    )
    .map_err(|e| e.to_string())?;

    if let Some(api_key) = &settings.api_key {
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_api_key', ?1)",
            [api_key],
        )
        .map_err(|e| e.to_string())?;
    }

    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_model', ?1)",
        [&settings.model],
    )
    .map_err(|e| e.to_string())?;

    if let Some(language) = &settings.language {
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('stt_language', ?1)",
            [language],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

#### 1.3 Register Commands
**File**: `src-tauri/src/commands/mod.rs`
```rust
pub mod stt;
```

**File**: `src-tauri/src/main.rs`
```rust
use commands::stt::{transcribe_audio, get_stt_settings, save_stt_settings};

// In invoke_handler:
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    transcribe_audio,
    get_stt_settings,
    save_stt_settings,
])
```

### Phase 2: Frontend (React/TypeScript)

#### 2.1 Add Audio Recording Hook
**File**: `src/hooks/useAudioRecording.ts`

```typescript
import { useState, useRef, useCallback } from 'react';

export interface UseAudioRecordingResult {
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
  error: string | null;
}

export function useAudioRecording(): UseAudioRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Good for speech
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      streamRef.current = stream;

      // Create MediaRecorder with WebM format
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(errorMessage);
      console.error('Recording error:', err);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;

      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }

        setIsRecording(false);
        setIsPaused(false);
        audioChunksRef.current = [];

        resolve(audioBlob);
      };

      mediaRecorder.stop();
    });
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      audioChunksRef.current = [];
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
    }
  }, []);

  return {
    isRecording,
    isPaused,
    recordingTime,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    error,
  };
}
```

#### 2.2 Add API Adapter Methods
**File**: `src/lib/apiAdapter.ts`

Add to the API object:
```typescript
// Add to TauriAPI class
async transcribeAudio(audioPath: string, apiKey: string, language?: string): Promise<string> {
  return invoke('transcribe_audio', { audioPath, apiKey, language });
}

async getSttSettings(): Promise<SttSettings> {
  return invoke('get_stt_settings');
}

async saveSttSettings(settings: SttSettings): Promise<void> {
  return invoke('save_stt_settings', { settings });
}

// Add to WebAPI class (if implementing web mode support)
async transcribeAudio(audioPath: string, apiKey: string, language?: string): Promise<string> {
  const formData = new FormData();
  const audioBlob = await fetch(audioPath).then(r => r.blob());
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('api_key', apiKey);
  if (language) formData.append('language', language);

  const response = await fetch(`${this.baseUrl}/api/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error('Transcription failed');
  const data = await response.json();
  return data.text;
}
```

#### 2.3 Create PTT Button Component
**File**: `src/components/ui/PushToTalkButton.tsx`

```typescript
import { useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import { api } from '@/lib/apiAdapter';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface PushToTalkButtonProps {
  onTranscription: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

export function PushToTalkButton({
  onTranscription,
  className,
  disabled = false,
}: PushToTalkButtonProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const { toast } = useToast();

  const {
    isRecording,
    recordingTime,
    startRecording,
    stopRecording,
    cancelRecording,
    error: recordingError,
  } = useAudioRecording();

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClick = async () => {
    if (disabled) return;

    if (isRecording) {
      // Stop recording and transcribe
      const audioBlob = await stopRecording();

      if (!audioBlob) {
        toast({
          title: 'Recording failed',
          description: 'No audio data captured',
          variant: 'destructive',
        });
        return;
      }

      setIsTranscribing(true);

      try {
        // Get STT settings
        const settings = await api.getSttSettings();

        if (!settings.api_key) {
          toast({
            title: 'API key required',
            description: 'Please configure your Mistral API key in settings',
            variant: 'destructive',
          });
          setIsTranscribing(false);
          return;
        }

        // Save audio to temporary file
        const tempPath = await saveBlobToTempFile(audioBlob);

        // Transcribe
        const transcription = await api.transcribeAudio(
          tempPath,
          settings.api_key,
          settings.language
        );

        if (transcription.trim()) {
          onTranscription(transcription);
          toast({
            title: 'Transcription complete',
            description: `Transcribed ${recordingTime}s of audio`,
          });
        }
      } catch (error) {
        console.error('Transcription error:', error);
        toast({
          title: 'Transcription failed',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Start recording
      await startRecording();
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelRecording();
  };

  if (recordingError) {
    toast({
      title: 'Microphone error',
      description: recordingError,
      variant: 'destructive',
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled || isTranscribing}
        className={cn(
          'relative flex items-center justify-center rounded-full p-2 transition-all',
          'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
          isRecording && 'bg-red-500 hover:bg-red-600 text-white animate-pulse',
          isTranscribing && 'opacity-50 cursor-not-allowed',
          className
        )}
        title={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isTranscribing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isRecording ? (
          <Square className="h-5 w-5" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </button>

      {isRecording && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-red-500">{formatTime(recordingTime)}</span>
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to save Blob to temporary file (Tauri-specific)
async function saveBlobToTempFile(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Use Tauri's fs plugin to write to temp file
  const { writeBinaryFile } = await import('@tauri-apps/plugin-fs');
  const { tempDir } = await import('@tauri-apps/api/path');

  const tempDirPath = await tempDir();
  const fileName = `recording_${Date.now()}.webm`;
  const filePath = `${tempDirPath}/${fileName}`;

  await writeBinaryFile(filePath, uint8Array);

  return filePath;
}
```

#### 2.4 Integrate into FloatingPromptInput
**File**: `src/components/claude-code-session/FloatingPromptInput.tsx`

Add the PTT button:
```typescript
import { PushToTalkButton } from '@/components/ui/PushToTalkButton';

// Inside the component:
const handleTranscription = (text: string) => {
  // Append to existing prompt or replace
  setPromptValue((prev) => {
    const separator = prev.trim() ? ' ' : '';
    return prev + separator + text;
  });
};

// In the JSX, add before the send button:
<PushToTalkButton
  onTranscription={handleTranscription}
  disabled={isExecuting}
/>
```

#### 2.5 Add Settings UI
**File**: `src/components/widgets/SttSettings.tsx`

```typescript
import { useState, useEffect } from 'react';
import { api } from '@/lib/apiAdapter';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SttSettings() {
  const [settings, setSettings] = useState({
    provider: 'mistral',
    api_key: '',
    model: 'voxtral-mini-latest',
    language: '',
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSttSettings();
      setSettings({
        provider: data.provider,
        api_key: data.api_key || '',
        model: data.model,
        language: data.language || '',
      });
    } catch (error) {
      console.error('Failed to load STT settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.saveSttSettings(settings);
      toast({
        title: 'Settings saved',
        description: 'Speech-to-text settings updated successfully',
      });
    } catch (error) {
      toast({
        title: 'Failed to save settings',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="provider">Provider</Label>
        <Select
          value={settings.provider}
          onValueChange={(value) => setSettings({ ...settings, provider: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mistral">Mistral AI (Voxtral)</SelectItem>
            <SelectItem value="openai" disabled>OpenAI Whisper (Coming soon)</SelectItem>
            <SelectItem value="local" disabled>Local Whisper (Coming soon)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="api-key">Mistral API Key</Label>
        <Input
          id="api-key"
          type="password"
          value={settings.api_key}
          onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
          placeholder="Enter your Mistral API key"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Get your API key from{' '}
          <a
            href="https://console.mistral.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            console.mistral.ai
          </a>
        </p>
      </div>

      <div>
        <Label htmlFor="language">Language (optional)</Label>
        <Input
          id="language"
          value={settings.language}
          onChange={(e) => setSettings({ ...settings, language: e.target.value })}
          placeholder="e.g., en, de, fr (leave empty for auto-detect)"
        />
      </div>

      <Button onClick={handleSave}>Save Settings</Button>
    </div>
  );
}
```

Add to settings dialog/page in your app.

### Phase 3: Web Server Support (Optional)

#### 3.1 Add REST Endpoint
**File**: `src-tauri/src/web_server.rs`

```rust
async fn transcribe_audio_web(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<String>>, StatusCode> {
    let mut file_data = None;
    let mut api_key = None;
    let mut language = None;

    while let Some(field) = multipart.next_field().await.unwrap() {
        let name = field.name().unwrap_or("").to_string();

        match name.as_str() {
            "file" => {
                file_data = Some(field.bytes().await.unwrap());
            }
            "api_key" => {
                api_key = Some(field.text().await.unwrap());
            }
            "language" => {
                language = Some(field.text().await.unwrap());
            }
            _ => {}
        }
    }

    let file_data = file_data.ok_or(StatusCode::BAD_REQUEST)?;
    let api_key = api_key.ok_or(StatusCode::BAD_REQUEST)?;

    // Save to temp file
    let temp_path = std::env::temp_dir().join(format!("audio_{}.webm", uuid::Uuid::new_v4()));
    tokio::fs::write(&temp_path, file_data)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Call transcription function
    let result = crate::commands::stt::transcribe_audio(temp_path, api_key, language)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(result)))
}

// Register route in create_web_server():
.route("/api/transcribe", post(transcribe_audio_web))
```

## Testing Checklist

- [ ] Microphone permission request works
- [ ] Recording starts/stops correctly
- [ ] Audio file is created in temp directory
- [ ] Mistral API authentication works
- [ ] Transcription returns correct text
- [ ] Text is inserted into prompt input
- [ ] Settings are saved/loaded correctly
- [ ] Error handling for no API key
- [ ] Error handling for network failures
- [ ] Error handling for microphone access denied
- [ ] Timer shows correct recording duration
- [ ] Cancel button stops recording without transcribing
- [ ] Works in both Tauri and web modes (if implementing web)
- [ ] Temp files are cleaned up after transcription

## Future Enhancements

1. **Alternative Providers**:
   - OpenAI Whisper API support
   - Local Whisper.cpp integration
   - Provider selection in settings

2. **Advanced Features**:
   - Real-time transcription (streaming)
   - Audio visualization waveform
   - Voice activity detection (auto-stop on silence)
   - Multiple language support with dropdown
   - Keyboard shortcut for PTT (e.g., Ctrl+Shift+M)
   - Push-and-hold recording mode

3. **UX Improvements**:
   - Show confidence scores
   - Edit transcription before inserting
   - Save audio recordings for debugging
   - Usage tracking (audio seconds consumed)

4. **Performance**:
   - Audio compression before upload
   - Chunked upload for long recordings
   - Cache API key securely in memory

## Estimated Timeline

- **Backend setup**: 2-3 hours
- **Frontend recording UI**: 2-3 hours
- **Integration & testing**: 2-4 hours
- **Settings UI**: 1-2 hours
- **Polish & error handling**: 2-3 hours

**Total: 1-2 days** for full implementation

## Security Notes

- Store API key encrypted in database
- Never log API keys
- Clean up temp audio files after transcription
- Validate audio file size before upload
- Rate limit transcription requests to prevent abuse
- Consider adding usage cost warnings
