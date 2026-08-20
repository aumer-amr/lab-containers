package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var safeWorldName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type World struct {
	Name    string   `json:"name"`
	Size    float64  `json:"size"`
	Styles  []string `json:"styles"`
	Preview string   `json:"preview,omitempty"`
	HasMeta bool     `json:"hasMeta"`
}

type worldManifest struct {
	WorldSize    float64         `json:"worldSize"`
	WorldSizeAlt float64         `json:"world_size"`
	Size         float64         `json:"size"`
	Styles       json.RawMessage `json:"styles"`
}

func discoverWorlds(root string) ([]World, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var worlds []World
	for _, entry := range entries {
		if !entry.IsDir() || !safeWorldName.MatchString(entry.Name()) {
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
	styleEntries, err := os.ReadDir(filepath.Join(directory, "styles"))
	if err != nil {
		return World{}, err
	}
	var styles []string
	for _, entry := range styleEntries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".json" {
			continue
		}
		stylePath := filepath.Join(directory, "styles", entry.Name())
		styleRaw, err := os.ReadFile(stylePath)
		if err != nil || !json.Valid(styleRaw) {
			continue
		}
		if !referencesExist(directory, styleRaw) {
			continue
		}
		styles = append(styles, strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
	}
	if len(styles) == 0 {
		return World{}, errors.New("world has no complete styles")
	}
	sort.Strings(styles)
	world := World{Name: name, Size: size, Styles: styles}
	if _, err := os.Stat(filepath.Join(directory, "preview.png")); err == nil {
		world.Preview = "preview.png"
	}
	if _, err := os.Stat(filepath.Join(directory, "meta.json")); err == nil {
		world.HasMeta = true
	}
	return world, nil
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
	return nil
}
