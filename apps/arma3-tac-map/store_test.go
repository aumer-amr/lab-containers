package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := openStore(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.close() })
	return store
}

func TestAuthenticationStorageExpiresAndCleansUp(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	if _, err := store.db.ExecContext(ctx, `INSERT INTO oauth_states(hash,expires_at) VALUES(?,?)`, []byte("expired"), time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.createOAuthState(ctx); err != nil {
		t.Fatal(err)
	}
	var expired int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM oauth_states WHERE expires_at<=?`, time.Now().Unix()).Scan(&expired); err != nil || expired != 0 {
		t.Fatalf("expired OAuth states=%d error=%v", expired, err)
	}
	user := testUser(t, store, "member", false)
	if _, err := store.db.ExecContext(ctx, `INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)`, []byte("expired"), user.ID, time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	before := time.Now().Add(sessionDuration - time.Second).Unix()
	token, err := store.createSession(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	var expiresAt int64
	if err := store.db.QueryRowContext(ctx, `SELECT expires_at FROM sessions WHERE hash=?`, tokenHash(token)).Scan(&expiresAt); err != nil || expiresAt < before {
		t.Fatalf("session expiry=%d error=%v", expiresAt, err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE expires_at<=?`, time.Now().Unix()).Scan(&expired); err != nil || expired != 0 {
		t.Fatalf("expired sessions=%d error=%v", expired, err)
	}
}
func testUser(t *testing.T, store *Store, id string, admin bool) User {
	t.Helper()
	user := User{ID: id, Username: id, DisplayName: id, Admin: admin}
	if err := store.upsertUser(context.Background(), user); err != nil {
		t.Fatal(err)
	}
	return user
}

func TestMapLifecycleAndRevisionRestore(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner := testUser(t, store, "owner", false)
	admin := testUser(t, store, "admin", true)
	created, err := store.createMap(ctx, owner, "Operation One", "altis")
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "Operation One" || len(created.Layers) != 1 || created.Layers[0].Name != "General" {
		t.Fatalf("unexpected map: %#v", created)
	}
	if err := store.renameMap(ctx, owner, created.ID, "Operation Two"); err != nil {
		t.Fatal(err)
	}
	revisions, err := store.revisions(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := store.restoreRevision(ctx, admin, created.ID, revisions[0].Version)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Name != "Operation One" || restored.Version != 3 {
		t.Fatalf("unexpected restored map: %#v", restored)
	}
	revisions, err = store.revisions(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := revisions[len(revisions)-1]; got.Kind != "history.restore" || got.Version != restored.Version {
		t.Fatalf("restore revision=%#v", got)
	}
}

func TestRevisionHistoryRestoresNotes(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner := testUser(t, store, "owner", false)
	admin := testUser(t, store, "admin", true)
	value, err := store.createMap(ctx, owner, "Map", "altis")
	if err != nil {
		t.Fatal(err)
	}
	note := Annotation{LayerID: value.Layers[0].ID, Kind: "note", Color: "ColorYellow", Text: "Hold the bridge"}
	noteVersion, err := store.mutateAnnotation(ctx, owner, value.ID, "create", &note, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	note.Text = "Move north"
	if _, err := store.mutateAnnotation(ctx, owner, value.ID, "update", &note, note.ID, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := store.mutateAnnotation(ctx, owner, value.ID, "delete", &Annotation{}, note.ID, 0); err != nil {
		t.Fatal(err)
	}
	revisions, err := store.revisions(ctx, value.ID)
	if err != nil {
		t.Fatal(err)
	}
	var deleted event
	if err := json.Unmarshal(revisions[len(revisions)-1].Data, &deleted); err != nil {
		t.Fatal(err)
	}
	if deleted.Annotation == nil || deleted.Annotation.Kind != "note" || deleted.Annotation.Text != "Move north" {
		t.Fatalf("deleted note revision=%#v", deleted.Annotation)
	}
	restored, err := store.restoreRevision(ctx, admin, value.ID, noteVersion)
	if err != nil {
		t.Fatal(err)
	}
	if got := restored.Layers[0].Annotations; len(got) != 1 || got[0].Kind != "note" || got[0].Text != "Hold the bridge" {
		t.Fatalf("restored notes=%#v", got)
	}
}

func TestMapPermissions(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner := testUser(t, store, "owner", false)
	other := testUser(t, store, "other", false)
	admin := testUser(t, store, "admin", true)
	value, err := store.createMap(ctx, owner, "Map", "altis")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.renameMap(ctx, other, value.ID, "No"); !errors.Is(err, errForbidden) {
		t.Fatalf("rename error=%v", err)
	}
	if _, err := store.createLayer(ctx, other, value.ID, "No"); !errors.Is(err, errForbidden) {
		t.Fatalf("create layer error=%v", err)
	}
	if _, err := store.restoreRevision(ctx, owner, value.ID, 1); !errors.Is(err, errForbidden) {
		t.Fatalf("restore error=%v", err)
	}
	if err := store.renameMap(ctx, admin, value.ID, "Admin"); err != nil {
		t.Fatal(err)
	}
}

func TestOnlyAdminCanPermanentlyDeleteTrashedMap(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner := testUser(t, store, "owner", false)
	admin := testUser(t, store, "admin", true)
	value, err := store.createMap(ctx, owner, "Map", "altis")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.purgeMap(ctx, owner, value.ID); !errors.Is(err, errForbidden) {
		t.Fatalf("owner purge error=%v", err)
	}
	if err := store.purgeMap(ctx, admin, value.ID); !errors.Is(err, errConflict) {
		t.Fatalf("active purge error=%v", err)
	}
	note := Annotation{LayerID: value.Layers[0].ID, Kind: "note", Color: "ColorYellow", Text: "Delete me"}
	if _, err := store.mutateAnnotation(ctx, owner, value.ID, "create", &note, "", 0); err != nil {
		t.Fatal(err)
	}
	if err := store.setMapDeleted(ctx, owner, value.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := store.purgeMap(ctx, admin, value.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.getMap(ctx, value.ID); !errors.Is(err, errNotFound) {
		t.Fatalf("get purged map error=%v", err)
	}
	for name, query := range map[string]string{
		"layers":      `SELECT COUNT(*) FROM layers WHERE map_id=?`,
		"annotations": `SELECT COUNT(*) FROM annotations WHERE map_id=?`,
		"revisions":   `SELECT COUNT(*) FROM revisions WHERE map_id=?`,
	} {
		var count int
		if err := store.db.QueryRowContext(ctx, query, value.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s count=%d error=%v", name, count, err)
		}
	}
}

func TestListMapsIncludesAllPlayersNewestFirst(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	first, err := store.createMap(ctx, testUser(t, store, "first", false), "First", "altis")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.createMap(ctx, testUser(t, store, "second", false), "Second", "altis")
	if err != nil {
		t.Fatal(err)
	}
	values, err := store.listMaps(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 || values[0].ID != second.ID || values[1].ID != first.ID {
		t.Fatalf("maps not newest first: %#v", values)
	}
	if values[0].CreatedAt == 0 || values[1].CreatedAt == 0 {
		t.Fatalf("missing creation time: %#v", values)
	}
}
