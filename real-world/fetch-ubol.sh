#!/usr/bin/env bash
# Downloads the latest uBlock Origin Lite (MV3, Chromium build) release into real-world/.ext/ubol
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/.ext"
mkdir -p "$DIR"
URL="$(curl -s https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).assets.find(a=>/chromium\.zip$/.test(a.name));console.log(a.browser_download_url)})')"
curl -sL "$URL" -o "$DIR/ubol.zip"
rm -rf "$DIR/ubol" && mkdir -p "$DIR/ubol" && unzip -q -o "$DIR/ubol.zip" -d "$DIR/ubol"
echo "uBOL extracted to $DIR/ubol from $URL"
