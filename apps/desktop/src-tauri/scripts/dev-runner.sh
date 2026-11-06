#!/bin/sh
# Cargo's runner on macOS (see ../.cargo/config.toml), so `pnpm dev` launches through it.
#
# Signs the dev build with a Developer ID under the release identifier before launching it,
# so macOS takes it for the same app as the release build: both then use the same keychain
# entry for the church device token, and rebuilding does not make the keychain ask again.
# When there is no Developer ID on this computer, or WORSHIPQ_DEV_SIGNING=0, the build runs
# unsigned and keeps its secrets in a file instead (see src/keychain.rs).
#
# WORSHIPQ_DEV_SIGNING_IDENTITY picks the identity when there are several.

bin="$1"

if [ "$(basename "$bin")" = "worship-q" ] && [ "${WORSHIPQ_DEV_SIGNING:-1}" != "0" ]; then
  identity="${WORSHIPQ_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning |
    sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)}"
  if [ -z "$identity" ]; then
    echo "dev-runner: no Developer ID found; the church device token is kept in a file." >&2
  elif out=$(codesign --force --sign "$identity" --identifier com.worship-q.desktop \
    --timestamp=none "$bin" 2>&1); then
    export WORSHIPQ_SYSTEM_KEYCHAIN=1
  else
    echo "dev-runner: signing failed; the church device token is kept in a file." >&2
    echo "$out" >&2
  fi
fi

exec "$@"
