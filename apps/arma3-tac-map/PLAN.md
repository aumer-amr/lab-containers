# Arma 3 Tactical Map Application

## Summary

Create `apps/arma3-tac-map`: one Docker container running a Go 1.26.5 backend that serves a React 19.2/Vite 8 frontend, authenticated APIs, WebSocket collaboration, OCAP2-compatible map assets, and SQLite persistence.

Use mapping/export concepts from MIT-licensed [Arma3TacMap](https://github.com/jetelain/Arma3TacMap), consume externally generated [OCAP2](https://github.com/OCAP2/web) PMTiles/MapLibre assets, and produce clipboard output compatible with [AET Plan Importer](https://github.com/Nomas-X/AET_Plan_Importer).

## Implementation Changes

### Authentication and authorization

- Implement Discord authorization-code OAuth with `identify` and `guilds.members.read`; validate OAuth `state`, then fetch current user and configured guild membership.
- Admit users only when `DISCORD_ALLOWED_ROLE_ID` exists in their guild roles. Admin IDs do not bypass this check.
- Store no Discord access/refresh tokens after login. Issue random server-side sessions stored hashed in SQLite, expiring after 24 hours.
- Use `HttpOnly`, `Secure`, `SameSite=Lax` cookies and validate request/WebSocket origins against `PUBLIC_URL`.
- Permissions:
  - Everyone admitted can view/create maps, create layers, and create/edit/delete any annotation.
  - Map creator or configured admin can rename/delete maps and rename/reorder/delete layers.
  - Admins alone can restore trash or historical revisions.
  - Everyone can view revision history and actor identities.

### Maps, terrain, and editor

- Discover OCAP2-generated worlds from read-only `/maps` on each catalog request. Validate safe world names, positive world size, `map.json`, available styles, and referenced PMTiles.
- Support OCAP2 layout: `<world>/map.json`, optional `meta.json`/preview, `styles/*.json`, `tiles/*.pmtiles`, and shared fonts. Serve authenticated byte-range requests required by PMTiles.
- Expose only complete worlds for map creation. Existing plans referencing a missing world remain listed; editor is disabled, but export and history remain available.
- Terrain binding is immutable after map creation. Duplicate plan/layer names are allowed; IDs are authoritative.
- Build an imperative Leaflet map inside React, with MapLibre/PMTiles terrain rendering and Leaflet-Geoman editing. Store coordinates as Arma `[easting, northing]` meters.
- Per-viewer controls:
  - Switch available OCAP styles.
  - Toggle terrain categories and annotation-layer visibility without persistence or broadcast.
  - Export dialog initially selects visible annotation layers.
- Annotation tools are limited to AET-exportable data:
  - Polylines and freehand strokes with one of the supported colors.
  - Vanilla markers with icon, color, label, rotation, and scale.
  - Curated icons: `mil_dot`, `mil_objective`, `mil_warning`, `mil_start`, `mil_end`, `mil_pickup`, `mil_destroy`, `mil_ambush`, `mil_arrow`, `mil_circle`, `mil_box`, `mil_triangle`, `mil_flag`, and `mil_unknown`.
  - No rectangles, ellipses, polygons, fills, opacity, custom widths/dashes, or Metis markers.
- Use official PLANOPS-compatible colors: eleven core `Color*` values plus `ColorUNKNOWN`, `colorBLUFOR`, `colorOPFOR`, `colorIndependent`, and `colorCivilian`, based on [Arma 3 CfgMarkerColors](https://community.bistudio.com/wiki/Arma_3%3A_CfgMarkerColors).
- Enforce fixed limits: 100 layers/map, 10,000 annotations/map, 2,000 points/polyline, and 200 characters/label.

### Persistence, realtime, and recovery

- Use `database/sql` with a pure-Go SQLite driver; enable WAL, foreign keys, busy timeout, and embedded forward-only migrations.
- Persist users, sessions, maps, ordered layers, current annotations, and immutable revision events. Create a default `General` layer with each map.
- Increment a monotonic map version for every persisted mutation. Keep revision events indefinitely; occasional restore events may contain a full snapshot.
- Restore history by replaying events through the selected revision, replacing current map contents transactionally, then appending a new restore revision.
- Soft-delete maps into trash with no automatic or permanent purge in MVP.
- WebSocket room per map:
  - Send authoritative snapshot and version on connection/reconnection.
  - Accept completed annotation create/update/delete operations only.
  - Serialize operations server-side and use arrival-order last-write-wins.
  - Broadcast committed mutation, version, and actor to all clients.
  - Disable editing while disconnected; reload authoritative snapshot after reconnect instead of queueing offline changes.
  - Broadcast ephemeral cursor positions/display names at a throttled maximum of 10 updates/second; never persist cursors.

## Public Interfaces and Deployment

- HTTP endpoints:
  - Discord login/callback/logout and `GET /api/me`.
  - `GET /api/worlds`.
  - Map list/create/read/update/soft-delete and admin trash restore.
  - Layer create/update/delete/reorder.
  - Revision list and admin whole-map restore.
  - `POST /api/maps/{id}/exports/aet` with selected layer IDs, returning `text/plain`.
  - `/healthz` for process health and `/readyz` for database/maps-volume readiness.
- WebSocket endpoint `/api/maps/{id}/ws` with typed JSON messages for snapshot, mutation, acknowledgement, error, presence, and cursor events.
- AET export:
  - Produce full PLANOPS-compatible text containing `private _data = [icons, polylines, []];`.
  - Preserve stable annotation IDs and deterministic layer/order sorting.
  - Escape SQF strings safely and reject embedded control/newline characters.
  - Render output in a read-only dialog with an explicit Copy button and selectable-text fallback if Clipboard API fails.
- Environment contract:
  - Required: `PUBLIC_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_ALLOWED_ROLE_ID`.
  - Optional: comma-separated `ADMIN_DISCORD_USER_IDS`, `DATABASE_PATH` defaulting to `/data/tacmap.db`, `MAPS_PATH` defaulting to `/maps`, and listen address defaulting to `:8080`.
- Add a multi-stage Dockerfile using Node 24 and Go 1.26.5, a Compose example mounting `/data` read-write and `/maps` read-only, and operational documentation for OAuth redirects, volume permissions, OCAP asset generation, backups, and single-instance deployment.
- Replace stale deleted-app entries in the GitHub Actions image matrix with `ghcr.io/aumer-amr/arma3-tac-map`.

## Test Plan

- Go tests with temporary SQLite and mocked Discord endpoints:
  - OAuth state, required role, denied role, admin allowlist, session expiry, logout, and origin checks.
  - Permission matrix for maps, layers, annotations, trash, and history restore.
  - Validation ceilings, immutable terrain, missing-world behavior, migrations, revision replay, and soft deletion.
  - PMTiles range responses, traversal rejection, and invalid/incomplete world discovery.
- Golden exporter tests for selected-layer filtering, deterministic ordering, all colors/icons, coordinate order, label escaping, empty Metis array, and exact AET-compatible wrapper.
- WebSocket integration test with two clients covering snapshot, mutation broadcast, arrival-order conflict, reconnect/resync, restore broadcast, presence, cursor throttling, and unauthorized origin.
- Frontend Vitest coverage for map coordinate conversion, annotation reducer, local visibility/export defaults, reconnect behavior, permission-gated controls, and clipboard fallback.
- Run frontend typecheck/tests/build, Go tests/race checks, Docker build, and container health/readiness smoke test.
- Manual acceptance:
  - Two Discord users edit one map and observe completed changes and cursors.
  - Creator/admin restrictions and revision restore work while clients are connected.
  - Paste exported text into AET Plan Importer and confirm selected markers appear for another multiplayer client.

## Assumptions and Boundaries

- One backend replica and roughly 50 concurrent users; no Redis, PostgreSQL, or multi-instance coordination.
- HTTPS terminates at an external reverse proxy; frontend, API, WebSocket, and map assets remain same-origin.
- Desktop Chrome, Firefox, and Edge editing is required. Mobile receives responsive viewing only.
- No runtime map generation/upload, permanent purge, offline editing, Metis support, unsupported geometry, or user-specific persisted preferences.
- Retain required MIT attribution for reused Arma3TacMap material. Consume OCAP2 output format without copying its implementation, and independently implement AET interoperability without copying its APL-ND source.
