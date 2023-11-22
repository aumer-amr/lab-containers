FROM golang:1.21-alpine as go-build
WORKDIR /
COPY . ./

RUN apk add \
    build-base \
    git \
&&  go build -ldflags="-s -w"

FROM debian:bookworm-slim
ENV GIN_MODE=release

COPY deb/veracrypt-console-1.25.9-Debian-12-amd64.deb /opt/veracrypt.deb
COPY deb/VeraCrypt_PGP_public_key.asc /opt/veracrypt.sig

RUN apt-get update --no-install-recommends && \
    apt-get autoclean && \
    apt-get install gnupg --yes

RUN gpg --dearmor /opt/veracrypt.sig && \
    apt-key add /opt/veracrypt.sig && \
    apt install /opt/veracrypt.deb --yes

WORKDIR /usr/local/bin
RUN apt update && apt install -y curl unzip libsecret-1-0 jq
RUN export VER=$(curl -H "Accept: application/vnd.github+json" https://api.github.com/repos/bitwarden/clients/releases | jq  -r 'sort_by(.published_at) | reverse | .[].name | select( index("CLI") )' | sed 's:.*CLI v::' | head -n 1) && \
curl -LO "https://github.com/bitwarden/clients/releases/download/cli-v{$VER}/bw-linux-{$VER}.zip" \
&& unzip *.zip && chmod +x ./bw && rm *.zip

COPY --from=go-build /bitwarden-backup /usr/local/bin

RUN chmod +x /usr/local/bin/bitwarden-backup

CMD ["/usr/local/bin/bitwarden-backup"]
