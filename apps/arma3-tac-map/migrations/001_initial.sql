CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE TABLE oauth_states (
    hash BLOB PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
    hash BLOB PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    world TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id),
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER
);

CREATE TABLE layers (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE(map_id, position)
);

CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    data BLOB NOT NULL,
    UNIQUE(layer_id, position)
);

CREATE TABLE revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    actor_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(map_id, version)
);

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX revisions_map ON revisions(map_id, version);
