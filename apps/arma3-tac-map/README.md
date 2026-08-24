# Arma 3 Tactical Map

Single-instance collaborative tactical-map editor. Go serves the authenticated API, WebSocket rooms, OCAP2 assets, SQLite data, and built React UI.

## Configure Discord

Create a Discord application and OAuth2 redirect for:

```text
https://your-public-host/auth/callback
```

Set these required variables:

```text
PUBLIC_URL=https://your-public-host
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_GUILD_ID=...
DISCORD_ALLOWED_ROLE_ID=...
```

The OAuth scopes are `identify guilds.members.read`. Every admitted user must hold `DISCORD_ALLOWED_ROLE_ID`; IDs in `ADMIN_DISCORD_USER_IDS` still need that role. Admin IDs are comma-separated.

Optional variables:

```text
ADMIN_DISCORD_USER_IDS=123,456
DATABASE_PATH=/data/tacmap.db
MAPS_PATH=/maps
PREVIEW_CACHE_PATH=/data/previews
LISTEN_ADDRESS=:8080
MAP_UPLOAD_MAX_BYTES=5368709120
```

Terminate HTTPS at a reverse proxy and preserve the original `Host`, scheme, and WebSocket upgrade headers. `PUBLIC_URL` must exactly match the browser origin. Session cookies are always `Secure`.

## Map assets

Mount OCAP2-generated assets read-write at `/maps`. Each complete world uses:

```text
/maps/<world>/map.json
/maps/<world>/meta.json          # optional
/maps/<world>/preview.png        # optional
/maps/<world>/previews/<style>.png # optional style thumbnails
/maps/<world>/styles/*.json
/maps/<world>/tiles/*.pmtiles
/maps/fonts/...                  # shared fonts when referenced
/maps/sprites/...                # shared sprites when referenced
```

GDAL2Tiles raster exports are also supported. Keep their numeric `{z}/{x}/{y}.png` folders beside `map.json`; optional terrain variants use the existing `colorRelief`, `topoDark`, and `topoRelief` directories. The manifest's `maxZoom` and `hasTopo*` flags determine which styles are offered.

For the map-style picker, optionally add a zoomed-out whole-map image at `previews/<style>.png` for each style. When vector-style thumbnails are missing, the first editor renders them in MapLibre and stores the resulting 320×240 PNGs in `PREVIEW_CACHE_PATH`; later editors reuse that disposable cache. Raster styles fall back to their zoom-zero tile.

`map.json` needs positive `worldSize`, `world_size`, or `size`. A world is offered for new plans only when it has at least one complete MapLibre/PMTiles style or raster tile pyramid. Asset names may contain letters, numbers, dots, underscores, and hyphens. Terrain generation and conversion remain external to this application.

Administrators listed in `ADMIN_DISCORD_USER_IDS` can open **Manage terrains** at `/admin/maps`. Upload one ZIP containing exactly one top-level terrain directory; that directory name becomes the world ID. Existing IDs must be deleted before re-upload. Uploads are synchronous and limited to 5 GiB compressed by default (`MAP_UPLOAD_MAX_BYTES`), 6 GiB extracted, and 70,000 files. `/tmp` holds the incoming ZIP and extraction workspace, so it must use disk-backed writable storage with enough capacity. After a vector terrain installs, the administrator's browser renders and saves every style preview before the terrain becomes available. Interrupted or failed preview generation leaves it unavailable with a retry action on the administration page. Raster terrains use their existing tiles and need no rendered preview step.

Installation validates the bundle in `/tmp`, copies it to an app-owned hidden staging directory on `/maps`, then atomically makes it visible. Failed workspaces are removed; narrowly named abandoned staging/deletion directories are retried at startup. Deleting terrain is irreversible, removes its generated preview cache, and moves every active tactical map using it to trash. Tactical-map records remain stored; after re-uploading the same world ID, an administrator may restore them from trash.

Existing plans remain visible if their world disappears. Editing is disabled until the mount returns; export and history remain usable.

## Run

For a local test, register this exact Discord OAuth2 redirect:

```text
http://localhost:8080/auth/callback
```

Copy `.env.example` to `.env`, fill in the Discord values, create the mounted directories, then start the app:

```sh
cp .env.example .env
mkdir -p data maps tmp
# Linux only: let container UID write SQLite data, terrain files, and upload workspaces
sudo chown 10001:10001 data maps tmp
docker compose up --build
```

Open <http://localhost:8080>. Use `localhost`, not `127.0.0.1`, because `PUBLIC_URL`, the browser origin, and Discord redirect must match exactly. Browsers permit the required `Secure` session cookie on localhost.

For deployment, prepare writable `data`, `maps`, and disk-backed `tmp` directories for container UID/GID `10001`, set an HTTPS `PUBLIC_URL`, then run:

```sh
docker compose up -d --build
```

Checks:

```text
GET /healthz  process is serving
GET /readyz   database, maps volume, and temporary storage are writable
```

Deploy exactly one replica. SQLite/WebSocket room coordination is process-local by design.

In Kubernetes, mount persistent writable storage at `/data` and `/maps`, plus disk-backed ephemeral storage at `/tmp`. Keep the container root filesystem read-only. Multi-replica terrain mutation is unsupported because operation coordination is process-local.

## Back up and restore

SQLite uses WAL. Use SQLite's online backup command against the mounted database; copying only the main file while the service writes can omit WAL data:

```sh
sqlite3 /path/to/data/tacmap.db ".backup '/path/to/backups/tacmap-$(date +%F).db'"
```

Alternatively stop the container, copy `tacmap.db`, `tacmap.db-wal`, and `tacmap.db-shm` together, then restart. To restore, stop the container, preserve the current files, replace them with a verified backup owned by UID/GID `10001`, then start and check `/readyz`.

Map trash and revisions have no automatic purge. Back up both the database and `/maps`; terrain deletion has no application-level recovery. Test restores regularly.

## Development and verification

```sh
go test ./...
go test -race ./...
cd web
npm ci
npm run typecheck
npm test
npm run build
cd ..
docker build -t arma3-tac-map .
```

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for interoperability attribution.
