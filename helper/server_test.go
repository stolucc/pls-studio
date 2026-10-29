// HTTP handler tests: request validation, the internal function, the
// version report, pairing and cancelling.

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testOrigin = "http://localhost:5175"

func newTestServer(t *testing.T, pool *rPool) (*server, *config) {
	t.Helper()
	cfg := &config{Port: 9878, BearerToken: generateToken(), AllowedOrigins: []string{testOrigin}, Path: filepath.Join(t.TempDir(), "config.json")}
	if pool == nil {
		var err error
		// No R: the helper runs and says so.
		pool, err = newRPool(&config{Rscript: "/nonexistent/Rscript", RWorkers: 1}, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.close)
	}
	return newServer(cfg, log.New(io.Discard, "", 0), pool), cfg
}

func do(t *testing.T, s *server, cfg *config, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	w := httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(w, req)
	return w
}

func TestCall_RejectsInvalidRequests(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	for _, body := range []string{
		`{"id":"a","fn":"system","req":"{}"}`,
		`{"id":"a","fn":"ps_helper_packages","req":"{}"}`,
		`{"id":"a","fn":"ps_pls","req":"{}","code":"system('x')"}`,
		`{"id":"a b","fn":"ps_pls","req":"{}"}`,
		`{"id":"a","fn":"ps_pls","req":"nope"}`,
		`not json`,
	} {
		if w := do(t, s, cfg, http.MethodPost, "/call", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", body, w.Code)
		}
	}
	if w := do(t, s, cfg, http.MethodGet, "/call", ""); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET /call: %d", w.Code)
	}
}

func TestCall_WithoutRReportsHelperError(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	w := do(t, s, cfg, http.MethodPost, "/call", `{"id":"a","fn":"ps_nca","req":"{}"}`)
	var rep callReply
	if err := json.Unmarshal(w.Body.Bytes(), &rep); err != nil || rep.OK || rep.Kind != "helper_error" || !strings.Contains(rep.Message, "Rscript") {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	v := do(t, s, cfg, http.MethodGet, "/version", "")
	var info map[string]any
	_ = json.Unmarshal(v.Body.Bytes(), &info)
	if info["bridge"] != bridgeHash() || info["r_error"] == nil {
		t.Fatalf("version: %s", v.Body.String())
	}
}

func TestCall_RequiresBearerAndOrigin(t *testing.T) {
	s, _ := newTestServer(t, nil)
	req := httptest.NewRequest(http.MethodPost, "/call", strings.NewReader(`{}`))
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", testOrigin)
	w := httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer: %d", w.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", "https://evil.example")
	w = httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", w.Code)
	}
}

func TestPair_RotatesTokenOnlyWithTheCode(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	old := cfg.BearerToken
	if w := do(t, s, cfg, http.MethodPost, "/pair", `{"code":"123456"}`); w.Code != http.StatusForbidden {
		t.Fatalf("pair without window: %d", w.Code)
	}
	code := startPairingWindow(cfg)
	s.pair.loadFromFile()
	w := do(t, s, cfg, http.MethodPost, "/pair", `{"code":"`+code+`"}`)
	var out map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != http.StatusOK || out["token"] == "" || out["token"] == old || cfg.BearerToken != out["token"] {
		t.Fatalf("pair: %d %s", w.Code, w.Body.String())
	}
}

func TestJobRegistry_RejectsDuplicateIDs(t *testing.T) {
	j := newJobRegistry()
	if !j.register("a", func() {}) || j.register("a", func() {}) {
		t.Fatal("duplicate id accepted")
	}
	called := false
	j.register("b", func() { called = true })
	if !j.cancel("b") || !called || j.cancel("b") {
		t.Fatal("cancel")
	}
}

func TestCall_EndToEndWithR(t *testing.T) {
	pool := testPool(t, 1)
	s, cfg := newTestServer(t, pool)
	body, _ := json.Marshal(callRequest{ID: "e2e", Fn: "ps_nca", Req: ncaRequest(0)})
	w := do(t, s, cfg, http.MethodPost, "/call", string(body))
	var rep callReply
	if err := json.Unmarshal(w.Body.Bytes(), &rep); err != nil || !rep.OK || !strings.Contains(rep.Result, `"y":"y"`) {
		t.Fatalf("call: %d %s", w.Code, w.Body.String()[:min(300, w.Body.Len())])
	}
	// /cancel stops a running calculation.
	long, _ := json.Marshal(callRequest{ID: "long2", Fn: "ps_nca", Req: ncaRequestN(5000, 20000)})
	res := make(chan *httptest.ResponseRecorder, 1)
	go func() { res <- do(t, s, cfg, http.MethodPost, "/call", string(long)) }()
	time.Sleep(1500 * time.Millisecond)
	if c := do(t, s, cfg, http.MethodPost, "/cancel/long2", ""); c.Code != http.StatusNoContent {
		t.Fatalf("cancel: %d", c.Code)
	}
	r := <-res
	if !bytes.Contains(r.Body.Bytes(), []byte(`"kind":"cancelled"`)) {
		t.Fatalf("cancelled call: %s", r.Body.String())
	}
	pk := do(t, s, cfg, http.MethodPost, "/packages", `{"packages":["jsonlite"]}`)
	if !strings.Contains(pk.Body.String(), `"jsonlite":"`) {
		t.Fatalf("packages: %s", pk.Body.String())
	}
}
