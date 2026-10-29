package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestConnectGate_AsksAndRemembersDenial(t *testing.T) {
	var asked []string
	answer := true
	g := &connectGate{ask: func(o string) (bool, error) { asked = append(asked, o); return answer, nil }}
	if err := g.request("http://localhost:5175"); err != nil {
		t.Fatalf("allowed: %v", err)
	}
	answer = false
	if err := g.request("http://localhost:5175"); err != errDenied {
		t.Fatalf("denied: %v", err)
	}
	// Within the cool-down a new request is refused without a dialog.
	if err := g.request("http://localhost:5175"); err != errDenied || len(asked) != 2 {
		t.Fatalf("cool-down: %v, asked %d times", err, len(asked))
	}
}

func TestConnectGate_OneDialogAtATime(t *testing.T) {
	release := make(chan struct{})
	g := &connectGate{ask: func(string) (bool, error) { <-release; return true, nil }}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); _ = g.request("http://localhost:5175") }()
	time.Sleep(50 * time.Millisecond)
	if err := g.request("http://localhost:5175"); err != errWaiting {
		t.Fatalf("second request while the dialog is open: %v", err)
	}
	close(release)
	wg.Wait()
}

func TestConnectGate_NoDialogWithoutTray(t *testing.T) {
	g := &connectGate{}
	if err := g.request("x"); err != errNoApprover {
		t.Fatalf("no approver: %v", err)
	}
	g = &connectGate{allowFirst: true}
	if err := g.request("x"); err != nil {
		t.Fatalf("first connection: %v", err)
	}
	if err := g.request("x"); err != errNoApprover {
		t.Fatalf("only the first connection is approved: %v", err)
	}
}

func TestConnect_EndpointHandsOutTokenOnlyWhenAllowed(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	var asked string
	s.connect.ask = func(o string) (bool, error) { asked = o; return false, nil }
	old := cfg.BearerToken
	// Unauthenticated (no token yet), but the origin must be trusted.
	if w := do(t, s, cfg, http.MethodPost, "/connect", ""); w.Code != http.StatusForbidden || asked != testOrigin || cfg.BearerToken != old {
		t.Fatalf("denied: %d %q", w.Code, asked)
	}
	s.connect.deniedAt = time.Time{}
	s.connect.ask = func(string) (bool, error) { return true, nil }
	w := do(t, s, cfg, http.MethodPost, "/connect", "")
	var out map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != http.StatusOK || out["token"] == "" || out["token"] == old || out["token"] != cfg.BearerToken {
		t.Fatalf("allowed: %d %s", w.Code, w.Body.String())
	}
	if w := do(t, s, cfg, http.MethodGet, "/connect", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", w.Code)
	}
}
