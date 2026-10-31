# PLS Studio: how it is built

For developers working on the code. The user guide is `public/guide.html`; validation and
conventions are in `README.md`; the server and the desktop helper have their own READMEs.

## 1. The shape of the system

```
┌──────────────────────────── browser ────────────────────────────────┐
│  React UI (src/components)   zustand stores (src/store.ts,          │
│  Model · Data · Analyses     src/analyses/store.ts)                 │
│            │                          │                              │
│      runner.ts  ──────────────── analyses/store.runCard             │
│            │                          │                              │
│   ┌────────┴─────────┐     ┌──────────┴──────────┐                  │
│   │ built-in engine  │     │ R bridge (rengine)  │                  │
│   │ src/engine (TS)  │     │ rCall(fn, req, pkg) │                  │
│   │ Web Workers      │     └───┬─────────────┬───┘                  │
│   └──────────────────┘         │             │                      │
│                      webR (WASM R)     HTTP 127.0.0.1:9878          │
│                      in Web Workers    (desktop helper, optional)    │
└────────────────────────────────────────┼─────────────────────────────┘
                                         │
     ┌──────────────────────┐   ┌────────┴─────────────────────┐
     │ collaboration server │   │ pls-studio-helper (Go)       │
     │ server/ (Express,    │   │ pool of native R processes;  │
     │ Postgres, Y.js WS)   │   │ runs the same R bridge code  │
     └──────────────────────┘   └──────────────────────────────┘
```

Three facts organise everything:

1. **Calculations run on the user's machine**, never on the server. The server only stores
   projects, syncs edits between collaborators and handles accounts. A project with no
   collaboration never contacts a server at all (the app also runs from a static host).
2. **The estimators are the reference R packages themselves** (lavaan, cSEM, seminr, MIIVsem,
   semTools, modsem, manymome, mice, psych, ltm, lme4, …), compiled to WebAssembly by the webR
   project and served from the app's own origin. The app writes a small R *script* per
   calculation, runs exactly that script, and reads a JSON result back. The script is what the
   user downloads under "R script", so what runs and what is exported are the same text.
3. **One working model.** The Model tab holds the project's model; every other view reads it.
   The Analyses tab holds a log of cards (analyses, headings, notes, and model runs) saved with
   the project.

## 2. Repository map

| Path | What lives there |
|---|---|
| `src/store.ts` | The project store: model, settings, data, results, undo history, workspace, cloud state, messages. `resultsKey()` fingerprints model + estimation settings + data so results are known to be current or stale. |
| `src/model/project.ts` | Model and settings types, defaults, `toSpec()` (canvas model → engine specification), strict parsers for untrusted input (`parseProject`, `parseModelState`, `parseSettings`), validation. |
| `src/components/` | React UI. `Canvas.tsx` (React Flow diagram), `Inspector.tsx` (settings), `ResultsPanel.tsx` + `results/` (tables per method), `analyses/` (the log), `cloud/` (accounts, sharing), `TopBar.tsx`. |
| `src/runner.ts` | Calculate / Bootstrap / Fit test: validates the model, picks the engine, dispatches, stores results, logs the run. |
| `src/engine/` | The built-in TypeScript engines: PLS/PLSc (`pls.ts`), CB-SEM ML-family (`cbsem.ts`), MIIV-2SLS, bootstrap, simulation. Run inside Web Workers (`src/worker.ts`). Validated against the R packages. |
| `src/rengine/` | The R side: `runtime.ts` (webR sessions), `bridge.ts` (`rCall`, package lists, R sources), `helper.ts` (desktop helper client), one TS module per R bridge file (`pls.ts`, `lavaan.ts`, `analyses.ts`, …) that builds requests and parses results, and `R/` (the bridge code in R). |
| `src/analyses/` | The Analyses log: `types.ts` (card and analysis-type contracts), `registry.ts` (all analysis types), `store.ts` (cards, running, results), `persist.ts` (validated load/save), `codec.ts` (gzip + base64 packing of results), `runs.tsx` / `runHash.ts` / `runCard.tsx` (model runs and versions), `report.ts`, one file per analysis. |
| `src/process/` | Conditional process analysis (PROCESS models): recognising the diagram, building the regression plan. |
| `src/cloud/` | Collaboration client: `api.ts` (fetch with CSRF), `auth.ts` (accounts), `collab.ts` (Y.js document ⇄ store), `invites.ts` (emailed links). |
| `src/examples/` | Home-screen examples (`packages.ts`: 58 package examples with their sources and documented settings; built-in examples). |
| `src/figure/`, `src/replication/` | Diagram rendering for export (SVG/PDF/LaTeX); replication package (zip of data, scripts, project, README). |
| `public/webr/` | The self-hosted R runtime and package repository (not in git; `scripts/webr/fetch.mjs` builds it from `scripts/webr/webr-lock.json`, with every package's source tarball for GPL compliance). |
| `server/` | Express + Postgres: accounts (argon2id, TOTP, Google OIDC, email verification, reset), projects, invitations, encrypted datasets, Y.js WebSocket rooms, audit log, migrations. |
| `helper/` | `pls-studio-helper`: a Go program with a menu-bar/tray icon that runs a pool of native R processes and serves the same bridge over loopback HTTP. `helper/rsrc` is a verbatim copy of `src/rengine/R` (checked by its tests; `make -C helper sync-r`). |
| `deploy/` | Provisioning, update and backup scripts for a single VPS behind Caddy. |
| `scripts/validation/` | Native-R scripts that produce the reference fixtures in `src/engine/__fixtures__`. |

## 3. State and data flow in the browser

**Stores.** `useStore` (src/store.ts) is the project: `model` (constructs, paths, moderations,
correlations, model-level fields), `settings` (method, estimator, engine, PLS options, missing
values, bootstrap options, figure and chart styles), `data` (column-oriented `Float64Array`s,
`NaN` = missing; or a covariance matrix with N and optional NACOV), `results` with its `key`,
`past`/`future` for undo, `workspace` (data / model / analyses), `messages`, `cloud`.
`useAnalyses` (src/analyses/store.ts) holds the cards of the log, which card is selected, unpacked
results per card, running state, errors.

**Edits.** Every model change goes through `commit(fn)`, which prunes dangling correlations and
fixed loadings, pushes the previous model onto the undo stack, and marks the project dirty. In a
shared project the Y.js `UndoManager` replaces the local stack (see §7).

**Freshness.** `resultsKey(state)` is a JSON fingerprint of the engine specification
(`toSpec(model)`), the settings that change estimates, and a data version counter. Results
carry the key they were computed for; `useFreshResults()` returns them only while the key
matches, so a stale diagram shows no estimates and the canvas offers Recalculate. The same idea,
made stable across sessions (a hash of spec + estimation settings + a fingerprint of the data
values), identifies a *model run* in the log (§6).

**Calculate.** `runner.run(kind)` (`estimate` | `boot` | `fittest`): validates the model
(`validateModel`), refuses without data, computes the key, then either posts a request to a Web
Worker (built-in engine) or calls the R bridge (R engine). On completion it `setResults` and
calls `logCurrentRun()` so the Analyses log records the version. On the Analyses tab, Calculate
acts on the selected card instead (`src/analyses/calculate.ts`).

## 4. The built-in engine

`src/engine` reimplements PLS (Mode A/B, path/centroid/factor schemes, PLSc, HTMT, fit
discrepancies, IPMA), CB-SEM by ML/GLS/ULS/MLM/MLMV/MLR, MIIV-2SLS and the bootstrap, in
TypeScript with its own linear algebra. It exists so the app works before R has loaded, on
devices that cannot run webR, and as a second implementation to check the bridge against. It runs
in Web Workers (`src/worker.ts`); the bootstrap splits its samples into ranges across one worker
per core (`workerCount()`), and the parts are merged (`engine/bootstrap.ts`). Its numbers are
tested against the packages' fixtures to 1e-5 (README, "Validation").

## 5. The R engine: how the front end talks to R

### 5.1 Loading R

`src/rengine/runtime.ts` starts webR lazily, in a Web Worker, with the SharedArrayBuffer
channel (so R can be interrupted; this needs a cross-origin isolated page, which the server's
COOP/COEP headers provide). `baseUrl` and `repoUrl` point at the app's own `/webr/` directory:
runtime files and a pinned CRAN-like repository. Packages are installed into the WASM file
system on first use per session (`withSession` tracks `installed`); the bridge's R source files
are `source()`d once per session (`sourced`). Session 0 serves all ordinary calculations; sessions
1… are started only for parallel work (bootstrap and permutation chunks) and each is another
webR instance in its own Worker. `parallelMap()` schedules items over sessions.

### 5.2 Requests and results

Every call is `rCall(fn, req, pkg)` in `src/rengine/bridge.ts`:

- `fn` is a bridge function in R, always named `ps_*` (`ps_pls`, `ps_cb`, `ps_boot`, `ps_endo`,
  …), defined in `src/rengine/R/*.R`; those files are imported as raw strings and sent to R as
  `SOURCES`.
- `req` is a plain JSON object: the data (`names`, `cols`), the model specification from
  `toSpec()`, and options. The TS module for the analysis (`src/rengine/pls.ts`,
  `lavaan.ts`, …) builds it; nothing user-typed goes in as R code.
- `pkg` names the package set to install first (`R_PACKAGES`).

In R, `ps_call(fn, req)` (src/rengine/R/common.R) is the single entry point: it checks that `fn`
is a `ps_*` function taking `req_json`, parses and validates the request (`ps_validate`: every
enumerated option against its allowed values, every number finite), and calls the function with
a warning handler. The function:

1. **Builds a script** as a character vector: data preparation, the model in the package's
   syntax (lavaan model syntax, cSEM/seminr syntax), the package call, and the post-processing
   it needs. Names are made safe first: `ps_ident()` turns construct and indicator names into
   identifiers (`"Service quality"` → `Service_quality`) and keeps a map back to the user's
   names; strings inside the script go through `ps_sq()`; user expressions that must reach the
   package as code (`:=` definitions, inequality constraints, Wald constraints) go through
   `ps_expr()`, a parser that admits arithmetic over parameter labels and nothing else (the
   client has the same grammar in `src/model/expr.ts`).
2. **Runs that script** with `ps_run(lines, inputs)` in a fresh environment holding the inputs
   (`data`, `S`, `N`, `NACOV`, …), collecting warnings.
3. **Reads the results** back from the fitted object into a list with the user's names restored,
   and returns `ps_json(list)`.

`ps_call(fn, req, export = TRUE)` returns the script text instead of running it: with the data
embedded (`ps_script()` adds a header naming the package versions and `install.packages(...)`,
the data as CSV text, the calculation, and a report section). That is the "R script" button, the
replication package's scripts, and a guarantee: the exported script is the calculation.

Results arrive as JSON with two side channels: `warnings` (the packages' warnings and anything
optional that could not be computed; the app flags them after a calculation) and `notes`
(explanations of a result or a package's advice; listed as information, shown under the table
they concern). `rengine/notices.ts` routes both into Messages.

Optional statistics are wrapped in `ps_try(expr, "what")`: a failure becomes a warning that
names what was lost, and the rest of the result stands.

### 5.3 Parallel work

The R bootstrap and permutation tests run as chunks of samples (`rCallParallel`), each a full
call on its own R session, merged on the TS side (`engine/bootstrap.ts` merges draws; cSEM's own
resampling is used within a chunk). Progress is reported per chunk. The number of sessions comes
from `parallelism()`: all cores but one in the browser (capped), or the desktop helper's pool.

### 5.4 Interrupting

`interruptR()` interrupts every webR session (possible because of the SharedArrayBuffer
channel) and cancels helper calls; the runner discards results whose token no longer matches.

### 5.5 The desktop helper

`pls-studio-helper` (helper/) is optional. It binds `127.0.0.1:9878`, keeps a pool of native R
processes (all cores but one by default, `r_workers` in its config), and serves:
`/health`, `/pair`, `/connect`, `/version`, `/packages`, `/call`, `/batch`, `/cancel/:id`.
`/call` takes the same `{fn, req}` and runs the same `ps_call` in native R, with the bridge
sources it embeds (`helper/rsrc`). The client (`src/rengine/helper.ts`) probes it, compares the
SHA-256 of the bridge sources it has with the helper's (`/version` → `bridge`), and uses it only
when they match ("built for another version" otherwise). When the person has chosen Desktop R
under "Calculated by", every `rCall` goes to the helper first (`viaHelper`) and falls back to
webR if it is not available. Security: an Origin allow list (dev origins by default; a
deployment is added with `pls-studio-helper allow-origin <url>`), a Host check against DNS
rebinding, a bearer token issued once per browser after the person clicks Allow in the helper's
dialog (or types a pairing code), per-origin rate limits, and its own injection test that replays
the recorded request corpus (`scripts/security/corpus.jsonl`) through the R bridge.

### 5.6 What keeps R code injection out

The bridge composes R code from identifiers it sanitised and literals it quoted; the only
user-written text evaluated as code is what `ps_expr` accepts. lavaan itself evaluates arbitrary
R inside `:=` definitions and `lavTestWald` constraints, so that parser is load-bearing. The
recorded corpus (`PS_RECORD_REQUESTS=… npm run test:webr` records every request the tests make;
`scripts/security/replay-injection.R` replays them with payloads) checks that no field reaches
`eval`. Requests from collaborators and project files pass the same validation as everything
else.

## 6. The Analyses log

A card is `{ id, kind: 'analysis', type, options, run?, title? }` or a heading / note. An
*analysis type* (`src/analyses/types.ts`) declares its options, defaults, a strict
`parseOptions` for options from files and collaborators, `blocked()` (why it cannot run now),
`fingerprint()` (the inputs a run used, so a card goes stale when its data or scores change),
`run()` (usually an `rCall`), an `Options` form and a `View`. `registry.ts` lists the 31 types.
Results are stored packed (`codec.ts`, gzip + base64, size-capped) in `card.run.packed` and
saved with the project; shared projects sync the cards without results (each computer runs
them itself). `report.ts` builds a self-contained HTML report from the rendered cards; the
replication package writes one R script per card.

**Model runs** are frozen cards added by Calculate (`runs.tsx`): the model, settings, data
identity, diagram and results of one version. `runHash()` identifies a version; calculating the
same version again updates its card, a change starts a new one with a plain-language diff
(`describeChanges`). Opening a run puts that model back on the Model tab through the undo stack;
the canvas badge (`ModelVersionBadge`) says which version is on the canvas.

## 7. Collaboration

A shared project lives in a Y.js document: maps `constructs`, `paths`, `moderations`,
`correlations`, `model` (the other model fields), `meta` (name, settings), and the cards.
`src/cloud/collab.ts` writes store changes into the document and applies remote changes to the
store (`readDoc` validates through the same parsers as a project file); `Y.UndoManager`
(own changes only) replaces the local undo stack while connected. The server (`server/src/ws.ts`)
keeps one room per project: handshake checks Origin, session and membership; viewers' document
updates are dropped; awareness (presence) is capped; the document is persisted as a compacted
state plus updates, with a cap on its stored size and on sockets per user. Datasets are not in
the document: they are uploaded encrypted (gzip + AES-256-GCM under a per-project key wrapped by
a master key, project id as associated data) and downloaded by members. Results never leave a
computer.

Accounts: express-session in Postgres, CSRF token + Origin check on every state change, argon2id
passwords with lockout, TOTP, Google OIDC with PKCE, email verification and password reset by
single-use hashed tokens carried in the URL fragment. `server/README.md` has the full list.

## 8. Examples and validation

`src/examples/packages.ts` describes each example: its data (loaded from the package in R, or
shipped), model, analysis card, and the settings its source documents (`CSEM()`/`SEMINR()`
helpers hold the packages' defaults). Opening an example resets the estimation settings to those
(`exampleSettings`). Tests run every example in webR and require it to raise no warning.

Correctness rests on three layers (README, "Validation"): the estimators are the packages
themselves; fixtures from native R check the bridge and the built-in engine at 1e-5; printed
results from the literature check the whole chain. `npm test` (unit, ~930), `npm run test:webr`
(R in webR, ~370), `npm run test:server` (Postgres, 53), `go test ./...` in helper/; CI runs all
four.

## 9. Build and deploy

Vite builds the app (`npm run build`; `prebuild` fetches the pinned R runtime if missing). The
server serves `dist/` and `public/webr/` with the headers webR needs (COOP/COEP) and a strict CSP
(no inline scripts; the worker script alone gets `wasm-unsafe-eval` and `unsafe-eval`, which
webR's loader needs). `deploy/pls-provision.sh` sets up a VPS (Node, Postgres, Caddy, a systemd
unit with `ProtectSystem=strict`); `pls-update.sh` pulls, builds, migrates and restarts.
The helper is released by tagging `helper-vX.Y.Z` (GitHub Actions builds macOS, Windows and Linux
binaries); every change to `src/rengine/R` needs a new helper release, because the helper refuses
to serve a bridge version other than its own.
