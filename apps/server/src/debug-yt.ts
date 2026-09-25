import Innertube from 'youtubei.js';

async function main() {
  const yt = await Innertube.create();
  const info = await yt.getInfo('8tS8vw3TqzI');
  const af = info.streaming_data?.adaptive_formats ?? [];
  const f = af[0];
  console.log('playability:', info.playability_status?.status, info.playability_status?.reason ?? '');
  console.log('playerConfig present:', !!info.player_config, '| playableInEmbed:', info.playability_status?.embeddable);
  console.log('--- url/cipher/signature_cipher values ---');
  console.log('url:', JSON.stringify(f.url));
  console.log('cipher:', f.cipher ? f.cipher.slice(0, 150) : JSON.stringify(f.cipher));
  console.log('signature_cipher:', f.signature_cipher ? f.signature_cipher.slice(0, 150) : JSON.stringify(f.signature_cipher));
  console.log('drm_families:', f.drm_families);
  // где хранится ссылка? в raw data
  const raw = f as unknown as { raw?: unknown };
  console.log('own enumerable keys:', Object.keys(f));
}

main().catch((e) => { console.error(e); process.exit(1); });