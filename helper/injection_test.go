// The full injection check of the R bridge (scripts/security/replay-injection.R)
// on the committed corpus of bridge calls: every string and number of every
// request replaced by payloads, the generated R code parsed and searched for
// them. Slow (minutes, all cores), so it runs only with PS_INJECTION=1
// (`make security`); it needs R with the packages PLS Studio uses.

package main

import (
	"os"
	"os/exec"
	"testing"
)

func TestBridge_NoRCodeInjection(t *testing.T) {
	if os.Getenv("PS_INJECTION") != "1" {
		t.Skip("set PS_INJECTION=1 (make security) to run the full injection check")
	}
	if _, err := exec.LookPath("Rscript"); err != nil {
		t.Skip("Rscript not available")
	}
	cmd := exec.Command("Rscript", "scripts/security/replay-injection.R", "scripts/security/corpus.jsonl", "3")
	cmd.Dir = ".."
	out, err := cmd.CombinedOutput()
	t.Logf("%s", tail(string(out), 4000))
	if err != nil {
		t.Fatalf("injection check failed: %v", err)
	}
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
