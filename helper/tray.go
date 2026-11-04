//go:build darwin || windows

// Tray (menu-bar / system-tray) UI on macOS and Windows: status (R and
// pairing), a pairing-code generator, About and Quit. Linux runs headless
// (tray_stub.go). The HTTP server runs in a goroutine; systray owns the
// main thread until Quit.

package main

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"
)

type trayState struct {
	mu         sync.Mutex
	cfg        *config
	server     *server
	logger     *log.Logger
	cancel     context.CancelFunc
	pairCodeMI *systray.MenuItem
	pairExpiry time.Time
}

var tray = &trayState{}

func runWithTray(cfg *config, srv *server, serve func(), logger *log.Logger, cancel context.CancelFunc) {
	tray.cfg, tray.server, tray.logger, tray.cancel = cfg, srv, logger, cancel
	go serve()
	systray.Run(onTrayReady, onTrayExit)
}

func onTrayReady() {
	systray.SetTitle("PLS")
	systray.SetTooltip("PLS Studio Helper — calculations in desktop R")
	if icon := trayIconBytes(); len(icon) > 0 {
		systray.SetIcon(icon)
	}
	rMI := systray.AddMenuItem("R: starting…", "")
	rMI.Disable()
	statusMI := systray.AddMenuItem("", "")
	statusMI.Disable()
	systray.AddSeparator()
	pairMI := systray.AddMenuItem("Generate pairing code…", "A 6-digit code for PLS Studio, valid for 60 s")
	setupMI := systray.AddMenuItem("Install R packages…", "Install the R packages PLS Studio uses (from CRAN, into the helper's own library)")
	updateMI := systray.AddMenuItem("Check for updates…", "Install the latest PLS Studio Helper (verified) and restart")
	aboutMI := systray.AddMenuItem("About PLS Studio Helper", "Version and build")
	systray.AddSeparator()
	quitMI := systray.AddMenuItem("Quit", "Stop the helper and its R processes")

	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			rv, n, err := tray.server.pool.status()
			if err != nil {
				rMI.SetTitle("R: not available")
				rMI.SetTooltip(err.Error())
			} else {
				rMI.SetTitle(fmt.Sprintf("%s · %d workers", strings.TrimPrefix(rv, "R version "), n))
			}
			if tray.cfg.BearerToken != "" {
				statusMI.SetTitle("● Ready for pairing / paired")
			}
			<-t.C
		}
	}()
	for {
		select {
		case <-pairMI.ClickedCh:
			go handleGeneratePair()
		case <-setupMI.ClickedCh:
			go handleSetup(setupMI)
		case <-updateMI.ClickedCh:
			go handleUpdateMenu(updateMI)
		case <-aboutMI.ClickedCh:
			go showDialog(fmt.Sprintf("PLS Studio Helper\n\nVersion: %s\nBuild: %s\nBuilt: %s\nR bridge: %s", helperVersion, helperBuildSHA, orUnknown(helperBuildTime), bridgeHash()[:12]), "About PLS Studio Helper")
		case <-quitMI.ClickedCh:
			systray.Quit()
			return
		}
	}
}

func quitTray() { systray.Quit() }

func onTrayExit() {
	if tray.cancel != nil {
		tray.cancel() // main's shutdown path closes the server and the R workers
	}
}

// handleUpdateMenu: is a newer release available? If so, ask, install it
// (verified, update.go) and restart into it.
func handleUpdateMenu(mi *systray.MenuItem) {
	mi.Disable()
	defer mi.Enable()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	info, _, err := checkUpdate(ctx)
	if err != nil {
		showDialog("Could not check for updates: "+err.Error(), "PLS Studio Helper")
		return
	}
	if !info.Available {
		showDialog(fmt.Sprintf("PLS Studio Helper %s: %s.", info.Current, info.Reason), "PLS Studio Helper")
		return
	}
	ok, err := askYesNo(fmt.Sprintf("PLS Studio Helper %s is available (this is %s).\n\nInstall it now? The helper restarts; calculations running now are stopped.", info.Latest, info.Current), "Not now", "Update")
	if err != nil || !ok {
		return
	}
	mi.SetTitle("Updating…")
	info, path, err := performUpdate(ctx)
	mi.SetTitle("Check for updates…")
	if err != nil {
		showDialog("The update failed: "+err.Error(), "PLS Studio Helper")
		return
	}
	if !info.Available {
		return
	}
	tray.logger.Printf("updated from %s to %s; restarting", info.Current, info.Latest)
	if tray.server.restart != nil {
		tray.server.restart(path)
	}
}

// askYesNo asks a question with two buttons; true for the second (yes).
func askYesNo(body, no, yes string) (bool, error) {
	switch runtime.GOOS {
	case "darwin":
		esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
		out, err := exec.Command("osascript", "-e", fmt.Sprintf(`display dialog "%s" with title "PLS Studio Helper" buttons {"%s", "%s"} default button "%s" cancel button "%s" with icon note`, esc.Replace(body), no, yes, yes, no)).Output()
		if err != nil {
			return false, nil // the cancel button exits with an error
		}
		return strings.Contains(string(out), "button returned:"+yes), nil
	case "windows":
		esc := strings.NewReplacer("'", "''", "\n", "`n")
		out, err := exec.Command("powershell", "-NoProfile", "-Command", fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('%s', 'PLS Studio Helper', 'YesNo', 'Question', 'Button1')`, esc.Replace(body))).Output()
		if err != nil {
			return false, err
		}
		return strings.TrimSpace(string(out)) == "Yes", nil
	}
	return false, errNoApprover
}

// handleSetup installs the R packages in the background and reports the result.
func handleSetup(mi *systray.MenuItem) {
	mi.Disable()
	mi.SetTitle("Installing R packages… (minutes)")
	defer func() { mi.SetTitle("Install R packages…"); mi.Enable() }()
	var output strings.Builder
	if err := installPackages(tray.cfg, &output); err != nil {
		msg := output.String()
		if len(msg) > 600 {
			msg = "…" + msg[len(msg)-600:]
		}
		showDialog(fmt.Sprintf("Installing the R packages failed: %v\n\n%s", err, msg), "PLS Studio Helper")
		return
	}
	showDialog("The R packages are installed. Quit the helper and open it again to use them.", "PLS Studio Helper")
}

// handleGeneratePair opens a 60-second pairing window and shows the code in
// a dialog, on the clipboard and in the menu.
func handleGeneratePair() {
	code := startPairingWindow(tray.cfg)
	tray.mu.Lock()
	if tray.pairCodeMI != nil {
		tray.pairCodeMI.Hide()
	}
	tray.pairCodeMI = systray.AddMenuItem(fmt.Sprintf("Code: %s  (expires in 60 s)", code), "")
	tray.pairCodeMI.Disable()
	tray.pairExpiry = time.Now().Add(60 * time.Second)
	tray.mu.Unlock()
	copyToClipboard(code)
	showDialog(fmt.Sprintf("Pairing code:\n\n        %s\n\nValid for 60 seconds. Already copied to the clipboard.", code), "PLS Studio Helper")
	go func() {
		<-time.After(60 * time.Second)
		tray.mu.Lock()
		if tray.pairCodeMI != nil && !time.Now().Before(tray.pairExpiry) {
			tray.pairCodeMI.SetTitle("Code expired — generate a new one")
		}
		tray.mu.Unlock()
	}()
}

// showDialog shows a native message. The text is built by this program
// (version strings, digits), never from requests; quotes are escaped anyway.
func showDialog(body, title string) {
	var err error
	switch runtime.GOOS {
	case "darwin":
		esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
		err = exec.Command("osascript", "-e", fmt.Sprintf(`display dialog "%s" with title "%s" buttons {"OK"} default button "OK" with icon note`, esc.Replace(body), esc.Replace(title))).Run()
	case "windows":
		esc := strings.NewReplacer("'", "''", "\n", "`n")
		err = exec.Command("powershell", "-NoProfile", "-Command", fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('%s', '%s') | Out-Null`, esc.Replace(body), esc.Replace(title))).Run()
	}
	if err != nil && tray.logger != nil {
		tray.logger.Printf("dialog: %v", err)
	}
}

// askConnect asks the person at this computer whether a PLS Studio page may
// use desktop R. The origin is on the allowlist (checked before); it is shown
// so the person can tell an unexpected request. No answer in 2 minutes = Deny.
func askConnect(origin string) (bool, error) {
	body := fmt.Sprintf("PLS Studio at %s wants to run calculations in desktop R on this computer.\n\nAllow only if you just clicked Connect in PLS Studio.", origin)
	switch runtime.GOOS {
	case "darwin":
		esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
		out, err := exec.Command("osascript", "-e", fmt.Sprintf(`display dialog "%s" with title "PLS Studio Helper" buttons {"Deny", "Allow"} default button "Deny" cancel button "Deny" with icon caution giving up after 120`, esc.Replace(body))).Output()
		if err != nil {
			return false, nil // Deny (cancel button) exits with an error
		}
		return strings.Contains(string(out), "button returned:Allow") && !strings.Contains(string(out), "gave up:true"), nil
	case "windows":
		esc := strings.NewReplacer("'", "''", "\n", "`n")
		out, err := exec.Command("powershell", "-NoProfile", "-Command", fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('%s', 'PLS Studio Helper', 'YesNo', 'Warning', 'Button2')`, esc.Replace(body))).Output()
		if err != nil {
			return false, err
		}
		return strings.TrimSpace(string(out)) == "Yes", nil
	}
	return false, errNoApprover
}

func copyToClipboard(text string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("pbcopy")
	case "windows":
		cmd = exec.Command("clip")
	default:
		return
	}
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err != nil && tray.logger != nil {
		tray.logger.Printf("copy to clipboard: %v", err)
	}
}
