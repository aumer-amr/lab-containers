package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	sessionCookie    = "tacmap_session"
	oauthStateCookie = "tacmap_oauth_state"
)

type userContextKey struct{}

func contextUser(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userContextKey{}).(User)
	return user, ok
}

type discordToken struct {
	AccessToken string `json:"access_token"`
}
type discordUser struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name"`
	Avatar     string `json:"avatar"`
}
type discordMember struct {
	Roles []string `json:"roles"`
	Nick  string   `json:"nick"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	state, err := s.store.createOAuthState(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Value: state, Path: "/auth/callback", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: 600})
	query := url.Values{"client_id": {s.config.DiscordClientID}, "redirect_uri": {s.config.PublicURL.ResolveReference(&url.URL{Path: "/auth/callback"}).String()}, "response_type": {"code"}, "scope": {"identify guilds.members.read"}, "state": {state}}
	http.Redirect(w, r, s.config.DiscordAuthorizeURL+"?"+query.Encode(), http.StatusFound)
}

func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	stateCookie, cookieErr := r.Cookie(oauthStateCookie)
	http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Path: "/auth/callback", Value: "", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	if cookieErr != nil || subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 {
		http.Error(w, "invalid OAuth state", http.StatusForbidden)
		return
	}
	if err := s.store.consumeOAuthState(r.Context(), state); err != nil {
		if errors.Is(err, errForbidden) {
			http.Error(w, "invalid OAuth state", http.StatusForbidden)
		} else {
			writeError(w, err)
		}
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing OAuth code", http.StatusBadRequest)
		return
	}
	form := url.Values{"client_id": {s.config.DiscordClientID}, "client_secret": {s.config.DiscordClientSecret}, "grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {s.config.PublicURL.ResolveReference(&url.URL{Path: "/auth/callback"}).String()}}
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, s.config.DiscordTokenURL, strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.httpClient.Do(request)
	if err != nil {
		writeError(w, err)
		return
	}
	var token discordToken
	if err = decodeDiscord(response, &token); err != nil {
		writeError(w, err)
		return
	}
	var user discordUser
	if err = s.discordGet(r.Context(), "/users/@me", token.AccessToken, &user); err != nil {
		writeError(w, err)
		return
	}
	var member discordMember
	if err = s.discordGet(r.Context(), "/users/@me/guilds/"+url.PathEscape(s.config.DiscordGuildID)+"/member", token.AccessToken, &member); err != nil {
		writeError(w, err)
		return
	}
	allowed := false
	for _, role := range member.Roles {
		if role == s.config.DiscordAllowedRoleID {
			allowed = true
			break
		}
	}
	if !allowed {
		http.Error(w, "required Discord role missing", http.StatusForbidden)
		return
	}
	display := user.GlobalName
	if member.Nick != "" {
		display = member.Nick
	}
	if display == "" {
		display = user.Username
	}
	local := User{ID: user.ID, Username: user.Username, DisplayName: display, Avatar: user.Avatar}
	if err = s.store.upsertUser(r.Context(), local); err != nil {
		writeError(w, err)
		return
	}
	session, err := s.store.createSession(r.Context(), user.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: session, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: int((24 * time.Hour).Seconds())})
	http.Redirect(w, r, s.config.PublicURL.String(), http.StatusFound)
}

func decodeDiscord(response *http.Response, value any) error {
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return errors.New("Discord request failed")
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(value)
}

func (s *Server) discordGet(ctx context.Context, path, token string, value any) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.config.DiscordAPIURL+path, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := s.httpClient.Do(request)
	if err != nil {
		return err
	}
	return decodeDiscord(response, value)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	cookie, _ := r.Cookie(sessionCookie)
	if cookie != nil {
		s.store.deleteSession(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", Value: "", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		user, err := s.store.sessionUser(r.Context(), cookie.Value, s.config.AdminIDs)
		if err != nil {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Server) checkOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions || strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			if !s.validOrigin(r.Header.Get("Origin")) {
				http.Error(w, "invalid origin", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) validOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Scheme == s.config.PublicURL.Scheme && parsed.Host == s.config.PublicURL.Host
}
