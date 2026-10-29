// HTTP handlers. Each endpoint runs through `withAuth` (auth.go): Host pin,
// origin allowlist and, except for /health and /pair, the bearer token.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type server struct {
	HTTP   *http.Server
	cfg    *config
	logger *log.Logger
	pair   *pairStore
	jobs   *jobRegistry
	pool   *rPool
	// connect approves one-click connections (connect.go).
	connect *connectGate
	// limiter caps the request rate (a parallel bootstrap sends one call
	// per chunk, so the burst is generous); the R pool caps concurrency.
	limiter *callLimiter
}

const callRateBurst = 200
const callRatePerMin = 1200

// callMaxBodyBytes caps a /call request: the data set travels with it.
const callMaxBodyBytes = 256 << 20

func newServer(cfg *config, logger *log.Logger, pool *rPool) *server {
	s := &server{cfg: cfg, logger: logger, pair: newPairStore(), jobs: newJobRegistry(), pool: pool, connect: &connectGate{},
		limiter: newCallLimiter(callRateBurst, callRatePerMin)}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", withAuth(cfg, false, s.handleHealth))
	mux.HandleFunc("/pair", withAuth(cfg, false, s.handlePair))
	mux.HandleFunc("/connect", withAuth(cfg, false, s.handleConnect))
	mux.HandleFunc("/version", withAuth(cfg, true, s.handleVersion))
	mux.HandleFunc("/packages", withAuth(cfg, true, s.handlePackages))
	mux.HandleFunc("/call", withAuth(cfg, true, s.handleCall))
	mux.HandleFunc("/cancel/", withAuth(cfg, true, s.handleCancel))
	// Bind to 127.0.0.1 ONLY (see main.go: the listener is created there).
	s.HTTP = &http.Server{
		Addr:              net.JoinHostPort("127.0.0.1", strconv.Itoa(cfg.Port)),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Minute, // large data sets
		WriteTimeout:      0,               // calculations can run for hours (simulations)
		IdleTimeout:       60 * time.Second,
	}
	go func() { // pairing-window poller (the `pair` subcommand writes a lock file)
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for range t.C {
			s.pair.loadFromFile()
		}
	}()
	return s
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// /health — unauthenticated liveness probe; deliberately says nothing else.
func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"ok":true}`)
}

// /pair — unauthenticated POST {"code":"NNNNNN"}: with the code of an open
// pairing window, rotates the bearer token and returns it (so a previously
// paired browser stops working).
func (s *server) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256)
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		http.Error(w, `code required (POST body {"code":"NNNNNN"})`, http.StatusBadRequest)
		return
	}
	if !s.pair.consume(body.Code) {
		http.Error(w, "no pairing window open, or wrong code", http.StatusForbidden)
		return
	}
	s.cfg.BearerToken = generateToken()
	if err := saveConfig(s.cfg); err != nil {
		s.logger.Printf("save config after pair: %v", err)
		http.Error(w, "failed to persist new token", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"token": s.cfg.BearerToken})
}

// /connect — unauthenticated POST from a trusted origin: asks the person at
// this computer (native dialog) and, when allowed, rotates the bearer token
// and returns it. Blocks while the dialog is open.
func (s *server) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	switch err := s.connect.request(r.Header.Get("Origin")); {
	case errors.Is(err, errNoApprover):
		http.Error(w, err.Error(), http.StatusConflict)
		return
	case errors.Is(err, errWaiting):
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	case err != nil:
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	s.cfg.BearerToken = generateToken()
	if err := saveConfig(s.cfg); err != nil {
		s.logger.Printf("save config after connect: %v", err)
		http.Error(w, "failed to persist new token", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"token": s.cfg.BearerToken})
}

// /version — the helper's build, R, worker count and the hash of its R
// bridge (the browser uses the helper only when it matches its own).
func (s *server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rv, workers, err := s.pool.status()
	resp := map[string]any{
		"helper_version": helperVersion, "helper_build_sha": helperBuildSHA,
		"bridge": bridgeHash(), "r": rv, "workers": workers,
	}
	if err != nil {
		resp["r_error"] = err.Error()
	}
	writeJSON(w, resp)
}

// /packages — POST {"packages":[...]}: installed versions (null if missing).
func (s *server) handlePackages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var body struct {
		Packages []string `json:"packages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request body", http.StatusBadRequest)
		return
	}
	req := &callRequest{ID: "packages-" + strconv.FormatInt(time.Now().UnixNano(), 36), Fn: "ps_helper_packages", Req: "{}", Packages: body.Packages}
	if len(req.Packages) > 64 {
		http.Error(w, "too many packages", http.StatusBadRequest)
		return
	}
	for _, p := range req.Packages {
		if !packagePattern.MatchString(p) {
			http.Error(w, "invalid package name", http.StatusBadRequest)
			return
		}
	}
	rep, err := s.pool.call(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{"versions": rep.Versions})
}

// /call — POST callRequest: runs one bridge function in R and returns its
// reply. Blocks until R answers; POST /cancel/<id> stops it.
func (s *server) handleCall(w http.ResponseWriter, r *http.Request) {
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
	var req callRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "bad request body", http.StatusBadRequest)
		return
	}
	// ps_helper_packages is internal (/packages).
	if err := req.validate(); err != nil || strings.HasPrefix(req.Fn, "ps_helper") {
		msg := "invalid request"
		if err != nil {
			msg = err.Error()
		}
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if !s.jobs.register(req.ID, cancel) {
		http.Error(w, "duplicate id", http.StatusConflict)
		return
	}
	defer s.jobs.deregister(req.ID)
	rep, err := s.pool.call(ctx, &req)
	switch {
	case errors.Is(err, errCancelled):
		writeJSON(w, callReply{ID: req.ID, OK: false, Kind: "cancelled", Message: "Cancelled."})
	case errors.Is(err, errBusy):
		w.Header().Set("Retry-After", "5")
		http.Error(w, err.Error(), http.StatusTooManyRequests)
	case err != nil:
		writeJSON(w, callReply{ID: req.ID, OK: false, Kind: "helper_error", Message: err.Error()})
	default:
		writeJSON(w, rep)
	}
}

// /cancel/<id> — stops a running (or waiting) calculation.
func (s *server) handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/cancel/")
	if !idPattern.MatchString(id) || !s.jobs.cancel(id) {
		http.Error(w, "no such calculation", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// jobRegistry — call id → cancel func.
type jobRegistry struct {
	mu   sync.Mutex
	jobs map[string]context.CancelFunc
}

func newJobRegistry() *jobRegistry { return &jobRegistry{jobs: map[string]context.CancelFunc{}} }

func (j *jobRegistry) register(id string, c context.CancelFunc) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if _, dup := j.jobs[id]; dup {
		return false
	}
	j.jobs[id] = c
	return true
}

func (j *jobRegistry) deregister(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.jobs, id)
}

func (j *jobRegistry) cancel(id string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	c, ok := j.jobs[id]
	if ok {
		c()
		delete(j.jobs, id)
	}
	return ok
}

// callLimiter: a token bucket capping the request rate.
type callLimiter struct {
	mu         sync.Mutex
	tokens     float64
	burst      float64
	ratePerMin float64
	refilledAt time.Time
}

func newCallLimiter(burst, ratePerMin int) *callLimiter {
	return &callLimiter{tokens: float64(burst), burst: float64(burst), ratePerMin: float64(ratePerMin), refilledAt: time.Now()}
}

// allow takes a token if one is available; otherwise it says how long to wait.
func (c *callLimiter) allow() (time.Duration, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	c.tokens += now.Sub(c.refilledAt).Seconds() * c.ratePerMin / 60.0
	if c.tokens > c.burst {
		c.tokens = c.burst
	}
	c.refilledAt = now
	if c.tokens >= 1 {
		c.tokens--
		return 0, true
	}
	return time.Duration((1.0 - c.tokens) * 60.0 / c.ratePerMin * float64(time.Second)), false
}
