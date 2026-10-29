// Tests for the /call rate limiter (a token bucket).

package main

import (
	"testing"
	"time"
)

func TestCallLimiter_AdmitsUpToBurst(t *testing.T) {
	l := newCallLimiter(3, 60) // 3-burst, 60/min
	for i := 0; i < 3; i++ {
		if _, ok := l.allow(); !ok {
			t.Fatalf("burst slot %d: expected admit", i)
		}
	}
	// 4th must be rejected — bucket is empty.
	if _, ok := l.allow(); ok {
		t.Fatal("4th request inside burst: expected reject")
	}
}

func TestCallLimiter_RejectsBeforeRefill(t *testing.T) {
	l := newCallLimiter(1, 60) // 1-burst
	if _, ok := l.allow(); !ok {
		t.Fatal("first request should be admitted")
	}
	wait, ok := l.allow()
	if ok {
		t.Fatal("second immediate request should be rejected")
	}
	// Should be ~1s until refill at 60/min.
	if wait <= 0 || wait > 2*time.Second {
		t.Fatalf("expected wait ~1s, got %v", wait)
	}
}

func TestCallLimiter_RefillsOverTime(t *testing.T) {
	l := newCallLimiter(1, 600) // very fast refill: 10/sec
	if _, ok := l.allow(); !ok {
		t.Fatal("first request should be admitted")
	}
	if _, ok := l.allow(); ok {
		t.Fatal("immediate second request should be rejected")
	}
	time.Sleep(150 * time.Millisecond) // ~1.5 tokens worth at 10/s
	if _, ok := l.allow(); !ok {
		t.Fatal("after refill window, request should be admitted")
	}
}
