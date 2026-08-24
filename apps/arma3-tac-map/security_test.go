package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func secureTestHandler(next http.Handler) http.Handler {
	publicURL, _ := url.Parse("https://maps.example.test")
	return securityHeaders(publicURL, next)
}

func TestSecurityHeadersRequireLocalMarkerArtwork(t *testing.T) {
	response := httptest.NewRecorder()
	secureTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if csp := response.Header().Get("Content-Security-Policy"); strings.Contains(csp, "atlas.plan-ops.fr") {
		t.Fatalf("external marker artwork allowed by content security policy: %q", csp)
	}
}

func TestSecurityHeadersAllowDiscordAvatars(t *testing.T) {
	response := httptest.NewRecorder()
	secureTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if csp := response.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "https://cdn.discordapp.com") {
		t.Fatalf("Discord avatars blocked by content security policy: %q", csp)
	}
}

func TestSecurityHeadersRestrictEmbeddingAndConnections(t *testing.T) {
	response := httptest.NewRecorder()
	secureTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	csp := response.Header().Get("Content-Security-Policy")
	for _, required := range []string{"connect-src 'self' wss://maps.example.test", "frame-ancestors 'none'"} {
		if !strings.Contains(csp, required) {
			t.Fatalf("content security policy missing %q: %q", required, csp)
		}
	}
	if strings.Contains(csp, " ws: wss:") {
		t.Fatalf("content security policy permits arbitrary WebSocket origins: %q", csp)
	}
	if response.Header().Get("Strict-Transport-Security") == "" || response.Header().Get("Permissions-Policy") == "" {
		t.Fatalf("security headers missing: %#v", response.Header())
	}
}

func TestSensitiveJSONIsNotCached(t *testing.T) {
	response := httptest.NewRecorder()
	writeJSON(response, http.StatusOK, map[string]bool{"ok": true})
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control=%q", got)
	}
}

func TestHTTPServerLimitsRequestReadTime(t *testing.T) {
	server := newHTTPServer(Config{ListenAddress: ":0"}, http.NotFoundHandler())
	if server.ReadTimeout != 30*time.Minute || server.ReadHeaderTimeout != 5*time.Second || server.IdleTimeout != time.Minute {
		t.Fatalf("unexpected timeouts: read=%s header=%s idle=%s", server.ReadTimeout, server.ReadHeaderTimeout, server.IdleTimeout)
	}
}
