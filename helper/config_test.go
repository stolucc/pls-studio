// Config round-trip tests. Pin the on-disk shape so a future
// schema bump doesnt silently lose the bearer token or the
// allowed-origins list.

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSaveAndLoadConfig_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	cfg := &config{
		Version:        1,
		Port:           9878,
		BearerToken:    "deadbeef",
		AllowedOrigins: []string{"https://pls.example.org"},
		Path:           filepath.Join(dir, "config.json"),
	}
	if err := saveConfig(cfg); err != nil {
		t.Fatalf("saveConfig: %v", err)
	}

	raw, err := os.ReadFile(cfg.Path)
	if err != nil {
		t.Fatalf("read back config: %v", err)
	}
	var disk map[string]interface{}
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatalf("parse persisted config: %v", err)
	}

	// The persisted file MUST contain the bearer token (no point in
	// auth if it doesn't survive a process restart) AND MUST NOT
	// contain the derived path fields (those are runtime-only).
	if disk["bearer_token"] != "deadbeef" {
		t.Errorf("bearer_token missing from disk: got %v", disk["bearer_token"])
	}
	for _, derived := range []string{"Path"} {
		if _, present := disk[derived]; present {
			t.Errorf("derived field %q should not be persisted, got %v", derived, disk[derived])
		}
	}
}

func TestSaveConfig_FileMode0600(t *testing.T) {
	// Bearer token sits in this file. World-readable would leak it to
	// any unix user on a shared machine.
	//
	// Windows: file modes don't map to Unix permission bits -- os.Stat
	// reports 0666 regardless of the 0600 we passed to os.OpenFile. The
	// equivalent protection on Windows is the icacls DACL lockdown
	// applied in config_windows.go (verified by TestApplyWindowsACL in
	// config_acl_test.go). So this test is skipped on Windows and the
	// Windows-specific test covers that path.
	if runtime.GOOS == "windows" {
		t.Skip("file modes don't apply on Windows; see TestApplyWindowsACL")
	}
	dir := t.TempDir()
	cfg := &config{
		Path:        filepath.Join(dir, "config.json"),
		BearerToken: "deadbeef",
	}
	if err := saveConfig(cfg); err != nil {
		t.Fatalf("saveConfig: %v", err)
	}
	info, err := os.Stat(cfg.Path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("config file mode = %o, want 0600", mode)
	}
}

func TestGenerateToken_LooksLikeHex(t *testing.T) {
	tok := generateToken()
	if len(tok) != 64 {
		t.Errorf("token length = %d, want 64 (32 bytes hex)", len(tok))
	}
	for _, r := range tok {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Errorf("non-hex char %q in token %q", r, tok)
			return
		}
	}
}

func TestGenerateToken_DistinctEachCall(t *testing.T) {
	a, b := generateToken(), generateToken()
	if a == b {
		t.Errorf("two successive tokens are identical (random source broken?)")
	}
}

func TestLoadConfig_DropsRelativePathsAndBadWorkerCounts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	raw := `{"version":1,"port":70000,"bearer_token":"x","allowed_origins":["http://localhost:5175"],"rscript":"bin/Rscript","r_library":"../lib","r_workers":999}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Rscript != "" || cfg.RLibrary != "" {
		t.Errorf("relative paths kept: %q %q", cfg.Rscript, cfg.RLibrary)
	}
	if cfg.RWorkers != 0 || cfg.workers() != max(1, runtime.NumCPU()-1) {
		t.Errorf("worker count not reset: %d / %d", cfg.RWorkers, cfg.workers())
	}
	if cfg.Port != defaultPort {
		t.Errorf("invalid port kept: %d", cfg.Port)
	}
}

func TestLoadConfig_FirstRunWritesDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg, err := loadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != defaultPort || len(cfg.BearerToken) != 64 || len(cfg.AllowedOrigins) == 0 {
		t.Errorf("defaults missing: %+v", cfg)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("config not written: %v", err)
	}
}

// A --port override is used for listening but never written to the config.
func TestPortOverride_NotPersisted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg, err := loadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PortOverride = 9999
	if cfg.listenPort() != 9999 {
		t.Fatalf("listenPort = %d", cfg.listenPort())
	}
	if err := saveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	again, err := loadConfigFrom(path)
	if err != nil || again.Port != defaultPort || again.listenPort() != defaultPort {
		t.Fatalf("override persisted: %+v %v", again, err)
	}
}
