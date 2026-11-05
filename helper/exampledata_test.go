// Tests for /example-data/statmodel/: the allowlist, the bearer token, no redirects, the size cap, the rate
// limit and the answer's headers, against a local stand-in for statmodel.com.

package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeStatmodel serves handler as statmodel.com/usersguide/ for the test, recording the paths asked for.
func fakeStatmodel(t *testing.T, handler http.HandlerFunc) *[]string {
	t.Helper()
	var mu sync.Mutex
	asked := []string{}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		asked = append(asked, r.URL.RequestURI())
		mu.Unlock()
		handler(w, r)
	}))
	t.Cleanup(up.Close)
	old := statmodelBase
	statmodelBase = up.URL + "/usersguide/"
	t.Cleanup(func() { statmodelBase = old })
	return &asked
}

func TestExampleData_PassesAllowedFilesThrough(t *testing.T) {
	asked := fakeStatmodel(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("  0.5  1.25\n*  2\n")) })
	s, cfg := newTestServer(t, nil)
	w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.23.dat", "")
	if w.Code != http.StatusOK || w.Body.String() != "  0.5  1.25\n*  2\n" {
		t.Fatalf("got %d %q", w.Code, w.Body.String())
	}
	for k, v := range map[string]string{"Content-Type": "text/plain; charset=iso-8859-1", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": testOrigin} {
		if got := w.Header().Get(k); got != v {
			t.Errorf("%s: %q, want %q", k, got, v)
		}
	}
	for _, p := range []string{"chap3/ex3.8part1.inp", "chap12/ex12.7real.dat", "chap5/ex5.27b.inp"} {
		if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/"+p, ""); w.Code != http.StatusOK {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	// The query is not passed on.
	do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.1.dat?url=http://evil.example/", "")
	want := []string{"/usersguide/chap6/ex6.23.dat", "/usersguide/chap3/ex3.8part1.inp", "/usersguide/chap12/ex12.7real.dat", "/usersguide/chap5/ex5.27b.inp", "/usersguide/chap6/ex6.1.dat"}
	if strings.Join(*asked, " ") != strings.Join(want, " ") {
		t.Fatalf("asked statmodel for %v", *asked)
	}
}

func TestExampleData_RefusesEverythingElse(t *testing.T) {
	asked := fakeStatmodel(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("x")) })
	s, cfg := newTestServer(t, nil)
	for _, p := range []string{
		"chap6/ex6.23.html", "chap6/ex6.23.DAT", "chap6/ex6.23.dat.html", "chap6/ex6.23", "chap7/ex6.23.dat", "chap6/ex6.23.dat%00",
		"chap6/..%2F..%2Fetc%2Fpasswd", "chap6/%2e%2e%2fex6.1.dat", "chap6%2Fex6.23.dat", "chap6/ex6.23.dat%3Fx=1",
		"chap6/x%40evil.example%2Fex6.1.dat", "chap6/ex6.1.dat/extra", "chap6/ex6.1-2.dat", "chap123/ex123.1.dat", "ex6.1.dat", "",
		"chap6/ex6.1.dat%0d%0aHost:%20evil",
	} {
		if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/"+p, ""); w.Code < 300 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	if w := do(t, s, cfg, http.MethodPost, "/example-data/statmodel/chap6/ex6.1.dat", ""); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", w.Code)
	}
	if len(*asked) != 0 {
		t.Fatalf("asked statmodel for %v", *asked)
	}
}

func TestExampleData_NeedsTheBearerToken(t *testing.T) {
	asked := fakeStatmodel(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("x")) })
	s, _ := newTestServer(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/example-data/statmodel/chap6/ex6.1.dat", nil)
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", testOrigin)
	w := httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || len(*asked) != 0 {
		t.Fatalf("without a token: %d, asked %v", w.Code, *asked)
	}
}

func TestExampleData_DoesNotFollowRedirectsAndMapsMissingFiles(t *testing.T) {
	status := http.StatusFound
	asked := fakeStatmodel(t, func(w http.ResponseWriter, r *http.Request) {
		if status == http.StatusFound {
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", status)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte("secret upstream page"))
	})
	s, cfg := newTestServer(t, nil)
	if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.1.dat", ""); w.Code != http.StatusNotFound || len(*asked) != 1 || w.Header().Get("Location") != "" {
		t.Fatalf("redirect: %d, asked %v", w.Code, *asked)
	}
	status = http.StatusMultipleChoices // statmodel.com's answer for a missing file
	if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.99.dat", ""); w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("missing: %d %q", w.Code, w.Body.String())
	}
	status = http.StatusInternalServerError
	if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.1.dat", ""); w.Code != http.StatusBadGateway || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("upstream error: %d %q", w.Code, w.Body.String())
	}
}

func TestExampleData_CapsTheSize(t *testing.T) {
	big := strings.Repeat("0123456789", maxExampleBytes/10+1)
	fakeStatmodel(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".inp") {
			w.Header().Set("Content-Length", "99999999999")
			return
		}
		// (streamed, without a length)
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte(big))
	})
	s, cfg := newTestServer(t, nil)
	for _, p := range []string{"chap6/ex6.1.dat", "chap6/ex6.1.inp"} {
		if w := do(t, s, cfg, http.MethodGet, "/example-data/statmodel/"+p, ""); w.Code != http.StatusBadGateway {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
}

func TestExampleData_RateLimited(t *testing.T) {
	fakeStatmodel(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("x")) })
	s, cfg := newTestServer(t, nil)
	s.exampleLimiter = newCallLimiter(2, 60)
	codes := []int{}
	for i := 0; i < 3; i++ {
		codes = append(codes, do(t, s, cfg, http.MethodGet, "/example-data/statmodel/chap6/ex6.1.dat", "").Code)
	}
	if codes[0] != 200 || codes[1] != 200 || codes[2] != http.StatusTooManyRequests {
		t.Fatalf("codes %v", codes)
	}
}
