package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFileLockExcludesASecondHolder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.lock")
	first, err := tryLockFile(path)
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	// (a second open of the file: refused even in the same process)
	if _, err := tryLockFile(path); !errors.Is(err, errLocked) {
		t.Fatalf("second lock: got %v, want errLocked", err)
	}
	first.unlock()
	again, err := tryLockFile(path)
	if err != nil {
		t.Fatalf("lock after unlock: %v", err)
	}
	again.unlock()
}

func TestLockFileWaitWaitsForTheHolder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.lock")
	held, err := tryLockFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockFileWait(path, 50*time.Millisecond); !errors.Is(err, errLocked) {
		t.Fatalf("while held: got %v, want errLocked after the timeout", err)
	}
	go func() {
		time.Sleep(100 * time.Millisecond)
		held.unlock()
	}()
	l, err := lockFileWait(path, 5*time.Second)
	if err != nil {
		t.Fatalf("after release: %v", err)
	}
	l.unlock()
}

// TestLockHolderProcess is not a test of its own: the cross-process test below
// runs the test binary with PLS_TEST_HOLD_LOCK set, and this holds that lock
// until the process is killed.
func TestLockHolderProcess(t *testing.T) {
	path := os.Getenv("PLS_TEST_HOLD_LOCK")
	if path == "" {
		t.Skip("helper process for TestFileLockAcrossProcesses")
	}
	if _, err := tryLockFile(path); err != nil {
		fmt.Println("lock failed:", err)
		os.Exit(1)
	}
	fmt.Println("locked")
	time.Sleep(time.Minute)
	os.Exit(0)
}

func TestFileLockAcrossProcesses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.lock")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLockHolderProcess$")
	cmd.Env = append(os.Environ(), "PLS_TEST_HOLD_LOCK="+path)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	line, _ := bufio.NewReader(out).ReadString('\n')
	if strings.TrimSpace(line) != "locked" {
		_ = cmd.Process.Kill()
		t.Fatalf("holder process: %q", line)
	}
	if _, err := tryLockFile(path); !errors.Is(err, errLocked) {
		t.Fatalf("while another process holds it: got %v, want errLocked", err)
	}
	// A holder that dies (crash, kill) leaves no stale lock: the system releases it.
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	l, err := lockFileWait(path, 5*time.Second)
	if err != nil {
		t.Fatalf("after the holder died: %v", err)
	}
	l.unlock()
}

func TestInstallPackagesRefusesWhileAnotherInstallRuns(t *testing.T) {
	held, err := lockInConfigDir(libraryLockName)
	if err != nil {
		t.Fatal(err)
	}
	defer held.unlock()
	cfg := &config{Path: filepath.Join(t.TempDir(), "config.json")}
	err = installPackages(cfg, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "already being installed") {
		t.Fatalf("got %v, want the already-being-installed error", err)
	}
}

func TestPerformUpdateRefusesWhileAnotherProcessUpdates(t *testing.T) {
	held, err := lockInConfigDir(updateLockName)
	if err != nil {
		t.Fatal(err)
	}
	defer held.unlock()
	_, _, err = performUpdate(context.Background())
	if err == nil || !strings.Contains(err.Error(), "another helper process") {
		t.Fatalf("got %v, want the update-already-running error", err)
	}
}

// Separate config values stand for separate processes (each has its own
// mutex): only config.lock keeps their read-modify-writes from losing changes.
func TestConfigUpdatesFromSeveralProcessesAreAllKept(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if _, err := loadConfigFrom(path); err != nil {
		t.Fatal(err)
	}
	const n = 16
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cfg, err := loadConfigFrom(path)
			if err != nil {
				errs <- err
				return
			}
			origin := fmt.Sprintf("https://pls%d.example.org", i)
			errs <- cfg.update(func(f *configFile) { addAllowedOrigin(f, origin) })
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	f, _, err := readConfigFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		origin := fmt.Sprintf("https://pls%d.example.org", i)
		found := false
		for _, o := range f.AllowedOrigins {
			found = found || o == origin
		}
		if !found {
			t.Errorf("%s was lost (origins: %v)", origin, f.AllowedOrigins)
		}
	}
}

func TestFirstConfigIsCreatedOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	const n = 8
	tokens := make([]string, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cfg, err := loadConfigFrom(path)
			if err != nil {
				t.Error(err)
				return
			}
			tokens[i] = cfg.BearerToken
		}(i)
	}
	wg.Wait()
	for i := 1; i < n; i++ {
		if tokens[i] != tokens[0] {
			t.Fatalf("processes starting at once got different tokens: %v", tokens)
		}
	}
}
