package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const cursorBroadcastInterval = 30 * time.Millisecond

type socketMessage struct {
	Type       string      `json:"type"`
	Version    int64       `json:"version,omitempty"`
	Operation  string      `json:"operation,omitempty"`
	Annotation *Annotation `json:"annotation,omitempty"`
	ID         string      `json:"id,omitempty"`
	Actor      *User       `json:"actor,omitempty"`
	Map        *Map        `json:"map,omitempty"`
	Cursor     *Point      `json:"cursor,omitempty"`
	Message    string      `json:"message,omitempty"`
}
type client struct {
	user       User
	send       chan socketMessage
	lastCursor time.Time
	cancel     context.CancelFunc
}
type room struct {
	mu         sync.RWMutex
	mutationMu sync.Mutex
	clients    map[*client]bool
}

func (s *Server) getRoom(id string) *room {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()
	value := s.rooms[id]
	if value == nil {
		value = &room{clients: map[*client]bool{}}
		s.rooms[id] = value
	}
	return value
}
func (r *room) add(c *client)    { r.mu.Lock(); r.clients[c] = true; r.mu.Unlock() }
func (r *room) remove(c *client) { r.mu.Lock(); delete(r.clients, c); r.mu.Unlock() }
func (r *room) broadcast(message socketMessage) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for c := range r.clients {
		select {
		case c.send <- message:
		default:
			c.cancel()
		}
	}
}
func (s *Server) broadcastSnapshot(id string, value Map) {
	value.WorldAvailable = s.worldExists(value.World)
	s.roomsMu.RLock()
	room := s.rooms[id]
	s.roomsMu.RUnlock()
	if room != nil {
		room.broadcast(socketMessage{Type: "snapshot", Version: value.Version, Map: &value})
	}
}
func (s *Server) closeRoom(id string) {
	s.roomsMu.Lock()
	room := s.rooms[id]
	delete(s.rooms, id)
	s.roomsMu.Unlock()
	if room != nil {
		room.mu.RLock()
		defer room.mu.RUnlock()
		for c := range room.clients {
			c.cancel()
		}
	}
}

func (s *Server) webSocket(w http.ResponseWriter, r *http.Request) {
	user, _ := contextUser(r.Context())
	mapID := r.PathValue("map")
	snapshot, err := s.getMap(r.Context(), mapID)
	if err != nil || snapshot.Deleted || !s.worldExists(snapshot.World) {
		if err == nil {
			err = errForbidden
		}
		writeError(w, err)
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	connection.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	c := &client{user: user, send: make(chan socketMessage, 32), cancel: cancel}
	room := s.getRoom(mapID)
	room.add(c)
	defer func() {
		cancel()
		room.remove(c)
		room.broadcast(socketMessage{Type: "presence", Actor: &user, Message: "left"})
		connection.CloseNow()
	}()
	room.broadcast(socketMessage{Type: "presence", Actor: &user, Message: "joined"})
	c.send <- socketMessage{Type: "snapshot", Version: snapshot.Version, Map: &snapshot}
	writerDone := make(chan error, 1)
	go func() {
		for {
			select {
			case <-ctx.Done():
				writerDone <- ctx.Err()
				return
			case message := <-c.send:
				writeCtx, cancelWrite := context.WithTimeout(ctx, 5*time.Second)
				err := wsjson.Write(writeCtx, connection, message)
				cancelWrite()
				if err != nil {
					writerDone <- err
					return
				}
			}
		}
	}()
	for {
		var message socketMessage
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			return
		}
		switch message.Type {
		case "mutation":
			if message.Operation != "delete" && message.Annotation == nil {
				c.send <- socketMessage{Type: "error", Message: "annotation required"}
				continue
			}
			annotation := Annotation{}
			if message.Annotation != nil {
				annotation = *message.Annotation
			}
			room.mutationMu.Lock()
			version, err := s.store.mutateAnnotation(ctx, user, mapID, message.Operation, &annotation, message.ID, 0)
			if err != nil {
				room.mutationMu.Unlock()
				c.send <- socketMessage{Type: "error", Message: publicError(err)}
				continue
			}
			committed := message
			committed.Type = "mutation"
			committed.Version = version
			committed.Actor = &user
			if message.Operation != "delete" {
				committed.Annotation = &annotation
			}
			room.broadcast(committed)
			room.mutationMu.Unlock()
			c.send <- socketMessage{Type: "acknowledgement", Version: version, ID: annotation.ID}
		case "cursor":
			now := time.Now()
			if message.Cursor == nil {
				c.lastCursor = time.Time{}
				room.broadcast(socketMessage{Type: "cursor", Actor: &user})
			} else if now.Sub(c.lastCursor) >= cursorBroadcastInterval {
				c.lastCursor = now
				room.broadcast(socketMessage{Type: "cursor", Actor: &user, Cursor: message.Cursor})
			}
		case "presence":
			c.send <- socketMessage{Type: "presence", Actor: &user, Message: "present"}
		default:
			c.send <- socketMessage{Type: "error", Message: "unsupported message type"}
		}
		select {
		case <-writerDone:
			return
		default:
		}
	}
}

func publicError(err error) string {
	switch {
	case errors.Is(err, errForbidden):
		return "forbidden"
	case errors.Is(err, errNotFound):
		return "not found"
	case errors.Is(err, errConflict):
		return "conflict"
	}
	return "invalid mutation"
}

var _ = json.Valid
