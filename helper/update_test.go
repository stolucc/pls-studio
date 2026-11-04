package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseVersionAndNewer(t *testing.T) {
	for _, v := range []string{"0.1.8", "helper-v0.1.8"} {
		if got, ok := parseVersion(v); !ok || got != [3]int{0, 1, 8} {
			t.Errorf("%s: %v %v", v, got, ok)
		}
	}
	for _, v := range []string{"0.1.0-dev", "dev-abc1234", "helper-v0.1.8-3-gabc", "1.2", ""} {
		if _, ok := parseVersion(v); ok {
			t.Errorf("%q should not be a release version", v)
		}
	}
	if !isNewer([3]int{0, 1, 8}, [3]int{0, 1, 9}) || !isNewer([3]int{0, 1, 9}, [3]int{0, 2, 0}) || isNewer([3]int{0, 1, 9}, [3]int{0, 1, 9}) || isNewer([3]int{0, 2, 0}, [3]int{0, 1, 99}) {
		t.Error("isNewer")
	}
}

func TestAssetName(t *testing.T) {
	for _, c := range [][3]string{{"darwin", "arm64", "pls-studio-helper-darwin-arm64"}, {"darwin", "amd64", "pls-studio-helper-darwin-amd64"},
		{"linux", "amd64", "pls-studio-helper-linux-amd64"}, {"windows", "amd64", "pls-studio-helper-windows-amd64.exe"}} {
		if got, err := assetName(c[0], c[1]); err != nil || got != c[2] {
			t.Errorf("%s/%s: %q %v", c[0], c[1], got, err)
		}
	}
	if _, err := assetName("linux", "arm64"); err == nil {
		t.Error("linux/arm64 has no release")
	}
}

// fakeRelease serves a release like GitHub's: latest-release JSON and assets,
// SHA256SUMS signed with priv (or as modified by the test).
type fakeRelease struct {
	tag    string
	files  map[string][]byte
	assets []string
	server *httptest.Server
}

func newFakeRelease(t *testing.T, tag string, bin []byte, priv ed25519.PrivateKey) *fakeRelease {
	t.Helper()
	name, err := assetName(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Skip(err)
	}
	h := sha256.Sum256(bin)
	sums := []byte(fmt.Sprintf("%s  %s\n%s  other-file\n", hex.EncodeToString(h[:]), name, strings.Repeat("0", 64)))
	f := &fakeRelease{tag: tag, files: map[string][]byte{name: bin, "SHA256SUMS": sums,
		"SHA256SUMS.sig": []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, sums)) + "\n")}}
	f.assets = []string{name, "SHA256SUMS", "SHA256SUMS.sig"}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/latest" {
			rel := release{Tag: f.tag}
			for _, a := range f.assets {
				rel.Assets = append(rel.Assets, releaseAsset{Name: a, URL: f.server.URL + "/download/" + f.tag + "/" + a})
			}
			_ = json.NewEncoder(w).Encode(rel)
			return
		}
		data, ok := f.files[strings.TrimPrefix(r.URL.Path, "/download/"+f.tag+"/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	}))
	t.Cleanup(f.server.Close)
	oldLatest, oldPrefix, oldKey, oldVersion := updateLatestURL, updateDownloadPrefix, updatePublicKey, helperVersion
	t.Cleanup(func() { updateLatestURL, updateDownloadPrefix, updatePublicKey, helperVersion = oldLatest, oldPrefix, oldKey, oldVersion })
	updateLatestURL, updateDownloadPrefix = f.server.URL+"/latest", f.server.URL+"/download/"
	updatePublicKey = base64.StdEncoding.EncodeToString(priv.Public().(ed25519.PublicKey))
	helperVersion = "0.1.8"
	return f
}

func newKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return priv
}

func TestCheckUpdate(t *testing.T) {
	newFakeRelease(t, "helper-v0.1.9", []byte("new"), newKey(t))
	info, _, err := checkUpdate(context.Background())
	if err != nil || !info.Available || info.Current != "0.1.8" || info.Latest != "0.1.9" {
		t.Fatalf("newer release: %+v %v", info, err)
	}
	helperVersion = "0.1.9"
	if info, _, _ := checkUpdate(context.Background()); info.Available || info.Reason != "this is the latest version" {
		t.Errorf("same version: %+v", info)
	}
	helperVersion = "0.1.0-dev"
	if info, _, _ := checkUpdate(context.Background()); info.Available || !strings.Contains(info.Reason, "development build") {
		t.Errorf("dev build: %+v", info)
	}
	helperVersion, updatePublicKey = "0.1.8", ""
	if info, _, _ := checkUpdate(context.Background()); info.Available || !strings.Contains(info.Reason, "no release key") {
		t.Errorf("no key: %+v", info)
	}
}

func TestVerifiedBinary(t *testing.T) {
	priv := newKey(t)
	bin := []byte("the new helper binary")
	f := newFakeRelease(t, "helper-v0.1.9", bin, priv)
	ctx := context.Background()
	_, rel, err := checkUpdate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH)
	if err != nil || string(got) != string(bin) {
		t.Fatalf("a signed release: %q %v", got, err)
	}
	name, _ := assetName(runtime.GOOS, runtime.GOARCH)

	// A binary that does not match the signed checksum.
	f.files[name] = []byte("tampered")
	if _, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Errorf("tampered binary: %v", err)
	}
	f.files[name] = bin

	// SHA256SUMS changed after signing (a checksum for a tampered binary): the signature fails.
	sums := f.files["SHA256SUMS"]
	f.files["SHA256SUMS"] = []byte(strings.Replace(string(sums), "  "+name, "x  "+name, 1))
	if _, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Errorf("modified SHA256SUMS: %v", err)
	}
	f.files["SHA256SUMS"] = sums

	// Signed by another key.
	other := newKey(t)
	good := f.files["SHA256SUMS.sig"]
	f.files["SHA256SUMS.sig"] = []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(other, sums)))
	if _, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "not valid") {
		t.Errorf("another key: %v", err)
	}
	f.files["SHA256SUMS.sig"] = good

	// An unsigned release.
	unsigned := *rel
	unsigned.Assets = nil
	for _, a := range rel.Assets {
		if a.Name != "SHA256SUMS.sig" {
			unsigned.Assets = append(unsigned.Assets, a)
		}
	}
	if _, err := verifiedBinary(ctx, &unsigned, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "not signed") {
		t.Errorf("unsigned release: %v", err)
	}

	// An asset from anywhere but this repository's release downloads.
	foreign := *rel
	foreign.Assets = append([]releaseAsset(nil), rel.Assets...)
	for i := range foreign.Assets {
		if foreign.Assets[i].Name == name {
			foreign.Assets[i].URL = "https://example.com/" + name
		}
	}
	if _, err := verifiedBinary(ctx, &foreign, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "unexpected download address") {
		t.Errorf("foreign URL: %v", err)
	}
}

func TestSumFor(t *testing.T) {
	sums := []byte(strings.Repeat("a", 64) + "  pls-studio-helper-linux-amd64\n" + strings.Repeat("B", 64) + " *PLS-Studio-Helper-arm64.dmg\n")
	if s, err := sumFor(sums, "pls-studio-helper-linux-amd64"); err != nil || s != strings.Repeat("a", 64) {
		t.Errorf("%q %v", s, err)
	}
	if s, err := sumFor(sums, "PLS-Studio-Helper-arm64.dmg"); err != nil || s != strings.Repeat("b", 64) {
		t.Errorf("binary-mode line: %q %v", s, err)
	}
	if _, err := sumFor(sums, "missing"); err == nil {
		t.Error("missing file")
	}
}

func TestInstallBinary(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "pls-studio-helper")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := installBinary(exe, []byte("new")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	st, _ := os.Stat(exe)
	if string(got) != "new" || st.Mode().Perm()&0o100 == 0 {
		t.Errorf("replaced: %q, mode %v", got, st.Mode())
	}
	left, _ := filepath.Glob(filepath.Join(filepath.Dir(exe), ".pls-studio-helper-update-*"))
	if len(left) != 0 {
		t.Errorf("temporary files left: %v", left)
	}
}

func TestUpdateEndpoint(t *testing.T) {
	newFakeRelease(t, "helper-v0.1.9", []byte("new"), newKey(t))
	s, cfg := newTestServer(t, nil)
	w := do(t, s, cfg, http.MethodGet, "/update", "")
	var info updateInfo
	if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil || w.Code != http.StatusOK || !info.Available || info.Latest != "0.1.9" {
		t.Fatalf("GET /update: %d %s", w.Code, w.Body.String())
	}
	// The same version: POST does nothing and says why.
	helperVersion = "0.1.9"
	if w := do(t, s, cfg, http.MethodPost, "/update", ""); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "latest version") {
		t.Errorf("POST /update when current: %d %s", w.Code, w.Body.String())
	}
	// Without the pairing token: refused.
	req := httptest.NewRequest(http.MethodPost, "/update", nil)
	req.Host = "127.0.0.1:9878"
	req.Header.Set("Origin", testOrigin)
	rec := httptest.NewRecorder()
	s.HTTP.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("POST /update without a token: %d", rec.Code)
	}
}
