package app

import (
	"github.com/rs/zerolog/log"
	"os/exec"
	"os"
	"strconv"
)

type Veracrypt struct {
	config BWBackupConfig
}

const (
	SAVEPATH string = "/backup/bitwarden_backup.vc"
	MOUNTPATH string = "/backup/exports"
)

func NewVeracrypt(config *BWBackupConfig) *Veracrypt {
	return &Veracrypt{
		config: *config,
	}
}

func (v *Veracrypt) Prepare() {
	log.Info().Msg("Preparing Veracrypt Container")
	CreateDirectory(v.GetMountPath())
}

func (v *Veracrypt) GetMountPath() string {
	return MOUNTPATH
}

func (v *Veracrypt) Mount() {
	log.Info().Msg("Mounting Veracrypt Container")
	err, _ := v.ExecuteVCCommand(
		"-t", 
		"-v",
		"--mount",
		"--pim", "0",
		"-p", v.config.GetVCPassword(),
		"--non-interactive",
		SAVEPATH,
		MOUNTPATH,
	)

	if err != nil {
		log.Fatal().Msgf("Failed to mount Veracrypt Container: %s", err)
		os.Exit(1)
	}
}

func (v *Veracrypt) Unmount() {
	log.Info().Msg("Unmounting Veracrypt Container")
	err, _ := v.ExecuteVCCommand(
		"-t", 
		"-d",
		"--non-interactive",
		MOUNTPATH,
	)

	if err != nil {
		log.Fatal().Msgf("Failed to unmount Veracrypt Container: %s", err)
		os.Exit(1)
	}
}

func (v *Veracrypt) Create(size int64) {
	log.Info().Msg("Creating Veracrypt Container")
	err, _ := v.ExecuteVCCommand(
		"-t", 
		"-v",
		"-c", SAVEPATH,
		"--size", strconv.FormatInt(v.GetMinimalRequiredSize(size), 10) + "M",
		"--encryption", "AES",
		"--hash", "SHA-512",
		"--filesystem", "FAT",
		"--pim", "0",
		"--volume-type", "normal",
		"-p", v.config.GetVCPassword(),
		"--non-interactive",
	)

	if err != nil {
		log.Fatal().Msgf("Failed to create Veracrypt Container: %s", err)
		os.Exit(1)
	}
}

func (v *Veracrypt) GetMinimalRequiredSize(currentSize int64) int64 {
	log.Info().Msg("Getting minimal required size")

	minimalSize := int64(3702)

	if currentSize > 3072 {
		minimalSize = currentSize + int64(2048)
	}

	return minimalSize / 1024
}

func (v *Veracrypt) ExecuteVCCommand(args ...string) (error, string) {
	cmd := exec.Command("veracrypt", args...)
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