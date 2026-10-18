# syntax=docker/dockerfile:1
FROM ghcr.io/getpaseo/paseo:0.11.4@sha256:0e64b56fa1f99808623f4de70321cdd292e85b6db151636c13b0e6786b0e1ba5

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libatomic1 python3 python3-yaml ripgrep unzip xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.163.0 \
    && npm cache clean --force

RUN curl -fsSL https://github.com/jdx/mise/releases/download/v2026.10.10/mise-v2026.10.10-linux-x64.tar.xz -o /tmp/mise.tar.xz \
    && echo '4a9f0f5708c1eeaf91813b02a0749cfffcb9aeb5605fa4d8758c37221984725f  /tmp/mise.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/mise.tar.xz -C /tmp \
    && install /tmp/mise/bin/mise /usr/local/bin/mise \
    && rm -rf /tmp/mise /tmp/mise.tar.xz

ENV MISE_DATA_DIR=/opt/mise
ENV MISE_GLOBAL_CONFIG_FILE=/opt/lab-tools/mise.toml
ENV PATH=/opt/mise/shims:/usr/local/bin:/usr/bin:/bin
COPY mise.toml /opt/lab-tools/mise.toml
RUN cd /opt/lab-tools && mise trust && mise install && mise reshim \
    && codex --version && kubectl version --client && flux --version && kustomize version \
    && sops --version && oxfmt --version

COPY skills /opt/paseo-skills
COPY start.sh /usr/local/bin/paseo-start
RUN chmod 0755 /usr/local/bin/paseo-start

USER 1000:1000
CMD ["/usr/local/bin/paseo-start"]
