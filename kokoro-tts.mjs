// JARVIS — optional Kokoro voice helper.
// Started by server.mjs when a Kokoro voice is chosen in Settings. It loads the Kokoro speech model once,
// then turns each line of JSON it is given on stdin into a WAV file:
//   in:  {"id": 1, "gen": 0, "text": "Good morning.", "voice": "bm_george", "speed": 1, "out": "/path/1.wav"}
//   in:  {"flush": 3}            forget every request made before generation 3 (the user said stop)
//   out: {"ready": true} once, then {"id": 1, "ok": true} or {"id": 1, "error": "…"} per request
// Kokoro itself (the kokoro-js package and the model) lives outside the app, in the folder named by the
// first argument: see setup-kokoro.sh. Run with "--download" as second argument to fetch the model once;
// otherwise this never touches the network.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const DIR = process.argv[2];
const DOWNLOAD = process.argv[3] === '--download';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// fp32 is the full-size model. The smaller quantized ones are slower than real time on Intel Macs.
const DTYPE = 'fp32';

const reply = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const require = createRequire(path.join(DIR, 'package.json'));

let tts;
try {
  const { env } = require('@huggingface/transformers');
  env.cacheDir = path.join(DIR, 'models');
  env.allowRemoteModels = DOWNLOAD;
  const { KokoroTTS } = require('kokoro-js');
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });
  await tts.generate('Ready.', { voice: 'bm_george' }); // warm up, so the first real sentence is not slow
} catch (err) {
  reply({ error: String(err && err.message || err) });
  process.exit(1);
}
// Leave by signal rather than process.exit: the speech engine's threads crash noisily on a normal exit.
const leave = () => process.kill(process.pid, 'SIGTERM');
if (DOWNLOAD) { console.log('Kokoro is ready.'); leave(); }

// 16-bit mono WAV from float samples
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

// Kokoro handles a sentence or two at a time, so longer text is spoken piece by piece and joined.
function pieces(text) {
  const out = [];
  for (const s of text.match(/[^.!?…\n]+[.!?…]*\s*/g) || [text]) {
    const last = out[out.length - 1];
    if (last && (last + s).length < 220) out[out.length - 1] = last + s; else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

let minGen = 0;
const queue = [];
let working = false;
async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    if (job.gen < minGen) { reply({ id: job.id, error: 'cancelled' }); continue; }
    try {
      const parts = [];
      let rate = 24000;
      for (const p of pieces(job.text)) {
        if (job.gen < minGen) break;
        const audio = await tts.generate(p, { voice: job.voice, speed: job.speed || 1 });
        rate = audio.sampling_rate;
        parts.push(audio.audio);
      }
      if (job.gen < minGen) { reply({ id: job.id, error: 'cancelled' }); continue; }
      const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      fs.writeFileSync(job.out, wav(all, rate));
      reply({ id: job.id, ok: true });
    } catch (err) {
      reply({ id: job.id, error: String(err && err.message || err) });
    }
  }
  working = false;
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (typeof msg.flush === 'number') { minGen = msg.flush; return; }
  if (typeof msg.text !== 'string' || typeof msg.out !== 'string') return;
  queue.push(msg);
  work();
}).on('close', leave);   // the server went away

reply({ ready: true });
