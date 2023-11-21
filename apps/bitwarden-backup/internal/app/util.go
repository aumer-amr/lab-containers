package app

import (
	"os"
	"os/exec"
	cp "github.com/otiai10/copy"
	"github.com/rs/zerolog/log"
)

func GetFileSize(path string) int64 {
	file, err := os.Stat(path)
	if err != nil {
		log.Error().Msgf("Failed to get file size: %s", err)
	}

	log.Debug().Msgf("File size: %d", file.Size() / 1024)

	return file.Size() / 1024
}

func DeleteFile(path string) {
	if FileExists(path) {
		err := os.Remove(path)
		if err != nil {
			log.Error().Msgf("Failed to delete file: %s", err)
		}
	}
}

func MoveFile(path string, destination string) error {
	err := cp.Copy(path, destination)
	if err != nil {
		log.Error().Msgf("Failed to move file: %s", err)
	}
	return err
}

func CreateDirectory(path string) {
	if !FileExists(path) {
		err := os.MkdirAll(path, 0755)
		if err != nil {
			log.Error().Msgf("Failed to create directory: %s", err)
		}
	}
}

func FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func CommandExists(command string) bool {
	_, err := exec.LookPath(command)
	return err == nil
}