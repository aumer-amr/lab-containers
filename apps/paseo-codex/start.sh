#!/usr/bin/env bash
set -euo pipefail
umask 077

# Fail closed even if the secret exists with an empty password.
: "${PASEO_PASSWORD:?PASEO_PASSWORD must be non-empty}"
: "${LITELLM_API_KEY:?LITELLM_API_KEY must be non-empty}"
: "${MEMINI_API_KEY:?MEMINI_API_KEY must be non-empty}"
mkdir -p "$CODEX_HOME" "$PASEO_HOME" "$HOME/.agents/skills"
install -m 600 /etc/paseo/codex.toml "$CODEX_HOME/config.toml"
install -m 600 /etc/paseo/paseo.json "$PASEO_HOME/config.json"
cp -R /opt/paseo-skills/. "$HOME/.agents/skills/"

# Keep the packaged supervisor and entrypoint behavior, running as uid 1000.
exec /usr/local/bin/paseo-docker-entrypoint
