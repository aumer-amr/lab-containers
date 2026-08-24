package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type zipEntry struct {
	name string
	data string
	mode os.FileMode
}

func terrainZIP(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		if entry.mode != 0 {
			header.SetMode(entry.mode)
		}
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(entry.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func validTerrainZIP(t *testing.T, world string) []byte {
	return terrainZIP(t,
		zipEntry{name: world + "/map.json", data: `{"worldSize":100}`},
		zipEntry{name: world + "/styles/default.json", data: `{"url":"pmtiles://tiles/map.pmtiles"}`},
		zipEntry{name: world + "/tiles/map.pmtiles", data: "tiles"},
	)
}

func adminRequest(t *testing.T, server *Server, method, target string, body []byte, contentType string) *http.Request {
	t.Helper()
	request := authenticatedRequest(t, server, User{ID: "admin", Username: "admin", DisplayName: "Admin"}, method, target, string(body))
	request.Header.Set("Content-Type", contentType)
	return request
}

func completeTestPreviews(t *testing.T, server *Server, world string, styles ...string) {
	t.Helper()
	directory := filepath.Join(server.config.PreviewCachePath, world)
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	for _, style := range styles {
		if err := os.WriteFile(filepath.Join(directory, style+".png"), []byte("preview"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds/"+world+"/previews/complete", nil, "application/json"))
	if response.Code != http.StatusOK {
		t.Fatalf("complete previews status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestAdminWorldUploadDeleteAndRelink(t *testing.T) {
	root := t.TempDir()
	server := newServer(testConfig(t, root), testStore(t))
	admin := testUser(t, server.store, "admin", true)
	owner := testUser(t, server.store, "owner", false)
	archive := validTerrainZIP(t, "altis")

	upload := httptest.NewRecorder()
	server.routes().ServeHTTP(upload, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", archive, "application/zip"))
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status=%d body=%q", upload.Code, upload.Body.String())
	}
	var uploaded AdminWorld
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil || uploaded.Ready || server.worldExists("altis") {
		t.Fatalf("terrain became ready before previews: %#v %v", uploaded, err)
	}
	completeTestPreviews(t, server, "altis", "default")
	if !server.worldExists("altis") {
		t.Fatal("terrain unavailable after preview completion")
	}
	duplicate := httptest.NewRecorder()
	server.routes().ServeHTTP(duplicate, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", archive, "application/zip"))
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate status=%d body=%q", duplicate.Code, duplicate.Body.String())
	}
	created, err := server.store.createMap(context.Background(), owner, "Plan", "altis")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.store.setMapDeleted(context.Background(), owner, created.ID, true); err != nil {
		t.Fatal(err)
	}
	active, err := server.store.createMap(context.Background(), owner, "Active", "altis")
	if err != nil {
		t.Fatal(err)
	}
	previewDirectory := filepath.Join(server.config.PreviewCachePath, "altis")
	if err := os.MkdirAll(previewDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewDirectory, "topo.png"), []byte("preview"), 0644); err != nil {
		t.Fatal(err)
	}

	detail := httptest.NewRecorder()
	server.routes().ServeHTTP(detail, adminRequest(t, server, http.MethodGet, "/api/admin/worlds/altis", nil, "application/json"))
	var item AdminWorld
	if err := json.Unmarshal(detail.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if !item.Valid || item.ActiveMaps != 1 || item.TrashedMaps != 1 {
		t.Fatalf("item=%#v", item)
	}

	stale := httptest.NewRecorder()
	server.routes().ServeHTTP(stale, adminRequest(t, server, http.MethodDelete, "/api/admin/worlds/altis", []byte(`{"activeMaps":0,"trashedMaps":1}`), "application/json"))
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale status=%d body=%q", stale.Code, stale.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "altis")); err != nil {
		t.Fatal("stale delete removed terrain")
	}

	deleted := httptest.NewRecorder()
	server.routes().ServeHTTP(deleted, adminRequest(t, server, http.MethodDelete, "/api/admin/worlds/altis", []byte(`{"activeMaps":1,"trashedMaps":1}`), "application/json"))
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%q", deleted.Code, deleted.Body.String())
	}
	if value, err := server.store.getMap(context.Background(), active.ID); err != nil || value.World != "altis" || !value.Deleted || value.Version != 2 {
		t.Fatalf("tactical map changed after terrain delete: %#v %v", value, err)
	}
	if activeCount, trashedCount, err := server.store.worldMapCounts(context.Background(), "altis"); err != nil || activeCount != 0 || trashedCount != 2 {
		t.Fatalf("counts=%d/%d error=%v", activeCount, trashedCount, err)
	}
	revisions, err := server.store.revisions(context.Background(), active.ID)
	if err != nil || len(revisions) != 2 || revisions[1].Kind != "map.delete" || revisions[1].Actor.ID != "admin" {
		t.Fatalf("revisions=%#v error=%v", revisions, err)
	}
	if _, err := os.Stat(previewDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("preview cache remains: %v", err)
	}
	mutation := httptest.NewRecorder()
	server.routes().ServeHTTP(mutation, authenticatedRequest(t, server, admin, http.MethodPatch, "/api/maps/"+active.ID, `{"name":"Changed"}`))
	if mutation.Code != http.StatusConflict {
		t.Fatalf("missing-terrain mutation status=%d body=%q", mutation.Code, mutation.Body.String())
	}

	reupload := httptest.NewRecorder()
	server.routes().ServeHTTP(reupload, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", archive, "application/zip"))
	if reupload.Code != http.StatusCreated || server.worldExists("altis") {
		t.Fatalf("reupload status=%d body=%q", reupload.Code, reupload.Body.String())
	}
	completeTestPreviews(t, server, "altis", "default")
	if value, err := server.store.getMap(context.Background(), active.ID); err != nil || !value.Deleted {
		t.Fatalf("re-upload unexpectedly restored trashed map: %#v %v", value, err)
	}
}

func TestTerrainStaysUnavailableWhenPreviewCompletionIsIncomplete(t *testing.T) {
	server := newServer(testConfig(t, t.TempDir()), testStore(t))
	upload := httptest.NewRecorder()
	server.routes().ServeHTTP(upload, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", validTerrainZIP(t, "altis"), "application/zip"))
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds/altis/previews/complete", nil, "application/json"))
	if response.Code != http.StatusBadRequest || server.worldExists("altis") {
		t.Fatalf("status=%d ready=%v body=%q", response.Code, server.worldExists("altis"), response.Body.String())
	}
}

func TestRasterTerrainIsReadyWithoutGeneratedPreviews(t *testing.T) {
	server := newServer(testConfig(t, t.TempDir()), testStore(t))
	archive := terrainZIP(t,
		zipEntry{name: "lythium/map.json", data: `{"worldSize":100,"maxZoom":0,"hasTopo":true}`},
		zipEntry{name: "lythium/0/0/0.png", data: "tile"},
	)
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", archive, "application/zip"))
	var world AdminWorld
	if err := json.Unmarshal(response.Body.Bytes(), &world); err != nil || response.Code != http.StatusCreated || !world.Ready || !server.worldExists("lythium") {
		t.Fatalf("status=%d world=%#v error=%v", response.Code, world, err)
	}
}

func TestAdminWorldUploadValidationAndCleanup(t *testing.T) {
	tests := []struct {
		name    string
		entries []zipEntry
	}{
		{name: "missing map", entries: []zipEntry{{name: "altis/file.txt", data: "x"}}},
		{name: "empty map", entries: []zipEntry{{name: "altis/map.json"}}},
		{name: "invalid map", entries: []zipEntry{{name: "altis/map.json", data: "{"}}},
		{name: "traversal", entries: []zipEntry{{name: "altis/../escape", data: "x"}}},
		{name: "absolute", entries: []zipEntry{{name: "/altis/map.json", data: "x"}}},
		{name: "backslash", entries: []zipEntry{{name: `altis\map.json`, data: "x"}}},
		{name: "symlink", entries: []zipEntry{{name: "altis/link", data: "target", mode: os.ModeSymlink | 0777}}},
		{name: "multiple roots", entries: []zipEntry{{name: "altis/map.json", data: "x"}, {name: "stratis/file", data: "x"}}},
		{name: "loose root", entries: []zipEntry{{name: "map.json", data: "x"}}},
		{name: "nested zip", entries: []zipEntry{{name: "altis/files.zip", data: "x"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			server := newServer(testConfig(t, root), testStore(t))
			response := httptest.NewRecorder()
			server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", terrainZIP(t, test.entries...), "application/zip"))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("terrain artifacts remain: %v %v", entries, err)
			}
		})
	}
}

func TestExtractTerrainArchiveLimits(t *testing.T) {
	tests := []struct {
		name     string
		entries  []zipEntry
		maxFiles int
		maxBytes int64
	}{
		{name: "files", entries: []zipEntry{{name: "altis/a", data: "a"}, {name: "altis/b", data: "b"}}, maxFiles: 1, maxBytes: 10},
		{name: "bytes", entries: []zipEntry{{name: "altis/a", data: "ab"}}, maxFiles: 2, maxBytes: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archive := filepath.Join(t.TempDir(), "terrain.zip")
			if err := os.WriteFile(archive, terrainZIP(t, test.entries...), 0600); err != nil {
				t.Fatal(err)
			}
			_, err := extractTerrainArchive(archive, filepath.Join(t.TempDir(), "out"), test.maxFiles, test.maxBytes)
			if !errors.Is(err, errTerrainLimit) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestAdminWorldListingIncludesMalformedAndExcludesUnsafeEntries(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "broken"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, uploadPrefix+strings.Repeat("a", 32)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "broken"), filepath.Join(root, "linked")); err != nil {
		t.Logf("symlink unavailable: %v", err)
	}
	server := newServer(testConfig(t, root), testStore(t))
	items, err := server.listAdminWorlds(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "broken" || items[0].Valid || items[0].ValidationError == "" {
		t.Fatalf("items=%#v", items)
	}
}

func TestTerrainOperationGuardRejectsConcurrentMutation(t *testing.T) {
	server := newServer(testConfig(t, t.TempDir()), testStore(t))
	server.terrainBusy.Store(true)
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", validTerrainZIP(t, "altis"), "application/zip"))
	if response.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestTerrainUploadCompressedLimit(t *testing.T) {
	config := testConfig(t, t.TempDir())
	config.MapUploadMaxBytes = 8
	server := newServer(config, testStore(t))
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, adminRequest(t, server, http.MethodPost, "/api/admin/worlds", validTerrainZIP(t, "altis"), "application/zip"))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestCleanupTerrainArtifactsOnlyRemovesOwnedNames(t *testing.T) {
	root := t.TempDir()
	owned := uploadPrefix + strings.Repeat("a", 32)
	untouched := uploadPrefix + "operator-data"
	for _, name := range []string{owned, untouched} {
		if err := os.Mkdir(filepath.Join(root, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := cleanupTerrainArtifacts(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, owned)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("owned staging directory remains")
	}
	if _, err := os.Stat(filepath.Join(root, untouched)); err != nil {
		t.Fatal("non-owned directory removed")
	}
}

func TestMapsReadyRejectsNonDirectory(t *testing.T) {
	file := filepath.Join(t.TempDir(), "maps")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := mapsReady(file); err == nil {
		t.Fatal("non-directory reported ready")
	}
}
