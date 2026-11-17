#!/bin/sh
# Prepares a Linux machine (Ubuntu) to render the screenshots: the Inter font, set to stand in
# for the fonts the app asks for (fonts.conf), and Playwright's Chromium with its libraries.
# Run from the repository root after `pnpm install`.
set -eu
SUDO=$(command -v sudo || true)
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq fonts-inter >/dev/null
mkdir -p "$HOME/.config/fontconfig"
cp "$(dirname "$0")/fonts.conf" "$HOME/.config/fontconfig/fonts.conf"
fc-cache -f >/dev/null
pnpm --filter @worship-q/screenshots exec playwright install --with-deps chromium
