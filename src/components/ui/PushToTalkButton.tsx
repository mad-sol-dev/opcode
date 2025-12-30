import { useState } from 'react';
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import { apiCall } from '@/lib/apiAdapter';
import { cn } from '@/lib/utils';
import type { SttSettings } from '@/types/stt';

interface PushToTalkButtonProps {
  onTranscription: (text: string) => void;
  className?: string;
  disabled?: boolean;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

/**
 * Push-to-Talk button component for speech-to-text transcription
 *
 * Features:
 * - Click to start recording
 * - Click again to stop and transcribe
 * - Shows recording timer
 * - Handles errors gracefully
 *
 * @example
 * <PushToTalkButton
 *   onTranscription={(text) => setPromptValue(text)}
 *   onError={(error) => showToast(error, 'error')}
 *   onSuccess={(msg) => showToast(msg, 'success')}
 * />
 */
export function PushToTalkButton({
  onTranscription,
  className,
  disabled = false,
  onError,
  onSuccess,
}: PushToTalkButtonProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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

  const handleError = (message: string) => {
    setLocalError(message);
    console.error('[PTT Error]:', message);
    onError?.(message);

    // Clear error after 5 seconds
    setTimeout(() => setLocalError(null), 5000);
  };

  const handleSuccess = (message: string) => {
    console.log('[PTT Success]:', message);
    onSuccess?.(message);
  };

  const handleClick = async () => {
    if (disabled) return;

    if (isRecording) {
      // Stop recording and transcribe
      const audioBlob = await stopRecording();

      if (!audioBlob) {
        handleError('No audio data captured');
        return;
      }

      setIsTranscribing(true);
      setLocalError(null);

      try {
        // Get STT settings
        const settings = await apiCall<SttSettings>('get_stt_settings');

        if (!settings.apiKey) {
          handleError('API key required. Please configure your Mistral API key in settings.');
          setIsTranscribing(false);
          return;
        }

        // Save audio to temporary file
        const tempPath = await saveBlobToTempFile(audioBlob);

        // Transcribe
        const transcription = await apiCall<string>('transcribe_audio', {
          audioPath: tempPath,
          apiKey: settings.apiKey,
          language: settings.language,
        });

        if (transcription.trim()) {
          onTranscription(transcription);
          handleSuccess(`Transcribed ${recordingTime}s of audio`);
        } else {
          handleError('Transcription returned empty result');
        }
      } catch (error) {
        console.error('Transcription error:', error);
        handleError(
          error instanceof Error
            ? error.message
            : 'Transcription failed. Check your API key and connection.'
        );
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Start recording
      setLocalError(null);
      await startRecording();
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelRecording();
    setLocalError(null);
  };

  // Show recording error
  if (recordingError && !localError) {
    handleError(recordingError);
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
          (isTranscribing || disabled) && 'opacity-50 cursor-not-allowed',
          className
        )}
        title={
          isRecording
            ? 'Stop recording and transcribe'
            : isTranscribing
            ? 'Transcribing...'
            : 'Start recording'
        }
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
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
          <span className="font-mono text-red-500 font-medium">
            {formatTime(recordingTime)}
          </span>
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {localError && (
        <div className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" />
          <span className="max-w-[200px] truncate" title={localError}>
            {localError}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Helper function to save audio Blob to a temporary file
 * Converts blob to base64 and sends to backend which saves it
 */
async function saveBlobToTempFile(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const base64Data = (reader.result as string).split(',')[1];
        const fileName = `recording_${Date.now()}.webm`;

        // Use Tauri invoke to save file on backend
        const { invoke } = await import('@tauri-apps/api/core');
        const filePath = await invoke<string>('save_audio_temp_file', {
          audioData: base64Data,
          fileName: fileName,
        });

        console.log('[PTT] Saved audio to:', filePath);
        resolve(filePath);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
