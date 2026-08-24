package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

const previewMaxBytes = 2 << 20

var safeWorldName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type World struct {
	Name    string   `json:"name"`
	Size    float64  `json:"size"`
	Styles  []string `json:"styles"`
	Format  string   `json:"format"`
	MaxZoom int      `json:"maxZoom,omitempty"`
	Preview string   `json:"preview,omitempty"`
	HasMeta bool     `json:"hasMeta"`
}

type worldManifest struct {
	WorldSize      float64         `json:"worldSize"`
	WorldSizeAlt   float64         `json:"world_size"`
	Size           float64         `json:"size"`
	Styles         json.RawMessage `json:"styles"`
	MaxZoom        int             `json:"maxZoom"`
	HasColorRelief bool            `json:"hasColorRelief"`
	HasTopo        bool            `json:"hasTopo"`
	HasTopoDark    bool            `json:"hasTopoDark"`
	HasTopoRelief  bool            `json:"hasTopoRelief"`
}

func discoverWorlds(root string) ([]World, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	worlds := make([]World, 0)
	for _, entry := range entries {
		if !entry.IsDir() || !safeWorldName.MatchString(entry.Name()) || !worldPreviewsReady(root, entry.Name()) {
			continue
		}
		world, err := inspectWorld(root, entry.Name())
		if err == nil {
			worlds = append(worlds, world)
		}
	}
	sort.Slice(worlds, func(i, j int) bool { return worlds[i].Name < worlds[j].Name })
	return worlds, nil
}

func worldPreviewsReady(root, name string) bool {
	_, err := os.Lstat(filepath.Join(root, name, previewPendingMarker))
	return errors.Is(err, os.ErrNotExist)
}

func inspectWorld(root, name string) (World, error) {
	directory := filepath.Join(root, name)
	raw, err := os.ReadFile(filepath.Join(directory, "map.json"))
	if err != nil {
		return World{}, err
	}
	var manifest worldManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return World{}, err
	}
	size := manifest.WorldSize
	if size == 0 {
		size = manifest.WorldSizeAlt
	}
	if size == 0 {
		size = manifest.Size
	}
	if size <= 0 {
		return World{}, errors.New("world size must be positive")
	}
	var styles []string
	format := "pmtiles"
	if styleEntries, err := os.ReadDir(filepath.Join(directory, "styles")); err == nil {
		for _, entry := range styleEntries {
			if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".json" {
				continue
			}
			stylePath := filepath.Join(directory, "styles", entry.Name())
			styleRaw, err := os.ReadFile(stylePath)
			if err != nil || !json.Valid(styleRaw) || !referencesExist(directory, styleRaw) {
				continue
			}
			styles = append(styles, strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
		}
	}
	if len(styles) == 0 {
		format = "raster"
		styles = rasterStyles(directory, manifest)
	}
	if len(styles) == 0 {
		return World{}, errors.New("world has no complete styles")
	}
	sort.Strings(styles)
	world := World{Name: name, Size: size, Styles: styles, Format: format}
	if format == "raster" {
		world.MaxZoom = manifest.MaxZoom
	}
	if _, err := os.Stat(filepath.Join(directory, "preview.png")); err == nil {
		world.Preview = "preview.png"
	}
	if _, err := os.Stat(filepath.Join(directory, "meta.json")); err == nil {
		world.HasMeta = true
	}
	return world, nil
}

func rasterStyles(directory string, manifest worldManifest) []string {
	if manifest.MaxZoom < 0 {
		return nil
	}
	candidates := []struct {
		name, path string
		enabled    bool
	}{
		{"topo", "", manifest.HasTopo},
		{"color-relief", "colorRelief", manifest.HasColorRelief},
		{"topo-dark", "topoDark", manifest.HasTopoDark},
		{"topo-relief", "topoRelief", manifest.HasTopoRelief},
	}
	styles := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if !candidate.enabled {
			continue
		}
		first := filepath.Join(directory, candidate.path, "0", "0", "0.png")
		last := filepath.Join(directory, candidate.path, strconv.Itoa(manifest.MaxZoom), "0", "0.png")
		firstInfo, firstErr := os.Stat(first)
		lastInfo, lastErr := os.Stat(last)
		if firstErr == nil && lastErr == nil && !firstInfo.IsDir() && !lastInfo.IsDir() {
			styles = append(styles, candidate.name)
		}
	}
	return styles
}

func referencesExist(worldDirectory string, raw []byte) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	var walk func(any) bool
	walk = func(v any) bool {
		switch typed := v.(type) {
		case string:
			lower := strings.ToLower(strings.Split(typed, "?")[0])
			if !strings.HasSuffix(lower, ".pmtiles") {
				return true
			}
			reference := strings.TrimPrefix(typed, "pmtiles://")
			reference = strings.TrimPrefix(reference, "./")
			if strings.HasPrefix(reference, "/") || strings.Contains(filepath.ToSlash(reference), "../") {
				return false
			}
			if !strings.HasPrefix(filepath.ToSlash(reference), "tiles/") {
				reference = filepath.ToSlash(filepath.Join("tiles", filepath.Base(reference)))
			}
			path, ok := safeJoin(worldDirectory, reference)
			if !ok {
				return false
			}
			info, err := os.Stat(path)
			return err == nil && !info.IsDir()
		case []any:
			for _, item := range typed {
				if !walk(item) {
					return false
				}
			}
		case map[string]any:
			for _, item := range typed {
				if !walk(item) {
					return false
				}
			}
		}
		return true
	}
	return walk(value)
}

func safeJoin(root, relative string) (string, bool) {
	relative = filepath.FromSlash(relative)
	if filepath.IsAbs(relative) {
		return "", false
	}
	clean := filepath.Clean(relative)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", false
	}
	joined := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, joined)
	return joined, err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func serveWorldAsset(root, world, asset string, w http.ResponseWriter, r *http.Request) {
	if !safeWorldName.MatchString(world) {
		http.NotFound(w, r)
		return
	}
	directory := filepath.Join(root, world)
	if _, err := inspectWorld(root, world); err != nil {
		http.NotFound(w, r)
		return
	}
	serveAsset(directory, asset, w, r)
}

func serveWorldPreview(mapsRoot, cacheRoot, worldName, style string, w http.ResponseWriter, r *http.Request) {
	if !safeWorldName.MatchString(worldName) || !safeWorldName.MatchString(style) {
		http.NotFound(w, r)
		return
	}
	world, err := inspectWorld(mapsRoot, worldName)
	if err != nil || !slices.Contains(world.Styles, style) {
		http.NotFound(w, r)
		return
	}
	directory := filepath.Join(cacheRoot, worldName)
	name := style + ".png"
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		if info, statErr := os.Stat(filepath.Join(directory, name)); statErr == nil && !info.IsDir() {
			serveAsset(directory, name, w, r)
		} else {
			serveAsset(filepath.Join(mapsRoot, worldName, "previews"), name, w, r)
		}
		return
	}
	if r.Header.Get("Content-Type") != "image/png" {
		http.Error(w, "preview must be a PNG", http.StatusUnsupportedMediaType)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, previewMaxBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "preview is too large", http.StatusRequestEntityTooLarge)
		return
	}
	config, err := png.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width != 320 || config.Height != 240 {
		http.Error(w, "preview must be a 320x240 PNG", http.StatusBadRequest)
		return
	}
	if _, err := png.Decode(bytes.NewReader(raw)); err != nil {
		http.Error(w, "preview must be a 320x240 PNG", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(directory, 0755); err != nil {
		writeError(w, err)
		return
	}
	temporary, err := os.CreateTemp(directory, ".preview-*.png")
	if err != nil {
		writeError(w, err)
		return
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err = temporary.Write(raw); err == nil {
		err = temporary.Chmod(0644)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, filepath.Join(directory, name))
	}
	if err != nil {
		if _, statErr := os.Stat(filepath.Join(directory, name)); statErr == nil {
			err = nil
		}
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func serveAsset(root, asset string, w http.ResponseWriter, r *http.Request) {
	path, ok := safeJoin(root, asset)
	if !ok {
		http.NotFound(w, r)
		return
	}
	rootDirectory, err := os.OpenRoot(root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rootDirectory.Close()
	relative, err := filepath.Rel(root, path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	file, err := rootDirectory.Open(filepath.ToSlash(relative))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	contentType := mimeFor(path)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func mimeFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".json":
		return "application/json"
	case ".pmtiles":
		return "application/octet-stream"
	case ".png":
		return "image/png"
	case ".pbf":
		return "application/x-protobuf"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	}
	return ""
}

func mapsReady(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return &fs.PathError{Op: "stat", Path: root, Err: errors.New("not a directory")}
	}
	probe, err := os.CreateTemp(root, ".arma3-tac-map-ready-")
	if err != nil {
		return err
	}
	name := probe.Name()
	if err := probe.Close(); err != nil {
		os.Remove(name)
		return err
	}
	return os.Remove(name)
}
