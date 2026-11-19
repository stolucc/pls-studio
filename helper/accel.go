// Accelerators run PLS Studio's GPU worker (gpusrc/worker.py: batched PLS /
// PLSc bootstrapping in torch). An accelerator is one worker process: on this
// computer (localAccelerator) or, later, on another machine over ssh — the
// same JSON-lines protocol either way. The pool schedules each request on an
// idle accelerator that computes in the requested precision (Apple GPUs have
// no double) and replaces a worker that dies.

package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed gpusrc/plsgpu.py gpusrc/worker.py
var gpuFS embed.FS

// gpuWorkerFiles are written to the worker's directory (tests swap worker.py for a fake).
var gpuWorkerFiles = func() map[string][]byte {
	files := map[string][]byte{}
	for _, name := range []string{"plsgpu.py", "worker.py"} {
		data, err := gpuFS.ReadFile("gpusrc/" + name)
		if err != nil {
			panic(err)
		}
		files[name] = data
	}
	return files
}()

// accelInfo describes one accelerator, as /version reports it.
type accelInfo struct {
	// Where the worker runs: "local", or the host name of a cluster node.
	Where  string `json:"where"`
	Device string `json:"device"`
	Name   string `json:"name"`
	Torch  string `json:"torch"`
	// Precisions the device computes in ("float32", "float64"), the preferred one first.
	Precisions []string `json:"precisions"`
}

func (a accelInfo) supports(precision string) bool {
	want := map[string]string{"single": "float32", "double": "float64"}[precision]
	if precision == "auto" || precision == "" {
		return true
	}
	for _, p := range a.Precisions {
		if p == want {
			return true
		}
	}
	return false
}

// accelerator is one GPU worker. Calls are serialised by the pool: one at a time per accelerator.
type accelerator interface {
	info() accelInfo
	// call sends one request and waits for its reply (the worker's ok: false is an error).
	call(ctx context.Context, op string, req json.RawMessage) (json.RawMessage, error)
	// clone starts a fresh worker of the same kind, replacing one that died.
	clone() (accelerator, error)
	close()
}

// errAccelDied marks a worker that ended during a call (the pool replaces it and retries elsewhere).
var errAccelDied = errors.New("the GPU worker stopped")

type workerReply struct {
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Result  json.RawMessage `json:"result"`
	Message string          `json:"message"`
}

type workerReady struct {
	Ready      bool     `json:"ready"`
	Message    string   `json:"message"`
	Device     string   `json:"device"`
	Name       string   `json:"name"`
	Torch      string   `json:"torch"`
	Precisions []string `json:"precisions"`
}

// ---------- the local worker ----------

type localAccelerator struct {
	python, dir, device string
	logger              *log.Logger

	cmd    *exec.Cmd
	stdin  *json.Encoder
	lines  chan string
	exited chan struct{}
	meta   accelInfo
	seq    int
}

// accelStartTimeout: importing torch the first time can take a while on a slow disk.
const accelStartTimeout = 120 * time.Second

func startLocalAccelerator(python, dir, device string, logger *log.Logger) (*localAccelerator, error) {
	if device == "" {
		device = "auto"
	}
	a := &localAccelerator{python: python, dir: dir, device: device, logger: logger}
	// -I: isolated mode — no PYTHON* environment variables, no user site-packages, the script's
	// directory not on sys.path (the worker adds its own 0700 directory itself).
	cmd := exec.Command(python, "-I", filepath.Join(dir, "worker.py"), device)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
	setProcessGroup(cmd)
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
		return nil, fmt.Errorf("start the GPU worker: %w", err)
	}
	a.cmd = cmd
	a.stdin = json.NewEncoder(stdin)
	a.lines = make(chan string, 1)
	a.exited = make(chan struct{})
	go func() { // torch's warnings: to the helper's log, briefly.
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			if logger != nil {
				line := sc.Text()
				if len(line) > 300 {
					line = line[:300] + "…"
				}
				logger.Printf("gpu[%d]: %s", cmd.Process.Pid, line)
			}
		}
	}()
	go func() {
		r := bufio.NewReaderSize(stdout, 1<<20)
		for {
			line, err := readLine(r, maxReplyBytes)
			if err != nil {
				killTree(cmd)
				break
			}
			if strings.HasPrefix(line, replyMark) {
				a.lines <- strings.TrimPrefix(line, replyMark)
			}
		}
		_ = cmd.Wait()
		close(a.exited)
	}()
	select {
	case line := <-a.lines:
		var ready workerReady
		if json.Unmarshal([]byte(line), &ready) != nil || !ready.Ready {
			a.close()
			if ready.Message != "" {
				return nil, errors.New(ready.Message)
			}
			return nil, errors.New("the GPU worker did not start")
		}
		a.meta = accelInfo{Where: "local", Device: ready.Device, Name: ready.Name, Torch: ready.Torch, Precisions: ready.Precisions}
		return a, nil
	case <-a.exited:
		return nil, errors.New("the GPU worker stopped while starting (is torch installed in its Python?)")
	case <-time.After(accelStartTimeout):
		a.close()
		return nil, errors.New("the GPU worker did not start within 120 s")
	}
}

func (a *localAccelerator) info() accelInfo { return a.meta }

func (a *localAccelerator) clone() (accelerator, error) {
	return startLocalAccelerator(a.python, a.dir, a.device, a.logger)
}

func (a *localAccelerator) close() {
	if a.cmd != nil {
		killTree(a.cmd)
	}
}

func (a *localAccelerator) call(ctx context.Context, op string, req json.RawMessage) (json.RawMessage, error) {
	a.seq++
	id := fmt.Sprintf("g%d", a.seq)
	msg := struct {
		ID  string          `json:"id"`
		Op  string          `json:"op"`
		Req json.RawMessage `json:"req,omitempty"`
	}{ID: id, Op: op, Req: req}
	if err := a.stdin.Encode(&msg); err != nil {
		a.close()
		return nil, errAccelDied
	}
	select {
	case out := <-a.lines:
		var rep workerReply
		if err := json.Unmarshal([]byte(out), &rep); err != nil || rep.ID != id {
			a.close()
			return nil, errAccelDied
		}
		if !rep.OK {
			return nil, errors.New(rep.Message)
		}
		return rep.Result, nil
	case <-a.exited:
		return nil, errAccelDied
	case <-ctx.Done():
		a.close()
		return nil, errCancelled
	}
}

// ---------- the pool ----------

type accelPool struct {
	mu       sync.Mutex
	cond     *sync.Cond
	accels   []accelerator
	busy     map[accelerator]bool
	queued   int
	starting bool
	startErr error
	closed   bool
	dir      string
	logger   *log.Logger
}

// accelStatus is the "gpu" entry of /version.
type accelStatus struct {
	Accelerators []accelInfo `json:"accelerators"`
	Starting     bool        `json:"starting,omitempty"`
	Error        string      `json:"error,omitempty"`
}

// gpuPython is the Python that runs the worker: the configured one, else the
// virtual environment `setup-gpu` creates under the config directory.
func (c *config) gpuPython() (string, error) {
	if c.GPUPython != "" {
		return c.GPUPython, nil
	}
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "gpu", "venv", venvPython()), nil
}

func venvPython() string {
	if runtime.GOOS == "windows" {
		return filepath.Join("Scripts", "python.exe")
	}
	return filepath.Join("bin", "python")
}

// newAccelPool prepares the worker directory and starts the local worker in
// the background (torch takes seconds to import; the helper serves meanwhile).
// Without a worker Python the pool is empty and status() says why.
func newAccelPool(cfg *config, logger *log.Logger) *accelPool {
	p := &accelPool{busy: map[accelerator]bool{}, logger: logger}
	p.cond = sync.NewCond(&p.mu)
	python, err := cfg.gpuPython()
	if err == nil {
		if _, statErr := os.Stat(python); statErr != nil {
			err = errors.New("the GPU worker is not set up: run pls-studio-helper setup-gpu")
		}
	}
	if err != nil {
		p.startErr = err
		return p
	}
	dir, err := os.MkdirTemp("", "pls-studio-gpu-")
	if err != nil {
		p.startErr = err
		return p
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		p.startErr = err
		return p
	}
	for name, data := range gpuWorkerFiles {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			p.startErr = err
			return p
		}
	}
	p.dir = dir
	p.starting = true
	go func() {
		a, err := startLocalAccelerator(python, dir, cfg.GPUDevice, logger)
		p.mu.Lock()
		defer p.mu.Unlock()
		p.starting = false
		if err != nil {
			p.startErr = err
		} else if p.closed {
			a.close()
		} else {
			p.accels = append(p.accels, a)
			p.startErr = nil
		}
		p.cond.Broadcast()
	}()
	return p
}

// waitReady blocks until the background start has finished (tests and setup-gpu).
func (p *accelPool) waitReady() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for p.starting {
		p.cond.Wait()
	}
}

func (p *accelPool) status() accelStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	st := accelStatus{Accelerators: []accelInfo{}, Starting: p.starting}
	for _, a := range p.accels {
		st.Accelerators = append(st.Accelerators, a.info())
	}
	if len(p.accels) == 0 && p.startErr != nil && !p.starting {
		st.Error = p.startErr.Error()
	}
	return st
}

// maxAccelWaiting bounds requests queued for an accelerator.
const maxAccelWaiting = 256

// acquire picks an idle accelerator that computes in the precision, waiting
// for one to become free; errBusy when too many wait, errCancelled on ctx.
func (p *accelPool) acquire(ctx context.Context, precision string) (accelerator, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	stop := context.AfterFunc(ctx, func() {
		p.mu.Lock()
		p.cond.Broadcast()
		p.mu.Unlock()
	})
	defer stop()
	for p.starting && len(p.accels) == 0 && ctx.Err() == nil {
		p.cond.Wait()
	}
	for {
		if ctx.Err() != nil {
			return nil, errCancelled
		}
		if p.closed {
			return nil, errors.New("the helper is shutting down")
		}
		var able []accelerator
		for _, a := range p.accels {
			if a.info().supports(precision) {
				able = append(able, a)
			}
		}
		if len(able) == 0 {
			if len(p.accels) == 0 {
				if p.startErr != nil {
					return nil, p.startErr
				}
				return nil, errors.New("no GPU worker is running")
			}
			return nil, fmt.Errorf("no accelerator computes in %s precision", precision)
		}
		for _, a := range able {
			if !p.busy[a] {
				p.busy[a] = true
				return a, nil
			}
		}
		if p.queued >= maxAccelWaiting {
			return nil, errBusy
		}
		p.queued++
		p.cond.Wait()
		p.queued--
	}
}

func (p *accelPool) release(a accelerator) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.busy, a)
	p.cond.Broadcast()
}

// replace drops a dead accelerator and starts its successor in the background.
func (p *accelPool) replace(dead accelerator) {
	p.mu.Lock()
	kept := p.accels[:0]
	for _, a := range p.accels {
		if a != dead {
			kept = append(kept, a)
		}
	}
	p.accels = kept
	delete(p.busy, dead)
	closed := p.closed
	if !closed {
		p.starting = true // (acquire waits for the successor while no accelerator is left)
	}
	p.cond.Broadcast()
	p.mu.Unlock()
	dead.close()
	if closed {
		return
	}
	go func() {
		a, err := dead.clone()
		p.mu.Lock()
		defer p.mu.Unlock()
		p.starting = false
		if err != nil {
			p.startErr = err
			if p.logger != nil {
				p.logger.Printf("gpu: worker not replaced: %v", err)
			}
		} else if p.closed {
			a.close()
		} else {
			p.accels = append(p.accels, a)
		}
		p.cond.Broadcast()
	}()
}

// call runs one request on an accelerator of the precision. A worker that
// dies mid-call is replaced and the request retried once on another.
func (p *accelPool) call(ctx context.Context, op string, req json.RawMessage, precision string) (json.RawMessage, error) {
	for attempt := 0; ; attempt++ {
		a, err := p.acquire(ctx, precision)
		if err != nil {
			return nil, err
		}
		out, err := a.call(ctx, op, req)
		switch {
		case errors.Is(err, errCancelled):
			// (the worker was killed to stop the calculation: replaced like one that died)
			p.replace(a)
			return nil, err
		case errors.Is(err, errAccelDied):
			p.replace(a)
			if attempt == 0 {
				continue
			}
			return nil, errors.New("the GPU worker stopped during the calculation (it may have run out of memory)")
		default:
			p.release(a)
			return out, err
		}
	}
}

func (p *accelPool) close() {
	p.mu.Lock()
	p.closed = true
	accels := p.accels
	p.accels = nil
	dir := p.dir
	p.cond.Broadcast()
	p.mu.Unlock()
	for _, a := range accels {
		a.close()
	}
	if dir != "" {
		_ = os.RemoveAll(dir)
	}
}
