// Self-update: replace this helper with the latest release from GitHub
// (github.com/stolucc/pls-studio, tags helper-v*), on request only: the
// command line (pls-studio-helper update), the tray's "Check for updates…",
// or PLS Studio (POST /update, with the pairing token) after the user clicks
// Update helper. Never automatic, never from an address a page supplies.
//
// A release is trusted only if its SHA256SUMS carries a valid Ed25519
// signature (SHA256SUMS.sig) by the release key, whose public half is built
// into the helper (updatekey.go): a checksum from the same release would only
// catch a corrupted download, not a tampered release. The release workflow
// signs with the private key, a repository secret (helper/cmd/sign-release).

package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const updateRepo = "stolucc/pls-studio"

var (
	// (variables, so tests can point them at a local server)
	updateLatestURL      = "https://api.github.com/repos/" + updateRepo + "/releases/latest"
	updateDownloadPrefix = "https://github.com/" + updateRepo + "/releases/download/"
	updateHTTP           = &http.Client{Timeout: 5 * time.Minute}
)

// The largest file an update downloads (the binaries are about 10 MB).
const maxUpdateDownload = 200 << 20

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type release struct {
	Tag    string         `json:"tag_name"`
	Assets []releaseAsset `json:"assets"`
}

// updateInfo is what /update and the tray report: this version, the latest
// release, whether updating is possible, and why not.
type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// parseVersion reads "0.1.8" or "helper-v0.1.8"; anything else (a
// development build: "0.1.0-dev", "dev-abc1234", "helper-v0.1.8-3-gabc") is
// not a release version.
func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(strings.TrimPrefix(v, "helper-v"), ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// isNewer: whether version b is newer than version a (both release versions).
func isNewer(a, b [3]int) bool {
	for i := range a {
		if b[i] != a[i] {
			return b[i] > a[i]
		}
	}
	return false
}

// assetName is the release asset for a platform: the plain binary (inside the
// macOS app it replaces Contents/MacOS/pls-studio-helper).
func assetName(goos, goarch string) (string, error) {
	switch {
	case goos == "darwin" && (goarch == "arm64" || goarch == "amd64"):
		return "pls-studio-helper-darwin-" + goarch, nil
	case goos == "linux" && goarch == "amd64":
		return "pls-studio-helper-linux-amd64", nil
	case goos == "windows" && goarch == "amd64":
		return "pls-studio-helper-windows-amd64.exe", nil
	}
	return "", fmt.Errorf("no release is built for %s/%s", goos, goarch)
}

func fetchLatest(ctx context.Context) (*release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, updateLatestURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "pls-studio-helper/"+helperVersion)
	resp, err := updateHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var rel release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil {
		return nil, fmt.Errorf("unreadable release information: %w", err)
	}
	return &rel, nil
}

// checkUpdate: is a newer release available for this build?
func checkUpdate(ctx context.Context) (updateInfo, *release, error) {
	info := updateInfo{Current: helperVersion}
	if updatePublicKey == "" {
		info.Reason = "this build has no release key and cannot update itself: download the helper from the releases page"
		return info, nil, nil
	}
	cur, ok := parseVersion(helperVersion)
	if !ok {
		info.Reason = "a development build does not update itself"
		return info, nil, nil
	}
	rel, err := fetchLatest(ctx)
	if err != nil {
		return info, nil, err
	}
	latest, ok := parseVersion(rel.Tag)
	if !ok {
		return info, nil, fmt.Errorf("the latest release has an unexpected tag %q", rel.Tag)
	}
	info.Latest = strings.TrimPrefix(rel.Tag, "helper-v")
	if !isNewer(cur, latest) {
		info.Reason = "this is the latest version"
		return info, rel, nil
	}
	info.Available = true
	return info, rel, nil
}

func (r *release) asset(name string) (releaseAsset, error) {
	for _, a := range r.Assets {
		if a.Name == name {
			// Only from this repository's release downloads (GitHub redirects to its file storage).
			if !strings.HasPrefix(a.URL, updateDownloadPrefix+r.Tag+"/") {
				return a, fmt.Errorf("%s: unexpected download address", name)
			}
			return a, nil
		}
	}
	return releaseAsset{}, fmt.Errorf("the release has no %s", name)
}

func download(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "pls-studio-helper/"+helperVersion)
	resp, err := updateHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateDownload+1))
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}
	if len(data) > maxUpdateDownload {
		return nil, errors.New("download too large")
	}
	return data, nil
}

// verifySums checks the release key's signature over SHA256SUMS
// (SHA256SUMS.sig: the base64 Ed25519 signature).
func verifySums(sums, sig []byte, publicKey string) error {
	pub, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("the built-in release key is invalid")
	}
	s, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || len(s) != ed25519.SignatureSize {
		return errors.New("the release signature is malformed")
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), sums, s) {
		return errors.New("the release signature is not valid: the release was not made by PLS Studio's release workflow")
	}
	return nil
}

// sumFor is the SHA-256 SHA256SUMS lists for a file ("<hex>  <name>" lines).
func sumFor(sums []byte, name string) (string, error) {
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name && len(f[0]) == 64 {
			return strings.ToLower(f[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS does not list %s", name)
}

// verifiedBinary downloads this platform's binary of a release and checks it
// against the signed SHA256SUMS.
func verifiedBinary(ctx context.Context, rel *release, goos, goarch string) ([]byte, error) {
	name, err := assetName(goos, goarch)
	if err != nil {
		return nil, err
	}
	sumsAsset, err := rel.asset("SHA256SUMS")
	if err != nil {
		return nil, err
	}
	sigAsset, err := rel.asset("SHA256SUMS.sig")
	if err != nil {
		return nil, fmt.Errorf("%w: the release is not signed", err)
	}
	binAsset, err := rel.asset(name)
	if err != nil {
		return nil, err
	}
	sums, err := download(ctx, sumsAsset.URL)
	if err != nil {
		return nil, err
	}
	sig, err := download(ctx, sigAsset.URL)
	if err != nil {
		return nil, err
	}
	if err := verifySums(sums, sig, updatePublicKey); err != nil {
		return nil, err
	}
	want, err := sumFor(sums, name)
	if err != nil {
		return nil, err
	}
	bin, err := download(ctx, binAsset.URL)
	if err != nil {
		return nil, err
	}
	got := sha256.Sum256(bin)
	if hex.EncodeToString(got[:]) != want {
		return nil, fmt.Errorf("%s does not match the signed checksum", name)
	}
	return bin, nil
}

// One update at a time (the tray, the command line and the app could ask at once).
var updating sync.Mutex

// performUpdate replaces this helper's binary with the latest verified
// release; it returns the version installed and the path to start. The
// running process keeps running the old code until it restarts.
func performUpdate(ctx context.Context) (updateInfo, string, error) {
	if !updating.TryLock() {
		return updateInfo{Current: helperVersion}, "", errors.New("an update is already running")
	}
	defer updating.Unlock()
	info, rel, err := checkUpdate(ctx)
	if err != nil || !info.Available {
		return info, "", err
	}
	bin, err := verifiedBinary(ctx, rel, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return info, "", err
	}
	exe, err := os.Executable()
	if err != nil {
		return info, "", err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return info, "", err
	}
	if err := installBinary(exe, bin); err != nil {
		return info, "", fmt.Errorf("could not replace %s: %w", exe, err)
	}
	if runtime.GOOS == "darwin" {
		resignMac(exe)
	}
	return info, exe, nil
}

// writeBeside writes data to a new executable file in dir (for an atomic rename).
func writeBeside(dir string, data []byte) (string, error) {
	f, err := os.CreateTemp(dir, ".pls-studio-helper-update-*")
	if err != nil {
		return "", err
	}
	tmp := f.Name()
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return tmp, nil
}

// resignMac: the release binary is ad-hoc signed; inside the app bundle the
// bundle's ad-hoc signature has to cover the new binary again, or macOS
// refuses to open the app.
func resignMac(exe string) {
	target := exe
	if i := strings.Index(exe, ".app/Contents/MacOS/"); i >= 0 {
		target = exe[:i+len(".app")]
	}
	_ = exec.Command("codesign", "--force", "--deep", "--sign", "-", target).Run()
}

// Restart after an update: main shuts the server and the R workers down,
// then starts the new binary (restartInto, per platform).
var (
	restartMu   sync.Mutex
	restartPath string
)

func requestRestart(path string) {
	restartMu.Lock()
	restartPath = path
	restartMu.Unlock()
}

func pendingRestart() string {
	restartMu.Lock()
	defer restartMu.Unlock()
	return restartPath
}

// runUpdate is `pls-studio-helper update` (--check: only report).
func runUpdate(args []string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if len(args) > 0 && args[0] == "--check" {
		info, _, err := checkUpdate(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, "update check failed:", err)
			return 1
		}
		printUpdateInfo(info)
		return 0
	}
	fmt.Println("Checking for a newer PLS Studio Helper …")
	info, _, err := performUpdate(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "update failed:", err)
		return 1
	}
	if !info.Available {
		printUpdateInfo(info)
		return 0
	}
	fmt.Printf("Updated from %s to %s (signature and checksum verified).\nRestart the helper to use it: quit it and start it again. Then install any new R packages: pls-studio-helper setup\n", info.Current, info.Latest)
	return 0
}

func printUpdateInfo(info updateInfo) {
	switch {
	case info.Available:
		fmt.Printf("Version %s is available (this is %s): run pls-studio-helper update\n", info.Latest, info.Current)
	case info.Latest != "":
		fmt.Printf("PLS Studio Helper %s: %s.\n", info.Current, info.Reason)
	default:
		fmt.Printf("PLS Studio Helper %s: %s.\n", info.Current, info.Reason)
	}
}
