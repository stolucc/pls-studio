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
`pls-studio-helper rotate` disconnects every browser (a running helper
refuses the old token from its next request on).

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

A running helper re-reads its config file when it changes, so `rotate`,
`allow-origin` and `deny-origin` need no restart.

## Updating

From version 0.1.9 the helper updates itself, when asked: the menu-bar /
tray icon → **Check for updates…**, `pls-studio-helper update` (or
`update --check` to only report), or in PLS Studio the **Update helper**
button shown when the helper is older than the site. It downloads the latest
release from this repository's GitHub releases, installs it only if the
release's `SHA256SUMS` carries a valid Ed25519 signature by the release key
built into the helper (`updatekey.go`) and the binary matches it, replaces
itself (on macOS inside the app, which is re-signed ad hoc) and restarts.
Nothing is updated automatically, and a page cannot choose what is installed.
Then install any new R packages (**Install R packages…** or
`pls-studio-helper setup`). Versions before 0.1.9 are updated by installing
the new release by hand once.

From version 0.1.11 an update also needs the release's signed version
manifest, `RELEASE.json` (+ `RELEASE.json.sig`, same key and format as
`SHA256SUMS.sig`):

```json
{"version":"0.1.11","tag":"helper-v0.1.11","sha256sums":"<SHA-256 of SHA256SUMS>","published":"2026-11-14T12:00:00Z"}
```

The signature over `SHA256SUMS` alone says nothing about the version (the tag
comes from GitHub's unsigned release information), so an old, validly signed
release republished under a new tag would be installed, and nothing newer
afterwards. The helper therefore refuses an update unless `RELEASE.json`
carries a valid signature, names exactly the release's tag, names a version
newer than the running one, and names the `SHA256SUMS` the release serves.
Helpers up to 0.1.10 ignore the manifest and keep checking `SHA256SUMS` as
before; 0.1.11 and later cannot self-update to a release without a manifest
(install such a release by hand).

Releases are signed by the release workflow with the secret
`HELPER_SIGNING_KEY` (`go run ./cmd/sign-release keygen <file>` makes a key
pair; the workflow refuses to publish without the secret).

### Release key

Only the publish job of `.github/workflows/helper-release.yml` uses the key,
and it runs in the GitHub environment `helper-release`; its third-party
actions are pinned by commit SHA. To make a release need your approval and
keep the key away from branches, move the secret into that environment
(once, on GitHub):

1. Repository **Settings → Environments → New environment**, name
   `helper-release` (it may already be listed: the workflow creates it,
   unprotected, on its first run).
2. **Required reviewers**: tick it and add yourself; Save protection rules.
3. **Deployment branches and tags**: choose **Selected branches and tags**,
   **Add deployment branch or tag rule** → Ref type **Tag**, pattern
   `helper-v*`.
4. **Environment secrets → Add environment secret**: name
   `HELPER_SIGNING_KEY`, the same value as the repository secret (the
   base64 private key from `sign-release keygen`).
5. **Settings → Secrets and variables → Actions → Repository secrets**:
   delete `HELPER_SIGNING_KEY` there.

Until then the repository secret keeps working. Afterwards every release
waits for your approval in the run's page (**Review deployments**) before
it is signed and published.

## 3 · What runs where

- Every calculation (estimation, bootstrap, the R script export, …) goes to
  desktop R when the helper is chosen and ready.
- Desktop R uses all cores but one, by itself (the app's Parallel setting is
  for the browser only): cSEM and seminr bootstraps, CCA and multigroup tests
  run on all of them inside one R process (cSEM's own parallel plan: the
  results equal a single-core run); lavaan bootstraps are drawn in chunks of
  100 samples spread over the helper's R processes (the same results on any
  computer, and in the exported script); simulations spread over the
  processes. Many calls travel in one streamed request (/batch), since
  browsers open at most six connections to a host.
- If a package is missing in desktop R, or the helper stops, that
  calculation runs in the browser instead (PLS Studio says so).
- Opening an Mplus User's Guide example downloads its input and data from
  statmodel.com (PLS Studio does not distribute them, and statmodel.com does
  not let a page read them itself): the connected helper fetches them
  (`GET /example-data/statmodel/chapN/exN.M….inp|.dat`), otherwise the PLS
  Studio server does. Only the guide's example files under
  `https://www.statmodel.com/usersguide/` can be asked for; no redirect is
  followed, files are capped at 10 MB and nothing is stored.
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

## GPU bootstrapping

The helper can bootstrap PLS and PLSc models of the **built-in engine** on a
GPU: every bootstrap sample is estimated at once by a batched torch port of
the engine (`gpusrc/plsgpu.py`), on an Apple GPU (Metal, single precision),
an NVIDIA GPU (CUDA, single or double precision) or, without one, the CPU
(double precision). The samples use the same rows as in the browser, so the
draws are the browser engine's up to rounding (exactly, in double precision).

Install torch into the helper's own Python environment, then restart the helper:

```bash
./pls-studio-helper setup-gpu                     # ~/.pls-studio-helper/gpu/venv
./pls-studio-helper setup-gpu --index-url https://download.pytorch.org/whl/cu126   # Linux + CUDA 12
```

Needs Python 3.10 or later on PATH (`--python <path>` to choose one). The
config keys `gpu_python` (another Python with torch) and `gpu_device`
(`cuda`, `mps` or `cpu`; empty = automatic) override the defaults.

In PLS Studio: **Inspector → Calculated by → Built-in**, then **R runs in →
GPU bootstrap → On** and the precision (Auto: the accelerator's own; Double is
not available on Apple GPUs). Models with interaction terms, copulas, sampling
weights or ordinal indicators keep bootstrapping in the browser; the message
says why. The results name the engine, device and precision.

The GPU worker is a separate process started by the helper (`python -I
worker.py`), one request at a time, JSON lines over its standard streams; it
is replaced when it stops. `/gpu/bootstrap` runs through the same Host pin,
origin allow list and bearer token as the R endpoints.
