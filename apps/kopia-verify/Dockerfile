# syntax=docker/dockerfile:1
FROM kopia/kopia:0.23.1@sha256:89fd95ee2942880ca00eae964266958a394421ddbdf69bca62e38afc55f5900e

RUN apt-get update && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /scratch && chown 65532:65532 /scratch

COPY --chmod=0555 verify.sh /usr/local/bin/kopia-verify
ENV HOME=/scratch \
    USER=kopia-verify \
    TMPDIR=/scratch/tmp \
    KOPIA_CONFIG_PATH=/scratch/repository.config \
    KOPIA_CACHE_DIRECTORY=/scratch/cache \
    KOPIA_LOG_DIR=/scratch/logs \
    GOMEMLIMIT=768MiB \
    GOMAXPROCS=1
USER 65532:65532
WORKDIR /scratch
ENTRYPOINT ["/usr/local/bin/kopia-verify"]
