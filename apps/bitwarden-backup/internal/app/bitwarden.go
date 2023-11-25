package app

import (
    "github.com/rs/zerolog/log"
	"os/exec"
	"os"
	"strings"
)

type Bitwarden struct {
	config BWBackupConfig
	session string
}

const (
	EXPORTFILE string = "bitwarden_export.json"
	EXPORTPATH string = "/backup"
)

func NewBitwarden(config *BWBackupConfig) *Bitwarden {
	return &Bitwarden{
		config: *config,
	}
}

func (b *Bitwarden) GetExportFile() string {
	return EXPORTFILE
}

func (b *Bitwarden) GetExportPath() string {
	return EXPORTPATH
}

func (b *Bitwarden) SetServer(host string) {
	log.Info().Msg("Setting Bitwarden Server")

	err, stdout := b.ExecuteBWCommand("config", "server", host)
	if err != nil {
		log.Error().Msgf("Failed to set server: %s", stdout)
		os.Exit(1)
	} else {
		log.Info().Msg(stdout)
	}
}

func (b *Bitwarden) StoreExport(path string) (error) {
	log.Info().Msg("Storing Bitwarden Export")

	err := MoveFile(EXPORTPATH + "/" + EXPORTFILE, path)
	if err != nil {
		log.Error().Msgf("Failed to move export: %s", err)
		b.DeleteExport()
		b.Logout()
		os.Exit(1)
	}
	return err
}

func (b *Bitwarden) DeleteExport() {
	log.Info().Msg("Deleting Bitwarden Export")

	DeleteFile(EXPORTPATH + "/" + EXPORTFILE)
}

func (b *Bitwarden) Export() {
	log.Info().Msg("Exporting Bitwarden Vault")

	err, stdout := b.ExecuteBWCommand("export", "--output", EXPORTPATH + "/" + EXPORTFILE, "--format", "encrypted_json", "--password", b.config.GetBWPassword())
	if err != nil {
		log.Error().Msgf("Failed to export vault: %s", stdout)
		b.Logout()
		os.Exit(1)
	} else {
		log.Info().Msg(stdout)
	}
}

func (b *Bitwarden) Logout() {
	log.Info().Msg("Logging out of Bitwarden")

	err, stdout := b.ExecuteBWCommand("logout")
	if err != nil {
		log.Error().Msgf("Failed to logout: %s", stdout)
		os.Exit(1)
	} else {
		log.Info().Msg(stdout)
	}
}

func (b *Bitwarden) Login() (error, string) {
	log.Info().Msg("Logging into Bitwarden")

	err, stdout :=  b.ExecuteBWCommand("login", "--apikey", "--raw")
	if err != nil {
		if strings.Contains(stdout, "You are already logged in as") == false {
			log.Error().Msgf("Failed to login: %s", stdout)
			os.Exit(1)
		} else {
			log.Warn().Msg("Already logged in")
		}
	}
	return err, stdout
}

func (b *Bitwarden) UnlockVault() (error, string) {
	log.Info().Msg("Unlocking Vault")

	_, b.session = b.ExecuteBWCommand("unlock", "--passwordenv", "BW_PASSWORD", "--raw")
	err, stdout := b.ExecuteBWCommand("unlock", "--check")

	if err != nil {
		log.Error().Msgf("Failed to unlock vault: %s", stdout)
		os.Exit(1)
	} else {
		log.Info().Msg(stdout)
	}

	return err, stdout
}

func (b *Bitwarden) ExecuteBWCommand(args ...string) (error, string) {
	cmd := exec.Command("bw", args...)
	cmd.Env = os.Environ()

	if b.session != "" {
		cmd.Env = append(cmd.Env, "BW_SESSION=" + b.session)
	}

	stdout, err := cmd.CombinedOutput()

	if err != nil {
		log.Error().Msgf("Failed to execute command: %s", err)
	}

	if len(stdout) == 0 {
		log.Debug().Msgf("Command output is empty")
		return err, ""
	} else {
		log.Debug().Msgf("Command output: %s", stdout)
	}
	return err, string(stdout)
}
