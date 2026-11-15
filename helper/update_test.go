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
// SHA256SUMS and the version manifest RELEASE.json signed with priv (or as
// modified by the test).
type fakeRelease struct {
	tag    string
	priv   ed25519.PrivateKey
	files  map[string][]byte
	assets []string
	server *httptest.Server
}

// signFile stores a file and its signature by the release key, as the
// release workflow does (cmd/sign-release sign).
func (f *fakeRelease) signFile(name string, data []byte, priv ed25519.PrivateKey) {
	f.files[name] = data
	f.files[name+".sig"] = []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, data)) + "\n")
}

// setManifest writes a signed RELEASE.json naming version and tag, for the
// SHA256SUMS the release serves.
func (f *fakeRelease) setManifest(version, tag string) {
	sumsHash := sha256.Sum256(f.files["SHA256SUMS"])
	manifest := fmt.Sprintf(`{"version":%q,"tag":%q,"sha256sums":%q,"published":"2026-11-14T12:00:00Z"}`+"\n",
		version, tag, hex.EncodeToString(sumsHash[:]))
	f.signFile("RELEASE.json", []byte(manifest), f.priv)
}

func newFakeRelease(t *testing.T, tag string, bin []byte, priv ed25519.PrivateKey) *fakeRelease {
	t.Helper()
	name, err := assetName(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Skip(err)
	}
	h := sha256.Sum256(bin)
	sums := []byte(fmt.Sprintf("%s  %s\n%s  other-file\n", hex.EncodeToString(h[:]), name, strings.Repeat("0", 64)))
	f := &fakeRelease{tag: tag, priv: priv, files: map[string][]byte{name: bin}}
	f.signFile("SHA256SUMS", sums, priv)
	f.setManifest(strings.TrimPrefix(tag, "helper-v"), tag)
	f.assets = []string{name, "SHA256SUMS", "SHA256SUMS.sig", "RELEASE.json", "RELEASE.json.sig"}
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
	t.Cleanup(func() {
		updateLatestURL, updateDownloadPrefix, updatePublicKey, helperVersion = oldLatest, oldPrefix, oldKey, oldVersion
	})
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

// withoutAsset is a copy of rel without the named asset.
func withoutAsset(rel *release, name string) *release {
	out := *rel
	out.Assets = nil
	for _, a := range rel.Assets {
		if a.Name != name {
			out.Assets = append(out.Assets, a)
		}
	}
	return &out
}

func TestReleaseManifest(t *testing.T) {
	priv := newKey(t)
	bin := []byte("the new helper binary")
	f := newFakeRelease(t, "helper-v0.1.9", bin, priv)
	ctx := context.Background()
	_, rel, err := checkUpdate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	refused := func(what, want string) {
		t.Helper()
		if _, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want an error containing %q, got %v", what, want, err)
		}
	}

	// A valid manifest: the binary is installed.
	if got, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err != nil || string(got) != string(bin) {
		t.Fatalf("a valid manifest: %q %v", got, err)
	}

	// The manifest of another release under this tag (an old release republished as helper-v0.1.9).
	f.setManifest("0.1.7", "helper-v0.1.7")
	refused("manifest of an older release", "tagged helper-v0.1.9")
	f.setManifest("0.1.9", "helper-v0.1.8")
	refused("tag and version disagree", "tagged helper-v0.1.9")
	f.setManifest("0.1.10", "helper-v0.1.10")
	refused("manifest of a newer release", "tagged helper-v0.1.9")

	// The same or an older version than the running helper (replay, downgrade).
	f.setManifest("0.1.9", "helper-v0.1.9")
	helperVersion = "0.1.9"
	refused("same version", "not newer")
	helperVersion = "0.2.0"
	refused("older version", "refusing a downgrade")
	helperVersion = "0.1.8"

	// A manifest changed after signing, or signed by another key.
	good := f.files["RELEASE.json"]
	f.files["RELEASE.json"] = []byte(strings.Replace(string(good), "0.1.9", "0.1.99", 2))
	refused("modified manifest", "RELEASE.json: the release signature is not valid")
	f.signFile("RELEASE.json", good, newKey(t))
	refused("manifest signed by another key", "not valid")
	f.files["RELEASE.json.sig"] = []byte("not base64!")
	refused("malformed manifest signature", "malformed")
	f.setManifest("0.1.9", "helper-v0.1.9")

	// SHA256SUMS validly signed, but not the one the manifest names (taken from another release).
	sums := f.files["SHA256SUMS"]
	f.signFile("SHA256SUMS", append(append([]byte(nil), sums...), []byte(strings.Repeat("1", 64)+"  extra\n")...), priv)
	refused("SHA256SUMS of another release", "not the one the signed release manifest names")
	f.signFile("SHA256SUMS", sums, priv)

	// Unreadable or incomplete manifests.
	for _, bad := range []string{
		`not json`,
		`{"version":"helper-v0.1.9","tag":"helper-v0.1.9","sha256sums":"` + strings.Repeat("a", 64) + `","published":"2026-11-14T12:00:00Z"}`,
		`{"version":"0.1.9","tag":"helper-v0.1.9","sha256sums":"abc","published":"2026-11-14T12:00:00Z"}`,
		`{"version":"0.1.9","tag":"helper-v0.1.9","sha256sums":"` + strings.Repeat("z", 64) + `","published":"2026-11-14T12:00:00Z"}`,
		`{"version":"0.1.9","tag":"helper-v0.1.9","sha256sums":"` + strings.Repeat("a", 64) + `"}`,
	} {
		f.signFile("RELEASE.json", []byte(bad), priv)
		if _, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "RELEASE.json") {
			t.Errorf("manifest %s: %v", bad, err)
		}
	}
	f.setManifest("0.1.9", "helper-v0.1.9")

	// A release without the manifest (made before 0.1.11, or with it removed), or without its signature.
	if _, err := verifiedBinary(ctx, withoutAsset(rel, "RELEASE.json"), runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "no signed version manifest") {
		t.Errorf("no manifest: %v", err)
	}
	if _, err := verifiedBinary(ctx, withoutAsset(rel, "RELEASE.json.sig"), runtime.GOOS, runtime.GOARCH); err == nil || !strings.Contains(err.Error(), "manifest is not signed") {
		t.Errorf("unsigned manifest: %v", err)
	}

	// Everything restored: accepted again.
	if got, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH); err != nil || string(got) != string(bin) {
		t.Fatalf("restored release: %q %v", got, err)
	}
}

func TestCheckManifest(t *testing.T) {
	sum := strings.Repeat("a", 64)
	manifest := func(version, tag string) []byte {
		return []byte(`{"version":"` + version + `","tag":"` + tag + `","sha256sums":"` + sum + `","published":"2026-11-14T12:00:00Z"}`)
	}
	if m, err := checkManifest(manifest("0.1.11", "helper-v0.1.11"), "helper-v0.1.11", "0.1.10"); err != nil || m.Version != "0.1.11" || m.SHA256Sums != sum {
		t.Errorf("valid: %+v %v", m, err)
	}
	// A newer major/minor counts as newer, numerically (0.1.10 > 0.1.9).
	if _, err := checkManifest(manifest("0.1.10", "helper-v0.1.10"), "helper-v0.1.10", "0.1.9"); err != nil {
		t.Errorf("0.1.10 after 0.1.9: %v", err)
	}
	for _, c := range []struct{ version, tag, relTag, current, want string }{
		{"0.1.9", "helper-v0.1.9", "helper-v9.9.9", "0.1.10", "tagged helper-v9.9.9"},
		{"0.1.11", "helper-v0.1.11", "helper-v0.1.11", "0.1.11", "not newer"},
		{"0.1.9", "helper-v0.1.9", "helper-v0.1.9", "0.1.10", "downgrade"},
		{"0.1.11", "helper-v0.1.11", "helper-v0.1.11", "0.1.0-dev", "development build"},
		{"0.1.11-rc1", "helper-v0.1.11-rc1", "helper-v0.1.11-rc1", "0.1.10", "no release version"},
	} {
		if _, err := checkManifest(manifest(c.version, c.tag), c.relTag, c.current); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%+v: %v", c, err)
		}
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
	// (Windows has no executable bit; there the old binary is moved aside, removed on the next start)
	if string(got) != "new" || (runtime.GOOS != "windows" && st.Mode().Perm()&0o100 == 0) {
		t.Errorf("replaced: %q, mode %v", got, st.Mode())
	}
	if runtime.GOOS == "windows" {
		if old, err := os.ReadFile(exe + ".old"); err != nil || string(old) != "old" {
			t.Errorf("the old binary moved aside: %q %v", old, err)
		}
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

func TestTranslocatedAppRefusesToUpdateWithAnExplanation(t *testing.T) {
	translocated := "/private/var/folders/bt/x/T/AppTranslocation/A858DC09/d/" +
		"PLS Studio Helper.app/Contents/MacOS/pls-studio-helper"
	err := translocationError(translocated)
	if err == nil || !strings.Contains(err.Error(), "drag PLS Studio Helper.app into Applications") {
		t.Fatalf("got %v, want the App Translocation explanation", err)
	}
	installed := "/Applications/PLS Studio Helper.app/Contents/MacOS/pls-studio-helper"
	if err := translocationError(installed); err != nil {
		t.Fatalf("an installed app: %v", err)
	}
}
