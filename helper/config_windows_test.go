//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
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

// While another process has the config open without read sharing (as during
// a rename over it), opening it fails with a sharing violation; readFile
// waits until it is closed.
func TestReadFileWaitsForAnExclusiveHandleToClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("content"), 0o600); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	exclusive, err := windows.CreateFile(name, windows.GENERIC_READ, 0, nil,
		windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadFile(path); err == nil {
		t.Fatal("a plain read succeeded although the file is held exclusively")
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		windows.CloseHandle(exclusive)
	}()
	got, err := readFile(path)
	if err != nil || string(got) != "content" {
		t.Fatalf("got %q, %v; want the content", got, err)
	}
}
