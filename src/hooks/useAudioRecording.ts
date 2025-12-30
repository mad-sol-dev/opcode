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

/**
 * Hook for recording audio from the user's microphone
 * Uses the browser's MediaRecorder API to capture audio in WebM format
 */
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

      // DEBUG: Log environment info
      console.log('[AudioRecording] Starting recording...');
      console.log('[AudioRecording] navigator.mediaDevices available:', !!navigator.mediaDevices);
      console.log('[AudioRecording] getUserMedia available:', !!navigator.mediaDevices?.getUserMedia);
      console.log('[AudioRecording] isSecureContext:', window.isSecureContext);
      console.log('[AudioRecording] location.protocol:', window.location.protocol);
      console.log('[AudioRecording] User Agent:', navigator.userAgent);

      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser/context');
      }

      // Enumerate devices for debugging
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        console.log('[AudioRecording] Audio input devices:', audioInputs.length);
        audioInputs.forEach((device, i) => {
          console.log(`[AudioRecording]   Device ${i}:`, device.label || 'Unknown', device.deviceId);
        });
      } catch (e) {
        console.warn('[AudioRecording] Could not enumerate devices:', e);
      }

      // Request microphone access (explicitly disable video!)
      console.log('[AudioRecording] Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Good for speech
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false, // EXPLICITLY disable video to avoid camera prompt
      });
      console.log('[AudioRecording] Microphone access granted!');
      console.log('[AudioRecording] Stream tracks:', stream.getTracks().length);

      streamRef.current = stream;

      // Determine the best mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus';

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
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
      console.error('[AudioRecording] ERROR:', err);
      console.error('[AudioRecording] Error name:', (err as any)?.name);
      console.error('[AudioRecording] Error message:', (err as any)?.message);
      console.error('[AudioRecording] Error constraint:', (err as any)?.constraint);

      let errorMessage = 'Failed to access microphone';

      if (err instanceof Error) {
        errorMessage = err.message;

        // Specific error handling
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Microphone permission denied. Please allow microphone access in browser/system settings.';
        } else if (err.name === 'NotFoundError') {
          errorMessage = 'No microphone found. Please connect a microphone.';
        } else if (err.name === 'NotSupportedError') {
          errorMessage = 'Microphone not supported in this context.';
        } else if (err.name === 'NotReadableError') {
          errorMessage = 'Microphone is already in use by another application.';
        }
      }

      setError(errorMessage);
      console.error('[AudioRecording] Final error message:', errorMessage);
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
        const mimeType =
          mediaRecorder.mimeType || 'audio/webm;codecs=opus';
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType,
        });

        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
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
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'paused'
    ) {
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
        streamRef.current.getTracks().forEach((track) => track.stop());
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
