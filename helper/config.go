// Config: load / save the helper's config file at ~/.pls-studio-helper/config.json.
//
// Defaults are written on first run so the user does not need to hand-edit
// the file. The bearer token is generated at once; pairing rotates it.

package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type config struct {
	Version        int      `json:"version"`
	Port           int      `json:"port"`
	BearerToken    string   `json:"bearer_token"`
	AllowedOrigins []string `json:"allowed_origins"`

	// Rscript, when set, is the absolute path of the Rscript executable;
	// empty = found on PATH (plus the usual install locations).
	Rscript string `json:"rscript,omitempty"`
	// RLibrary, when set, is an R package library searched before the
	// user's own (absolute path; `pls-studio-helper setup` installs into
	// ~/.pls-studio-helper/library and sets it).
	RLibrary string `json:"r_library,omitempty"`
	// RWorkers is the number of R processes kept running (each one
	// calculation at a time). 0 = automatic (cores - 1, at most 8).
	RWorkers int `json:"r_workers,omitempty"`

	// File path derived from the config location. Not persisted.
	Path string `json:"-"`
}

const defaultPort = 9878
const configFileName = "config.json"
const maxRWorkers = 16

func defaultAllowedOrigins() []string {
	// PLS Studio in development (Vite :5175), preview (:4175) and the
	// collaboration server (:8787). A deployment adds its own origin with
	// `pls-studio-helper allow-origin https://…`.
	return []string{
		"http://localhost:5175",
		"http://127.0.0.1:5175",
		"http://localhost:4175",
		"http://127.0.0.1:4175",
		"http://localhost:8787",
		"http://127.0.0.1:8787",
	}
}

// configDir returns ~/.pls-studio-helper, creating it if missing.
func configDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".pls-studio-helper")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	// Windows: os.MkdirAll only sets the read-only bit, not a proper
	// NTFS DACL. secureDirACL drops inherited ACEs and grants only the
	// current user FullControl. No-op on Unix. Best-effort.
	_ = secureDirACL(dir)
	return dir, nil
}

func loadConfig() (*config, error) {
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	return loadConfigFrom(filepath.Join(dir, configFileName))
}

func loadConfigFrom(path string) (*config, error) {
	cfg := &config{Path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg.Version = 1
		cfg.Port = defaultPort
		cfg.BearerToken = generateToken()
		cfg.AllowedOrigins = defaultAllowedOrigins()
		if err := saveConfig(cfg); err != nil {
			return nil, fmt.Errorf("write initial config: %w", err)
		}
		return cfg, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	cfg.Path = path

	// Backfill any missing fields after a config-schema bump.
	if cfg.Port <= 0 || cfg.Port > 65535 {
		cfg.Port = defaultPort
	}
	if cfg.BearerToken == "" {
		cfg.BearerToken = generateToken()
	}
	if len(cfg.AllowedOrigins) == 0 {
		cfg.AllowedOrigins = defaultAllowedOrigins()
	}
	// Defence in depth: these paths are executed / put on R's library
	// path. A hand-edited relative path would resolve against whatever
	// directory the helper happens to start in; drop it instead.
	if cfg.Rscript != "" && !filepath.IsAbs(cfg.Rscript) {
		cfg.Rscript = ""
	}
	if cfg.RLibrary != "" && !filepath.IsAbs(cfg.RLibrary) {
		cfg.RLibrary = ""
	}
	if cfg.RWorkers < 0 || cfg.RWorkers > maxRWorkers {
		cfg.RWorkers = 0
	}
	return cfg, nil
}

// workers is the number of R processes to run.
func (c *config) workers() int {
	if c.RWorkers > 0 {
		return c.RWorkers
	}
	n := runtime.NumCPU() - 1
	if n < 1 {
		n = 1
	}
	if n > 8 {
		n = 8
	}
	return n
}

func saveConfig(cfg *config) error {
	out := *cfg
	out.Path = "" // do not persist derived paths

	data, err := json.MarshalIndent(&out, "", "  ")
	if err != nil {
		return err
	}
	// Atomic replace via tmpfile + rename. Mode 0600 — token is in there.
	tmp, err := os.CreateTemp(filepath.Dir(cfg.Path), ".config.tmp")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), cfg.Path); err != nil {
		return err
	}
	// Windows: explicit per-file DACL after the rename. No-op on Unix.
	_ = secureFileACL(cfg.Path)
	return nil
}

// generateToken returns a 32-byte random hex string (~256 bits of entropy),
// the bearer token authenticating every authenticated request.
func generateToken() string {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// crypto/rand failures are catastrophic — refuse to run rather
		// than silently fall back to a weak token.
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return hex.EncodeToString(buf[:])
}
