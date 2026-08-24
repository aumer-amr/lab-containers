package main

import (
	"bytes"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestWorldPreviewCacheStoresValidatedPNGOutsideTerrain(t *testing.T) {
	mapsRoot := t.TempDir()
	cacheRoot := t.TempDir()
	directory := filepath.Join(mapsRoot, "altis")
	if err := os.MkdirAll(filepath.Join(directory, "styles"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(directory, "tiles"), 0755); err != nil {
		t.Fatal(err)
	}
	for path, value := range map[string]string{
		filepath.Join(directory, "map.json"):                 `{"worldSize":30720}`,
		filepath.Join(directory, "styles", "topo.json"):      `{"sources":{"terrain":{"url":"pmtiles://tiles/terrain.pmtiles"}}}`,
		filepath.Join(directory, "tiles", "terrain.pmtiles"): "tile",
	} {
		if err := os.WriteFile(path, []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	var body bytes.Buffer
	if err := png.Encode(&body, image.NewRGBA(image.Rect(0, 0, 320, 240))); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(body.Bytes()))
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	serveWorldPreview(mapsRoot, cacheRoot, "altis", "topo", response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("put status=%d body=%q", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(directory, "previews", "topo.png")); !os.IsNotExist(err) {
		t.Fatal("preview modified terrain directory")
	}
	response = httptest.NewRecorder()
	serveWorldPreview(mapsRoot, cacheRoot, "altis", "topo", response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("get status=%d content-type=%q", response.Code, response.Header().Get("Content-Type"))
	}
	response = httptest.NewRecorder()
	serveWorldPreview(mapsRoot, cacheRoot, "altis", "missing", response, httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(body.Bytes())))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown style status=%d", response.Code)
	}
}

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

func TestDiscoverWorldsSupportsRasterTilePyramids(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "lythium")
	for _, style := range []string{"", "colorRelief", "topoDark", "topoRelief"} {
		for _, zoom := range []string{"0", "7"} {
			if err := os.MkdirAll(filepath.Join(directory, style, zoom, "0"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(directory, style, zoom, "0", "0.png"), []byte("tile"), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	manifest := `{"worldSize":20480,"maxZoom":7,"hasTopo":true,"hasColorRelief":true,"hasTopoDark":true,"hasTopoRelief":true}`
	if err := os.WriteFile(filepath.Join(directory, "map.json"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}

	world, err := inspectWorld(root, "lythium")
	if err != nil {
		t.Fatal(err)
	}
	if world.Format != "raster" || world.MaxZoom != 7 || len(world.Styles) != 4 {
		t.Fatalf("unexpected raster world: %#v", world)
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
