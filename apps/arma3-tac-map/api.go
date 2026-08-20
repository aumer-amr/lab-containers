package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
)

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /auth/login", s.login)
	mux.HandleFunc("GET /auth/callback", s.callback)
	protected := http.NewServeMux()
	protected.HandleFunc("POST /auth/logout", s.logout)
	protected.HandleFunc("GET /api/me", s.me)
	protected.HandleFunc("GET /api/worlds", s.worlds)
	protected.HandleFunc("GET /api/worlds/{world}/assets/{asset...}", s.worldAsset)
	protected.HandleFunc("GET /api/assets/fonts/{asset...}", s.sharedAsset)
	protected.HandleFunc("GET /api/maps", s.maps)
	protected.HandleFunc("POST /api/maps", s.maps)
	protected.HandleFunc("GET /api/trash", s.trash)
	protected.HandleFunc("GET /api/maps/{map}", s.mapByID)
	protected.HandleFunc("PATCH /api/maps/{map}", s.mapByID)
	protected.HandleFunc("DELETE /api/maps/{map}", s.mapByID)
	protected.HandleFunc("POST /api/maps/{map}/trash/restore", s.restoreTrash)
	protected.HandleFunc("POST /api/maps/{map}/layers", s.layers)
	protected.HandleFunc("PATCH /api/maps/{map}/layers/{layer}", s.layerByID)
	protected.HandleFunc("DELETE /api/maps/{map}/layers/{layer}", s.layerByID)
	protected.HandleFunc("PUT /api/maps/{map}/layers/order", s.layerOrder)
	protected.HandleFunc("GET /api/maps/{map}/revisions", s.revisionList)
	protected.HandleFunc("POST /api/maps/{map}/revisions/{revision}/restore", s.restoreHistory)
	protected.HandleFunc("POST /api/maps/{map}/exports/aet", s.aetExport)
	protected.HandleFunc("GET /api/maps/{map}/ws", s.webSocket)
	mux.Handle("/api/", s.authenticate(s.checkOrigin(protected)))
	mux.Handle("POST /auth/logout", s.authenticate(s.checkOrigin(protected)))
	mux.Handle("/", s.frontend())
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.store.db.PingContext(r.Context()); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := mapsReady(s.config.MapsPath); err != nil {
		http.Error(w, "maps volume unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte("ready\n"))
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	writeJSON(w, http.StatusOK, user)
}
func (s *Server) worlds(w http.ResponseWriter, r *http.Request) {
	worlds, err := discoverWorlds(s.config.MapsPath)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, worlds)
}
func (s *Server) worldAsset(w http.ResponseWriter, r *http.Request) {
	serveWorldAsset(s.config.MapsPath, r.PathValue("world"), r.PathValue("asset"), w, r)
}
func (s *Server) sharedAsset(w http.ResponseWriter, r *http.Request) {
	serveAsset(filepath.Join(s.config.MapsPath, "fonts"), r.PathValue("asset"), w, r)
}

func (s *Server) maps(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	if r.Method == http.MethodGet {
		values, err := s.store.listMaps(r.Context(), false)
		if err != nil {
			writeError(w, err)
			return
		}
		if err := s.markWorldAvailability(values); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, values)
		return
	}
	var input struct {
		Name  string `json:"name"`
		World string `json:"world"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.worldExists(input.World) {
		http.Error(w, "world is incomplete or unavailable", http.StatusBadRequest)
		return
	}
	value, err := s.store.createMap(r.Context(), user, input.Name, input.World)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (s *Server) mapByID(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	id := r.PathValue("map")
	switch r.Method {
	case http.MethodGet:
		value, err := s.getMap(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, value)
	case http.MethodPatch:
		var input struct {
			Name string `json:"name"`
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		if err := s.store.renameMap(r.Context(), user, id, input.Name); err != nil {
			writeError(w, err)
			return
		}
		value, err := s.getMap(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcastSnapshot(id, value)
		writeJSON(w, http.StatusOK, value)
	case http.MethodDelete:
		if err := s.store.setMapDeleted(r.Context(), user, id, true); err != nil {
			writeError(w, err)
			return
		}
		s.closeRoom(id)
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) trash(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	if !user.Admin {
		writeError(w, errForbidden)
		return
	}
	values, err := s.store.listMaps(r.Context(), true)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.markWorldAvailability(values); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, values)
}
func (s *Server) restoreTrash(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	if err := s.store.setMapDeleted(r.Context(), user, r.PathValue("map"), false); err != nil {
		writeError(w, err)
		return
	}
	value, err := s.getMap(r.Context(), r.PathValue("map"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *Server) layers(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	var input struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value, err := s.store.createLayer(r.Context(), user, r.PathValue("map"), input.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	snapshot, err := s.getMap(r.Context(), r.PathValue("map"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastSnapshot(r.PathValue("map"), snapshot)
	writeJSON(w, http.StatusCreated, value)
}
func (s *Server) layerByID(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	mapID, layerID := r.PathValue("map"), r.PathValue("layer")
	var err error
	if r.Method == http.MethodPatch {
		var input struct {
			Name string `json:"name"`
		}
		if !decodeJSON(w, r, &input) {
			return
		}
		err = s.store.updateLayer(r.Context(), user, mapID, layerID, input.Name)
	} else {
		err = s.store.deleteLayer(r.Context(), user, mapID, layerID)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	snapshot, err := s.getMap(r.Context(), mapID)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastSnapshot(mapID, snapshot)
	if r.Method == http.MethodDelete {
		w.WriteHeader(http.StatusNoContent)
	} else {
		writeJSON(w, http.StatusOK, snapshot)
	}
}
func (s *Server) layerOrder(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	var input struct {
		LayerIDs []string `json:"layerIds"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.store.reorderLayers(r.Context(), user, r.PathValue("map"), input.LayerIDs); err != nil {
		writeError(w, err)
		return
	}
	snapshot, err := s.getMap(r.Context(), r.PathValue("map"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcastSnapshot(r.PathValue("map"), snapshot)
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) revisionList(w http.ResponseWriter, r *http.Request) {
	values, err := s.store.revisions(r.Context(), r.PathValue("map"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, values)
}
func (s *Server) restoreHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	mapID := r.PathValue("map")
	revision, err := strconv.ParseInt(r.PathValue("revision"), 10, 64)
	if err != nil {
		http.Error(w, "invalid revision", http.StatusBadRequest)
		return
	}
	room := s.getRoom(mapID)
	room.mutationMu.Lock()
	defer room.mutationMu.Unlock()
	value, err := s.store.restoreRevision(r.Context(), user, mapID, revision)
	if err != nil {
		writeError(w, err)
		return
	}
	value.WorldAvailable = s.worldExists(value.World)
	s.broadcastSnapshot(value.ID, value)
	writeJSON(w, http.StatusOK, value)
}
func (s *Server) aetExport(w http.ResponseWriter, r *http.Request) {
	var input struct {
		LayerIDs []string `json:"layerIds"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value, err := s.getMap(r.Context(), r.PathValue("map"))
	if err != nil {
		writeError(w, err)
		return
	}
	if err = selectedLayerIDs(value, input.LayerIDs); err != nil {
		writeError(w, err)
		return
	}
	output, err := exportAET(value, input.LayerIDs)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(output))
}

func (s *Server) worldExists(name string) bool {
	if !safeWorldName.MatchString(name) {
		return false
	}
	_, err := inspectWorld(s.config.MapsPath, name)
	return err == nil
}

func (s *Server) getMap(ctx context.Context, id string) (Map, error) {
	value, err := s.store.getMap(ctx, id)
	if err == nil {
		value.WorldAvailable = s.worldExists(value.World)
	}
	return value, err
}
func (s *Server) markWorldAvailability(values []Map) error {
	worlds, err := discoverWorlds(s.config.MapsPath)
	if err != nil {
		return err
	}
	available := map[string]bool{}
	for _, world := range worlds {
		available[world.Name] = true
	}
	for i := range values {
		values[i].WorldAvailable = available[values[i].World]
	}
	return nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, errNotFound):
		status = http.StatusNotFound
	case errors.Is(err, errForbidden):
		status = http.StatusForbidden
	case errors.Is(err, errConflict):
		status = http.StatusConflict
	case strings.Contains(err.Error(), "limit"), strings.Contains(err.Error(), "invalid"), strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "unsupported"), strings.Contains(err.Error(), "must contain"), strings.Contains(err.Error(), "does not belong"), strings.Contains(err.Error(), "unknown"):
		status = http.StatusBadRequest
	}
	http.Error(w, http.StatusText(status), status)
}
