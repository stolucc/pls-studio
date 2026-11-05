// /example-data/statmodel/<chapN>/<file> — the Mplus User's Guide example files from statmodel.com, for the
// browser app: statmodel.com sends no CORS header, so the page cannot fetch them itself, and PLS Studio does not
// distribute them (no licence is stated). The helper downloads the one file named, each time, and stores nothing.
//
// Against request forgery: the upstream base is a constant (a variable only so tests can point it at a local
// server); the path must match the same allowlist as the server's (exN.M….inp|.dat in its own chapter); nothing
// of the request but that path is used; redirects are not followed; the answer must be 200 and is capped in size
// and time; a rate limit and a cap on concurrent downloads apply. Bearer token required (withAuth).

package main

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// statmodelPath is the allowlist: chapN/exN.M[a-z0-9]*.(dat|inp), N the same in both places.
var statmodelPath = regexp.MustCompile(`^chap(\d{1,2})/ex(\d{1,2})\.\d{1,2}[a-z0-9]*\.(dat|inp)$`)

var (
	// (variables, so tests can point them at a local server)
	statmodelBase = "https://www.statmodel.com/usersguide/"
	exampleHTTP   = &http.Client{
		Timeout: 30 * time.Second,
		// A redirect is an answer, not something to follow.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
)

// The largest file passed through (the guide's largest is 2.6 MB).
const maxExampleBytes = 10 << 20
const examplePrefix = "/example-data/statmodel/"

// exampleSlots caps the downloads in progress.
var exampleSlots = make(chan struct{}, 4)

// statmodelFile: the allowed path for a request path, or "".
func statmodelFile(urlPath string) string {
	p := strings.TrimPrefix(urlPath, examplePrefix)
	m := statmodelPath.FindStringSubmatch(p)
	if m == nil || m[1] != m[2] {
		return ""
	}
	return p
}

var errTooLarge = errors.New("the file is larger than allowed")

func (s *server) handleExampleData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	// r.URL.Path is decoded: an encoded slash or dot is checked like a plain one. RawQuery is never used.
	file := statmodelFile(r.URL.Path)
	if file == "" || (r.URL.RawPath != "" && r.URL.RawPath != r.URL.Path) {
		http.Error(w, "not one of the Mplus User's Guide example files", http.StatusNotFound)
		return
	}
	if wait, ok := s.exampleLimiter.allow(); !ok {
		secs := int((wait + time.Second - 1) / time.Second)
		if secs < 1 {
			secs = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	select {
	case exampleSlots <- struct{}{}:
		defer func() { <-exampleSlots }()
	default:
		w.Header().Set("Retry-After", "5")
		http.Error(w, "busy", http.StatusServiceUnavailable)
		return
	}
	data, status, err := fetchStatmodel(r, file)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=iso-8859-1")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// fetchStatmodel downloads one allowed file; on failure, the status to answer with.
func fetchStatmodel(r *http.Request, file string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, statmodelBase+file, nil)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("User-Agent", "pls-studio-helper/"+helperVersion+" (example data, no storage)")
	resp, err := exampleHTTP.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, errors.New("could not reach statmodel.com")
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
	// statmodel.com answers a missing file with 300 Multiple Choices, or a 301 to a similarly named file: a
	// redirect is never followed, whatever its target, and means the file asked for is not there.
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone || (resp.StatusCode >= 300 && resp.StatusCode < 400):
		return nil, http.StatusNotFound, errors.New("statmodel.com does not have this file")
	default:
		return nil, http.StatusBadGateway, errors.New("statmodel.com answered " + strconv.Itoa(resp.StatusCode))
	}
	if resp.ContentLength > maxExampleBytes {
		return nil, http.StatusBadGateway, errTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxExampleBytes+1))
	if err != nil {
		return nil, http.StatusBadGateway, errors.New("the download failed")
	}
	if len(data) > maxExampleBytes {
		return nil, http.StatusBadGateway, errTooLarge
	}
	return data, 0, nil
}
