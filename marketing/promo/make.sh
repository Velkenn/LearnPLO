#!/bin/sh
# Renders the FeltReady promo to out/FeltReady-promo.mp4 (1080×1920, 30 fps, about 33 s).
# Needs: node with playwright, python3 with numpy and scipy, and ffmpeg.
# Rendering every frame takes about 10 minutes; see render.mjs for re-rendering one scene.
set -e
cd "$(dirname "$0")"
[ "$1" = "--audio-only" ] || node render.mjs
python3 audio.py out/frames/events.json out/track.wav
ffmpeg -loglevel error -y -framerate 30 -i out/frames/%05d.png -i out/track.wav \
  -filter_complex "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]" -map 0:v -map "[a]" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest out/FeltReady-promo.mp4
echo "made out/FeltReady-promo.mp4"
