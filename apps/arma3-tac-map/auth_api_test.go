package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testConfig(t *testing.T, mapsPath string) Config {
	t.Helper()
	publicURL, _ := url.Parse("https://maps.example.test")
	return Config{PublicURL: publicURL, DiscordClientID: "client", DiscordClientSecret: "secret", DiscordGuildID: "guild", DiscordAllowedRoleID: "role", AdminIDs: map[string]bool{"admin": true}, DatabasePath: t.TempDir() + "/test.db", MapsPath: mapsPath, ListenAddress: ":0", DiscordAuthorizeURL: "https://discord.example/authorize", DiscordTokenURL: "https://discord.example/token", DiscordAPIURL: "https://discord.example/api"}
}
func authenticatedRequest(t *testing.T, server *Server, user User, method, path, body string) *http.Request {
	t.Helper()
	if err := server.store.upsertUser(context.Background(), user); err != nil {
		t.Fatal(err)
	}
	token, err := server.store.createSession(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	if method != http.MethodGet {
		request.Header.Set("Origin", server.config.PublicURL.String())
	}
	request.Header.Set("Content-Type", "application/json")
	return request
}

func cookieNamed(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func TestOAuthRequiresRoleEvenForAdmin(t *testing.T) {
	mapsPath := t.TempDir()
	config := testConfig(t, mapsPath)
	config.AdminIDs = map[string]bool{"admin": true}
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			json.NewEncoder(w).Encode(map[string]string{"access_token": "temporary"})
		case "/api/users/@me":
			json.NewEncoder(w).Encode(map[string]string{"id": "admin", "username": "boss"})
		case "/api/users/@me/guilds/guild/member":
			json.NewEncoder(w).Encode(map[string]any{"roles": []string{"different"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer discord.Close()
	config.DiscordTokenURL = discord.URL + "/token"
	config.DiscordAPIURL = discord.URL + "/api"
	store := testStore(t)
	server := newServer(config, store)
	handler := server.routes()
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, httptest.NewRequest(http.MethodGet, "/auth/login", nil))
	location, err := url.Parse(login.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	callback := httptest.NewRecorder()
	callbackRequest := httptest.NewRequest(http.MethodGet, "/auth/callback?code=ok&state="+url.QueryEscape(location.Query().Get("state")), nil)
	callbackRequest.AddCookie(cookieNamed(login.Result().Cookies(), oauthStateCookie))
	handler.ServeHTTP(callback, callbackRequest)
	if callback.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", callback.Code, callback.Body.String())
	}
	if cookieNamed(callback.Result().Cookies(), sessionCookie) != nil {
		t.Fatal("denied login issued cookie")
	}
}

func TestOAuthSessionAndExpiry(t *testing.T) {
	config := testConfig(t, t.TempDir())
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			json.NewEncoder(w).Encode(map[string]string{"access_token": "temporary"})
		case "/api/users/@me":
			json.NewEncoder(w).Encode(map[string]string{"id": "member", "username": "member", "global_name": "Member"})
		case "/api/users/@me/guilds/guild/member":
			json.NewEncoder(w).Encode(map[string]any{"roles": []string{"role"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer discord.Close()
	config.DiscordTokenURL = discord.URL + "/token"
	config.DiscordAPIURL = discord.URL + "/api"
	store := testStore(t)
	server := newServer(config, store)
	handler := server.routes()
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, httptest.NewRequest(http.MethodGet, "/auth/login", nil))
	location, _ := url.Parse(login.Header().Get("Location"))
	callback := httptest.NewRecorder()
	callbackRequest := httptest.NewRequest(http.MethodGet, "/auth/callback?code=ok&state="+url.QueryEscape(location.Query().Get("state")), nil)
	callbackRequest.AddCookie(cookieNamed(login.Result().Cookies(), oauthStateCookie))
	handler.ServeHTTP(callback, callbackRequest)
	if callback.Code != http.StatusFound {
		t.Fatalf("status=%d body=%s", callback.Code, callback.Body.String())
	}
	cookie := cookieNamed(callback.Result().Cookies(), sessionCookie)
	if cookie == nil || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("bad session cookie: %#v", callback.Result().Cookies())
	}
	meRequest := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meRequest.AddCookie(cookie)
	me := httptest.NewRecorder()
	handler.ServeHTTP(me, meRequest)
	if me.Code != http.StatusOK {
		t.Fatalf("me status=%d", me.Code)
	}
	store.db.Exec(`UPDATE sessions SET expires_at=?`, time.Now().Add(-time.Minute).Unix())
	expired := httptest.NewRecorder()
	handler.ServeHTTP(expired, meRequest)
	if expired.Code != http.StatusUnauthorized {
		t.Fatalf("expired status=%d", expired.Code)
	}
}

func TestUnsafeAPIRequiresExactOrigin(t *testing.T) {
	store := testStore(t)
	server := newServer(testConfig(t, t.TempDir()), store)
	request := authenticatedRequest(t, server, User{ID: "member", Username: "member", DisplayName: "Member"}, http.MethodPost, "/auth/logout", "")
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d", response.Code)
	}
}

func TestAuthenticatedPMTilesRange(t *testing.T) {
	root := t.TempDir()
	world := filepath.Join(root, "altis")
	if err := os.MkdirAll(filepath.Join(world, "styles"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(world, "tiles"), 0755); err != nil {
		t.Fatal(err)
	}
	for path, data := range map[string]string{filepath.Join(world, "map.json"): `{"worldSize":100}`, filepath.Join(world, "styles", "default.json"): `{"url":"pmtiles://tiles/map.pmtiles"}`, filepath.Join(world, "tiles", "map.pmtiles"): "0123456789"} {
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	store := testStore(t)
	server := newServer(testConfig(t, root), store)
	request := authenticatedRequest(t, server, User{ID: "member", Username: "member", DisplayName: "Member"}, http.MethodGet, "/api/worlds/altis/assets/tiles/map.pmtiles", "")
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}
