// R pool tests. The bridge checks run everywhere; the worker tests need
// Rscript (with jsonlite) and are skipped without it.

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The embedded bridge must be byte-identical to the app's (src/rengine/R):
// run `make sync-r` after changing the R code.
func TestBridge_InSyncWithApp(t *testing.T) {
	app, _ := filepath.Glob("../src/rengine/R/*.R")
	if len(app) == 0 {
		t.Skip("app sources not found")
	}
	var names []string
	for _, f := range app {
		names = append(names, filepath.Base(f))
	}
	sort.Strings(names)
	if fmt.Sprint(names) != fmt.Sprint(bridgeFiles()) {
		t.Fatalf("bridge files differ: app %v, helper %v", names, bridgeFiles())
	}
	h := sha256.New()
	for _, n := range names {
		data, err := os.ReadFile(filepath.Join("../src/rengine/R", n))
		if err != nil {
			t.Fatal(err)
		}
		embedded, _ := bridgeFS.ReadFile("rsrc/" + n)
		if string(embedded) != string(data) {
			t.Errorf("%s differs from the app's copy: run make sync-r", n)
		}
		fmt.Fprintf(h, "%s\n%s\n", strings.TrimSuffix(n, ".R"), data)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != bridgeHash() {
		t.Errorf("bridgeHash = %s, want %s", bridgeHash(), got)
	}
}

// The packages `setup` installs are those the app's bridge uses.
func TestRequiredPackages_MatchApp(t *testing.T) {
	src, err := os.ReadFile("../src/rengine/bridge.ts")
	if err != nil {
		t.Skip("app sources not found")
	}
	s := string(src)
	block := s[strings.Index(s, "export const R_PACKAGES"):strings.Index(s, "} as const;")]
	set := map[string]bool{}
	for _, m := range regexp.MustCompile(`'([A-Za-z][A-Za-z0-9.]*)'`).FindAllStringSubmatch(block, -1) {
		set[m[1]] = true
	}
	var want []string
	for k := range set {
		want = append(want, k)
	}
	sort.Strings(want)
	got := requiredPackages()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("r/packages.txt = %v, want %v", got, want)
	}
}

func TestCallRequest_Validate(t *testing.T) {
	ok := callRequest{ID: "a-1", Fn: "ps_pls", Req: `{"x":1}`, Packages: []string{"cSEM", "data.table"}}
	if err := ok.validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	bad := []callRequest{
		{ID: "a b", Fn: "ps_pls", Req: "{}"},
		{ID: "", Fn: "ps_pls", Req: "{}"},
		{ID: "a", Fn: "system", Req: "{}"},
		{ID: "a", Fn: "ps_pls(1); system", Req: "{}"},
		{ID: "a", Fn: "PS_pls", Req: "{}"},
		{ID: "a", Fn: "ps_pls", Req: "not json"},
		{ID: "a", Fn: "ps_pls", Req: "{}", Packages: []string{"cSEM; system('x')"}},
		{ID: "a", Fn: "ps_pls", Req: "{}", Packages: make([]string, 40)},
	}
	for i, b := range bad {
		if b.validate() == nil {
			t.Errorf("case %d accepted: %+v", i, b)
		}
	}
}

func testPool(t *testing.T, workers int) *rPool {
	t.Helper()
	if _, err := exec.LookPath("Rscript"); err != nil {
		t.Skip("Rscript not available")
	}
	if exec.Command("Rscript", "-e", "stopifnot(requireNamespace('jsonlite', quietly = TRUE))").Run() != nil {
		t.Skip("jsonlite not installed")
	}
	p, err := newRPool(&config{RWorkers: workers}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.status(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	return p
}

// A necessary condition analysis needs base R only (no packages).
func ncaRequest(perm int) string { return ncaRequestN(60, perm) }

func ncaRequestN(n, perm int) string {
	x, y := make([]float64, n), make([]float64, n)
	for i := range x {
		x[i] = float64(i % 10)
		y[i] = float64((i*7)%10) * x[i] / 9
	}
	b, _ := json.Marshal(map[string]any{"data": map[string]any{"names": []string{"x", "y"}, "cols": [][]float64{x, y}}, "x": []string{"x"}, "y": "y", "permutations": perm, "missing": "casewise"})
	return string(b)
}

func TestRPool_RunsBridgeFunctionsAndReportsErrors(t *testing.T) {
	p := testPool(t, 2)
	ctx := context.Background()
	rep, err := p.call(ctx, &callRequest{ID: "nca", Fn: "ps_nca", Req: ncaRequest(0)})
	if err != nil || !rep.OK {
		t.Fatalf("ps_nca: %v %+v", err, rep)
	}
	var out struct {
		Y          string `json:"y"`
		Conditions []struct {
			CeFdh float64 `json:"ceFdh"`
		} `json:"conditions"`
	}
	if err := json.Unmarshal([]byte(rep.Result), &out); err != nil || out.Y != "y" || len(out.Conditions) != 1 {
		t.Fatalf("unexpected result %s (%v)", rep.Result[:min(200, len(rep.Result))], err)
	}
	// Exported scripts come back as text.
	exp, err := p.call(ctx, &callRequest{ID: "nca-x", Fn: "ps_nca", Req: ncaRequest(0), Export: true})
	if err != nil || !exp.OK || !strings.Contains(exp.Result, "nca_peers <- function") {
		t.Fatalf("export: %v %+v", err, exp)
	}
	// An R error (invalid request) is reported, and the worker stays usable.
	bad, err := p.call(ctx, &callRequest{ID: "bad", Fn: "ps_nca", Req: `{"x":["y"],"y":"y"}`})
	if err != nil || bad.OK || bad.Kind != "r_error" || bad.Message == "" {
		t.Fatalf("R error: %v %+v", err, bad)
	}
	// Only the bridge's entry points can be called: not unknown names, and not
	// internal helpers (ps_run evaluates its argument as R code).
	for _, fn := range []string{"ps_nope", "ps_helper_callable_not", "ps_run", "ps_json", "ps_script", "ps_expr", "ps_validate"} {
		r, err := p.call(ctx, &callRequest{ID: "u", Fn: fn, Req: "{}"})
		if err != nil || r.OK || r.Kind != "bad_request" {
			t.Fatalf("%s: %v %+v", fn, err, r)
		}
	}
	// Missing packages are named, not loaded.
	miss, err := p.call(ctx, &callRequest{ID: "m", Fn: "ps_nca", Req: ncaRequest(0), Packages: []string{"jsonlite", "notAPackage123"}})
	if err != nil || miss.Kind != "missing_packages" || len(miss.Packages) != 1 || miss.Packages[0] != "notAPackage123" {
		t.Fatalf("missing package: %v %+v", err, miss)
	}
	// Package versions.
	v, err := p.call(ctx, &callRequest{ID: "v", Fn: "ps_helper_packages", Req: "{}", Packages: []string{"jsonlite", "notAPackage123"}})
	if err != nil || v.Versions["jsonlite"] == nil || v.Versions["notAPackage123"] != nil {
		t.Fatalf("versions: %v %+v", err, v)
	}
}

func TestRPool_CancelKillsAndReplacesWorker(t *testing.T) {
	p := testPool(t, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := p.call(ctx, &callRequest{ID: "long", Fn: "ps_nca", Req: ncaRequestN(5000, 20000)})
		done <- err
	}()
	time.Sleep(1500 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != errCancelled {
			t.Fatalf("expected errCancelled, got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("cancel did not stop the calculation")
	}
	// The replacement worker answers.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel2()
	rep, err := p.call(ctx2, &callRequest{ID: "after", Fn: "ps_nca", Req: ncaRequest(0)})
	if err != nil || !rep.OK {
		t.Fatalf("after cancel: %v %+v", err, rep)
	}
}

func TestRPool_ParallelCallsUseAllWorkers(t *testing.T) {
	p := testPool(t, 3)
	ctx := context.Background()
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		go func(i int) {
			rep, err := p.call(ctx, &callRequest{ID: fmt.Sprintf("p%d", i), Fn: "ps_nca", Req: ncaRequest(200)})
			if err != nil || !rep.OK {
				errs <- fmt.Errorf("call %d: %v %+v", i, err, rep)
				return
			}
			errs <- nil
		}(i)
	}
	for i := 0; i < 6; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
}

// setup uses CRAN's binaries for the installed R (no compiling), reinstalls
// packages built for another R before loading anything, and names the
// packages that still fail, with R's reason.
func TestSetupRCode(t *testing.T) {
	for _, want := range []string{`install.packages.compile.from.source = "never"`, `lib = lib`, `Could not load `, `quit(status = 1)`,
		// packages built for another R are reinstalled before anything is loaded (loading them can crash R)
		`installed.packages(lib.loc = lib, fields = "Built"`, `built for another version of R`, `remove.packages(left, lib = lib)`} {
		if !strings.Contains(setupRCode, want) {
			t.Errorf("setup R code lacks %q", want)
		}
	}
	if _, err := exec.LookPath("Rscript"); err != nil {
		t.Skip("Rscript not available")
	}
	// The code parses as R.
	if out, err := exec.Command("Rscript", "--vanilla", "-e", "invisible(parse(text = commandArgs(TRUE)[1]))", setupRCode).CombinedOutput(); err != nil {
		t.Fatalf("setup code does not parse: %v %s", err, out)
	}
}

// A cSEM bootstrap through the helper on several cores of one R process
// (cSEM's multicore plan) gives exactly the single-core results.
func TestRPool_CSEMMulticoreBootstrapIsIdentical(t *testing.T) {
	p := testPool(t, 1)
	if exec.Command("Rscript", "-e", "stopifnot(requireNamespace('cSEM', quietly = TRUE))").Run() != nil {
		t.Skip("cSEM not installed")
	}
	req := multicoreRequest
	ctx := context.Background()
	one, err := p.call(ctx, &callRequest{ID: "c1", Fn: "ps_pls_boot", Req: req(1)})
	if err != nil || !one.OK {
		t.Fatalf("1 core: %v %+v", err, one)
	}
	four, err := p.call(ctx, &callRequest{ID: "c4", Fn: "ps_pls_boot", Req: req(4)})
	if err != nil || !four.OK {
		t.Fatalf("4 cores: %v %+v", err, four)
	}
	if one.Result != four.Result {
		t.Fatalf("results differ:\n1: %.300s\n4: %.300s", one.Result, four.Result)
	}
	script, err := p.call(ctx, &callRequest{ID: "c4x", Fn: "ps_pls_boot", Req: req(4), Export: true})
	if err != nil || !strings.Contains(script.Result, "cores <- 4") {
		t.Fatalf("script: %v", err)
	}
}

// Cancelling a multicore cSEM bootstrap kills the forked R processes too, and
// the pool keeps serving (a replacement worker starts).
func TestRPool_CancelKillsForkedChildren(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process groups: unix")
	}
	p := testPool(t, 1)
	if exec.Command("Rscript", "-e", "stopifnot(requireNamespace('cSEM', quietly = TRUE))").Run() != nil {
		t.Skip("cSEM not installed")
	}
	var w *rWorker
	select {
	case w = <-p.free:
		p.free <- w
	default:
		t.Fatal("no free worker")
	}
	pgid := w.cmd.Process.Pid
	req := strings.Replace(multicoreRequest(4), `"samples":300`, `"samples":200000`, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := p.call(ctx, &callRequest{ID: "big", Fn: "ps_pls_boot", Req: req}); done <- err }()
	// Wait until the bootstrap has forked its workers.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) && countGroup(pgid) < 3 {
		time.Sleep(200 * time.Millisecond)
	}
	if n := countGroup(pgid); n < 3 {
		t.Fatalf("expected forked R processes, found %d in the group", n)
	}
	cancel()
	if err := <-done; err != errCancelled {
		t.Fatalf("cancel: %v", err)
	}
	time.Sleep(time.Second)
	if n := countGroup(pgid); n != 0 {
		t.Fatalf("%d R processes left after cancelling", n)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel2()
	if rep, err := p.call(ctx2, &callRequest{ID: "after", Fn: "ps_nca", Req: ncaRequest(0)}); err != nil || !rep.OK {
		t.Fatalf("after cancel: %v %+v", err, rep)
	}
	if _, live, err := p.status(); live != 1 || err != nil {
		t.Fatalf("status after replacement: %d %v", live, err)
	}
}

// countGroup counts the processes of a process group (ps; unix).
func countGroup(pgid int) int {
	out, _ := exec.Command("ps", "-A", "-o", "pgid=").Output()
	n := 0
	for _, f := range strings.Fields(string(out)) {
		if f == strconv.Itoa(pgid) {
			n++
		}
	}
	return n
}

// multicoreRequest: a two-construct cSEM bootstrap (300 samples) on `cores` cores.
func multicoreRequest(cores int) string {
	items := func(pre string) []string { return []string{pre + "1", pre + "2", pre + "3"} }
	cols := map[string][]float64{}
	names := []string{}
	for _, pre := range []string{"x", "y"} {
		for _, n := range items(pre) {
			names = append(names, n)
			v := make([]float64, 120)
			for i := range v {
				f := float64((i*7919+len(n)*31)%97) / 97
				if pre == "y" {
					f = 0.6*float64((i*7919+31)%97)/97 + 0.4*float64((i*104729+len(n)*17)%89)/89
				}
				v[i] = f
			}
			cols[n] = v
		}
	}
	data := [][]float64{}
	for _, n := range names {
		data = append(data, cols[n])
	}
	b, _ := json.Marshal(map[string]any{"kind": "pls", "package": "cSEM", "missing": "casewise",
		"options": map[string]any{"scheme": "path", "consistent": false, "tolerance": 1e-7, "maxIter": 300, "approach": "PLS-PM"},
		"data":    map[string]any{"names": names, "cols": data},
		"model": map[string]any{"constructs": []map[string]any{{"name": "X", "type": "factor", "mode": "A", "indicators": items("x")}, {"name": "Y", "type": "factor", "mode": "A", "indicators": items("y")}},
			"paths": []map[string]any{{"from": "X", "to": "Y"}}, "moderations": []any{}},
		"boot": map[string]any{"samples": 300, "seed": 5, "confidence": 0.95}, "cores": cores})
	return string(b)
}
