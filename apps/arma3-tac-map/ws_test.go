package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func completeWorld(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	world := filepath.Join(root, "altis")
	if err := os.MkdirAll(filepath.Join(world, "styles"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(world, "tiles"), 0755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{filepath.Join(world, "map.json"): `{"worldSize":100}`, filepath.Join(world, "styles", "default.json"): `{"url":"pmtiles://tiles/map.pmtiles"}`, filepath.Join(world, "tiles", "map.pmtiles"): "tiles"}
	for path, data := range files {
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func dialMap(t *testing.T, baseURL, mapID, token, origin string) *websocket.Conn {
	t.Helper()
	headers := http.Header{"Cookie": {sessionCookie + "=" + token}, "Origin": {origin}}
	connection, response, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(baseURL, "http")+"/api/maps/"+mapID+"/ws", &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		if response != nil {
			t.Fatalf("dial status=%d error=%v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { connection.CloseNow() })
	return connection
}
func readSocketType(t *testing.T, connection *websocket.Conn, want string) socketMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		var message socketMessage
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			t.Fatalf("read %s: %v", want, err)
		}
		if message.Type == want {
			return message
		}
	}
}

func TestCursorBroadcastRateIsSmooth(t *testing.T) {
	if cursorBroadcastInterval > time.Second/30 {
		t.Fatalf("cursor broadcast interval %s is below 30 Hz", cursorBroadcastInterval)
	}
}

func TestWebSocketCollaborationResyncAndRestore(t *testing.T) {
	store := testStore(t)
	owner := testUser(t, store, "owner", false)
	other := testUser(t, store, "other", false)
	admin := testUser(t, store, "admin", true)
	value, err := store.createMap(context.Background(), owner, "Plan", "altis")
	if err != nil {
		t.Fatal(err)
	}
	config := testConfig(t, completeWorld(t))
	server := newServer(config, store)
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()
	server.config.PublicURL, _ = url.Parse(httpServer.URL)
	ownerToken, err := store.createSession(context.Background(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := store.createSession(context.Background(), other.ID)
	if err != nil {
		t.Fatal(err)
	}
	first := dialMap(t, httpServer.URL, value.ID, ownerToken, httpServer.URL)
	if snapshot := readSocketType(t, first, "snapshot"); snapshot.Version != 1 {
		t.Fatalf("first snapshot version=%d", snapshot.Version)
	}
	second := dialMap(t, httpServer.URL, value.ID, otherToken, httpServer.URL)
	readSocketType(t, second, "snapshot")
	readSocketType(t, first, "presence")
	point := Point{10, 20}
	create := socketMessage{Type: "mutation", Operation: "create", Annotation: &Annotation{LayerID: value.Layers[0].ID, Kind: "marker", Color: "ColorBlue", Icon: "mil_dot", Point: &point, Scale: 1, Label: "first"}}
	if err := wsjson.Write(context.Background(), first, create); err != nil {
		t.Fatal(err)
	}
	firstMutation := readSocketType(t, first, "mutation")
	secondMutation := readSocketType(t, second, "mutation")
	if firstMutation.Version != 2 || secondMutation.Version != 2 || secondMutation.Actor.ID != owner.ID {
		t.Fatalf("bad mutation: %#v", secondMutation)
	}
	annotationID := firstMutation.Annotation.ID
	update := *firstMutation.Annotation
	update.Label = "owner update"
	if err := wsjson.Write(context.Background(), first, socketMessage{Type: "mutation", Operation: "update", ID: annotationID, Annotation: &update}); err != nil {
		t.Fatal(err)
	}
	readSocketType(t, first, "mutation")
	readSocketType(t, second, "mutation")
	update.Label = "last arrival"
	if err := wsjson.Write(context.Background(), second, socketMessage{Type: "mutation", Operation: "update", ID: annotationID, Annotation: &update}); err != nil {
		t.Fatal(err)
	}
	last := readSocketType(t, first, "mutation")
	readSocketType(t, second, "mutation")
	if last.Version != 4 {
		t.Fatalf("last version=%d", last.Version)
	}
	reconnected := dialMap(t, httpServer.URL, value.ID, otherToken, httpServer.URL)
	snapshot := readSocketType(t, reconnected, "snapshot")
	if snapshot.Version != 4 || snapshot.Map.Layers[0].Annotations[0].Label != "last arrival" {
		t.Fatalf("bad resync: %#v", snapshot)
	}
	cursor := Point{5, 6}
	if err := wsjson.Write(context.Background(), first, socketMessage{Type: "cursor", Cursor: &cursor}); err != nil {
		t.Fatal(err)
	}
	cursorMessage := readSocketType(t, second, "cursor")
	if cursorMessage.Actor.ID != owner.ID || *cursorMessage.Cursor != cursor {
		t.Fatalf("bad cursor: %#v", cursorMessage)
	}
	if err := wsjson.Write(context.Background(), first, socketMessage{Type: "cursor"}); err != nil {
		t.Fatal(err)
	}
	cursorEnded := readSocketType(t, second, "cursor")
	if cursorEnded.Actor.ID != owner.ID || cursorEnded.Cursor != nil {
		t.Fatalf("bad cursor end: %#v", cursorEnded)
	}
	adminToken, err := store.createSession(context.Background(), admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/maps/"+value.ID+"/revisions/1/restore", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookie, Value: adminToken})
	request.Header.Set("Origin", httpServer.URL)
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", response.Code, response.Body.String())
	}
	restored := readSocketType(t, first, "snapshot")
	if restored.Version != 5 || len(restored.Map.Layers[0].Annotations) != 0 {
		t.Fatalf("bad restore broadcast: %#v", restored)
	}
}

func TestWebSocketRejectsUnauthorizedOrigin(t *testing.T) {
	store := testStore(t)
	owner := testUser(t, store, "owner", false)
	value, err := store.createMap(context.Background(), owner, "Plan", "altis")
	if err != nil {
		t.Fatal(err)
	}
	server := newServer(testConfig(t, completeWorld(t)), store)
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()
	server.config.PublicURL, _ = url.Parse(httpServer.URL)
	token, err := store.createSession(context.Background(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"Cookie": {sessionCookie + "=" + token}, "Origin": {"https://attacker.example"}}
	_, response, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/maps/"+value.ID+"/ws", &websocket.DialOptions{HTTPHeader: headers})
	if err == nil {
		t.Fatal("unauthorized origin connected")
	}
	if response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("response=%v error=%v", response, err)
	}
}

func TestTerrainDeleteBroadcastsUnavailableAndRejectsWebSocketMutation(t *testing.T) {
	store := testStore(t)
	owner := testUser(t, store, "owner", false)
	value, err := store.createMap(context.Background(), owner, "Plan", "altis")
	if err != nil {
		t.Fatal(err)
	}
	server := newServer(testConfig(t, completeWorld(t)), store)
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()
	server.config.PublicURL, _ = url.Parse(httpServer.URL)
	token, err := store.createSession(context.Background(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	connection := dialMap(t, httpServer.URL, value.ID, token, httpServer.URL)
	readSocketType(t, connection, "snapshot")

	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, authenticatedRequest(t, server, User{ID: "admin", Username: "admin", DisplayName: "Admin"}, http.MethodDelete, "/api/admin/worlds/altis", `{"activeMaps":1,"trashedMaps":0}`))
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%q", response.Code, response.Body.String())
	}
	unavailable := readSocketType(t, connection, "snapshot")
	if unavailable.Map == nil || unavailable.Map.WorldAvailable {
		t.Fatalf("snapshot=%#v", unavailable)
	}
	point := Point{1, 2}
	if err := wsjson.Write(context.Background(), connection, socketMessage{Type: "mutation", Operation: "create", Annotation: &Annotation{LayerID: value.Layers[0].ID, Kind: "marker", Color: "ColorBlue", Icon: "mil_dot", Point: &point, Scale: 1}}); err != nil {
		t.Fatal(err)
	}
	if message := readSocketType(t, connection, "error"); message.Message != "conflict" {
		t.Fatalf("message=%#v", message)
	}
}
