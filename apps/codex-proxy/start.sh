#!/bin/sh
set -eu
umask 077

mkdir -p "$CODEX_HOME"
if [ ! -e "$CODEX_HOME/config.toml" ]; then
    cp /etc/codex-proxy/codex.toml "$CODEX_HOME/config.toml"
fi

exec "$@"
