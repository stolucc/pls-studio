package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeWorker speaks the worker protocol without torch: it advertises the
// precisions given on the command line (the "device" argument), echoes
// bootstrap requests, sleeps on "slow" and exits on "die".
const fakeWorker = `import json, sys, time
MARK = "\x1ePSH\x1e"
def reply(o):
    sys.stdout.write(MARK + json.dumps(o) + "\n"); sys.stdout.flush()
device = sys.argv[1] if len(sys.argv) > 1 else "auto"
if device == "broken":
    reply({"ready": False, "message": "no torch here"}); sys.exit(1)
precisions = {"mps": ["float32"], "cpu": ["float64", "float32"]}.get(device, ["float32", "float64"])
reply({"ready": True, "device": device, "name": "Fake GPU", "torch": "0.0", "precisions": precisions})
for line in sys.stdin:
    req = json.loads(line)
    op = req.get("op")
    if op == "die":
        sys.exit(3)
    if op == "slow":
        time.sleep(5)
    if op == "bootstrap":
        r = req.get("req") or {}
        reply({"id": req["id"], "ok": True, "result": {"start": r.get("start", 0), "draws": [[1.5, None]], "precision": precisions[0] if r.get("precision", "auto") == "auto" else {"single": "float32", "double": "float64"}[r["precision"]]}})
    elif op == "fail":
        reply({"id": req["id"], "ok": False, "message": "bad columns"})
    else:
        reply({"id": req["id"], "ok": True, "result": {"device": device}})
`

func python3(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	t.Skip("python3 not available")
	return ""
}

// fakePool starts a pool whose worker is the fake, pretending to be `device`.
func fakePool(t *testing.T, device string) *accelPool {
	t.Helper()
	py := python3(t)
	saved := gpuWorkerFiles
	gpuWorkerFiles = map[string][]byte{"worker.py": []byte(fakeWorker), "plsgpu.py": []byte("")}
	t.Cleanup(func() { gpuWorkerFiles = saved })
	p := newAccelPool(&config{GPUPython: py, GPUDevice: device}, log.New(io.Discard, "", 0))
	t.Cleanup(p.close)
	p.waitReady()
	return p
}

func TestAccelPool_StartsRoutesAndReportsPrecisions(t *testing.T) {
	p := fakePool(t, "cpu")
	st := p.status()
	if st.Error != "" || len(st.Accelerators) != 1 || st.Starting {
		t.Fatalf("status %+v", st)
	}
	a := st.Accelerators[0]
	if a.Where != "local" || a.Device != "cpu" || a.Name != "Fake GPU" || strings.Join(a.Precisions, ",") != "float64,float32" {
		t.Fatalf("info %+v", a)
	}
	out, err := p.call(context.Background(), "bootstrap", json.RawMessage(`{"start":7}`), "auto")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Start     int          `json:"start"`
		Draws     [][]*float64 `json:"draws"`
		Precision string       `json:"precision"`
	}
	if err := json.Unmarshal(out, &got); err != nil || got.Start != 7 || got.Precision != "float64" {
		t.Fatalf("result %s (%v)", out, err)
	}
	// NaN travels as null.
	if len(got.Draws) != 1 || len(got.Draws[0]) != 2 || got.Draws[0][1] != nil || *got.Draws[0][0] != 1.5 {
		t.Fatalf("draws %s", out)
	}
	// The worker's own errors come back as errors, and the worker stays usable.
	if _, err := p.call(context.Background(), "fail", nil, "auto"); err == nil || err.Error() != "bad columns" {
		t.Fatalf("worker error: %v", err)
	}
	if _, err := p.call(context.Background(), "probe", nil, "single"); err != nil {
		t.Fatal(err)
	}
}

func TestAccelPool_RefusesAPrecisionNoAcceleratorHas(t *testing.T) {
	p := fakePool(t, "mps")
	_, err := p.call(context.Background(), "bootstrap", json.RawMessage(`{"precision":"double"}`), "double")
	if err == nil || !strings.Contains(err.Error(), "double precision") {
		t.Fatalf("want a precision error, got %v", err)
	}
	if _, err := p.call(context.Background(), "bootstrap", json.RawMessage(`{"precision":"single"}`), "single"); err != nil {
		t.Fatal(err)
	}
}

func TestAccelPool_ReplacesAWorkerThatDies(t *testing.T) {
	p := fakePool(t, "cpu")
	// A worker that dies mid-call is replaced; the call is retried on the replacement.
	_, err := p.call(context.Background(), "die", nil, "auto")
	if err == nil || !errors.Is(err, errAccelDied) && !strings.Contains(err.Error(), "stopped") {
		t.Fatalf("want a stopped-worker error, got %v", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if len(p.status().Accelerators) == 1 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := p.call(context.Background(), "probe", nil, "auto"); err != nil {
		t.Fatalf("after replacement: %v", err)
	}
}

func TestAccelPool_CancelKillsTheWorkerAndRecovers(t *testing.T) {
	p := fakePool(t, "cpu")
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := p.call(ctx, "slow", nil, "auto")
	if !errors.Is(err, errCancelled) {
		t.Fatalf("want errCancelled, got %v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("cancel did not stop the call promptly")
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) && len(p.status().Accelerators) == 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := p.call(context.Background(), "probe", nil, "auto"); err != nil {
		t.Fatalf("after cancel: %v", err)
	}
}

func TestAccelPool_ReportsAWorkerThatCannotStart(t *testing.T) {
	p := fakePool(t, "broken")
	st := p.status()
	if st.Error != "no torch here" || len(st.Accelerators) != 0 {
		t.Fatalf("status %+v", st)
	}
	if _, err := p.call(context.Background(), "probe", nil, "auto"); err == nil || err.Error() != "no torch here" {
		t.Fatalf("call: %v", err)
	}
}

func TestAccelPool_WithoutAPythonSaysHowToSetUp(t *testing.T) {
	p := newAccelPool(&config{GPUPython: filepath.Join(t.TempDir(), "nope")}, nil)
	defer p.close()
	if st := p.status(); !strings.Contains(st.Error, "setup-gpu") {
		t.Fatalf("status %+v", st)
	}
}

func TestGPUBootstrap_Endpoint(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	// Without a worker: a helper error, not a crash.
	w := do(t, s, cfg, http.MethodPost, "/gpu/bootstrap", `{"id":"abc123","req":{"start":0}}`)
	var rep gpuReply
	if err := json.Unmarshal(w.Body.Bytes(), &rep); err != nil || rep.OK || rep.Kind != "gpu_error" {
		t.Fatalf("no worker: %d %s", w.Code, w.Body.String())
	}
	s.gpu = fakePool(t, "mps")
	for _, body := range []string{`{}`, `{"id":"abc123"}`, `{"id":"abc123","req":[1]}`, `{"id":"abc123","req":{"precision":"half"}}`, `{"id":"abc123","req":{},"extra":1}`, `{"id":"a b","req":{}}`} {
		if w := do(t, s, cfg, http.MethodPost, "/gpu/bootstrap", body); w.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d %s", body, w.Code, w.Body.String())
		}
	}
	if w := do(t, s, cfg, http.MethodGet, "/gpu/bootstrap", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", w.Code)
	}
	// No bearer: refused before anything runs.
	req := do(t, s, cfg, http.MethodPost, "/gpu/bootstrap", `{"id":"abc123","req":{}}`)
	if req.Code != http.StatusOK {
		t.Fatalf("ok call: %d %s", req.Code, req.Body.String())
	}
	if err := json.Unmarshal(req.Body.Bytes(), &rep); err != nil || !rep.OK || !strings.Contains(string(rep.Result), `"float32"`) {
		t.Fatalf("result: %s", req.Body.String())
	}
	// A precision the accelerator lacks: a gpu_error the app can act on (fall back to the browser engine).
	req = do(t, s, cfg, http.MethodPost, "/gpu/bootstrap", `{"id":"abc124","req":{"precision":"double"}}`)
	if err := json.Unmarshal(req.Body.Bytes(), &rep); err != nil || rep.OK || rep.Kind != "gpu_error" || !strings.Contains(rep.Message, "double") {
		t.Fatalf("double: %s", req.Body.String())
	}
	// /version reports the accelerators.
	v := do(t, s, cfg, http.MethodGet, "/version", "")
	var ver struct {
		GPU accelStatus `json:"gpu"`
	}
	if err := json.Unmarshal(v.Body.Bytes(), &ver); err != nil || len(ver.GPU.Accelerators) != 1 || ver.GPU.Accelerators[0].Device != "mps" {
		t.Fatalf("version: %s", v.Body.String())
	}
}

func TestGPUBootstrap_RequiresBearer(t *testing.T) {
	s, cfg := newTestServer(t, nil)
	req := do(t, s, cfg, http.MethodPost, "/gpu/bootstrap", `{"id":"abc123","req":{}}`)
	if req.Code != http.StatusOK {
		t.Fatalf("with bearer: %d", req.Code)
	}
	cfg.BearerToken = generateToken()
	w := do(t, s, &config{Port: 9878, BearerToken: "wrong"}, http.MethodPost, "/gpu/bootstrap", `{"id":"abc123","req":{}}`)
	if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden {
		t.Fatalf("wrong bearer: %d", w.Code)
	}
}

// The real worker (torch) from the development venv, when present.
func TestLocalAccelerator_RealWorkerBootstraps(t *testing.T) {
	py := filepath.Join("gpusrc", ".venv", "bin", "python")
	if _, err := exec.LookPath(py); err != nil {
		t.Skip("gpusrc/.venv not present")
	}
	abs, _ := filepath.Abs(py)
	p := newAccelPool(&config{GPUPython: abs, GPUDevice: "cpu"}, log.New(io.Discard, "", 0))
	defer p.close()
	p.waitReady()
	st := p.status()
	if st.Error != "" || len(st.Accelerators) != 1 {
		t.Fatalf("status %+v", st)
	}
	// Two indicators per construct, one path: the smallest model.
	req := `{"cols":[[1,2,3,4,5,6,7,8],[2,1,4,3,6,5,8,7.5],[1,3,2,5,4,7,6,8],[3,1,2,4,6,5,8,7]],
	  "model":{"constructs":["A","B"],"indicatorNames":["a1","a2","b1","b2"],"indicatorConstruct":[0,0,1,1],
	  "blocks":[[0,1],[2,3]],"modes":["A","A"],"types":["factor","factor"],"preds":[[],[0]],"succs":[[1],[]],
	  "hasPath":[[false,true],[false,false]],"dominant":[-1,-1],"predefined":[null,null]},
	  "options":{"scheme":"path","maxIter":300,"tolerance":1e-7,"consistent":false},"seed":1,"start":0,"end":10,"precision":"double"}`
	out, err := p.call(context.Background(), "bootstrap", json.RawMessage(req), "double")
	if err != nil {
		t.Fatal(err)
	}
	var part struct {
		Params    []struct{ Key string } `json:"params"`
		Draws     [][]*float64           `json:"draws"`
		Precision string                 `json:"precision"`
	}
	if err := json.Unmarshal(out, &part); err != nil || part.Precision != "float64" || len(part.Draws) != len(part.Params) || len(part.Draws[0]) != 10 {
		t.Fatalf("part: %v %s", err, string(out)[:200])
	}
	if part.Params[0].Key != "path:A:B" {
		t.Fatalf("params %+v", part.Params)
	}
}
