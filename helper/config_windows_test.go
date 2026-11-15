//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A reader holding the config open (without delete sharing) makes a plain
// rename fail with "Access is denied"; replaceFile waits until it closes.
func TestReplaceFileWaitsForAReaderToClose(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "config.json")
	src := filepath.Join(dir, "new.json")
	if err := os.WriteFile(dst, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	reader, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		reader.Close()
	}()
	if err := replaceFile(src, dst); err != nil {
		t.Fatalf("replaceFile: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != "new" {
		t.Fatalf("got %q, %v; want the new content", got, err)
	}
}
