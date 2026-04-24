// Generates one mp3 per entry in audio/texts.json, using OpenAI TTS.
// Idempotent: skips any file that already exists, so re-running after a
// content tweak only costs the delta.
//
// Usage:
//   export OPENAI_API_KEY=sk-...
//   npm run generate-audio
//
// Optional:
//   VOICE_EN=fable  VOICE_DE=nova  MODEL=tts-1-hd  npm run generate-audio
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = resolve(__dirname, '..', 'audio');
const TEXTS_FILE = resolve(AUDIO_DIR, 'texts.json');
const MANIFEST_FILE = resolve(AUDIO_DIR, 'manifest.json');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY env var. Get one from https://platform.openai.com/api-keys');
  console.error('Then: export OPENAI_API_KEY=sk-... && npm run generate-audio');
  process.exit(1);
}

// Nova is a warm, friendly voice that works across English and German.
// Swap via env vars if you want to experiment with different voices per lang.
const VOICE = { en: process.env.VOICE_EN || 'nova', de: process.env.VOICE_DE || 'nova' };
const MODEL = process.env.MODEL || 'tts-1-hd';
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

async function generateOne(entry) {
  const outFile = join(AUDIO_DIR, `${entry.id}.mp3`);
  if (existsSync(outFile) && statSync(outFile).size > 0) {
    return { entry, outFile, cached: true };
  }
  const voice = VOICE[entry.lang] || 'nova';
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      voice,
      input: entry.text,
      // Opus would be smaller but isn't well-supported in older Safari.
      // mp3 is universal and the quality difference is minor for spoken word.
      response_format: 'mp3',
      speed: 1.0
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS ${res.status} for ${entry.id}: ${body}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outFile, buf);
  return { entry, outFile, cached: false, bytes: buf.length };
}

async function runWithConcurrency(items, worker, limit) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        const r = await worker(items[i]);
        results[i] = r;
        process.stdout.write(r.cached ? '.' : '+');
      } catch (e) {
        results[i] = { entry: items[i], error: e.message };
        process.stdout.write('x');
      }
    }
  });
  await Promise.all(runners);
  return results;
}

(async () => {
  if (!existsSync(TEXTS_FILE)) {
    console.error(`Missing ${TEXTS_FILE} — run \`npm run extract-audio\` first.`);
    process.exit(1);
  }
  if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });
  const { texts } = JSON.parse(readFileSync(TEXTS_FILE, 'utf8'));
  console.log(`Generating up to ${texts.length} clips · model=${MODEL} · concurrency=${CONCURRENCY}`);
  console.log(`  '+' = new, '.' = cached, 'x' = error`);

  const t0 = Date.now();
  const results = await runWithConcurrency(texts, generateOne, CONCURRENCY);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();

  const newOnes = results.filter(r => r && !r.cached && !r.error).length;
  const cachedOnes = results.filter(r => r && r.cached).length;
  const errors = results.filter(r => r && r.error);
  const totalBytes = results.reduce((s, r) => s + (r && r.bytes || 0), 0);

  // Build a language-partitioned manifest the client can fetch once on boot.
  const manifest = { en: {}, de: {} };
  for (const entry of texts) {
    manifest[entry.lang][entry.id] = `audio/${entry.id}.mp3`;
  }
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  console.log(`Done in ${secs}s — ${newOnes} new, ${cachedOnes} cached, ${errors.length} failed`);
  if (newOnes) console.log(`New audio size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Manifest: ${MANIFEST_FILE}`);
  if (errors.length) {
    console.log(`\nFailures:`);
    errors.slice(0, 20).forEach(e => console.log(`  ${e.entry.id} (${e.entry.lang}): ${e.error}`));
  }
})();
