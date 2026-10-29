# PLS Studio Helper

`pls-studio-helper` is a small companion program that runs PLS Studio's
calculations in the **R installed on your own computer** ("desktop R")
instead of the R that runs inside the browser (webR). Desktop R is several
times faster and uses all your processor cores. Your data travel only
between your browser and the helper, both on your computer.

The helper is optional. Without it PLS Studio calculates in the browser,
and it falls back to the browser whenever the helper is not available.

## 1 · Install

You need [R](https://cran.r-project.org) (4.1 or later); on macOS, version 13 (Ventura) or later.

Build the helper (requires [Go](https://go.dev) 1.27):

```bash
cd helper
make build          # → ./pls-studio-helper
make app-mac-arm64  # optional on macOS: dist/PLS Studio Helper.app (menu-bar app)
```

Install the R packages PLS Studio uses into the helper's own library
(`~/.pls-studio-helper/library`, so your own R library is left alone):

```bash
./pls-studio-helper setup
```

## 2 · Start and pair

```bash
./pls-studio-helper            # macOS / Windows: a "PLS" icon appears in the menu bar / tray
```

Then connect this browser once:

1. In PLS Studio: **Inspector → Calculated by → R runs in → Desktop R (helper)**.
2. Click **Connect**. The helper asks in a dialog whether this PLS Studio
   page may use desktop R: click **Allow**.

The status line then shows the R version and the number of R processes.
**Disconnect** forgets the connection in this browser;
`pls-studio-helper rotate` disconnects every browser.

Without a tray (Linux, or `--no-tray`) there is no dialog. Either start the
helper with `--allow-first-connection` (it approves the first browser that
connects, once), or use a pairing code: run `./pls-studio-helper pair` and
enter the 6-digit code under **Use a pairing code** (valid for 60 seconds and
five attempts). The code also works on macOS and Windows (menu-bar icon →
Generate pairing code).

A PLS Studio deployment on its own address must be trusted first:

```bash
./pls-studio-helper allow-origin https://pls.example.edu
```

## 3 · What runs where

- Every calculation (estimation, bootstrap, the R script export, …) goes to
  desktop R when the helper is chosen and ready. With **Parallel bootstrap**
  on, bootstrap chunks run on several R processes at once.
- If a package is missing in desktop R, or the helper stops, that
  calculation runs in the browser instead (PLS Studio says so).
- Desktop R uses the package versions you installed; the browser uses pinned
  versions. Results can differ slightly between versions; the package and
  version used are shown with the results (and in the exported script).

## 4 · Security

- The helper listens on **127.0.0.1 only** (never the network), port 9878.
- Every request must come from a trusted PLS Studio origin (`Origin`
  allowlist, `Host` pinned against DNS rebinding) and, except for the
  liveness probe and pairing, carry the bearer token (256 bits, rotated at
  every pairing, stored with mode 0600 in `~/.pls-studio-helper/config.json`).
- Connecting needs the person at this computer: either Allow in the
  helper's dialog (which names the requesting page; one request at a time,
  and after Deny new requests are refused for 15 s), or a 6-digit code that
  only the helper shows (60 s, closed after five wrong attempts). Each
  connection rotates the token, so an earlier browser is disconnected.
- The helper runs **only PLS Studio's own R functions** (`ps_*`), from its
  own embedded copy of PLS Studio's R code; a request names the function and
  carries its data and options as JSON — never R code. The browser uses the
  helper only when the helper's copy of the R code is identical to its own.
- Names and options from a project become part of the R code these
  functions write, so a shared project file must not be able to inject R
  code. `scripts/security/replay-injection.R` checks this: it replays the
  bridge calls of the test suite with every value replaced by injection
  payloads and verifies that none of them can become code.
- Residual risk: anyone who can read your browser's storage (e.g. a
  malicious extension) can use the token, but only to run PLS Studio's
  analyses on this computer.

## 5 · Configuration

`~/.pls-studio-helper/config.json` (created on first run):

| Field | Meaning |
| --- | --- |
| `port` | 9878 |
| `allowed_origins` | PLS Studio origins that may call the helper |
| `rscript` | Absolute path of `Rscript` (default: found on PATH and in the usual install locations) |
| `r_library` | Package library searched first (set by `setup`) |
| `r_workers` | R processes (default: cores − 1); also the cores one cSEM bootstrap uses |

Linux has no tray: run it as a systemd user service, e.g.
`~/.config/systemd/user/pls-studio-helper.service` with
`ExecStart=/path/to/pls-studio-helper --no-tray`.
