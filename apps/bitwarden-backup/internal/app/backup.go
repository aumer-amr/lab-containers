package app

import (
    "github.com/rs/zerolog/log"
	"os"
)

type BWBackup struct {
	config BWBackupConfig
}

func NewBWBackup(config *BWBackupConfig) *BWBackup {
	return &BWBackup{
		config: *config,
	}
}

func (b *BWBackup) Validate() {
	if CommandExists("bw") == false {
		log.Fatal().Msg("Bitwarden CLI not found")
		os.Exit(1)
	}

	if CommandExists("veracrypt") == false {
		log.Fatal().Msg("Veracrypt not found")
		os.Exit(1)
	}
}

func (b *BWBackup) Backup() {
	log.Info().Msg("Running Bitwarden Backup")

	b.Validate()

	bitwarden := NewBitwarden(&b.config)

    bitwarden.SetServer(b.config.GetBWHost())
	bitwarden.Login()
	bitwarden.UnlockVault()
	bitwarden.Export()

	size := GetFileSize(bitwarden.GetExportFile())

	veracrypt := NewVeracrypt(&b.config)
	veracrypt.Prepare()
	veracrypt.Create(size)
	veracrypt.Mount()

	bitwarden.StoreExport(veracrypt.GetMountPath() + "/" + bitwarden.GetExportFile())

	veracrypt.Unmount()
	bitwarden.DeleteExport()

	bitwarden.Logout()
}