/**
 * Пробник player-клиентов: показывает, какой клиент отдаёт ссылки с этого IP.
 *
 * Запуск в контейнере:
 *   docker compose -f deploy/docker-compose.yml exec server \
 *     node apps/server/dist/debug-yt.js dQw4w9WgXcQ
 */

import Innertube from 'youtubei.js';
import { KNOWN_PLAYER_CLIENTS, playerClients, resolveFormatUrls } from './yt.js';

const videoId = process.argv[2] ?? 'dQw4w9WgXcQ';

type CipherFormat = {
  itag?: number;
  url?: string;
  signature_cipher?: string;
  height?: number;
  has_video?: boolean;
  decipher?: (player?: unknown) => Promise<string>;
};

type DecipherPlayer = {
  decipher: (
    url?: string,
    signatureCipher?: string,
    cipher?: string,
    cache?: Map<string, string>,
  ) => Promise<string>;
};

async function probe(yt: Innertube, player: DecipherPlayer | undefined, client: string) {
  const started = Date.now();
  try {
    const info = await yt.getBasicInfo(videoId, { client: client as never });
    const streaming = (
      info as unknown as {
        streaming_data?: { adaptive_formats?: CipherFormat[]; formats?: CipherFormat[] };
        playability_status?: { status?: string; reason?: string };
      }
    ).streaming_data;
    const formats = [...(streaming?.adaptive_formats ?? []), ...(streaming?.formats ?? [])];
    const deciphered = await resolveFormatUrls({ streaming_data: streaming }, player as never);
    const withUrl = formats.filter((f) => !!f.url);
    const video = withUrl.filter((f) => f.has_video !== false);
    const best = video.reduce((max, f) => Math.max(max, f.height ?? 0), 0);
    const status = (info as { playability_status?: { status?: string; reason?: string } })
      .playability_status;

    console.log(
      `${client.padEnd(13)} ${(status?.status ?? '?').padEnd(18)} ` +
        `ссылок: ${String(withUrl.length).padStart(2)}/${String(formats.length).padEnd(2)} ` +
        `видео: ${String(video.length).padStart(2)} макс: ${String(best || '—').padStart(4)}p ` +
        `расшифровано: ${String(deciphered).padStart(2)} ` +
        `(${Date.now() - started}ms)${status?.reason ? ` — ${status.reason}` : ''}`,
    );
  } catch (err) {
    console.log(`${client.padEnd(13)} ОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log(`Видео: ${videoId}`);
  console.log(`Клиенты по умолчанию: ${playerClients().join(', ')}`);
  console.log('');

  const yt = await Innertube.create({ retrieve_player: true });
  const player = (yt.session as unknown as { player?: DecipherPlayer }).player;
  if (!player) console.log('ВНИМАНИЕ: JS player не загрузился — расшифровка невозможна\n');

  const clients = ['WEB', ...KNOWN_PLAYER_CLIENTS];
  for (const client of clients) {
    await probe(yt, player, client);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
