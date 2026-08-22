package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

var (
	errNotFound  = errors.New("not found")
	errForbidden = errors.New("forbidden")
	errConflict  = errors.New("conflict")
)

type Store struct{ db *sql.DB }

func openStore(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" && !strings.HasPrefix(path, "file:") {
		dsn = "file:" + filepath.ToSlash(path)
	}
	separator := "?"
	if strings.Contains(dsn, "?") {
		separator = "&"
	}
	dsn += separator + "_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, db.Ping()
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		var applied int
		err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version=?`, entry.Name()).Scan(&applied)
		if err != nil || applied != 0 {
			if err != nil {
				return err
			}
			continue
		}
		sqlBytes, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, string(sqlBytes)); err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?,?)`, entry.Name(), time.Now().Unix())
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func randomToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func newID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func tokenHash(token string) []byte { sum := sha256.Sum256([]byte(token)); return sum[:] }

func (s *Store) createOAuthState(ctx context.Context) (string, error) {
	state, err := randomToken()
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO oauth_states(hash, expires_at) VALUES(?,?)`, tokenHash(state), time.Now().Add(10*time.Minute).Unix())
	return state, err
}

func (s *Store) consumeOAuthState(ctx context.Context, state string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM oauth_states WHERE hash=? AND expires_at>?`, tokenHash(state), time.Now().Unix())
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return errForbidden
	}
	return nil
}

func (s *Store) upsertUser(ctx context.Context, user User) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users(id,username,display_name,avatar,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar=excluded.avatar,updated_at=excluded.updated_at`, user.ID, user.Username, user.DisplayName, user.Avatar, time.Now().Unix())
	return err
}

func (s *Store) createSession(ctx context.Context, userID string) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)`, tokenHash(token), userID, time.Now().Add(24*time.Hour).Unix())
	return token, err
}

func (s *Store) sessionUser(ctx context.Context, token string, admins map[string]bool) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.display_name,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?`, tokenHash(token), time.Now().Unix()).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, errForbidden
	}
	user.Admin = admins[user.ID]
	return user, err
}

func (s *Store) deleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE hash=?`, tokenHash(token))
	return err
}

func (s *Store) createMap(ctx context.Context, actor User, name, world string) (Map, error) {
	if err := validateName(name); err != nil {
		return Map{}, err
	}
	mapID, err := newID()
	if err != nil {
		return Map{}, err
	}
	layerID, err := newID()
	if err != nil {
		return Map{}, err
	}
	value := Map{ID: mapID, Name: strings.TrimSpace(name), World: world, CreatorID: actor.ID, Version: 1, CreatedAt: time.Now().Unix(), WorldAvailable: true, Layers: []Layer{{ID: layerID, MapID: mapID, Name: "General", Position: 0}}}
	err = s.mutate(ctx, mapID, actor.ID, 0, "map.create", event{Map: &value}, func(tx *sql.Tx, version int64) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO maps(id,name,world,creator_id,version) VALUES(?,?,?,?,?)`, mapID, value.Name, world, actor.ID, version); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO layers(id,map_id,name,position) VALUES(?,?,?,0)`, layerID, mapID, "General")
		return err
	})
	return value, err
}

func (s *Store) mutate(ctx context.Context, mapID, actorID string, expected int64, kind string, data event, apply func(*sql.Tx, int64) error) error {
	_, err := s.mutateVersion(ctx, mapID, actorID, expected, kind, data, apply)
	return err
}

func (s *Store) mutateVersion(ctx context.Context, mapID, actorID string, expected int64, kind string, data event, apply func(*sql.Tx, int64) error) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	version := int64(1)
	if kind != "map.create" {
		if err := tx.QueryRowContext(ctx, `SELECT version FROM maps WHERE id=?`, mapID).Scan(&version); errors.Is(err, sql.ErrNoRows) {
			return 0, errNotFound
		} else if err != nil {
			return 0, err
		}
		if expected > 0 && version != expected {
			return 0, errConflict
		}
		version++
	}
	if err := apply(tx, version); err != nil {
		return 0, err
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO revisions(map_id,version,actor_id,kind,data,created_at) VALUES(?,?,?,?,?,?)`, mapID, version, actorID, kind, payload, time.Now().Unix()); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return version, nil
}

func (s *Store) listMaps(ctx context.Context, trash bool) ([]Map, error) {
	operator := "IS NULL"
	if trash {
		operator = "IS NOT NULL"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.id,m.name,m.world,m.creator_id,m.version,r.created_at,m.deleted_at,u.id,u.username,u.display_name,u.avatar FROM maps m JOIN users u ON u.id=m.creator_id JOIN revisions r ON r.map_id=m.id AND r.version=1 WHERE m.deleted_at `+operator+` ORDER BY r.created_at DESC,r.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	maps := make([]Map, 0)
	for rows.Next() {
		var value Map
		var deleted sql.NullInt64
		var creator User
		if err := rows.Scan(&value.ID, &value.Name, &value.World, &value.CreatorID, &value.Version, &value.CreatedAt, &deleted, &creator.ID, &creator.Username, &creator.DisplayName, &creator.Avatar); err != nil {
			return nil, err
		}
		value.Deleted = deleted.Valid
		value.Creator = &creator
		maps = append(maps, value)
	}
	return maps, rows.Err()
}

func (s *Store) getMap(ctx context.Context, id string) (Map, error) {
	var value Map
	var deleted sql.NullInt64
	var creator User
	err := s.db.QueryRowContext(ctx, `SELECT m.id,m.name,m.world,m.creator_id,m.version,r.created_at,m.deleted_at,u.id,u.username,u.display_name,u.avatar FROM maps m JOIN users u ON u.id=m.creator_id JOIN revisions r ON r.map_id=m.id AND r.version=1 WHERE m.id=?`, id).Scan(&value.ID, &value.Name, &value.World, &value.CreatorID, &value.Version, &value.CreatedAt, &deleted, &creator.ID, &creator.Username, &creator.DisplayName, &creator.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return Map{}, errNotFound
	}
	if err != nil {
		return Map{}, err
	}
	value.Deleted = deleted.Valid
	value.Creator = &creator
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,position FROM layers WHERE map_id=? ORDER BY position,id`, id)
	if err != nil {
		return Map{}, err
	}
	for rows.Next() {
		var layer Layer
		layer.MapID = id
		if err := rows.Scan(&layer.ID, &layer.Name, &layer.Position); err != nil {
			rows.Close()
			return Map{}, err
		}
		value.Layers = append(value.Layers, layer)
	}
	rows.Close()
	byID := make(map[string]*Layer)
	for i := range value.Layers {
		byID[value.Layers[i].ID] = &value.Layers[i]
	}
	annotationRows, err := s.db.QueryContext(ctx, `SELECT data FROM annotations WHERE map_id=? ORDER BY layer_id,position,id`, id)
	if err != nil {
		return Map{}, err
	}
	defer annotationRows.Close()
	for annotationRows.Next() {
		var raw []byte
		var a Annotation
		if err := annotationRows.Scan(&raw); err != nil {
			return Map{}, err
		}
		if err := json.Unmarshal(raw, &a); err != nil {
			return Map{}, err
		}
		if layer := byID[a.LayerID]; layer != nil {
			layer.Annotations = append(layer.Annotations, a)
		}
	}
	return value, annotationRows.Err()
}

func (s *Store) isMapManager(ctx context.Context, mapID string, user User) (bool, error) {
	if user.Admin {
		return true, nil
	}
	var creator string
	err := s.db.QueryRowContext(ctx, `SELECT creator_id FROM maps WHERE id=?`, mapID).Scan(&creator)
	if errors.Is(err, sql.ErrNoRows) {
		return false, errNotFound
	}
	return creator == user.ID, err
}

func (s *Store) renameMap(ctx context.Context, actor User, mapID, name string) error {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return err
	}
	if !manager {
		return errForbidden
	}
	if err := validateName(name); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	return s.mutate(ctx, mapID, actor.ID, 0, "map.rename", event{Name: name}, func(tx *sql.Tx, version int64) error {
		result, err := tx.ExecContext(ctx, `UPDATE maps SET name=?,version=? WHERE id=?`, name, version, mapID)
		if err == nil {
			if n, _ := result.RowsAffected(); n == 0 {
				return errNotFound
			}
		}
		return err
	})
}

func (s *Store) setMapDeleted(ctx context.Context, actor User, mapID string, deleted bool) error {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return err
	}
	if deleted && !manager || !deleted && !actor.Admin {
		return errForbidden
	}
	kind := "map.delete"
	var value any = time.Now().Unix()
	if !deleted {
		kind = "map.restore-trash"
		value = nil
	}
	return s.mutate(ctx, mapID, actor.ID, 0, kind, event{}, func(tx *sql.Tx, version int64) error {
		_, err := tx.ExecContext(ctx, `UPDATE maps SET deleted_at=?,version=? WHERE id=?`, value, version, mapID)
		return err
	})
}

func (s *Store) purgeMap(ctx context.Context, actor User, mapID string) error {
	if !actor.Admin {
		return errForbidden
	}
	var deletedAt sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT deleted_at FROM maps WHERE id=?`, mapID).Scan(&deletedAt); errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	} else if err != nil {
		return err
	}
	if !deletedAt.Valid {
		return errConflict
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM maps WHERE id=?`, mapID)
	return err
}

func (s *Store) createLayer(ctx context.Context, actor User, mapID, name string) (Layer, error) {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return Layer{}, err
	}
	if !manager {
		return Layer{}, errForbidden
	}
	if err := validateName(name); err != nil {
		return Layer{}, err
	}
	var count, position int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MAX(position)+1,0) FROM layers WHERE map_id=?`, mapID).Scan(&count, &position); err != nil {
		return Layer{}, err
	}
	if count >= maxLayers {
		return Layer{}, errors.New("layer limit reached")
	}
	id, err := newID()
	if err != nil {
		return Layer{}, err
	}
	layer := Layer{ID: id, MapID: mapID, Name: strings.TrimSpace(name), Position: position}
	err = s.mutate(ctx, mapID, actor.ID, 0, "layer.create", event{Layer: &layer}, func(tx *sql.Tx, version int64) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO layers(id,map_id,name,position) VALUES(?,?,?,?)`, id, mapID, layer.Name, position); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE maps SET version=? WHERE id=?`, version, mapID)
		return err
	})
	return layer, err
}

func (s *Store) updateLayer(ctx context.Context, actor User, mapID, layerID, name string) error {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return err
	}
	if !manager {
		return errForbidden
	}
	if err := validateName(name); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	layer := Layer{ID: layerID, MapID: mapID, Name: name}
	return s.mutate(ctx, mapID, actor.ID, 0, "layer.rename", event{Layer: &layer}, func(tx *sql.Tx, version int64) error {
		result, err := tx.ExecContext(ctx, `UPDATE layers SET name=? WHERE id=? AND map_id=?`, name, layerID, mapID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return errNotFound
		}
		_, err = tx.ExecContext(ctx, `UPDATE maps SET version=? WHERE id=?`, version, mapID)
		return err
	})
}

func (s *Store) deleteLayer(ctx context.Context, actor User, mapID, layerID string) error {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return err
	}
	if !manager {
		return errForbidden
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM layers WHERE map_id=?`, mapID).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return errors.New("map must retain one layer")
	}
	return s.mutate(ctx, mapID, actor.ID, 0, "layer.delete", event{ID: layerID}, func(tx *sql.Tx, version int64) error {
		result, err := tx.ExecContext(ctx, `DELETE FROM layers WHERE id=? AND map_id=?`, layerID, mapID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return errNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE layers SET position=position+? WHERE map_id=?`, maxLayers, mapID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id FROM layers WHERE map_id=? ORDER BY position,id`, mapID)
		if err != nil {
			return err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for position, id := range ids {
			if _, err := tx.ExecContext(ctx, `UPDATE layers SET position=? WHERE id=?`, position, id); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE maps SET version=? WHERE id=?`, version, mapID)
		return err
	})
}

func (s *Store) reorderLayers(ctx context.Context, actor User, mapID string, ids []string) error {
	manager, err := s.isMapManager(ctx, mapID, actor)
	if err != nil {
		return err
	}
	if !manager {
		return errForbidden
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM layers WHERE map_id=?`, mapID).Scan(&count); err != nil {
		return err
	}
	if len(ids) != count {
		return errors.New("all layer IDs required")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return errors.New("duplicate layer ID")
		}
		seen[id] = true
	}
	return s.mutate(ctx, mapID, actor.ID, 0, "layer.reorder", event{LayerIDs: ids}, func(tx *sql.Tx, version int64) error {
		for i, id := range ids {
			result, err := tx.ExecContext(ctx, `UPDATE layers SET position=? WHERE id=? AND map_id=?`, i+maxLayers, id, mapID)
			if err != nil {
				return err
			}
			if n, _ := result.RowsAffected(); n != 1 {
				return errors.New("unknown layer ID")
			}
		}
		for i, id := range ids {
			if _, err := tx.ExecContext(ctx, `UPDATE layers SET position=? WHERE id=?`, i, id); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE maps SET version=? WHERE id=?`, version, mapID)
		return err
	})
}

func (s *Store) mutateAnnotation(ctx context.Context, actor User, mapID, operation string, annotation *Annotation, id string, expected int64) (int64, error) {
	value, err := s.getMap(ctx, mapID)
	if err != nil {
		return 0, err
	}
	if value.Deleted {
		return 0, errForbidden
	}
	if operation != "delete" {
		annotation.MapID = mapID
		if err := annotation.validate(); err != nil {
			return 0, err
		}
		var layerMap string
		if err := s.db.QueryRowContext(ctx, `SELECT map_id FROM layers WHERE id=?`, annotation.LayerID).Scan(&layerMap); errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("layer does not belong to map")
		} else if err != nil {
			return 0, err
		} else if layerMap != mapID {
			return 0, errors.New("layer does not belong to map")
		}
	}
	if operation == "create" {
		var count int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM annotations WHERE map_id=?`, mapID).Scan(&count); err != nil {
			return 0, err
		}
		if count >= maxAnnotations {
			return 0, errors.New("annotation limit reached")
		}
		if annotation.ID == "" {
			annotation.ID, err = newID()
			if err != nil {
				return 0, err
			}
		}
	}
	if operation == "delete" {
		var raw []byte
		if err := s.db.QueryRowContext(ctx, `SELECT data FROM annotations WHERE id=? AND map_id=?`, id, mapID).Scan(&raw); errors.Is(err, sql.ErrNoRows) {
			return 0, errNotFound
		} else if err != nil {
			return 0, err
		} else if err := json.Unmarshal(raw, annotation); err != nil {
			return 0, err
		}
	}
	kind := "annotation." + operation
	data := event{Annotation: annotation, ID: id}
	version, err := s.mutateVersion(ctx, mapID, actor.ID, expected, kind, data, func(tx *sql.Tx, version int64) error {
		switch operation {
		case "create":
			if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(position)+1,0) FROM annotations WHERE layer_id=?`, annotation.LayerID).Scan(&annotation.Position); err != nil {
				return err
			}
			raw, _ := json.Marshal(annotation)
			_, err = tx.ExecContext(ctx, `INSERT INTO annotations(id,map_id,layer_id,kind,position,data) VALUES(?,?,?,?,?,?)`, annotation.ID, mapID, annotation.LayerID, annotation.Kind, annotation.Position, raw)
		case "update":
			annotation.ID = id
			raw, _ := json.Marshal(annotation)
			result, e := tx.ExecContext(ctx, `UPDATE annotations SET layer_id=?,kind=?,position=?,data=? WHERE id=? AND map_id=?`, annotation.LayerID, annotation.Kind, annotation.Position, raw, id, mapID)
			err = e
			if err == nil {
				if n, _ := result.RowsAffected(); n == 0 {
					err = errNotFound
				}
			}
		case "delete":
			result, e := tx.ExecContext(ctx, `DELETE FROM annotations WHERE id=? AND map_id=?`, id, mapID)
			err = e
			if err == nil {
				if n, _ := result.RowsAffected(); n == 0 {
					err = errNotFound
				}
			}
		default:
			err = errors.New("unsupported operation")
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE maps SET version=? WHERE id=?`, version, mapID)
		return err
	})
	if err != nil {
		return 0, err
	}
	return version, nil
}

func (s *Store) revisions(ctx context.Context, mapID string) ([]Revision, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.map_id,r.version,r.kind,r.data,r.created_at,u.id,u.username,u.display_name,u.avatar FROM revisions r JOIN users u ON u.id=r.actor_id WHERE r.map_id=? ORDER BY r.version`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]Revision, 0)
	for rows.Next() {
		var r Revision
		if err := rows.Scan(&r.ID, &r.MapID, &r.Version, &r.Kind, &r.Data, &r.CreatedAt, &r.Actor.ID, &r.Actor.Username, &r.Actor.DisplayName, &r.Actor.Avatar); err != nil {
			return nil, err
		}
		values = append(values, r)
	}
	return values, rows.Err()
}

func replayRevisions(revisions []Revision, through int64) (Map, error) {
	var result Map
	layers := map[string]Layer{}
	annotations := map[string]Annotation{}
	for _, revision := range revisions {
		if revision.Version > through {
			break
		}
		var e event
		if err := json.Unmarshal(revision.Data, &e); err != nil {
			return Map{}, err
		}
		switch revision.Kind {
		case "map.create":
			result = *e.Map
			layers = map[string]Layer{}
			for _, l := range result.Layers {
				l.Annotations = nil
				layers[l.ID] = l
			}
			annotations = map[string]Annotation{}
		case "map.rename":
			result.Name = e.Name
		case "map.delete":
			result.Deleted = true
		case "map.restore-trash":
			result.Deleted = false
		case "layer.create", "layer.rename":
			layers[e.Layer.ID] = *e.Layer
		case "layer.delete":
			delete(layers, e.ID)
			for id, a := range annotations {
				if a.LayerID == e.ID {
					delete(annotations, id)
				}
			}
		case "layer.reorder":
			for i, id := range e.LayerIDs {
				l := layers[id]
				l.Position = i
				layers[id] = l
			}
		case "annotation.create", "annotation.update":
			annotations[e.Annotation.ID] = *e.Annotation
		case "annotation.delete":
			delete(annotations, e.ID)
		case "history.restore":
			if e.Snapshot != nil {
				result = *e.Snapshot
				layers = map[string]Layer{}
				annotations = map[string]Annotation{}
				for _, l := range result.Layers {
					for _, a := range l.Annotations {
						annotations[a.ID] = a
					}
					l.Annotations = nil
					layers[l.ID] = l
				}
			}
		}
		result.Version = revision.Version
	}
	result.Layers = nil
	ordered := make([]Layer, 0, len(layers))
	for _, l := range layers {
		l.Annotations = nil
		ordered = append(ordered, l)
	}
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].Position < ordered[j].Position || ordered[i].Position == ordered[j].Position && ordered[i].ID < ordered[j].ID
	})
	for i := range ordered {
		for _, a := range annotations {
			if a.LayerID == ordered[i].ID {
				ordered[i].Annotations = append(ordered[i].Annotations, a)
			}
		}
		sort.Slice(ordered[i].Annotations, func(a, b int) bool {
			x, y := ordered[i].Annotations[a], ordered[i].Annotations[b]
			return x.Position < y.Position || x.Position == y.Position && x.ID < y.ID
		})
	}
	result.Layers = ordered
	return result, nil
}

func (s *Store) restoreRevision(ctx context.Context, actor User, mapID string, through int64) (Map, error) {
	if !actor.Admin {
		return Map{}, errForbidden
	}
	revisions, err := s.revisions(ctx, mapID)
	if err != nil {
		return Map{}, err
	}
	snapshot, err := replayRevisions(revisions, through)
	if err != nil {
		return Map{}, err
	}
	if snapshot.ID == "" {
		return Map{}, errNotFound
	}
	current, err := s.getMap(ctx, mapID)
	if err != nil {
		return Map{}, err
	}
	err = s.mutate(ctx, mapID, actor.ID, current.Version, "history.restore", event{Snapshot: &snapshot}, func(tx *sql.Tx, version int64) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM layers WHERE map_id=?`, mapID); err != nil {
			return err
		}
		deletedAt := any(nil)
		if snapshot.Deleted {
			deletedAt = time.Now().Unix()
		}
		if _, err := tx.ExecContext(ctx, `UPDATE maps SET name=?,world=?,deleted_at=?,version=? WHERE id=?`, snapshot.Name, snapshot.World, deletedAt, version, mapID); err != nil {
			return err
		}
		for _, l := range snapshot.Layers {
			if _, err := tx.ExecContext(ctx, `INSERT INTO layers(id,map_id,name,position) VALUES(?,?,?,?)`, l.ID, mapID, l.Name, l.Position); err != nil {
				return err
			}
			for _, a := range l.Annotations {
				raw, _ := json.Marshal(a)
				if _, err := tx.ExecContext(ctx, `INSERT INTO annotations(id,map_id,layer_id,kind,position,data) VALUES(?,?,?,?,?,?)`, a.ID, mapID, a.LayerID, a.Kind, a.Position, raw); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return Map{}, err
	}
	snapshot.Version = current.Version + 1
	return snapshot, nil
}

func (s *Store) close() error { return s.db.Close() }

func sqlError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("database: %w", err)
}
