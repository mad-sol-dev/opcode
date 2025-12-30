import { useState, useCallback } from 'react';
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
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
 * Push-to-Talk button using subprocess recording (Linux workaround for WebKitGTK)
 * Uses arecord command to capture audio directly
 */
export function PushToTalkButton({
  onTranscription,
  className,
  disabled = false,
  onError,
  onSuccess,
}: PushToTalkButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleError = (message: string) => {
    setLocalError(message);
    console.error('[PTT Subprocess]:', message);
    onError?.(message);
    setTimeout(() => setLocalError(null), 5000);
  };

  const handleSuccess = (message: string) => {
    console.log('[PTT Subprocess]:', message);
    onSuccess?.(message);
  };

  const startRecording = useCallback(async () => {
    try {
      console.log('[PTT Subprocess] Starting recording...');

      // Start subprocess recording
      const filePath = await invoke<string>('start_subprocess_recording');

      console.log('[PTT Subprocess] Recording started, file:', filePath);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      const interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
      setTimerInterval(interval);

    } catch (error) {
      console.error('[PTT Subprocess] Start error:', error);
      handleError(
        error instanceof Error
          ? error.message
          : 'Failed to start recording. Is arecord installed?'
      );
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      console.log('[PTT Subprocess] Stopping recording...');

      // Stop timer
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }

      // Stop subprocess recording
      const filePath = await invoke<string>('stop_subprocess_recording');

      console.log('[PTT Subprocess] Recording stopped, file:', filePath);
      setIsRecording(false);
      setIsTranscribing(true);

      // Get STT settings
      const settings = await apiCall<SttSettings>('get_stt_settings');

      if (!settings.apiKey) {
        handleError('API key required. Please configure your Mistral API key in settings.');
        setIsTranscribing(false);
        return;
      }

      // Transcribe the audio file
      console.log('[PTT Subprocess] Transcribing...');
      const transcription = await apiCall<string>('transcribe_audio', {
        audioPath: filePath,
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
      console.error('[PTT Subprocess] Stop/transcribe error:', error);
      handleError(
        error instanceof Error
          ? error.message
          : 'Failed to stop recording or transcribe'
      );
    } finally {
      setIsTranscribing(false);
    }
  }, [timerInterval, recordingTime, onTranscription]);

  const cancelRecording = useCallback(async () => {
    try {
      console.log('[PTT Subprocess] Cancelling recording...');

      // Stop timer
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }

      // Cancel subprocess recording
      await invoke('cancel_subprocess_recording');

      setIsRecording(false);
      setRecordingTime(0);
      setLocalError(null);

      console.log('[PTT Subprocess] Recording cancelled');
    } catch (error) {
      console.error('[PTT Subprocess] Cancel error:', error);
    }
  }, [timerInterval]);

  const handleClick = async () => {
    if (disabled || isTranscribing) return;

    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelRecording();
  };

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
            : 'Start recording (subprocess)'
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
