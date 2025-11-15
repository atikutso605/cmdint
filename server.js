// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STREAM_KEY = process.env.STREAM_KEY || ''; // set this in Replit Secrets

if (!STREAM_KEY) {
  console.warn('Warning: STREAM_KEY is empty. Set STREAM_KEY in environment (Replit Secrets).');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Single-client logic: we accept one active ffmpeg piping session at a time.
// If multiple browsers connect, we'll create separate ffmpeg processes per connection.
wss.on('connection', function connection(ws, req) {
  console.log('Browser connected for streaming');

  // Build RTMP destination (YouTube)
  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}`;

  // FFmpeg arguments to accept WebM/Matroska input via stdin and push to RTMP
  const ffmpegArgs = [
    // Input from stdin, webm demuxer:
    '-i', 'pipe:0',
    // Video codec
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-b:v', '3500k',
    '-maxrate', '3500k',
    '-bufsize', '7000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    // Audio codec
    '-c:a', 'aac',
    '-ar', '44100',
    '-b:a', '128k',
    // Output format
    '-f', 'flv',
    rtmpUrl
  ];

  console.log('Spawning ffmpeg:', ffmpegPath, ffmpegArgs.join(' '));
  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'inherit', 'pipe'] });

  ffmpeg.on('close', (code, sig) => {
    console.log(`FFmpeg exited (code: ${code}, signal: ${sig})`);
  });

  ffmpeg.stderr.on('data', (chunk) => {
    // keep FFmpeg logs for debugging
    console.log('ffmpeg:', chunk.toString());
  });

  ws.on('message', (message) => {
    // Binary frames from browser are ArrayBuffer or Buffer — write raw to ffmpeg stdin
    if (Buffer.isBuffer(message)) {
      ffmpeg.stdin.write(message);
    } else if (message instanceof ArrayBuffer) {
      ffmpeg.stdin.write(Buffer.from(message));
    } else if (typeof message === 'string') {
      // allow text messages for control or debug
      console.log('Text message from client:', message);
      if (message === '__stop__') {
        try { ffmpeg.stdin.end(); } catch(e) {}
      }
    }
  });

  ws.on('close', () => {
    console.log('Browser disconnected. Closing ffmpeg stdin.');
    try { ffmpeg.stdin.end(); } catch(e) {}
  });

  ws.on('error', (err) => {
    console.log('WebSocket error:', err);
    try { ffmpeg.stdin.end(); } catch(e) {}
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open the web client at: http://localhost:${PORT}/ (or use Replit webview)`);
});
