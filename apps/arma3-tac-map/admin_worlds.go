package main

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

const (
	mapExtractMaxBytes   int64 = 6 * 1024 * 1024 * 1024
	mapExtractMaxFiles         = 70_000
	uploadPrefix               = ".upload-"
	deletingPrefix             = ".deleting-"
	previewPendingMarker       = ".previews-pending"
)

var (
	errTerrainInvalid   = errors.New("invalid terrain archive")
	errTerrainLimit     = errors.New("terrain archive limit exceeded")
	errTerrainBusy      = errors.New("another terrain operation is running")
	internalTerrainName = regexp.MustCompile(`^\.(?:upload|deleting)-[0-9a-f]{32}$`)
)

type AdminWorld struct {
	Name            string   `json:"name"`
	Valid           bool     `json:"valid"`
	ValidationError string   `json:"validationError"`
	Format          string   `json:"format,omitempty"`
	Styles          []string `json:"styles,omitempty"`
	ActiveMaps      int      `json:"activeMaps"`
	TrashedMaps     int      `json:"trashedMaps"`
	Ready           bool     `json:"ready"`
	Size            float64  `json:"size,omitempty"`
}

type extractedTerrain struct {
	world string
	root  string
	bytes int64
}

func (s *Server) adminWorlds(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.terrainMu.RLock()
		defer s.terrainMu.RUnlock()
		items, err := s.listAdminWorlds(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
		return
	}
	s.uploadWorld(w, r)
}

func (s *Server) adminWorldByName(w http.ResponseWriter, r *http.Request) {
	world := r.PathValue("world")
	if !safeWorldName.MatchString(world) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		s.terrainMu.RLock()
		defer s.terrainMu.RUnlock()
		item, err := s.adminWorld(r.Context(), world)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	s.deleteWorld(w, r, world)
}

func (s *Server) listAdminWorlds(ctx context.Context) ([]AdminWorld, error) {
	entries, err := os.ReadDir(s.config.MapsPath)
	if err != nil {
		return nil, err
	}
	items := make([]AdminWorld, 0)
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() || !safeWorldName.MatchString(entry.Name()) {
			continue
		}
		item, err := s.adminWorld(ctx, entry.Name())
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func (s *Server) adminWorld(ctx context.Context, name string) (AdminWorld, error) {
	info, err := os.Lstat(filepath.Join(s.config.MapsPath, name))
	if errors.Is(err, os.ErrNotExist) || err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		return AdminWorld{}, errNotFound
	}
	if err != nil {
		return AdminWorld{}, err
	}
	active, trashed, err := s.store.worldMapCounts(ctx, name)
	if err != nil {
		return AdminWorld{}, err
	}
	item := AdminWorld{Name: name, ActiveMaps: active, TrashedMaps: trashed}
	world, inspectErr := inspectWorld(s.config.MapsPath, name)
	if inspectErr != nil {
		item.ValidationError = terrainValidationError(inspectErr)
		return item, nil
	}
	item.Valid = true
	item.Format = world.Format
	item.Styles = world.Styles
	item.Size = world.Size
	item.Ready = worldPreviewsReady(s.config.MapsPath, name)
	return item, nil
}

func terrainValidationError(err error) string {
	if errors.Is(err, os.ErrNotExist) {
		return "map.json is missing"
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "invalid character"), strings.Contains(message, "cannot unmarshal"), strings.Contains(message, "unexpected end"):
		return "map.json is invalid"
	case strings.Contains(message, "world size"):
		return "world size must be positive"
	case strings.Contains(message, "complete styles"):
		return "terrain has no complete styles"
	default:
		return "terrain files are invalid"
	}
}

func (s *Server) beginTerrainOperation() bool { return s.terrainBusy.CompareAndSwap(false, true) }
func (s *Server) endTerrainOperation()        { s.terrainBusy.Store(false) }

func (s *Server) uploadWorld(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	user, _ := contextUser(r.Context())
	worldName, category := "", "success"
	var compressed, extracted int64
	defer func() {
		slog.Info("terrain operation", "operation", "upload", "administrator", user.ID, "world", worldName, "compressedBytes", compressed, "extractedBytes", extracted, "durationMs", time.Since(started).Milliseconds(), "result", category)
	}()
	if !s.beginTerrainOperation() {
		category = "conflict"
		writeTerrainError(w, errTerrainBusy)
		return
	}
	defer s.endTerrainOperation()
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/zip" {
		category = "content_type"
		http.Error(w, "Content-Type must be application/zip", http.StatusUnsupportedMediaType)
		return
	}
	limit := s.config.MapUploadMaxBytes
	if limit <= 0 {
		limit = defaultMapUploadMaxBytes
	}
	workspace, err := os.MkdirTemp("", "arma3-tac-map-upload-")
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	defer os.RemoveAll(workspace)
	archivePath := filepath.Join(workspace, "terrain.zip")
	archive, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		compressed, err = io.Copy(archive, r.Body)
		if closeErr := archive.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	value, err := extractTerrainArchive(archivePath, filepath.Join(workspace, "extracted"), mapExtractMaxFiles, mapExtractMaxBytes)
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	worldName, extracted = value.world, value.bytes
	inspected, err := inspectWorld(value.root, value.world)
	if err != nil {
		category = "validation"
		writeTerrainError(w, fmt.Errorf("%w: %s", errTerrainInvalid, terrainValidationError(err)))
		return
	}
	stageID, err := newID()
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	stage := filepath.Join(s.config.MapsPath, uploadPrefix+stageID)
	if err = os.Mkdir(stage, 0755); err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	defer os.RemoveAll(stage)
	if err = os.CopyFS(stage, os.DirFS(filepath.Join(value.root, value.world))); err == nil {
		err = normalizeTerrainPermissions(stage)
	}
	pendingPreviews := inspected.Format == "pmtiles" && len(inspected.Styles) > 0
	if err == nil && pendingPreviews {
		err = os.WriteFile(filepath.Join(stage, previewPendingMarker), []byte("pending\n"), 0644)
	}
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	s.terrainMu.Lock()
	final := filepath.Join(s.config.MapsPath, value.world)
	if _, err = os.Lstat(final); err == nil {
		err = errConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		// keep filesystem error
	} else {
		err = removeWorldPreviews(s.config.PreviewCachePath, value.world)
		if err == nil {
			err = os.Rename(stage, final)
		}
	}
	s.terrainMu.Unlock()
	if err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	item, err := s.adminWorld(r.Context(), value.world)
	if err != nil {
		category = "internal"
		writeTerrainError(w, err)
		return
	}
	if !pendingPreviews {
		s.broadcastWorldSnapshots(r.Context(), value.world)
	} else {
		category = "preview_pending"
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) completeWorldPreviews(w http.ResponseWriter, r *http.Request) {
	world := r.PathValue("world")
	if !safeWorldName.MatchString(world) {
		http.NotFound(w, r)
		return
	}
	if !s.beginTerrainOperation() {
		writeTerrainError(w, errTerrainBusy)
		return
	}
	defer s.endTerrainOperation()
	s.terrainMu.Lock()
	item, err := s.adminWorld(r.Context(), world)
	if err == nil && !item.Valid {
		err = fmt.Errorf("%w: terrain files are invalid", errTerrainInvalid)
	}
	if err == nil && !item.Ready {
		err = verifyWorldPreviews(s.config.PreviewCachePath, item)
		if err == nil {
			err = os.Remove(filepath.Join(s.config.MapsPath, world, previewPendingMarker))
		}
	}
	if err == nil {
		item, err = s.adminWorld(r.Context(), world)
	}
	s.terrainMu.Unlock()
	if err != nil {
		writeTerrainError(w, err)
		return
	}
	s.broadcastWorldSnapshots(r.Context(), world)
	writeJSON(w, http.StatusOK, item)
}

func verifyWorldPreviews(cacheRoot string, world AdminWorld) error {
	if strings.TrimSpace(cacheRoot) == "" || world.Format != "pmtiles" {
		return fmt.Errorf("%w: preview generation is incomplete", errTerrainInvalid)
	}
	for _, style := range world.Styles {
		info, err := os.Lstat(filepath.Join(cacheRoot, world.Name, style+".png"))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return fmt.Errorf("%w: preview generation is incomplete", errTerrainInvalid)
		}
	}
	return nil
}

func extractTerrainArchive(archivePath, destination string, maxFiles int, maxBytes int64) (extractedTerrain, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return extractedTerrain{}, fmt.Errorf("%w: malformed ZIP", errTerrainInvalid)
	}
	defer reader.Close()
	world := ""
	files := 0
	var declared int64
	seen := map[string]bool{}
	regular := map[string]bool{}
	directories := map[string]bool{}
	for _, entry := range reader.File {
		name := entry.Name
		if name == "" || strings.ContainsAny(name, `\:`) || strings.HasPrefix(name, "/") || filepath.VolumeName(name) != "" {
			return extractedTerrain{}, fmt.Errorf("%w: unsafe archive path", errTerrainInvalid)
		}
		clean := path.Clean(name)
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != strings.TrimSuffix(name, "/") {
			return extractedTerrain{}, fmt.Errorf("%w: unsafe archive path", errTerrainInvalid)
		}
		parts := strings.Split(clean, "/")
		if seen[clean] {
			return extractedTerrain{}, fmt.Errorf("%w: duplicate archive path", errTerrainInvalid)
		}
		seen[clean] = true
		for i := 1; i < len(parts); i++ {
			parent := strings.Join(parts[:i], "/")
			if regular[parent] {
				return extractedTerrain{}, fmt.Errorf("%w: conflicting archive paths", errTerrainInvalid)
			}
			directories[parent] = true
		}
		if !safeWorldName.MatchString(parts[0]) {
			return extractedTerrain{}, fmt.Errorf("%w: invalid world ID", errTerrainInvalid)
		}
		if world == "" {
			world = parts[0]
		} else if world != parts[0] {
			return extractedTerrain{}, fmt.Errorf("%w: ZIP must contain one top-level directory", errTerrainInvalid)
		}
		mode := entry.Mode()
		if entry.FileInfo().IsDir() {
			if regular[clean] {
				return extractedTerrain{}, fmt.Errorf("%w: conflicting archive paths", errTerrainInvalid)
			}
			directories[clean] = true
			continue
		}
		if len(parts) == 1 {
			return extractedTerrain{}, fmt.Errorf("%w: loose root file", errTerrainInvalid)
		}
		if !mode.IsRegular() {
			return extractedTerrain{}, fmt.Errorf("%w: special files are not allowed", errTerrainInvalid)
		}
		if directories[clean] {
			return extractedTerrain{}, fmt.Errorf("%w: conflicting archive paths", errTerrainInvalid)
		}
		regular[clean] = true
		if strings.EqualFold(path.Ext(clean), ".zip") {
			return extractedTerrain{}, fmt.Errorf("%w: nested ZIP files are not allowed", errTerrainInvalid)
		}
		files++
		if files > maxFiles || entry.UncompressedSize64 > uint64(maxBytes-declared) {
			return extractedTerrain{}, errTerrainLimit
		}
		declared += int64(entry.UncompressedSize64)
	}
	if world == "" {
		return extractedTerrain{}, fmt.Errorf("%w: ZIP is empty", errTerrainInvalid)
	}
	if err := os.MkdirAll(destination, 0755); err != nil {
		return extractedTerrain{}, err
	}
	var copied int64
	for _, entry := range reader.File {
		clean := path.Clean(entry.Name)
		target := filepath.Join(destination, filepath.FromSlash(clean))
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return extractedTerrain{}, err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return extractedTerrain{}, err
		}
		source, err := entry.Open()
		if err != nil {
			return extractedTerrain{}, fmt.Errorf("%w: unreadable ZIP entry", errTerrainInvalid)
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			source.Close()
			return extractedTerrain{}, err
		}
		written, copyErr := io.Copy(output, io.LimitReader(source, maxBytes-copied+1))
		closeSourceErr := source.Close()
		closeOutputErr := output.Close()
		copied += written
		if copied > maxBytes {
			return extractedTerrain{}, errTerrainLimit
		}
		if copyErr != nil || closeSourceErr != nil || closeOutputErr != nil {
			return extractedTerrain{}, fmt.Errorf("%w: unreadable ZIP entry", errTerrainInvalid)
		}
	}
	mapInfo, err := os.Stat(filepath.Join(destination, world, "map.json"))
	if err != nil || !mapInfo.Mode().IsRegular() || mapInfo.Size() == 0 {
		return extractedTerrain{}, fmt.Errorf("%w: map.json is missing or empty", errTerrainInvalid)
	}
	return extractedTerrain{world: world, root: destination, bytes: copied}, nil
}

func normalizeTerrainPermissions(root string) error {
	return filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.Chmod(name, 0755)
		}
		return os.Chmod(name, 0644)
	})
}

func (s *Server) deleteWorld(w http.ResponseWriter, r *http.Request, world string) {
	started := time.Now()
	user, _ := contextUser(r.Context())
	category := "success"
	var active, trashed int
	defer func() {
		slog.Info("terrain operation", "operation", "delete", "administrator", user.ID, "world", world, "activeMaps", active, "trashedMaps", trashed, "durationMs", time.Since(started).Milliseconds(), "result", category)
	}()
	if !s.beginTerrainOperation() {
		category = "conflict"
		writeTerrainError(w, errTerrainBusy)
		return
	}
	defer s.endTerrainOperation()
	var confirmed struct {
		ActiveMaps  int `json:"activeMaps"`
		TrashedMaps int `json:"trashedMaps"`
	}
	if !decodeJSON(w, r, &confirmed) {
		category = "validation"
		return
	}
	if confirmed.ActiveMaps < 0 || confirmed.TrashedMaps < 0 {
		category = "validation"
		http.Error(w, "map counts must not be negative", http.StatusBadRequest)
		return
	}
	s.terrainMu.Lock()
	item, err := s.adminWorld(r.Context(), world)
	if err == nil {
		active, trashed = item.ActiveMaps, item.TrashedMaps
	}
	if err == nil && (active != confirmed.ActiveMaps || trashed != confirmed.TrashedMaps) {
		s.terrainMu.Unlock()
		category = "stale_counts"
		writeJSON(w, http.StatusConflict, item)
		return
	}
	tombstone := ""
	if err == nil {
		id, tokenErr := newID()
		if tokenErr != nil {
			err = tokenErr
		} else {
			tombstone = filepath.Join(s.config.MapsPath, deletingPrefix+id)
			err = os.Rename(filepath.Join(s.config.MapsPath, world), tombstone)
		}
	}
	if err != nil {
		s.terrainMu.Unlock()
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	ids, trashErr := s.store.trashActiveMapsByWorld(r.Context(), user, world)
	if trashErr != nil {
		if restoreErr := os.Rename(tombstone, filepath.Join(s.config.MapsPath, world)); restoreErr != nil {
			slog.Error("terrain rollback failed", "operation", "delete", "administrator", user.ID, "world", world, "result", "rollback_failed")
		}
		s.terrainMu.Unlock()
		category = terrainErrorCategory(trashErr)
		writeTerrainError(w, trashErr)
		return
	}
	s.terrainMu.Unlock()
	for _, id := range ids {
		if value, getErr := s.store.getMap(r.Context(), id); getErr == nil {
			s.broadcastSnapshot(id, value)
		}
	}
	if err := os.RemoveAll(tombstone); err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	if err := removeWorldPreviews(s.config.PreviewCachePath, world); err != nil {
		category = terrainErrorCategory(err)
		writeTerrainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func removeWorldPreviews(cacheRoot, world string) error {
	if strings.TrimSpace(cacheRoot) == "" || !safeWorldName.MatchString(world) {
		return nil
	}
	return os.RemoveAll(filepath.Join(cacheRoot, world))
}

func (s *Server) broadcastWorldSnapshots(ctx context.Context, world string) {
	ids, err := s.store.activeMapIDsByWorld(ctx, world)
	if err != nil {
		return
	}
	for _, id := range ids {
		if value, err := s.store.getMap(ctx, id); err == nil {
			s.broadcastSnapshot(id, value)
		}
	}
}

func cleanupTerrainArtifacts(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() || !internalTerrainName.MatchString(entry.Name()) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func terrainErrorCategory(err error) string {
	switch {
	case errors.Is(err, errTerrainBusy), errors.Is(err, errConflict):
		return "conflict"
	case errors.Is(err, errNotFound):
		return "not_found"
	case errors.Is(err, errTerrainLimit), errors.As(err, new(*http.MaxBytesError)):
		return "limit"
	case errors.Is(err, syscall.ENOSPC):
		return "storage"
	case errors.Is(err, errTerrainInvalid):
		return "validation"
	default:
		return "internal"
	}
}

func writeTerrainError(w http.ResponseWriter, err error) {
	switch terrainErrorCategory(err) {
	case "conflict":
		http.Error(w, "terrain already exists or another terrain operation is running", http.StatusConflict)
	case "not_found":
		http.Error(w, "terrain not found", http.StatusNotFound)
	case "limit":
		http.Error(w, "terrain archive exceeds configured limits", http.StatusRequestEntityTooLarge)
	case "storage":
		http.Error(w, "insufficient storage", http.StatusInsufficientStorage)
	case "validation":
		message := strings.TrimPrefix(err.Error(), errTerrainInvalid.Error()+": ")
		http.Error(w, message, http.StatusBadRequest)
	default:
		http.Error(w, "terrain operation failed", http.StatusInternalServerError)
	}
}
