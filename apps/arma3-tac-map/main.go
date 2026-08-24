package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web/embed
var frontendFiles embed.FS

type Server struct {
	config      Config
	store       *Store
	httpClient  *http.Client
	roomsMu     sync.RWMutex
	rooms       map[string]*room
	terrainMu   sync.RWMutex
	terrainBusy atomic.Bool
}

func newServer(config Config, store *Store) *Server {
	return &Server{config: config, store: store, httpClient: &http.Client{Timeout: 10 * time.Second}, rooms: map[string]*room{}}
}

func newHTTPServer(config Config, handler http.Handler) *http.Server {
	return &http.Server{Addr: config.ListenAddress, Handler: handler, ReadTimeout: 30 * time.Minute, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
}

func (s *Server) frontend() http.Handler {
	directory, err := fs.Sub(frontendFiles, "web/embed")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			if _, err := fs.Stat(directory, r.URL.Path[1:]); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	})
}

func main() {
	config, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	store, err := openStore(config.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer store.close()
	server := newServer(config, store)
	if err := cleanupTerrainArtifacts(config.MapsPath); err != nil {
		log.Printf("terrain cleanup failed")
	}
	httpServer := newHTTPServer(config, server.routes())
	log.Printf("listening on %s", config.ListenAddress)
	log.Fatal(httpServer.ListenAndServe())
}
