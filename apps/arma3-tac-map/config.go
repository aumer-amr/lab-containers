package main

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	PublicURL            *url.URL
	DiscordClientID      string
	DiscordClientSecret  string
	DiscordGuildID       string
	DiscordAllowedRoleID string
	AdminIDs             map[string]bool
	DatabasePath         string
	MapsPath             string
	ListenAddress        string
	DiscordAuthorizeURL  string
	DiscordTokenURL      string
	DiscordAPIURL        string
}

func loadConfig() (Config, error) {
	required := []string{"PUBLIC_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID", "DISCORD_ALLOWED_ROLE_ID"}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			return Config{}, errors.New(key + " is required")
		}
	}
	publicURL, err := url.Parse(os.Getenv("PUBLIC_URL"))
	if err != nil || publicURL.Scheme == "" || publicURL.Host == "" {
		return Config{}, errors.New("PUBLIC_URL must be an absolute URL")
	}
	adminIDs := make(map[string]bool)
	for _, id := range strings.Split(os.Getenv("ADMIN_DISCORD_USER_IDS"), ",") {
		if id = strings.TrimSpace(id); id != "" {
			adminIDs[id] = true
		}
	}
	return Config{
		PublicURL:            publicURL,
		DiscordClientID:      os.Getenv("DISCORD_CLIENT_ID"),
		DiscordClientSecret:  os.Getenv("DISCORD_CLIENT_SECRET"),
		DiscordGuildID:       os.Getenv("DISCORD_GUILD_ID"),
		DiscordAllowedRoleID: os.Getenv("DISCORD_ALLOWED_ROLE_ID"),
		AdminIDs:             adminIDs,
		DatabasePath:         envOr("DATABASE_PATH", "/data/tacmap.db"),
		MapsPath:             envOr("MAPS_PATH", "/maps"),
		ListenAddress:        envOr("LISTEN_ADDRESS", ":8080"),
		DiscordAuthorizeURL:  "https://discord.com/oauth2/authorize",
		DiscordTokenURL:      "https://discord.com/api/oauth2/token",
		DiscordAPIURL:        "https://discord.com/api/v10",
	}, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
