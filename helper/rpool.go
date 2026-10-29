// R worker pool: a fixed number of R processes (r/worker.R), each running
// one calculation at a time. Requests wait for a free worker. Cancelling a
// running calculation kills its process; a fresh one takes its place.
//
// The R code that runs is PLS Studio's R bridge, embedded in this binary
// (rsrc/, a copy of src/rengine/R/ made by `make sync-r`), written to a
// private temporary directory at startup. Requests name a ps_* function of
// the bridge and carry its JSON argument; they never carry R code.

package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed rsrc/*.R
var bridgeFS embed.FS

//go:embed r/worker.R
var workerR []byte

const replyMark = "\x1ePSH\x1e"

// maxReplyBytes caps one reply line from R (results, or an exported script
// with the data embedded).
const maxReplyBytes = 512 << 20

var (
	fnPattern      = regexp.MustCompile(`^ps_[a-z0-9_]{1,64}$`)
	idPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	packagePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9.]{0,63}$`)
)

// bridgeHash identifies the embedded R bridge: SHA-256 over the files in
// name order, each as "<name without .R>\n<content>\n". The browser computes
// the same over its own copy and uses the helper only when they match.
func bridgeHash() string {
	h := sha256.New()
	for _, f := range bridgeFiles() {
		data, _ := bridgeFS.ReadFile("rsrc/" + f)
		fmt.Fprintf(h, "%s\n%s\n", strings.TrimSuffix(f, ".R"), data)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func bridgeFiles() []string {
	entries, _ := fs.ReadDir(bridgeFS, "rsrc")
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

// callRequest is what /call accepts (and what is sent to R, plus the id).
type callRequest struct {
	ID       string   `json:"id"`
	Fn       string   `json:"fn"`
	Req      string   `json:"req"`
	Export   bool     `json:"export"`
	Packages []string `json:"packages"`
}

func (c *callRequest) validate() error {
	if !idPattern.MatchString(c.ID) {
		return errors.New("invalid id")
	}
	if !fnPattern.MatchString(c.Fn) {
		return errors.New("invalid function name")
	}
	if len(c.Packages) > 32 {
		return errors.New("too many packages")
	}
	for _, p := range c.Packages {
		if !packagePattern.MatchString(p) {
			return errors.New("invalid package name")
		}
	}
	if !json.Valid([]byte(c.Req)) {
		return errors.New("the request is not JSON")
	}
	return nil
}

// callReply is R's answer: ok with result (JSON text, or the R script when
// exporting), or an error kind: r_error, missing_packages, bad_request.
type callReply struct {
	ID       string         `json:"id"`
	OK       bool           `json:"ok"`
	Result   string         `json:"result,omitempty"`
	Kind     string         `json:"kind,omitempty"`
	Message  string         `json:"message,omitempty"`
	Packages []string       `json:"packages,omitempty"`
	Versions map[string]any `json:"versions,omitempty"`
}

type rWorker struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	lines  chan string
	exited chan struct{}
}

type rPool struct {
	rscript string
	library string
	dir     string // bridge + worker.R
	logger  *log.Logger
	size    int

	free    chan *rWorker
	waiting chan struct{} // bounded queue of requests waiting for a worker

	mu       sync.Mutex
	running  map[string]*rWorker // call id -> worker
	rVersion string
	startErr error
	closed   bool
}

// maxWaiting bounds requests queued for a worker (bootstrap chunks queue here).
const maxWaiting = 512

func findRscript(configured string) (string, error) {
	if configured != "" {
		if _, err := os.Stat(configured); err != nil {
			return "", fmt.Errorf("configured Rscript %s: %w", configured, err)
		}
		return configured, nil
	}
	if p, err := exec.LookPath("Rscript"); err == nil {
		return p, nil
	}
	// GUI apps (macOS .app, Windows tray) get a bare PATH: try the usual places.
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{"/usr/local/bin/Rscript", "/opt/homebrew/bin/Rscript", "/Library/Frameworks/R.framework/Resources/bin/Rscript"}
	case "windows":
		matches, _ := filepath.Glob(`C:\Program Files\R\R-*\bin\Rscript.exe`)
		sort.Sort(sort.Reverse(sort.StringSlice(matches)))
		candidates = matches
	default:
		candidates = []string{"/usr/bin/Rscript", "/usr/local/bin/Rscript"}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", errors.New("Rscript not found: install R (https://cran.r-project.org) or set \"rscript\" in the helper's config.json")
}

func newRPool(cfg *config, logger *log.Logger) (*rPool, error) {
	dir, err := os.MkdirTemp("", "pls-studio-helper-")
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	for _, f := range bridgeFiles() {
		data, _ := bridgeFS.ReadFile("rsrc/" + f)
		if err := os.WriteFile(filepath.Join(dir, f), data, 0o600); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "worker.R.txt"), workerR, 0o600); err != nil {
		return nil, err
	}
	p := &rPool{library: cfg.RLibrary, dir: dir, logger: logger, size: cfg.workers(),
		running: map[string]*rWorker{}, waiting: make(chan struct{}, maxWaiting)}
	p.free = make(chan *rWorker, p.size)
	p.rscript, p.startErr = findRscript(cfg.Rscript)
	if p.startErr != nil {
		return p, nil // the helper still runs; /version reports the problem
	}
	for i := 0; i < p.size; i++ {
		w, err := p.spawn()
		if err != nil {
			p.startErr = err
			return p, nil
		}
		p.free <- w
	}
	return p, nil
}

// spawn starts one R worker and waits for its ready line.
func (p *rPool) spawn() (*rWorker, error) {
	// The worker script is not named *.R so it is not sourced as part of the bridge.
	cmd := exec.Command(p.rscript, "--vanilla", filepath.Join(p.dir, "worker.R.txt"), p.dir)
	cmd.Dir = p.dir
	cmd.Env = append(os.Environ(), "PS_HELPER_LIBRARY="+p.library)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start R: %w", err)
	}
	w := &rWorker{cmd: cmd, stdin: stdin, lines: make(chan string, 1), exited: make(chan struct{})}
	go func() { // R's messages and warnings: to the helper's log, briefly.
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			if p.logger != nil {
				line := sc.Text()
				if len(line) > 300 {
					line = line[:300] + "…"
				}
				p.logger.Printf("R[%d]: %s", cmd.Process.Pid, line)
			}
		}
	}()
	go func() {
		r := bufio.NewReaderSize(stdout, 1<<20)
		for {
			line, err := readLine(r, maxReplyBytes)
			if err != nil {
				break
			}
			if strings.HasPrefix(line, replyMark) {
				w.lines <- strings.TrimPrefix(line, replyMark)
			}
		}
		_ = cmd.Wait()
		close(w.exited)
	}()
	select {
	case line := <-w.lines:
		var ready struct {
			Ready   bool   `json:"ready"`
			R       string `json:"r"`
			Message string `json:"message"`
		}
		if json.Unmarshal([]byte(line), &ready) != nil || !ready.Ready {
			p.kill(w)
			if ready.Message != "" {
				return nil, errors.New(ready.Message)
			}
			return nil, errors.New("R worker did not start")
		}
		p.mu.Lock()
		p.rVersion = ready.R
		p.mu.Unlock()
		return w, nil
	case <-w.exited:
		return nil, errors.New("R stopped while starting (is R installed correctly?)")
	case <-time.After(120 * time.Second):
		p.kill(w)
		return nil, errors.New("R worker did not start within 120 s")
	}
}

// readLine reads one '\n'-terminated line of at most max bytes.
func readLine(r *bufio.Reader, max int) (string, error) {
	var b strings.Builder
	for {
		chunk, isPrefix, err := r.ReadLine()
		if err != nil {
			return "", err
		}
		if b.Len()+len(chunk) > max {
			return "", errors.New("line too long")
		}
		b.Write(chunk)
		if !isPrefix {
			return b.String(), nil
		}
	}
}

func (p *rPool) kill(w *rWorker) {
	_ = w.stdin.Close()
	if w.cmd.Process != nil {
		_ = w.cmd.Process.Kill()
	}
}

// replace puts a fresh worker in place of a killed or crashed one.
func (p *rPool) replace() {
	p.mu.Lock()
	closed := p.closed
	p.mu.Unlock()
	if closed {
		return
	}
	w, err := p.spawn()
	if err != nil {
		p.mu.Lock()
		p.startErr = err
		p.mu.Unlock()
		if p.logger != nil {
			p.logger.Printf("restart R worker: %v", err)
		}
		return
	}
	p.free <- w
}

var errCancelled = errors.New("cancelled")
var errBusy = errors.New("too many waiting calculations")

// call runs one request on a free worker. Cancelling ctx (client gone, or
// /cancel) kills the worker's process.
func (p *rPool) call(ctx context.Context, req *callRequest) (*callReply, error) {
	p.mu.Lock()
	err := p.startErr
	p.mu.Unlock()
	if err != nil && len(p.free) == 0 && p.idle() {
		return nil, err
	}
	select {
	case p.waiting <- struct{}{}:
	default:
		return nil, errBusy
	}
	var w *rWorker
	select {
	case w = <-p.free:
		<-p.waiting
	case <-ctx.Done():
		<-p.waiting
		return nil, errCancelled
	}
	line, err := json.Marshal(req)
	if err != nil {
		p.free <- w
		return nil, err
	}
	p.mu.Lock()
	p.running[req.ID] = w
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.running, req.ID)
		p.mu.Unlock()
	}()
	if _, err := w.stdin.Write(append(line, '\n')); err != nil {
		p.kill(w)
		go p.replace()
		return nil, errors.New("R stopped")
	}
	select {
	case out := <-w.lines:
		var rep callReply
		if err := json.Unmarshal([]byte(out), &rep); err != nil || rep.ID != req.ID {
			p.kill(w)
			go p.replace()
			return nil, errors.New("unreadable reply from R")
		}
		p.free <- w
		return &rep, nil
	case <-w.exited:
		go p.replace()
		return nil, errors.New("R stopped during the calculation (it may have run out of memory)")
	case <-ctx.Done():
		p.kill(w)
		go p.replace()
		return nil, errCancelled
	}
}

// idle reports whether no worker is busy (used to tell "no R at all" apart).
func (p *rPool) idle() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.running) == 0
}

func (p *rPool) status() (rVersion string, workers int, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.rVersion, p.size, p.startErr
}

func (p *rPool) close() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	for {
		select {
		case w := <-p.free:
			p.kill(w)
		default:
			p.mu.Lock()
			for _, w := range p.running {
				p.kill(w)
			}
			p.mu.Unlock()
			_ = os.RemoveAll(p.dir)
			return
		}
	}
}
