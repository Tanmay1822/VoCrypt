import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: 'https://vocrypt-1.onrender.com' }));
app.use(express.json());

// Serve built client if present (for container deploy)
const distDir = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

const upload = multer({ storage: multer.memoryStorage() });

// --- CORRECTED PATHS ---
// This now correctly and cleanly uses only the environment variables from your Dockerfile.
const BIN_DIR = process.env.GGWAVE_BIN_DIR;
const TO_FILE = path.join(BIN_DIR, 'ggwave-to-file');
const FROM_FILE = path.join(BIN_DIR, 'ggwave-from-file');
const CLI_BIN = process.env.GGWAVE_CLI;

function ensureBinaryExists(filePath) {
  // Gracefully handle cases where filePath might be undefined if env vars are missing
  if (!filePath) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, toFile: ensureBinaryExists(TO_FILE), fromFile: ensureBinaryExists(FROM_FILE), cli: ensureBinaryExists(CLI_BIN) });
});

// Encode a text into WAV. Body: { message, volume?, sampleRate?, protocol? }
app.post('/encode', async (req, res) => {
  const message = `${req.body?.message ?? ''}`;
  if (!message) return res.status(400).json({ error: 'message is required' });

  if (!ensureBinaryExists(TO_FILE)) {
    return res.status(500).json({ error: 'ggwave-to-file binary not found or not configured.' });
  }

  // Create temp wav path
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggwave-'));
  const wavPath = path.join(tmpDir, 'out.wav');

  const args = [`-f${wavPath}`];
  if (req.body?.volume) args.push(`-v${req.body.volume}`);
  if (req.body?.sampleRate) args.push(`-s${req.body.sampleRate}`);
  if (req.body?.protocol) args.push(`-p${req.body.protocol}`);

  const child = spawn(TO_FILE, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let responded = false;
  const safe = (fn) => { if (!responded) { responded = true; fn(); } };
  child.stderr.on('data', d => { stderr += d.toString(); });
  child.on('error', err => {
    safe(() => res.status(500).json({ error: err.message }));
    try { child.kill('SIGKILL'); } catch {}
  });
  child.on('close', code => {
    if (responded) return;
    if (code !== 0) {
      return safe(() => res.status(500).json({ error: 'encode failed', details: stderr }));
    }
    try {
      const data = fs.readFileSync(wavPath);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', 'inline; filename="message.wav"');
      safe(() => res.send(data));
    } catch (e) {
      safe(() => res.status(500).json({ error: 'read wav failed', details: e.message }));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
  child.stdin.end(message);
});

// Decode a provided WAV file (multipart form field: file)
app.post('/decode', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required (audio/wav)' });

  if (!ensureBinaryExists(FROM_FILE)) {
    return res.status(500).json({ error: 'ggwave-from-file binary not found or not configured.' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggwave-'));
  const wavPath = path.join(tmpDir, 'in.wav');
  fs.writeFileSync(wavPath, req.file.buffer);

  let responded = false; const safe = (fn) => { if (!responded) { responded = true; fn(); } };
  execFile(FROM_FILE, [wavPath], (error, stdout, stderr) => {
    try {
      if (error) return safe(() => res.status(500).json({ error: error.message, stderr }));
      const m = stdout.match(/Decoded message[^:]*:\s*'([^']*)'/);
      const message = m ? m[1] : '';
      safe(() => res.json({ message, raw: stdout }));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});

// Decode a WEBM/Opus mic chunk: convert to WAV with ffmpeg, then decode
app.post('/decode-webm', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required (audio/webm)' });
  if (!ensureBinaryExists(FROM_FILE)) {
    return res.status(500).json({ error: 'ggwave-from-file binary not found or not configured.' });
  }

  const ffmpeg = 'ffmpeg';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggwave-'));
  const webmPath = path.join(tmpDir, 'in.webm');
  const wavPath = path.join(tmpDir, 'in.wav');
  fs.writeFileSync(webmPath, req.file.buffer);

  const ff = spawn(ffmpeg, ['-y', '-v', 'error', '-i', webmPath, '-ar', '48000', '-ac', '1', '-f', 'wav', wavPath]);
  let ffErr = '';
  let responded = false; const safe = (fn) => { if (!responded) { responded = true; fn(); } };
  ff.stderr.on('data', d => { ffErr += d.toString(); });
  ff.on('error', err => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    safe(() => res.status(500).json({ error: 'ffmpeg not found or failed', details: err.message }));
  });
  ff.on('close', code => {
    if (code !== 0) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return safe(() => res.status(500).json({ error: 'ffmpeg failed', details: ffErr }));
    }
    execFile(FROM_FILE, [wavPath], (error, stdout, stderr) => {
      try {
        if (error) return safe(() => res.status(200).json({ message: '', raw: stdout }));
        const m = stdout.match(/Decoded message[^:]*:\s*'([^']*)'/);
        const message = m ? m[1] : '';
        safe(() => res.json({ message, raw: stdout }));
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });
  });
});

const PORT = process.env.PORT || 5055;
const server = app.listen(PORT, () => {
  console.log(`ggwave api listening on port ${PORT}`);
});

// WebSocket: spawn ggwave-cli per connection
const wss = new WebSocketServer({ server, path: '/ws/cli' });
wss.on('connection', (ws) => {
  if (!ensureBinaryExists(CLI_BIN)) {
    ws.close(1011, 'ggwave-cli not available');
    return;
  }
  // default to protocol 1 (Fast)
  const cli = spawn(CLI_BIN, ['-t1']);

  const sendLine = (line) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(line));

  cli.stdout.on('data', (d) => {
    const s = d.toString();
    sendLine({ type: 'stdout', data: s });
    // Parse decoded messages from cli output if present
    const m = s.match(/Decoded message[^:]*:\s*'([^']*)'/);
    if (m) sendLine({ type: 'decoded', message: m[1] });
  });
  cli.stderr.on('data', (d) => sendLine({ type: 'stderr', data: d.toString() }));
  cli.on('close', (code) => ws.close(1000, `cli_exit_${code}`));

  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg.type === 'send' && typeof msg.text === 'string') {
        cli.stdin.write(msg.text + '\n');
      }
    } catch {}
  });
  ws.on('close', () => {
    try { cli.kill('SIGKILL'); } catch {}
  });
});

// --- RECOMMENDED: Graceful Shutdown ---
function gracefulShutdown() {
  console.log('Received shutdown signal, shutting down gracefully.');
  server.close(() => {
    console.log('Closed out remaining connections.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', gracefulShutdown); // For Render/Docker
process.on('SIGINT', gracefulShutdown);  // For local Ctrl+C