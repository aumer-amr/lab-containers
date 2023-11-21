package main

import (
	"os"
    "github.com/rs/zerolog"
    "github.com/rs/zerolog/log"
	cfg "github.com/golobby/config/v3"
	"github.com/golobby/config/v3/pkg/feeder"
    app "github.com/aumer-amr/containers/apps/bitwarden-backup/internal/app"
)

var (
    config app.BWBackupConfig
)

func init() {
    dotEnvFeeder := feeder.DotEnv{ Path: ".env" }
	envFeeder := feeder.Env{}

	cfg.New().AddFeeder(dotEnvFeeder).AddStruct(&config).Feed()
	cfg.New().AddFeeder(envFeeder).AddStruct(&config).Feed()

    log.Logger = log.With().Caller().Logger().Output(zerolog.ConsoleWriter{ Out: os.Stderr })

    if config.GetDebug() {
        zerolog.SetGlobalLevel(zerolog.DebugLevel)
    } else {
        zerolog.SetGlobalLevel(zerolog.InfoLevel)
    }
}

func main() {
	log.Info().Msg("Starting Bitwarden Backup")
    log.Debug().Msg("Debugging enabled")

    bwBackup := app.NewBWBackup(&config)
    bwBackup.Backup()
}