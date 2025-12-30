/**
 * Speech-to-Text (STT) types
 */

export interface SttSettings {
  provider: 'mistral' | 'openai' | 'local';
  apiKey: string | null;
  model: string;
  language: string | null;
}

export interface TranscriptionRequest {
  audioPath: string;
  apiKey: string;
  language?: string;
}

export interface TranscriptionResponse {
  text: string;
  model?: string;
  language?: string;
  usage?: {
    promptAudioSeconds?: number;
    promptTokens?: number;
    totalTokens?: number;
    completionTokens?: number;
  };
}
