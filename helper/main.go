// Package main is pls-studio-helper: runs PLS Studio's calculations in the
// R installed on the user's own machine (desktop R, all cores) instead of
// the browser's R. One process per user, listening only on 127.0.0.1; the
// browser pairs with it once (6-digit code), then sends bridge calls with a
// bearer token. Data never leave the machine.
//
// Subcommands:
//
//	pls-studio-helper                 run the helper (default)
//	pls-studio-helper pair            open a 60 s pairing window, print the code
//	pls-studio-helper rotate          rotate the bearer token (un-pairs browsers)
//	pls-studio-helper setup           install the R packages PLS Studio uses
//	pls-studio-helper allow-origin U  trust a PLS Studio deployment at U
//	pls-studio-helper deny-origin U   remove it again
//	pls-studio-helper info            config path, port, trusted origins, R
//	pls-studio-helper version         build information
package main

import (
	"context"
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"
)

//go:embed r/packages.txt
var packagesTxt string

// requiredPackages are the R packages PLS Studio's bridge uses (the union
// of R_PACKAGES in src/rengine/bridge.ts; a test keeps them in sync).
func requiredPackages() []string {
	var out []string
	for _, p := range strings.Fields(packagesTxt) {
		if packagePattern.MatchString(p) {
			out = append(out, p)
		}
	}
	return out
}

func main() {
	logger := log.New(os.Stderr, "", log.LstdFlags)
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "pair":
			runPair(logger)
			return
		case "rotate":
			runRotate(logger)
			return
		case "setup":
			runSetup(logger)
			return
		case "info":
			runInfo(logger)
			return
		case "allow-origin":
			runAllowOrigin(logger, os.Args[2:])
			return
		case "deny-origin":
			runDenyOrigin(logger, os.Args[2:])
			return
		case "help", "-h", "--help":
			printHelp()
			return
		case "version":
			fmt.Printf("pls-studio-helper %s\nbuild sha:  %s\nbuild time: %s\nR bridge:   %s\n", helperVersion, helperBuildSHA, orUnknown(helperBuildTime), bridgeHash()[:12])
			return
		}
	}

	portFlag := flag.Int("port", 0, "override the configured port")
	noTrayFlag := flag.Bool("no-tray", false, "run headless even on platforms that default to the tray UI")
	allowFirstFlag := flag.Bool("allow-first-connection", false, "without a tray: approve the first browser that connects (instead of a pairing code)")
	if err := flag.CommandLine.Parse(os.Args[1:]); err != nil {
		logger.Fatalf("flag parse: %v", err)
	}
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	if *portFlag > 0 && *portFlag <= 65535 {
		cfg.Port = *portFlag
	}
	if err := saveConfig(cfg); err != nil {
		logger.Fatalf("save config: %v", err)
	}
	pool, err := newRPool(cfg, logger)
	if err != nil {
		logger.Fatalf("R workers: %v", err)
	}
	defer pool.close()
	if rv, n, perr := pool.status(); perr != nil {
		logger.Printf("R is not available: %v (the helper runs; PLS Studio will use the browser's R)", perr)
	} else {
		logger.Printf("%s, %d R workers", rv, n)
	}
	srv := newServer(cfg, logger, pool)
	tray := !*noTrayFlag && trayDefault()
	if tray {
		srv.connect.ask = askConnect // native Allow / Deny dialog
	}
	srv.connect.allowFirst = *allowFirstFlag

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = srv.HTTP.Shutdown(shutdownCtx)
		quitTray() // (the tray owns the main thread on macOS / Windows)
	}()

	// Listen on the loopback interface only, never 0.0.0.0. Plain HTTP:
	// http://127.0.0.1 is a potentially trustworthy origin, so an HTTPS page
	// may call it (no mixed-content block); token, origin and Host checks apply.
	ln, err := net.Listen("tcp", srv.HTTP.Addr)
	if err != nil {
		logger.Fatalf("listen: %v", err)
	}
	logger.Printf("pls-studio-helper %s listening on http://%s (config: %s)", helperVersion, srv.HTTP.Addr, cfg.Path)
	logger.Printf("allowed origins: %v", cfg.AllowedOrigins)
	logger.Printf("first-time pairing? click the menu-bar icon or run: pls-studio-helper pair")
	if warnIfRoamingProfile(filepath.Dir(cfg.Path)) {
		logger.Printf("WARNING: config dir %s appears to be on a network share (roaming profile); the bearer token travels over SMB.", filepath.Dir(cfg.Path))
	}
	serve := func() {
		if err := srv.HTTP.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("serve: %v", err)
		}
	}
	if tray {
		runWithTray(cfg, srv, serve, logger, cancel)
	} else {
		serve()
	}
	logger.Print("shutdown complete")
}

// trayDefault: the tray UI is the default on macOS and Windows; Linux runs headless.
func trayDefault() bool { return runtime.GOOS == "darwin" || runtime.GOOS == "windows" }

func orUnknown(s string) string {
	if s == "" {
		return "unknown"
	}
	return s
}

func printHelp() {
	fmt.Print(`pls-studio-helper — run PLS Studio's calculations in desktop R.

Usage:
  pls-studio-helper                       run the helper (foreground)
  pls-studio-helper pair                  print a one-time 6-digit pairing code
  pls-studio-helper setup                 install the R packages PLS Studio uses
                                          (into ~/.pls-studio-helper/library)
  pls-studio-helper rotate                rotate the bearer token
  pls-studio-helper allow-origin <url>    trust a PLS Studio deployment
  pls-studio-helper deny-origin <url>     remove an origin from the trust list
  pls-studio-helper info                  config path, port, trusted origins
  pls-studio-helper version               print version
  pls-studio-helper help                  this message

Config file: ~/.pls-studio-helper/config.json (created on first run).

Connect PLS Studio:
  In PLS Studio: Inspector → Calculated by → Desktop R (helper) → Connect,
  then click Allow in the helper's dialog (macOS / Windows).
  Without a tray (Linux): start with --allow-first-connection, or run
  pls-studio-helper pair and enter the 6-digit code in PLS Studio.
`)
}

var (
	helperVersion   = "0.1.0-dev"
	helperBuildSHA  = "dev"
	helperBuildTime = ""
)

func init() {
	if helperBuildSHA != "dev" && helperBuildTime != "" {
		return
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return
	}
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			if helperBuildSHA == "dev" && len(s.Value) >= 7 {
				helperBuildSHA = s.Value[:7]
			}
		case "vcs.time":
			if helperBuildTime == "" {
				helperBuildTime = s.Value
			}
		}
	}
}

func runPair(logger *log.Logger) {
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	code := startPairingWindow(cfg)
	fmt.Printf(`
Pairing code: %s
Valid for 60 seconds; the helper must already be running. Enter the code in
PLS Studio: Inspector → Calculated by → Desktop R (helper) → Pair.
`, code)
}

func runRotate(logger *log.Logger) {
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	cfg.BearerToken = generateToken()
	if err := saveConfig(cfg); err != nil {
		logger.Fatalf("save config: %v", err)
	}
	fmt.Println("bearer token rotated; previously paired browsers must pair again.")
}

// runSetup installs the R packages (command line).
func runSetup(logger *log.Logger) {
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	fmt.Printf("Installing %d R packages (and their dependencies) from CRAN …\n", len(requiredPackages()))
	if err := installPackages(cfg, os.Stdout); err != nil {
		logger.Fatalf("setup failed: %v", err)
	}
	fmt.Println("Done. Restart the helper to use the library.")
}

// installPackages installs the R packages into the helper's own library
// (so the user's library is left alone) and records it in the config.
// Package names come from the embedded list and the library path is passed
// as an argument, never pasted into R code.
func installPackages(cfg *config, out io.Writer) error {
	rscript, err := findRscript(cfg.Rscript)
	if err != nil {
		return err
	}
	dir, err := configDir()
	if err != nil {
		return err
	}
	lib := filepath.Join(dir, "library")
	if err := os.MkdirAll(lib, 0o700); err != nil {
		return err
	}
	code := `a <- commandArgs(trailingOnly = TRUE); lib <- a[1]; pk <- a[-1]; .libPaths(c(lib, .libPaths()))
need <- pk[!vapply(pk, requireNamespace, TRUE, quietly = TRUE)]
if (length(need)) install.packages(need, lib = lib, repos = "https://cloud.r-project.org") else cat("All packages are installed.\n")
miss <- pk[!vapply(pk, requireNamespace, TRUE, quietly = TRUE)]
if (length(miss)) { cat("Could not install:", miss, "\n"); quit(status = 1) }`
	cmd := exec.Command(rscript, append([]string{"--vanilla", "-e", code, lib}, requiredPackages()...)...)
	cmd.Stdout, cmd.Stderr = out, out
	if err := cmd.Run(); err != nil {
		return err
	}
	cfg.RLibrary = lib
	return saveConfig(cfg)
}

func runInfo(logger *log.Logger) {
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	fmt.Printf("config:           %s\n", cfg.Path)
	fmt.Printf("port:             %d\n", cfg.Port)
	fmt.Printf("bearer token set: %v\n", cfg.BearerToken != "")
	rs, err := findRscript(cfg.Rscript)
	if err != nil {
		rs = err.Error()
	}
	fmt.Printf("Rscript:          %s\n", rs)
	if cfg.RLibrary != "" {
		fmt.Printf("R library:        %s\n", cfg.RLibrary)
	}
	fmt.Printf("R workers:        %d\n", cfg.workers())
	fmt.Println("trusted origins:")
	for _, o := range cfg.AllowedOrigins {
		fmt.Printf("  - %s\n", o)
	}
}

func runAllowOrigin(logger *log.Logger, args []string) {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "Usage: pls-studio-helper allow-origin <url>")
		os.Exit(2)
	}
	origin, err := normalizeOrigin(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid origin: %v\n", err)
		os.Exit(2)
	}
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	if !addAllowedOrigin(cfg, origin) {
		fmt.Printf("%s is already trusted.\n", origin)
		return
	}
	if err := saveConfig(cfg); err != nil {
		logger.Fatalf("save config: %v", err)
	}
	fmt.Printf("Trusted: %s (restart the helper for the change to take effect)\n", origin)
}

func runDenyOrigin(logger *log.Logger, args []string) {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "Usage: pls-studio-helper deny-origin <url>")
		os.Exit(2)
	}
	origin, err := normalizeOrigin(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid origin: %v\n", err)
		os.Exit(2)
	}
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	if !removeAllowedOrigin(cfg, origin) {
		fmt.Printf("%s is not in the trust list.\n", origin)
		return
	}
	if err := saveConfig(cfg); err != nil {
		logger.Fatalf("save config: %v", err)
	}
	fmt.Printf("Removed: %s (restart the helper for the change to take effect)\n", origin)
}
