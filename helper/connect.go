// One-click connection: instead of typing a pairing code, the browser asks
// to connect (POST /connect) and the helper asks the person at the computer
// in a native dialog ("Allow <origin> to use desktop R?"). Allow hands the
// browser a fresh bearer token, as pairing with a code does.
//
// Why this is safe without a code: only someone at this computer can click
// Allow, the dialog names the requesting origin (already on the allowlist),
// only one request waits at a time, and after a Deny further requests are
// refused for a while (no dialog spam). Without a tray (Linux, --no-tray)
// there is no dialog: /connect is refused unless the helper was started with
// --allow-first-connection, which approves exactly one connection.

package main

import (
	"errors"
	"sync"
	"time"
)

// approver asks whether `origin` may connect; nil when no dialog is possible.
type approver func(origin string) (bool, error)

const denyCooldown = 15 * time.Second

type connectGate struct {
	mu         sync.Mutex
	ask        approver
	waiting    bool
	deniedAt   time.Time
	allowFirst bool // --allow-first-connection: approve one connection without asking
}

var (
	errNoApprover = errors.New("this helper cannot show an approval dialog (no tray): pair with a code (pls-studio-helper pair), or start it with --allow-first-connection")
	errWaiting    = errors.New("another connection is waiting for approval in the helper")
	errDenied     = errors.New("the connection was not allowed in the helper")
)

// request decides whether origin may connect: by the one-time flag, or by
// asking. Blocks while the dialog is open.
func (g *connectGate) request(origin string) error {
	g.mu.Lock()
	if g.allowFirst {
		g.allowFirst = false
		g.mu.Unlock()
		return nil
	}
	if g.ask == nil {
		g.mu.Unlock()
		return errNoApprover
	}
	if g.waiting {
		g.mu.Unlock()
		return errWaiting
	}
	if !g.deniedAt.IsZero() && time.Since(g.deniedAt) < denyCooldown {
		g.mu.Unlock()
		return errDenied
	}
	g.waiting = true
	ask := g.ask
	g.mu.Unlock()

	ok, err := ask(origin)

	g.mu.Lock()
	defer g.mu.Unlock()
	g.waiting = false
	if err != nil || !ok {
		g.deniedAt = time.Now()
		return errDenied
	}
	g.deniedAt = time.Time{}
	return nil
}
