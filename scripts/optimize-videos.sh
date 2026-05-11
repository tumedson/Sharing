#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# optimize-videos.sh
#
# Re-encodes videos to 720p H.264, 2 Mbps, faststart (moov atom at
# front so browsers can start playing without downloading the whole
# file).  Works on TWO storage locations:
#
#   MODE=local  (default)  — processes files in /var/www/sharing/uploads/
#   MODE=r2                — downloads from R2, re-encodes, re-uploads
#
# Usage:
#   bash /var/www/sharing/scripts/optimize-videos.sh            # local
#   MODE=r2 bash /var/www/sharing/scripts/optimize-videos.sh    # R2
#
# Run in background so SSH disconnect doesn't kill it:
#   nohup bash /var/www/sharing/scripts/optimize-videos.sh > /var/log/optimize-videos.log 2>&1 &
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
UPLOADS_DIR="/var/www/sharing/uploads"
TMP_DIR="/var/www/sharing/uploads/tmp/opt"
LOG_FILE="/var/log/optimize-videos.log"
MODE="${MODE:-local}"

# R2 / S3 settings (only needed when MODE=r2)
S3_BUCKET="moments-edson"
S3_ENDPOINT="https://3075d026bff0ba12553c09d82a3bc1d4.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="55cbd196f7382930df3edc08c595a33f"
export AWS_SECRET_ACCESS_KEY="dd394d4968ca18884d82877491874bce0729ae651d42ba00773d4df9c6c654d0"
export AWS_DEFAULT_REGION="auto"

FFMPEG_OPTS=(
  -c:v libx264
  -preset veryfast
  -crf 23
  -b:v 2M -maxrate 2.5M -bufsize 4M
  -vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
  -r 30 -vsync cfr
  -c:a aac -b:a 128k -ac 2
  -movflags +faststart
  -y
)

VIDEO_EXTS="mp4|mov|m4v|mkv|avi|webm"

mkdir -p "$TMP_DIR"
exec >> "$LOG_FILE" 2>&1

echo ""
echo "════════════════════════════════════════════════════════════"
echo " optimize-videos.sh  |  mode=$MODE  |  $(date)"
echo "════════════════════════════════════════════════════════════"

# ── Encode function ───────────────────────────────────────────────
encode_file() {
  local input="$1"
  local output="$2"
  local name
  name=$(basename "$input")

  echo "[encode] $name"

  # Skip if already small / well-encoded (under 100 MB and under 3 Mbps bitrate)
  local size_bytes
  size_bytes=$(stat -c%s "$input" 2>/dev/null || stat -f%z "$input")
  local duration_s
  duration_s=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$input" 2>/dev/null || echo "0")
  # duration may be empty / 0 on corrupt files
  duration_s=${duration_s:-0}

  if (( $(echo "$duration_s > 0" | bc -l) )); then
    local bitrate_kbps
    bitrate_kbps=$(echo "scale=0; $size_bytes * 8 / $duration_s / 1000" | bc 2>/dev/null || echo "9999")
    if [[ "$bitrate_kbps" -lt 2600 && "$size_bytes" -lt 524288000 ]]; then
      echo "  → already optimized ($bitrate_kbps kbps, $((size_bytes/1024/1024)) MB) — skipping"
      return 0
    fi
  fi

  if ffmpeg -i "$input" "${FFMPEG_OPTS[@]}" "$output" 2>>"$LOG_FILE"; then
    echo "  → done ($(du -sh "$output" | cut -f1))"
    return 0
  else
    echo "  → FAILED — keeping original"
    rm -f "$output"
    return 1
  fi
}

# ── LOCAL mode ────────────────────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  echo "Scanning: $UPLOADS_DIR"
  processed=0
  failed=0

  while IFS= read -r -d '' src_file; do
    tmp_out="$TMP_DIR/$(basename "$src_file").tmp.mp4"

    if encode_file "$src_file" "$tmp_out"; then
      # Replace original only if output is smaller
      orig_size=$(stat -c%s "$src_file" 2>/dev/null || stat -f%z "$src_file")
      new_size=$(stat -c%s "$tmp_out"  2>/dev/null || stat -f%z "$tmp_out")
      if [[ "$new_size" -lt "$orig_size" ]]; then
        mv "$tmp_out" "$src_file"
        echo "  ↳ replaced original (saved $((( orig_size - new_size ) / 1024 / 1024)) MB)"
      else
        echo "  ↳ re-encoded is larger — keeping original"
        rm -f "$tmp_out"
      fi
      (( processed++ )) || true
    else
      (( failed++ )) || true
    fi
  done < <(find "$UPLOADS_DIR" -maxdepth 1 -type f -regextype posix-extended \
            -iregex ".*\.($VIDEO_EXTS)" -print0)

  echo ""
  echo "Done. Processed: $processed | Failed: $failed"
  exit 0
fi

# ── R2 mode ───────────────────────────────────────────────────────
if [[ "$MODE" == "r2" ]]; then
  echo "Listing R2 bucket: s3://$S3_BUCKET"
  processed=0
  failed=0

  while IFS= read -r object_key; do
    [[ -z "$object_key" ]] && continue

    ext="${object_key##*.}"
    if ! echo "$ext" | grep -qiE "^($VIDEO_EXTS)$"; then
      continue
    fi

    local_src="$TMP_DIR/$(basename "$object_key")"
    local_out="$TMP_DIR/$(basename "$object_key").opt.mp4"

    echo ""
    echo "[r2] $object_key"

    # Download
    if ! aws s3 cp "s3://$S3_BUCKET/$object_key" "$local_src" \
          --endpoint-url "$S3_ENDPOINT" --no-progress; then
      echo "  → download FAILED — skipping"
      (( failed++ )) || true
      continue
    fi

    if encode_file "$local_src" "$local_out"; then
      orig_size=$(stat -c%s "$local_src" 2>/dev/null || stat -f%z "$local_src")
      new_size=$(stat -c%s "$local_out"  2>/dev/null || stat -f%z "$local_out")

      if [[ "$new_size" -lt "$orig_size" ]]; then
        # Determine content type (always mp4 after encoding)
        new_key="${object_key%.*}.mp4"
        echo "  ↳ uploading as $new_key"
        aws s3 cp "$local_out" "s3://$S3_BUCKET/$new_key" \
          --endpoint-url "$S3_ENDPOINT" \
          --content-type "video/mp4" \
          --no-progress

        # Remove old key if the name changed
        if [[ "$new_key" != "$object_key" ]]; then
          aws s3 rm "s3://$S3_BUCKET/$object_key" --endpoint-url "$S3_ENDPOINT"
          echo "  ↳ removed old key: $object_key"
        fi
        echo "  ↳ saved $((( orig_size - new_size ) / 1024 / 1024)) MB"
      else
        echo "  ↳ re-encoded is larger — skipping upload"
      fi
      (( processed++ )) || true
    else
      (( failed++ )) || true
    fi

    rm -f "$local_src" "$local_out"
  done < <(aws s3 ls "s3://$S3_BUCKET/" --endpoint-url "$S3_ENDPOINT" --recursive \
           | awk '{print $4}')

  echo ""
  echo "Done. Processed: $processed | Failed: $failed"
  exit 0
fi

echo "Unknown MODE=$MODE. Use 'local' or 'r2'."
exit 1
