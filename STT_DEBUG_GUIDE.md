# STT Microphone Debug Guide (Linux/WebKitGTK)

## Problem
WebKitGTK blockiert Mikrofon-Zugriff mit: "The request is not allowed by the user agent or the platform in the current context"

## Debug-Schritte

### Schritt 1: App neu starten mit Debug-Logging

```bash
# Stoppe die laufende App
# Dann:
bun run tauri dev
```

### Schritt 2: Browser-Konsole öffnen

In der opcode-App:
- **Rechtsklick** → **Inspect Element** oder **Ctrl+Shift+I**
- Tab **"Console"** öffnen

### Schritt 3: Mikrofon-Button klicken und Logs analysieren

Klicke auf den 🎤 Button und schaue dir die Console-Ausgaben an:

```
[AudioRecording] Starting recording...
[AudioRecording] navigator.mediaDevices available: true/false
[AudioRecording] getUserMedia available: true/false
[AudioRecording] isSecureContext: true/false
[AudioRecording] location.protocol: tauri://...
[AudioRecording] User Agent: ...
[AudioRecording] Audio input devices: X
[AudioRecording] Requesting microphone permission...
```

**Bitte sende mir diese Logs!**

## Bekannte WebKitGTK-Probleme

### Problem 1: WebKitGTK 2.40+ braucht spezielle Permissions

**Lösung:**
```bash
# Check WebKitGTK version
dpkg -l | grep webkit

# Wenn < 2.40, update empfohlen:
sudo apt update
sudo apt upgrade libwebkit2gtk-4.1-0
```

### Problem 2: Flatpak Sandbox blockiert Mikrofon

**Prüfen:**
```bash
# Ist opcode als Flatpak installiert?
flatpak list | grep opcode

# Falls ja:
flatpak override --user --device=all opcode.asterisk.so
```

### Problem 3: PipeWire/PulseAudio Permissions

**PipeWire (Debian 12+):**
```bash
# Check PipeWire status
systemctl --user status pipewire pipewire-pulse

# Check permissions
pactl list sources short
```

**PulseAudio:**
```bash
# Check audio devices
pactl list sources short

# Test microphone
parecord --channels=1 --rate=16000 test.wav
# Sprechen, dann Ctrl+C
paplay test.wav
```

### Problem 4: Gnome Portal Permissions

**Check Gnome Settings:**
```bash
# Öffne Privacy Settings
gnome-control-center privacy

# Oder per CLI:
gsettings list-recursively org.gnome.desktop.privacy
```

Stelle sicher:
- **Privacy → Microphone → Enabled**
- **Privacy → Microphone → opcode** ist erlaubt

### Problem 5: AppArmor blockiert Zugriff

```bash
# Check AppArmor status
sudo aa-status | grep opcode

# Wenn blockiert, temporär disable:
sudo aa-complain /usr/bin/opcode
```

## Erweiterte Diagnose

### Test 1: getUserMedia direkt in Console testen

Öffne die Browser Console in opcode und führe aus:

```javascript
// Test 1: Ist getUserMedia verfügbar?
console.log('mediaDevices:', navigator.mediaDevices);
console.log('getUserMedia:', navigator.mediaDevices.getUserMedia);

// Test 2: Versuche Mikrofon-Zugriff
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('SUCCESS! Stream:', stream);
    console.log('Tracks:', stream.getTracks());
    stream.getTracks().forEach(track => track.stop());
  })
  .catch(err => {
    console.error('FAILED:', err.name, err.message);
  });

// Test 3: Enumerate devices
navigator.mediaDevices.enumerateDevices()
  .then(devices => {
    console.log('All devices:', devices);
    devices.forEach(d => console.log(d.kind, d.label, d.deviceId));
  });
```

**Sende mir die Ausgabe!**

### Test 2: Einfaches HTML-File testen

Erstelle `test-mic.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Mic Test</title></head>
<body>
  <button onclick="testMic()">Test Microphone</button>
  <div id="result"></div>

  <script>
    async function testMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        document.getElementById('result').innerText = 'SUCCESS! Microphone works!';
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        document.getElementById('result').innerText = 'ERROR: ' + err.name + ' - ' + err.message;
      }
    }
  </script>
</body>
</html>
```

Öffne in **normalem Browser** (Firefox/Chrome) und teste.

## Workaround-Optionen

### Option 1: Native Audio Capture (Rust)

Statt WebView-MediaRecorder → Native Rust Audio Capture mit `cpal`:

**Pro:**
- Umgeht WebKitGTK-Limitierungen
- Direkter System-Zugriff
- Bessere Kontrolle

**Contra:**
- Komplexer zu implementieren
- Platform-spezifischer Code

### Option 2: sox/arecord als Subprocess

Einfacher Workaround:

```bash
# Backend spawnt sox command
arecord -f S16_LE -r 16000 -c 1 -d 10 output.wav
```

**Pro:**
- Sehr einfach
- Funktioniert überall

**Contra:**
- Externe Dependency
- Weniger Kontrolle

### Option 3: WebRTC getUserMedia Polyfill

Versuche ein getUserMedia-Polyfill für ältere WebKit-Versionen.

## Nächste Schritte

1. **Führe Schritt 1-3 aus** und sende mir die Console-Logs
2. **Führe Test 1 aus** (getUserMedia in Console)
3. **Teste Test 2** (HTML-File im normalen Browser)

Dann entscheiden wir:
- Ist es ein WebKitGTK-Bug → Workaround nötig
- Ist es ein Permission-Problem → System-Config
- Ist es ein CSP/Security-Problem → Weitere Tauri-Config

---

**Bitte sende mir:**
1. Console-Logs vom Mikrofon-Click
2. Ausgabe von `navigator.mediaDevices.getUserMedia({ audio: true })`
3. WebKitGTK Version: `dpkg -l | grep webkit`
4. Gnome Version: `gnome-shell --version`
