// The GPU bootstrap endpoint and the `setup-gpu` command.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// gpuRequest is POST /gpu/bootstrap: {"id": ..., "req": {...}}. The request
// object is the GPU worker's (gpusrc/worker.py bootstrap): the prepared
// columns, the compiled model, the options, the sample range and the
// precision ("auto", "single", "double"); it is passed through unparsed
// except for the precision, which picks the accelerator.
type gpuRequest struct {
	ID  string          `json:"id"`
	Req json.RawMessage `json:"req"`
}

func (g *gpuRequest) validate() (precision string, err error) {
	if !idPattern.MatchString(g.ID) {
		return "", errors.New("invalid id")
	}
	var probe struct {
		Precision string `json:"precision"`
	}
	if len(g.Req) == 0 || g.Req[0] != '{' || json.Unmarshal(g.Req, &probe) != nil {
		return "", errors.New("the request is not a JSON object")
	}
	switch probe.Precision {
	case "", "auto":
		return "auto", nil
	case "single", "double":
		return probe.Precision, nil
	}
	return "", errors.New("unknown precision")
}

type gpuReply struct {
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Result  json.RawMessage `json:"result,omitempty"`
	Kind    string          `json:"kind,omitempty"`
	Message string          `json:"message,omitempty"`
}

// /gpu/bootstrap — POST: one range of a PLS bootstrap on an accelerator. The
// answer is the native engine's RangePart (params, originals, draws, …) with
// the precision it was computed in. POST /cancel/<id> stops it.
func (s *server) handleGPUBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if wait, ok := s.limiter.allow(); !ok {
		secs := int((wait + time.Second - 1) / time.Second)
		if secs < 1 {
			secs = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, callMaxBodyBytes)
	var req gpuRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "bad request body", http.StatusBadRequest)
		return
	}
	precision, err := req.validate()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if s.gpu == nil {
		writeJSON(w, gpuReply{ID: req.ID, OK: false, Kind: "gpu_error", Message: "this helper has no GPU worker"})
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if !s.jobs.register(req.ID, cancel) {
		http.Error(w, "duplicate id", http.StatusConflict)
		return
	}
	defer s.jobs.deregister(req.ID)
	out, err := s.gpu.call(ctx, "bootstrap", req.Req, precision)
	switch {
	case errors.Is(err, errCancelled):
		writeJSON(w, gpuReply{ID: req.ID, OK: false, Kind: "cancelled", Message: "Cancelled."})
	case errors.Is(err, errBusy):
		w.Header().Set("Retry-After", "5")
		http.Error(w, err.Error(), http.StatusTooManyRequests)
	case err != nil:
		writeJSON(w, gpuReply{ID: req.ID, OK: false, Kind: "gpu_error", Message: err.Error()})
	default:
		writeJSON(w, gpuReply{ID: req.ID, OK: true, Result: out})
	}
}

// ---------- setup-gpu ----------

// runSetupGPU creates the worker's Python virtual environment under the
// config directory and installs torch into it. `--index-url <url>` picks
// another wheel index (e.g. https://download.pytorch.org/whl/cu126 for CUDA
// 12 on Linux); `--python <path>` the Python to build the venv from (3.10+).
func runSetupGPU(logger *log.Logger, args []string) {
	var python, indexURL string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--python":
			if i+1 < len(args) {
				i++
				python = args[i]
			}
		case "--index-url":
			if i+1 < len(args) {
				i++
				indexURL = args[i]
			}
		default:
			logger.Fatalf("setup-gpu: unknown argument %q", args[i])
		}
	}
	if indexURL != "" && !strings.HasPrefix(indexURL, "https://") {
		logger.Fatalf("setup-gpu: the index URL must start with https://")
	}
	if python == "" {
		var err error
		python, err = findPython()
		if err != nil {
			logger.Fatalf("setup-gpu: %v", err)
		}
	}
	dir, err := configDir()
	if err != nil {
		logger.Fatalf("setup-gpu: %v", err)
	}
	venv := filepath.Join(dir, "gpu", "venv")
	fmt.Printf("Creating %s with %s …\n", venv, python)
	if err := runShown(python, "-m", "venv", "--clear", venv); err != nil {
		logger.Fatalf("setup-gpu: venv: %v", err)
	}
	vpy := filepath.Join(venv, venvPython())
	pip := []string{"-m", "pip", "install", "--disable-pip-version-check", "torch", "numpy"}
	if indexURL != "" {
		pip = append(pip, "--index-url", indexURL)
	}
	fmt.Println("Installing torch and numpy …")
	if err := runShown(vpy, pip...); err != nil {
		logger.Fatalf("setup-gpu: pip: %v", err)
	}
	fmt.Println("Checking the worker …")
	cfg := &config{GPUPython: vpy}
	pool := newAccelPool(cfg, logger)
	pool.waitReady()
	st := pool.status()
	pool.close()
	if st.Error != "" {
		logger.Fatalf("setup-gpu: the worker does not start: %s", st.Error)
	}
	for _, a := range st.Accelerators {
		fmt.Printf("GPU worker ready: %s (%s), torch %s, precisions %s.\n", a.Name, a.Device, a.Torch, strings.Join(a.Precisions, ", "))
	}
	fmt.Println("Done. Restart the helper to use it.")
}

// findPython: python3 (or python) on PATH, 3.10 or later.
func findPython() (string, error) {
	for _, name := range []string{"python3", "python"} {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		out, err := exec.Command(path, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])").Output()
		if err != nil {
			continue
		}
		var major, minor int
		if _, err := fmt.Sscan(string(out), &major, &minor); err == nil && (major > 3 || (major == 3 && minor >= 10)) {
			return path, nil
		}
	}
	return "", errors.New("no Python 3.10 or later found on PATH (pass --python <path>)")
}

func runShown(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
