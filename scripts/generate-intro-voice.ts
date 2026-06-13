// Офлайн-генерация закадровой озвучки интро-заставки (Фаза 6D). Запуск:
//   ELEVENLABS_API_KEY=... npx vite-node scripts/generate-intro-voice.ts
//
// Берёт утверждённые реплики (src/cinematic/voiceLines.ts), синтезирует каждую через
// ElevenLabs TTS (eleven_multilingual_v2), кладёт mp3 в
// public/assets/audio/voice/intro/<id>.mp3 и пишет длительности в
// src/cinematic/voiceManifest.json ({ id: { src, durationSec } }). Запускается РУКАМИ
// один раз (или при правке текстов) — в рантайме игры к ElevenLabs не ходим (ключ в
// клиенте + латентность запрещены спекой). vite-node нужен, чтобы импортировать .ts.
//
// Без ключа — понятная ошибка и выход (ключ в .env/.gitignore, в git не попадает).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_LINES } from '../src/cinematic/voiceLines';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'voice', 'intro');
const MANIFEST_PATH = path.join(ROOT, 'src', 'cinematic', 'voiceManifest.json');
/** Путь клипа от корня сайта (как его грузит IntroVoice через fetch). */
const SRC_PREFIX = '/assets/audio/voice/intro';

// Голос выбран игроком на слух (2026-06-12) из трёх кандидатов: «George» —
// тёплый бархатный баритон, классический сказочный рассказчик. Читает русский
// текст через eleven_multilingual_v2. id — публичный пресет библиотеки ElevenLabs.
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // «George», утверждён игроком
const MODEL_ID = 'eleven_multilingual_v2';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * Длительность MP3 в секундах из сырых байтов: суммируем длительности всех
 * фреймов по их заголовкам (CBR/VBR — точнее, чем bitrate·size). Без внешних
 * зависимостей (в проекте нет ffmpeg/аудио-либ). Парсер минимальный, но покрывает
 * MPEG-1/2 Layer III, который и отдаёт ElevenLabs.
 */
function mp3DurationSec(buf: Buffer): number {
  // Таблицы битрейта (кбит/с) и частот для MPEG Layer III.
  const BITRATE: Record<number, number[]> = {
    // MPEG-1 Layer III
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    // MPEG-2/2.5 Layer III
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  };
  const SAMPLE_RATE: Record<number, number[]> = {
    1: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    25: [11025, 12000, 8000], // MPEG-2.5
  };

  let i = 0;
  let duration = 0;
  // Пропустить ID3v2-тег, если есть ("ID3" + 6 байт, size — синхросейф).
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    i = 10 + size;
  }

  while (i + 4 <= buf.length) {
    // Синхрослово фрейма: 11 бит единиц (0xFFE...).
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const b1 = buf[i + 1]!;
    const b2 = buf[i + 2]!;
    const versionBits = (b1 >> 3) & 0x03; // 00=2.5, 10=2, 11=1
    const layerBits = (b1 >> 1) & 0x03; // 01 = Layer III
    if (layerBits !== 0x01) {
      i++;
      continue;
    }
    const verKey = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 25;
    const brKey = verKey === 1 ? 1 : 2;
    const bitrate = BITRATE[brKey]![(b2 >> 4) & 0x0f]!;
    const sampleRate = SAMPLE_RATE[verKey]![(b2 >> 2) & 0x03]!;
    if (!bitrate || !sampleRate) {
      i++;
      continue;
    }
    const padding = (b2 >> 1) & 0x01;
    // Samples/frame: MPEG-1 = 1152, MPEG-2/2.5 = 576.
    const samplesPerFrame = verKey === 1 ? 1152 : 576;
    const frameBytes = Math.floor(((samplesPerFrame / 8) * bitrate * 1000) / sampleRate) + padding;
    if (frameBytes <= 0) {
      i++;
      continue;
    }
    duration += samplesPerFrame / sampleRate;
    i += frameBytes;
  }
  return duration;
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Нет ELEVENLABS_API_KEY в env. Положи ключ в .env (он в .gitignore) и повтори:');
    console.error('  ELEVENLABS_API_KEY=sk_... npx vite-node scripts/generate-intro-voice.ts');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Record<string, { src: string; durationSec: number }> = {};

  for (const [id, text] of Object.entries(VOICE_LINES)) {
    process.stdout.write(`Генерирую реплику «${id}»… `);
    const res = await fetch(`${API_BASE}/${VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        // Спокойный сказочный тон: высокая стабильность, лёгкая выразительность.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.25 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`\nОшибка ElevenLabs для «${id}»: ${res.status} ${res.statusText}\n${body}`);
      process.exit(1);
    }
    const mp3 = Buffer.from(await res.arrayBuffer());
    const outFile = path.join(OUT_DIR, `${id}.mp3`);
    fs.writeFileSync(outFile, mp3);
    const durationSec = Math.round(mp3DurationSec(mp3) * 100) / 100;
    manifest[id] = { src: `${SRC_PREFIX}/${id}.mp3`, durationSec };
    console.log(`ок (${(mp3.length / 1024).toFixed(0)} КБ, ${durationSec.toFixed(2)} с)`);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nГотово: ${Object.keys(manifest).length} реплик → ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`Манифест обновлён → ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log('Проверь длительности: реплика каждой сцены должна быть ≤ длины сцены (см. SCENES).');
}

void main();
