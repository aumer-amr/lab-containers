# syntax=docker/dockerfile:1
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build

# Upstream v0.4.8, pinned to its commit and archive checksum.
ADD --checksum=sha256:9334b594a50fd8e25110054fbd5710dd1b1db3f7922591814d7628862432099a \
    https://codeload.github.com/mehdic/codex-proxy/tar.gz/bb1683d1ed680dab4bae645bb9a0dc3cd49e065d /tmp/source.tar.gz
WORKDIR /opt/codex-proxy
# Patch vulnerable transitive dependencies in the upstream lock.
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 \
    && rm /tmp/source.tar.gz \
    && npm pkg set overrides.body-parser=1.20.9 overrides.proxy-addr=2.0.8 overrides.qs=6.16.1 \
    && npm install --ignore-scripts --no-audit --no-fund \
    && npm test \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.163.0 \
    && npm cache clean --force \
    && codex --version \
    && mkdir -p /home/node/.codex /workspace \
    && chown 1000:1000 /home/node/.codex /workspace

COPY --from=build /opt/codex-proxy/dist /opt/codex-proxy/dist
COPY --from=build /opt/codex-proxy/node_modules /opt/codex-proxy/node_modules
COPY --from=build /opt/codex-proxy/package.json /opt/codex-proxy/LICENSE /opt/codex-proxy/
COPY codex.toml /etc/codex-proxy/codex.toml
COPY --chmod=0555 start.sh /usr/local/bin/codex-proxy-start

ENV HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    CODEX_PROXY_HOST=0.0.0.0 \
    CODEX_PROXY_PORT=3466 \
    CODEX_PROXY_INIT_POOL=0 \
    CODEX_PROXY_SANDBOX=read-only \
    CODEX_PROXY_APPROVAL_POLICY=never
USER 1000:1000
WORKDIR /workspace
EXPOSE 3466
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/codex-proxy-start"]
CMD ["node", "/opt/codex-proxy/dist/server/standalone.js"]
