import React, { useState, useEffect } from 'react';
import { Mic, ExternalLink, Loader2 } from 'lucide-react';
import { apiCall } from '@/lib/apiAdapter';
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
import type { SttSettings as SttSettingsType } from '@/types/stt';

interface SttSettingsProps {
  setToast?: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onChange?: (hasChanges: boolean, save: () => Promise<void>) => void;
}

/**
 * Speech-to-Text Settings Component
 * Manages STT provider configuration (API keys, model selection, language)
 */
export const SttSettings: React.FC<SttSettingsProps> = ({ setToast, onChange }) => {
  const [settings, setSettings] = useState<SttSettingsType>({
    provider: 'mistral',
    apiKey: null,
    model: 'voxtral-mini-latest',
    language: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (onChange) {
      onChange(hasChanges, handleSave);
    }
  }, [hasChanges]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await apiCall<SttSettingsType>('get_stt_settings');
      setSettings({
        provider: data.provider || 'mistral',
        apiKey: data.apiKey || null,
        model: data.model || 'voxtral-mini-latest',
        language: data.language || null,
      });
    } catch (error) {
      console.error('Failed to load STT settings:', error);
      setToast?.({
        message: 'Failed to load speech-to-text settings',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiCall('save_stt_settings', { settings });
      setHasChanges(false);
      setToast?.({
        message: 'Speech-to-text settings saved successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Failed to save STT settings:', error);
      setToast?.({
        message: error instanceof Error ? error.message : 'Failed to save settings',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof SttSettingsType>(
    key: K,
    value: SttSettingsType[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Mic className="h-5 w-5 text-primary" />
          <h3 className="text-heading-4">Speech-to-Text Configuration</h3>
        </div>
        <p className="text-body-small text-muted-foreground">
          Configure voice input for Claude Code using Mistral AI's Voxtral API
        </p>
      </div>

      <div className="space-y-4">
        {/* Provider Selection */}
        <div className="space-y-2">
          <Label htmlFor="provider">STT Provider</Label>
          <Select
            value={settings.provider}
            onValueChange={(value: 'mistral' | 'openai' | 'local') =>
              updateSetting('provider', value)
            }
          >
            <SelectTrigger id="provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mistral">Mistral AI (Voxtral)</SelectItem>
              <SelectItem value="openai" disabled>
                OpenAI Whisper (Coming soon)
              </SelectItem>
              <SelectItem value="local" disabled>
                Local Whisper (Coming soon)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-caption text-muted-foreground">
            Choose your speech-to-text provider
          </p>
        </div>

        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="api-key">Mistral API Key</Label>
          <Input
            id="api-key"
            type="password"
            value={settings.apiKey || ''}
            onChange={(e) => updateSetting('apiKey', e.target.value || null)}
            placeholder="Enter your Mistral API key"
            className="font-mono"
          />
          <div className="flex items-start gap-1 text-caption text-muted-foreground">
            <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <p>
              Get your API key from{' '}
              <a
                href="https://console.mistral.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                console.mistral.ai
              </a>
            </p>
          </div>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Select
            value={settings.model}
            onValueChange={(value) => updateSetting('model', value)}
          >
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="voxtral-mini-latest">
                Voxtral Mini (Recommended)
              </SelectItem>
              <SelectItem value="voxtral-latest">Voxtral (24B)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-caption text-muted-foreground">
            Voxtral Mini is faster and more cost-effective for most use cases
          </p>
        </div>

        {/* Language Selection */}
        <div className="space-y-2">
          <Label htmlFor="language">Language (Optional)</Label>
          <Input
            id="language"
            type="text"
            value={settings.language || ''}
            onChange={(e) => updateSetting('language', e.target.value || null)}
            placeholder="e.g., en, de, fr (leave empty for auto-detect)"
            maxLength={5}
            className="font-mono"
          />
          <p className="text-caption text-muted-foreground">
            Specify a language code or leave empty for automatic detection
          </p>
        </div>

        {/* Info Box */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-medium text-foreground flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            How to use voice input
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 ml-6">
            <li>• Click the microphone button 🎤 in the prompt input</li>
            <li>• Speak your message clearly</li>
            <li>• Click the square button ⏹️ to stop recording</li>
            <li>• Transcribed text will appear in your prompt automatically</li>
          </ul>
        </div>

        {/* Cost Information */}
        {settings.apiKey && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">Pricing Information</p>
            <p className="text-xs text-muted-foreground">
              Voxtral Mini is very affordable: approximately $0.001-0.005 per 10-second recording.
              Most voice prompts cost less than a penny!
            </p>
          </div>
        )}

        {/* Save Button (standalone mode) */}
        {!onChange && (
          <div className="pt-4">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
