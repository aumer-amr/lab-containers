package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeadersRequireLocalMarkerArtwork(t *testing.T) {
	response := httptest.NewRecorder()
	securityHeaders(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if csp := response.Header().Get("Content-Security-Policy"); strings.Contains(csp, "atlas.plan-ops.fr") {
		t.Fatalf("external marker artwork allowed by content security policy: %q", csp)
	}
}

func TestSecurityHeadersAllowDiscordAvatars(t *testing.T) {
	response := httptest.NewRecorder()
	securityHeaders(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if csp := response.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "https://cdn.discordapp.com") {
		t.Fatalf("Discord avatars blocked by content security policy: %q", csp)
	}
}
