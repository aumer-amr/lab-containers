FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26.5-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY migrations/ ./migrations/
COPY --from=web /src/web/dist ./web/embed/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /tacmap .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10001 tacmap && adduser -D -H -u 10001 -G tacmap tacmap && mkdir /data /maps && chown tacmap:tacmap /data /maps
COPY --from=backend /tacmap /usr/local/bin/tacmap
USER tacmap
EXPOSE 8080
VOLUME ["/data", "/maps", "/tmp"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/tacmap"]
