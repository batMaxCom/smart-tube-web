#!/usr/bin/env bash
# Генерирует демо-DASH-ассет (video-only, single-file/SegmentList).
# ffmpeg -single_file с несколькими адаптивными наборами пишет одинаковые byte-range
# для аудио (накладываются на видео), поэтому демо — только видеопоток:
# MSE-воспроизведение YT'шного DASH с аудио проверяется по реальному потоку.
set -euo pipefail

OUT_DIR="${1:-$(dirname "$0")/../apps/server/assets/demo}"
mkdir -p "$OUT_DIR"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=8" \
  -c:v libx264 -preset fast -b:v 1500k -pix_fmt yuv420p -profile:v high \
  -an \
  -f dash -seg_duration 2 -use_timeline 1 -single_file 1 -single_file_name media.mp4 \
  "$OUT_DIR/media.mpd"

# ffmpeg single_file не умеет задавать имя init-файла; при single_file=1 он
# встраивает init в media.mp4 и MPD ссылается на него же — диапазоны корректны.

echo "Demo DASH asset generated in $OUT_DIR"
ls -la "$OUT_DIR"