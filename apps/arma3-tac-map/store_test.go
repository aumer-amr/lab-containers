package main

import (
	"context"
	"errors"
	"testing"
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
	if _, err := store.restoreRevision(ctx, owner, value.ID, 1); !errors.Is(err, errForbidden) {
		t.Fatalf("restore error=%v", err)
	}
	if err := store.renameMap(ctx, admin, value.ID, "Admin"); err != nil {
		t.Fatal(err)
	}
}
