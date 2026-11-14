// The running helper and the command line share the config file: `rotate`,
// `allow-origin` and `deny-origin` (separate processes) must apply to the
// running helper, and the helper's own saves (pairing) must not undo them.

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

// runningHelper is a test server whose config file exists on disk.
func runningHelper(t *testing.T) (*server, *config) {
	t.Helper()
	s, cfg := newTestServer(t, nil)
	if err := saveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	return s, cfg
}

// cli edits the config file as a separate `pls-studio-helper` process would.
func cli(t *testing.T, path string, change func(f *configFile)) {
	t.Helper()
	other, err := loadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.update(change); err != nil {
		t.Fatal(err)
	}
}

// authed sends an authenticated request for an unknown calculation: 404
// when origin and token pass, 401 / 403 when they do not.
func authed(s *server, origin, token string) int {
	req := httptest.NewRequest(http.MethodPost, "/cancel/nope", nil)
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", origin)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(w, req)
	return w.Code
}

func TestReload_RotateOnDiskRevokesTheOldToken(t *testing.T) {
	s, cfg := runningHelper(t)
	old := cfg.BearerToken
	if code := authed(s, testOrigin, old); code != http.StatusNotFound {
		t.Fatalf("before rotate: %d", code)
	}
	fresh := generateToken()
	cli(t, cfg.Path, func(f *configFile) { f.BearerToken = fresh })
	if code := authed(s, testOrigin, old); code != http.StatusUnauthorized {
		t.Fatalf("old token after rotate: %d, want 401", code)
	}
	if code := authed(s, testOrigin, fresh); code != http.StatusNotFound {
		t.Fatalf("new token after rotate: %d", code)
	}
}

func TestReload_OriginEditsOnDiskTakeEffect(t *testing.T) {
	s, cfg := runningHelper(t)
	token := cfg.BearerToken
	const added = "https://pls.example.org"
	if code := authed(s, added, token); code != http.StatusForbidden {
		t.Fatalf("untrusted origin: %d", code)
	}
	cli(t, cfg.Path, func(f *configFile) { addAllowedOrigin(f, added) })
	if code := authed(s, added, token); code != http.StatusNotFound {
		t.Fatalf("after allow-origin: %d", code)
	}
	cli(t, cfg.Path, func(f *configFile) { removeAllowedOrigin(f, testOrigin) })
	if code := authed(s, testOrigin, token); code != http.StatusForbidden {
		t.Fatalf("after deny-origin: %d, want 403", code)
	}
}

func TestReload_PairingKeepsEditsMadeOnDisk(t *testing.T) {
	s, cfg := runningHelper(t)
	const added = "https://pls.example.org"
	cli(t, cfg.Path, func(f *configFile) { addAllowedOrigin(f, added) })
	// No request in between: the helper has not re-read the file yet.
	token, err := s.rotateToken()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(cfg.Path)
	if err != nil {
		t.Fatal(err)
	}
	var disk configFile
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatal(err)
	}
	if disk.BearerToken != token {
		t.Fatalf("new token not saved")
	}
	if !strings.Contains(strings.Join(disk.AllowedOrigins, " "), added) {
		t.Fatalf("pairing dropped the origin added on disk: %v", disk.AllowedOrigins)
	}
	if code := authed(s, added, token); code != http.StatusNotFound {
		t.Fatalf("added origin with the new token: %d", code)
	}
}

func TestReload_UnreadableFileKeepsSettingsAndEmptyTokenNeverMatches(t *testing.T) {
	s, cfg := runningHelper(t)
	token := cfg.BearerToken
	if err := os.WriteFile(cfg.Path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code := authed(s, testOrigin, token); code != http.StatusNotFound {
		t.Fatalf("broken file: %d (the previous settings should stay)", code)
	}
	// A file without a token: a fresh random one, which nobody has.
	if err := os.WriteFile(cfg.Path, []byte(`{"version":1,"port":9878,"bearer_token":"","allowed_origins":["`+testOrigin+`"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if code := authed(s, testOrigin, token); code != http.StatusUnauthorized {
		t.Fatalf("old token after the token was removed on disk: %d", code)
	}
	if code := authed(s, testOrigin, ""); code != http.StatusUnauthorized {
		t.Fatalf("empty token: %d", code)
	}
	if (&config{}).tokenMatches("") {
		t.Fatal("an empty token matched an empty config")
	}
}

// Requests, pairing and command-line edits at once (run with -race).
func TestReload_ConcurrentRequestsPairingAndEdits(t *testing.T) {
	s, cfg := runningHelper(t)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(3)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				authed(s, testOrigin, "x")
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				if _, err := s.rotateToken(); err != nil {
					t.Error(err)
				}
			}
		}()
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				origin := fmt.Sprintf("https://o%d-%d.example", i, j)
				other, err := loadConfigFrom(cfg.Path)
				if err == nil {
					err = other.update(func(f *configFile) { addAllowedOrigin(f, origin) })
				}
				if err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
	token, err := s.rotateToken()
	if err != nil {
		t.Fatal(err)
	}
	if code := authed(s, testOrigin, token); code != http.StatusNotFound {
		t.Fatalf("after the storm: %d", code)
	}
}
