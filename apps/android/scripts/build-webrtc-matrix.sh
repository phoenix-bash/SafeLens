#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/build-webrtc-matrix.sh [1.0.40793 1.0.43591 1.0.45036]

if [[ "$#" -gt 0 ]]; then
  versions=("$@")
else
  versions=("1.0.40793" "1.0.42469" "1.0.43591" "1.0.44992" "1.0.45036")
fi

output_dir="app/build/outputs/webrtc-matrix"
mkdir -p "$output_dir"
results_file="$output_dir/results.csv"

echo "version,coordinate,build_status,apk_path" > "$results_file"

for version in "${versions[@]}"; do
  coordinate="com.infobip:google-webrtc:${version}"
  label="${version//[^0-9A-Za-z._-]/_}"
  apk_target="$output_dir/app-debug-${label}.apk"

  echo "=== Building ${coordinate} ==="
  if ./gradlew :app:assembleDebug -PSAFELENS_WEBRTC_COORDINATE="$coordinate"; then
    cp app/build/outputs/apk/debug/app-debug.apk "$apk_target"
    echo "${version},${coordinate},ok,${apk_target}" >> "$results_file"
  else
    echo "${version},${coordinate},failed," >> "$results_file"
  fi
done

echo "Saved matrix build results: $results_file"
