package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverWorldsRejectsIncompleteAssets(t *testing.T) {
	root := t.TempDir()
	complete := filepath.Join(root, "altis")
	if err := os.MkdirAll(filepath.Join(complete, "styles"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(complete, "tiles"), 0755); err != nil {
		t.Fatal(err)
	}
	write := func(path, value string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(complete, "map.json"), `{"worldSize":30720}`)
	write(filepath.Join(complete, "styles", "topo.json"), `{"sources":{"terrain":{"url":"pmtiles://tiles/terrain.pmtiles"}}}`)
	write(filepath.Join(complete, "tiles", "terrain.pmtiles"), "tile")
	bad := filepath.Join(root, "broken")
	if err := os.MkdirAll(filepath.Join(bad, "styles"), 0755); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(bad, "map.json"), `{"worldSize":0}`)
	write(filepath.Join(bad, "styles", "topo.json"), `{}`)
	worlds, err := discoverWorlds(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(worlds) != 1 || worlds[0].Name != "altis" || worlds[0].Size != 30720 {
		t.Fatalf("unexpected worlds: %#v", worlds)
	}
}

func TestSafeJoinRejectsTraversal(t *testing.T) {
	if _, ok := safeJoin(t.TempDir(), "../secret"); ok {
		t.Fatal("traversal accepted")
	}
}

func TestServeAssetRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	response := httptest.NewRecorder()
	serveAsset(root, "link", response, httptest.NewRequest("GET", "/link", nil))
	if response.Code != 404 {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}
