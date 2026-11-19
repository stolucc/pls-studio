// Config: load / save the helper's config file at ~/.pls-studio-helper/config.json.
//
// Defaults are written on first run so the user does not need to hand-edit
// the file. The bearer token is generated at once; pairing rotates it.

package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
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
	// calculation at a time). 0 = automatic (cores - 1).
	RWorkers int `json:"r_workers,omitempty"`
	// GPUPython, when set, is the Python (with torch) that runs the GPU
	// worker; empty = the virtual environment `setup-gpu` creates
	// (~/.pls-studio-helper/gpu/venv).
	GPUPython string `json:"gpu_python,omitempty"`
	// GPUDevice picks the worker's torch device: "cuda", "mps", "cpu"; empty = automatic.
	GPUDevice string `json:"gpu_device,omitempty"`

	// File path derived from the config location. Not persisted.
	Path string `json:"-"`
	// PortOverride (--port) applies to this run only. Not persisted.
	PortOverride int `json:"-"`

	// mu guards the persisted fields above while the helper runs: every
	// request reads the token and the origins, /pair and /connect write
	// the token, and refresh() replaces them when the file changed on disk
	// (`rotate`, `allow-origin`, `deny-origin` run as separate processes).
	mu sync.RWMutex
	// loaded is the file version last read or written (see sameFile).
	loaded os.FileInfo
}

// configFile is the persisted part of the config, as written to disk.
type configFile struct {
	Version        int      `json:"version"`
	Port           int      `json:"port"`
	BearerToken    string   `json:"bearer_token"`
	AllowedOrigins []string `json:"allowed_origins"`
	Rscript        string   `json:"rscript,omitempty"`
	RLibrary       string   `json:"r_library,omitempty"`
	RWorkers       int      `json:"r_workers,omitempty"`
	GPUPython      string   `json:"gpu_python,omitempty"`
	GPUDevice      string   `json:"gpu_device,omitempty"`
}

// file copies the persisted fields (the caller holds c.mu or owns c).
func (c *config) file() configFile {
	return configFile{
		Version:        c.Version,
		Port:           c.Port,
		BearerToken:    c.BearerToken,
		AllowedOrigins: append([]string(nil), c.AllowedOrigins...),
		Rscript:        c.Rscript,
		RLibrary:       c.RLibrary,
		RWorkers:       c.RWorkers,
		GPUPython:      c.GPUPython,
		GPUDevice:      c.GPUDevice,
	}
}

// setFile replaces the persisted fields (the caller holds c.mu or owns c).
// The port is kept when keepPort is set: the listener and the Host pin of a
// running helper were set up for it, so a new port needs a restart.
func (c *config) setFile(f configFile, keepPort bool) {
	c.Version = f.Version
	if !keepPort {
		c.Port = f.Port
	}
	c.BearerToken = f.BearerToken
	c.AllowedOrigins = append([]string(nil), f.AllowedOrigins...)
	c.Rscript = f.Rscript
	c.RLibrary = f.RLibrary
	c.RWorkers = f.RWorkers
	c.GPUPython = f.GPUPython
	c.GPUDevice = f.GPUDevice
}

// snapshot is a copy of the persisted fields, safe to read while the helper runs.
func (c *config) snapshot() configFile {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.file()
}

// listenPort is the port this run listens on.
func (c *config) listenPort() int {
	if c.PortOverride > 0 {
		return c.PortOverride
	}
	return c.Port
}

const defaultPort = 9878
const configFileName = "config.json"
const maxRWorkers = 256

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
	f, info, err := readConfigFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return createConfig(cfg)
	}
	if err != nil {
		return nil, err
	}
	cfg.setFile(f, false)
	cfg.loaded = info
	return cfg, nil
}

// createConfig writes the first config file (a fresh token, the default port
// and origins), unless another process wrote it meanwhile: then that one is
// used, so that two processes starting at once agree on one token.
func createConfig(cfg *config) (*config, error) {
	lock, err := cfg.lockFile()
	if err != nil {
		return nil, err
	}
	defer lock.unlock()
	f, info, err := readConfigFile(cfg.Path)
	if err == nil {
		cfg.setFile(f, false)
		cfg.loaded = info
		return cfg, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	cfg.Version = 1
	cfg.Port = defaultPort
	cfg.BearerToken = generateToken()
	cfg.AllowedOrigins = defaultAllowedOrigins()
	info, err = writeConfigFile(cfg.Path, cfg.file())
	if err != nil {
		return nil, fmt.Errorf("write initial config: %w", err)
	}
	cfg.loaded = info
	return cfg, nil
}

// readConfigFile reads and checks the config file. The file is stat'ed
// before it is read: if it is replaced in between, the next refresh sees a
// newer version than the one recorded and reads it again (the other order
// could record the new version with the old contents and miss it).
func readConfigFile(path string) (configFile, os.FileInfo, error) {
	var f configFile
	info, err := os.Stat(path)
	if err != nil {
		return f, nil, err
	}
	data, err := readFile(path)
	if err != nil {
		return f, nil, err
	}
	if err := json.Unmarshal(data, &f); err != nil {
		return f, nil, fmt.Errorf("parse config: %w", err)
	}

	// Backfill any missing fields after a config-schema bump.
	if f.Port <= 0 || f.Port > 65535 {
		f.Port = defaultPort
	}
	// No token on disk: a fresh random one, which no browser knows. (An
	// empty token must never authorise anything; see tokenMatches.)
	if f.BearerToken == "" {
		f.BearerToken = generateToken()
	}
	if len(f.AllowedOrigins) == 0 {
		f.AllowedOrigins = defaultAllowedOrigins()
	}
	// Defence in depth: these paths are executed / put on R's library
	// path. A hand-edited relative path would resolve against whatever
	// directory the helper happens to start in; drop it instead.
	if f.Rscript != "" && !filepath.IsAbs(f.Rscript) {
		f.Rscript = ""
	}
	if f.RLibrary != "" && !filepath.IsAbs(f.RLibrary) {
		f.RLibrary = ""
	}
	if f.RWorkers < 0 || f.RWorkers > maxRWorkers {
		f.RWorkers = 0
	}
	return f, info, nil
}

// sameFile: is the file on disk the version last read or written? saveConfig
// writes a new file and renames it into place, so every save is a new file
// (os.SameFile compares device and inode); size and modification time catch
// an in-place edit with an editor.
func sameFile(a, b os.FileInfo) bool {
	if a == nil || b == nil {
		return false
	}
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

// refresh reloads the config when the file changed on disk since it was
// last read or written, so that `rotate`, `allow-origin` and `deny-origin`
// apply to the running helper at once (a rotated token stops working).
// The port is kept (it needs a restart). A file that cannot be read or
// parsed leaves the config as it was, and is not read again until it
// changes; a missing file too.
func (c *config) refresh() {
	if c.Path == "" {
		return
	}
	info, err := os.Stat(c.Path)
	if err != nil {
		return
	}
	c.mu.RLock()
	current := sameFile(info, c.loaded)
	c.mu.RUnlock()
	if current {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if sameFile(info, c.loaded) {
		return // (another request reloaded it meanwhile)
	}
	f, fresh, err := readConfigFile(c.Path)
	if err != nil {
		log.Printf("config %s changed but cannot be read (%v); keeping the previous settings", c.Path, err)
		c.loaded = info
		return
	}
	c.setFile(f, true)
	c.loaded = fresh
}

// update changes the config and saves it. The file is read first and the
// change applied to what is on disk, so edits by the command line since the
// helper last read it are kept (and take effect); the port stays as it was
// for this run.
//
// The read-modify-write holds config.lock (beside the file) for its duration,
// so that two processes changing the config at once (the running helper, the
// command line) do not lose one of the changes.
func (c *config) update(change func(f *configFile)) error {
	lock, err := c.lockFile()
	if err != nil {
		return err
	}
	defer lock.unlock()
	c.mu.Lock()
	defer c.mu.Unlock()
	f := c.file()
	if disk, _, err := readConfigFile(c.Path); err == nil {
		f = disk
	}
	change(&f)
	info, err := writeConfigFile(c.Path, f)
	if err != nil {
		return err
	}
	c.setFile(f, true)
	c.loaded = info
	return nil
}

// tokenMatches compares a presented bearer token with the configured one in
// constant time. An empty token never matches.
func (c *config) tokenMatches(provided string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.BearerToken == "" || provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(c.BearerToken)) == 1
}

// hasToken: is a bearer token configured?
func (c *config) hasToken() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.BearerToken != ""
}

// workers is the number of R processes to run.
func (c *config) workers() int {
	if c.RWorkers > 0 {
		return c.RWorkers
	}
	// All cores but one (left for the browser and the system). The same
	// number is the cores a cSEM bootstrap uses in one of these processes.
	n := runtime.NumCPU() - 1
	if n < 1 {
		n = 1
	}
	return n
}

// configLockWait: how long a config change waits for another process's (a
// change takes milliseconds; a holder that long has hung).
const configLockWait = 10 * time.Second

// lockFile takes config.lock beside the config file (before c.mu: readers of
// the config are not held up while waiting for another process).
func (c *config) lockFile() (*fileLock, error) {
	return lockFileWait(filepath.Join(filepath.Dir(c.Path), configLockName), configLockWait)
}

func saveConfig(cfg *config) error {
	lock, err := cfg.lockFile()
	if err != nil {
		return err
	}
	defer lock.unlock()
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	info, err := writeConfigFile(cfg.Path, cfg.file())
	if err != nil {
		return err
	}
	cfg.loaded = info
	return nil
}

// writeConfigFile writes the file and returns the version written.
func writeConfigFile(path string, f configFile) (os.FileInfo, error) {
	data, err := json.MarshalIndent(&f, "", "  ")
	if err != nil {
		return nil, err
	}
	// Atomic replace via tmpfile + rename. Mode 0600 — token is in there.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config.tmp")
	if err != nil {
		return nil, err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := replaceFile(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return nil, err
	}
	// Windows: explicit per-file DACL after the rename. No-op on Unix.
	_ = secureFileACL(path)
	return os.Stat(path)
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
