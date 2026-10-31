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

## 1b. A walk through a session (what happens, in order)

Reading this first makes the rest concrete. Nothing here needs a server except the two
collaboration steps marked as such.

1. **The page loads.** The browser fetches `index.html` and one JavaScript bundle (Vite, React).
   That is the whole app: the diagram editor, the tables, the built-in engine, and the code that
   knows how to talk to R. No R has been downloaded yet; the home screen appears in well under a
   second. (The bundle also carries the R *bridge* files, `src/rengine/R/*.R`, as plain text: they
   are sent to R later.)
2. **The person opens an example or imports a file.** A CSV/SPSS/Stata/Excel file is parsed in
   the browser into columns of numbers (`src/engine/dataset.ts`, or R for SPSS/Stata/Excel).
   A package example's data come from the package itself: that is the first moment R is needed.
3. **R starts, in the browser.** webR (§5.0) is downloaded from the app's own site: an 18 MB
   WebAssembly binary plus a small loader, started inside a Web Worker (a background thread), so
   the page stays responsive. This takes a few seconds once; the browser caches it.
4. **Packages load on demand.** The first PLS calculation installs `cSEM` (or `seminr`) and
   what they depend on, downloaded as compiled `.tgz` bundles from the app's own package
   repository (`/webr/repo`, 286 packages pinned by version). A CB-SEM calculation installs
   `lavaan`; an analysis card installs its package. Each package is fetched once per session.
5. **Calculate.** The app writes a short R script for the drawn model (§5.2), hands it to R with
   the data, R runs the package, and the app reads the numbers back as JSON. Results appear on
   the diagram and in the results panel, and a *model run* card is added to the Analyses log.
6. **Bootstrap.** The samples are split into chunks; extra R sessions (more Workers) are started
   so chunks run in parallel; the draws are merged.
7. **Analyses.** Each card on the Analyses tab is one more script: another package, the same
   data (or the construct scores), results stored with the card.
8. **Save.** A project file (`.plsproj.json`) holds the model, settings, data and the log with its
   packed results. Autosave keeps recent projects in the browser's storage. "R script" and the
   replication package export the exact scripts that ran.
9. **Share** (server). Signing in and inviting someone puts the project in a Y.js document that
   the server relays between browsers; the dataset is uploaded encrypted; calculations still run
   on each person's own machine.
10. **Desktop R** (optional, local). With the helper installed, the same scripts run in the R
   installed on the computer, several times faster, on all cores; the browser falls back to
   webR whenever the helper is not there.

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
| `src/examples/` | Home-screen examples (`packages.ts`: 59 package examples with their sources and documented settings; built-in examples). |
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

```ts
// src/worker.ts — the messages between the page and an engine worker
export type WorkerRequest =
  | { kind: 'pls'; data: Dataset; spec: ModelSpec; options: PlsOptions }
  | { kind: 'cb'; data: Dataset; spec: ModelSpec; options: PlsOptions; estimator: CbEstimator }
  | { kind: 'miiv'; data: Dataset; spec: ModelSpec; options: PlsOptions }
  | { kind: 'range'; range: RangeRequest }     // a range of bootstrap samples
  | { kind: 'mc'; task: McTask };              // a slice of a Monte Carlo design
export type WorkerResponse =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'pls'; result: PlsResult } | { kind: 'cb'; result: CbResult } | { kind: 'miiv'; result: MiivResult }
  | { kind: 'range'; part: RangePart } | { kind: 'mc'; part: McPart }
  | { kind: 'error'; message: string };
```

## 5. The R engine: how the front end talks to R

### 5.0 What webR is, for readers who have not met it

R is a C/Fortran program. **WebAssembly** (WASM) is a binary format that every modern browser
can execute at near-native speed, in a sandbox: it cannot read files, open sockets or touch the
page except through functions the host JavaScript gives it. **webR** (the r-wasm project) is R
itself compiled to WebAssembly, with a JavaScript API around it. Concretely, for PLS Studio:

- `public/webr/R.wasm` (18 MB) is the R interpreter; `R.js` and `webr-worker.js` load it;
  `vfs/` holds R's base library as a snapshot of a file system. The same files on every visit,
  from the app's own origin, cached by the browser (an hour, then revalidated).
- R runs inside a **Web Worker**: a thread separate from the page. The page sends it R code and
  receives results; a long calculation never freezes the UI. The Worker has an in-memory
  **virtual file system**: when a package is "installed", its compiled files are written there,
  and when data is handed to R it lives in that memory. Nothing is written to the computer's disk
  and nothing is sent anywhere.
- An **R package** for webR is the same package source compiled for WebAssembly. CRAN does not
  ship these; the r-wasm project builds them (`repo.r-wasm.org`). PLS Studio does not fetch
  from there at run time: `scripts/webr/fetch.mjs` downloads the pinned versions once, with their
  source tarballs (GPL), into `public/webr/repo`, and the app installs from its own copy. So the
  package versions a user gets are exactly those the tests ran against, and they cannot change
  under the app.
- The page must be **cross-origin isolated** (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` headers). Browsers only allow
  `SharedArrayBuffer` on such pages, and webR uses it as the channel between page and Worker; it
  is what makes **interrupting** a running R computation possible (Cancel). The server sets these
  headers; a static host must too.
- The **Content Security Policy** forbids inline scripts and `eval` on the page. WebAssembly
  compilation needs `wasm-unsafe-eval`; webR's Worker script additionally needs `unsafe-eval`
  (Emscripten builds some package code with it), so that one script response gets a policy of
  its own (`WEBR_WORKER_CSP` in `server/src/app.ts`); the page keeps the strict one.
- Limits: one R session is single-threaded (parallel work uses several sessions); it is some
  2–5× slower than native R; a crash in a package's compiled code takes the session down, which
  the runtime detects (`isWasmCrash`) and restarts for the next calculation; and the browser tab's
  memory is the ceiling, which is why results are size-capped before they are stored.

### 5.1 Loading R

`src/rengine/runtime.ts` starts webR lazily: the first call that needs R triggers it. Every
call goes through `withSession(index, packages, sources, fn)`, which queues work per session
and does, in order, whatever is still missing:

```
withSession(0, ['cSEM'], SOURCES, fn)
  │
  ├─ start(session 0)        new WebR({ baseUrl: '/webr/', repoUrl: '/webr/repo/', channelType: SharedArrayBuffer })
  │                          await webR.init()               ← downloads R.wasm once; "Starting R…" in the status bar
  │                          options(expressions = 5e5)      ← cSEM's resampling recurses deeper than webR's default
  ├─ installPackages(missing) cSEM and its dependencies from /webr/repo → the Worker's virtual file system
  │                          then: packageVersion() of each, shown in About and with every result
  ├─ evalRVoid(source files)  the bridge (common.R, pls.R, …) defined in R's global environment, once per session
  └─ fn(webR)                 the actual call, e.g. evalRString('ps_call("ps_pls", req)', { env: { req: json } })
```

`baseUrl` and `repoUrl` point at the app's own `/webr/` directory. Session 0 serves all
ordinary calculations; sessions 1… are started only for parallel work (bootstrap and
permutation chunks), each another webR instance in its own Worker with its own packages and
sources. `parallelMap()` schedules items over sessions. A session that crashed (compiled code
hitting a WASM trap) is discarded and the next call starts a fresh one. The status of session 0
is a small store (`useR`: idle / loading / ready / error, with package versions) that the UI
shows.

### 5.2 Requests and results: the bridge

"Bridge" means the pair of layers that let TypeScript and R talk without either embedding the
other's code: on the TypeScript side a module per analysis that turns app objects into a JSON
request and a JSON result back into typed objects; on the R side a function per analysis that
turns that request into an R script, runs it and returns JSON. Both sides are plain data at the
boundary, which is what makes the boundary safe (§5.6) and testable (the recorded corpus).

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

In code, the whole chain for a PLS calculation:

```ts
// src/rengine/pls.ts — the request is plain data: no R code, no user text as code
export function plsRequest(data0: Dataset, spec0: ModelSpec, options: PlsOptions, pkg: PlsPackage): PlsRequest {
  const { data, spec } = expandCategorical(data0, spec0);          // dummies for categorical exogenous constructs
  const used = new Set(spec.constructs.flatMap((c) => c.indicators));
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => used.has(n));
  return {
    kind: 'pls', package: pkg, missing: options.missing,
    options: { scheme: options.scheme, consistent: !!options.consistent, tolerance: options.tolerance, maxIter: options.maxIter, approach: options.approach ?? 'PLS-PM' },
    data: { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) },
    model: spec,                                                    // toSpec(model): names, types, modes, indicators, paths
  };
}
export async function estimatePlsR(data, spec, options, pkg) {
  return parsePlsOutput(await rCall('ps_pls', plsRequest(data, spec, options, pkg), plsPackages(pkg, options)));
}
```

```ts
// src/rengine/bridge.ts — one entry point for every R call
export async function rCall<T>(fn: string, req: unknown, pkg: RPackage): Promise<T> {
  const h = await viaHelper(fn, req, pkg, false);                   // desktop R chosen and ready? its answer
  if (h !== null) return reported(fromDesktop<T>(h), pkg);
  return reported(await withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `ps_call("${fn}", req)`, req)) as T, pkg);
}
```

```ts
// src/rengine/runtime.ts — the request reaches R as a string bound to `req`; R answers a string
export function callString(webR: WebR, call: string, req: unknown): Promise<string> {
  const json = encode(req);
  return webR.evalRString(call, { env: { req: json } });
}
```

```r
# src/rengine/R/common.R — the only door into the bridge
ps_call <- function(fn, req, export = FALSE) {
  if (!(is.character(fn) && length(fn) == 1 && grepl("^ps_[a-z0-9_]+$", fn))) stop("Invalid bridge function.")
  f <- get(fn, envir = globalenv(), mode = "function")
  if (!identical(names(formals(f))[1], "req_json")) stop("Invalid bridge function.")
  .ps_state$warnings <- character(0); .ps_state$notes <- character(0)
  withCallingHandlers(if (isTRUE(export)) f(req, export = TRUE) else f(req),
    warning = function(w) {
      m <- conditionMessage(w)
      if (ps_irrelevant(m)) NULL else if (ps_advisory(m)) ps_note(m) else ps_warning(m)
      invokeRestart("muffleWarning")
    })
}
```

```r
# src/rengine/R/pls.R — build the script, run it, read the fit; or return the script
ps_pls <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)                                  # JSON -> list, validated (ps_validate)
  b <- ps_pls_build(req, allow_hoc = TRUE, allow_mi = TRUE)  # b$body: the script lines; b$inputs: data
  if (export) return(paste(ps_script(title, b$pkg, b$inputs, b$body, report), collapse = "\n"))
  ps_json(ps_htmt_notes(ps_pls_out(req, b, ps_run(b$body, b$inputs))))
}
# ... inside ps_pls_build, the cSEM call is composed from sanitised pieces only:
body <- c("suppressPackageStartupMessages(library(cSEM))", ps_missing_code(req$missing),
  "model <- '", paste0("  ", lines), "'",                     # lines: "Trust =~ TR1 + TR2 + TR3", built from ps_ident() names
  sprintf("fit <- csem(data, model, .PLS_modes = %s, .PLS_weight_scheme_inner = \"%s\", .disattenuate = %s, .tolerance = %s, .iter_max = %d)",
    modes, scheme, if (isTRUE(o$consistent)) "TRUE" else "FALSE", format(tolerance, scientific = TRUE), as.integer(o$maxIter)))
```

```r
# src/rengine/R/common.R — the script runs in its own environment; warnings are collected, not lost
ps_run <- function(lines, inputs) {
  env <- list2env(inputs, envir = new.env(parent = globalenv()))
  warn <- character(0)
  withCallingHandlers(eval(parse(text = paste(lines, collapse = "\n")), envir = env),
    warning = function(w) { m <- ps_flat(conditionMessage(w)); if (!ps_irrelevant(m)) { if (ps_advisory(m)) ps_note(m) else warn <<- c(warn, m) }; invokeRestart("muffleWarning") })
  env$.warnings <- unique(warn)
  env
}
```

The sequence, for Calculate with the R packages in the browser:

```
UI (TopBar)      runner.ts            rengine/pls.ts        bridge.ts           runtime.ts (webR)         R (ps_* in a Worker)
   │ Calculate      │                      │                    │                    │                          │
   ├───────────────▶│ validateModel()      │                    │                    │                          │
   │                │ key = resultsKey()   │                    │                    │                          │
   │                ├─ estimatePlsR ──────▶│ plsRequest()       │                    │                          │
   │                │                      ├─ rCall('ps_pls') ─▶│ viaHelper → null   │                          │
   │                │                      │                    ├─ withR(pkgs, SOURCES, fn) ───────────────────▶│
   │                │                      │                    │                    │ start webR if needed     │
   │                │                      │                    │                    │ installPackages(missing) │
   │                │                      │                    │                    │ evalRVoid(source files)  │
   │                │                      │                    │                    ├─ evalRString('ps_call("ps_pls", req)', {env:{req}})
   │                │                      │                    │                    │        ps_parse → build → ps_run → ps_json
   │                │                      │                    │                    │◀──────── JSON ───────────┤
   │                │                      │                    │◀── parsed object ──┤                          │
   │                │                      │◀─ parsePlsOutput ──┤ reported(): warnings/notes → Messages        │
   │                │◀─ PlsResult ─────────┤                    │                    │                          │
   │                │ setResults({pls}, key); logCurrentRun()   │                    │                          │
   │◀── re-render ──┤ (diagram estimates, results panel, run card in the Analyses log)                          │
```

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

```ts
// src/rengine/bridge.ts — the same chunks go to the helper's pool as one streamed batch, or to webR sessions
export async function rCallParallel<T>(fn: string, reqs: unknown[], pkg: RPackage, onDone?: (done: number) => void): Promise<T[]> {
  const p = await parallelism();
  if (p.where === 'desktop') {
    try { return (await helperBatch(fn, reqs.map(toJson), [...R_PACKAGES[pkg]], onDone)).map((r) => reported(fromDesktop<T>(r), pkg)); }
    catch (e) { if (e instanceof HelperUnavailable) fallbackNotice(e.message); else throw e; }
  }
  return parallelMap(reqs, useCompute.getState().workers, (req, session) =>
    withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `ps_call("${fn}", req)`, req)).then((r) => reported(r as T, pkg)), onDone);
}
```

```
bootstrap of 1,000 samples, 4 sessions in the browser:

 analyses.ts        bridge.rCallParallel          runtime.parallelMap            webR sessions
     │ splitRanges(1000, 4) → 4 requests {boot:{chunkR, seed+k}}                       │
     ├──────────────────────▶│                           │                            │
     │                       ├─ parallelMap(reqs, 4) ───▶│ session 0 ◀── req 1 ──────▶│ (main session, already warm)
     │                       │                           │ session 1 ◀── req 2 ──────▶│ (started now: webR + packages + sources)
     │                       │                           │ session 2 ◀── req 3 ──────▶│
     │                       │                           │ session 3 ◀── req 4 ──────▶│
     │                       │                           │ onDone(k) as each finishes │
     │◀── 4 results ─────────┤◀──────────────────────────┤                            │
     │ mergeBootstrap(parts) → one BootstrapResult (means, SDs, percentiles)           │
```

### 5.4 Interrupting

`interruptR()` interrupts every webR session (possible because of the SharedArrayBuffer
channel) and cancels helper calls; the runner discards results whose token no longer matches.

### 5.5 The desktop helper

`pls-studio-helper` (helper/) is optional. It binds `127.0.0.1:9878`, keeps a pool of native R
processes (all cores but one by default, `r_workers` in its config), and serves:

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | origin | Is a helper running? |
| `POST /connect` | origin | Ask the person, in the helper's own dialog, to allow this browser; answers a bearer token |
| `POST /pair` | origin | The same with a 6-digit code shown by the helper (no tray) |
| `GET /version` | token | Helper version, R version, worker count, and the SHA-256 of its R bridge |
| `POST /packages` | token | Which of the named R packages its R has, with versions |
| `POST /call` | token | `{id, fn, req, export, packages}` → `{id, ok, result}`: one bridge call |
| `POST /batch` | token | Many calls of one `fn`, run on all R processes, replies streamed as they finish |
| `POST /cancel/:id` | token | Interrupt a running call (its R process is killed and replaced) |

**Same bridge, same check.** The helper embeds `helper/rsrc`, a verbatim copy of
`src/rengine/R` (a Go test fails if they differ), and the two sides compare hashes before any
call. The browser hashes the sources it was built with; the helper hashes the files it embeds:

```ts
// src/rengine/helper.ts
export async function bridgeHash(sources: Record<string, string>): Promise<string> {
  const names = Object.keys(sources).sort((a, b) => (`${a}.R` < `${b}.R` ? -1 : 1));
  const text = names.map((n) => `${n}\n${sources[n]}\n`).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
// probeHelper(): /health → token? → /version → hash equal? → /packages → 'ready'
if (raw.bridge !== await bridgeHash(sources)) return set('mismatch', `This site’s R code is newer than the helper installed here (helper ${info.helperVersion}) …`);
```

**Routing a call.** With Desktop R chosen under "Calculated by", `rCall` asks the helper first
and falls back to webR when the helper is absent, unpaired, lacks a package, or stopped:

```ts
// src/rengine/bridge.ts
async function viaHelper(fn: string, req: unknown, pkg: RPackage, exportScript: boolean): Promise<string | null> {
  if (useCompute.getState().backend !== 'helper') return null;
  await checkHelper();
  const h = useHelper.getState();
  if (h.state !== 'ready') { fallbackNotice(`Desktop R is not available (${h.message || h.state}).`); return null; }
  // cSEM / seminr resampling: all the helper's cores in this one R process (not when drawing chunks).
  const cores = MULTICORE.has(fn) && !(req as { boot?: { chunkR?: unknown } }).boot?.chunkR ? Math.max(1, h.info?.workers ?? 1) : undefined;
  try { return await helperCall(fn, toJson(cores ? { ...(req as object), cores } : req), [...R_PACKAGES[pkg]], exportScript); }
  catch (e) {
    if (e instanceof HelperMissingPackages) { fallbackNotice(`${e.message} Install them … pls-studio-helper setup.`); return null; }
    if (e instanceof HelperUnavailable) { fallbackNotice(e.message); return null; }
    throw e;                                                   // an R error is an R error, wherever R ran
  }
}
```

```ts
// src/rengine/helper.ts — one call over HTTP; 429 is waited out (the helper rate-limits per origin)
export async function helperCall(fn: string, req: string, packages: string[], exportScript = false): Promise<string> {
  const id = newId();
  running.add(id);                                                // cancelHelperCalls() posts /cancel/<id> for these
  let r: Response;
  try { r = await postRetrying('/call', JSON.stringify({ id, fn, req, export: exportScript, packages })); }
  catch { useHelper.setState({ state: 'absent', message: 'The helper stopped.' }); throw new HelperUnavailable('The desktop R helper is not reachable.'); }
  finally { running.delete(id); }
  if (r.status === 401) { setToken(''); useHelper.setState({ state: 'unpaired', message: 'Pair again.' }); throw new HelperUnavailable('…pair again.'); }
  if (!r.ok) throw new HelperUnavailable(`The helper answered ${r.status}.`);
  return resultOf(await r.json() as Reply);                      // ok → result; missing_packages / helper_error → HelperUnavailable; R error → Error
}
```

On the Go side, `/call` validates the body strictly (unknown fields refused, `fn` must be a
`ps_*` name, size-capped), registers the job so `/cancel` can find it, and hands it to the pool:

```go
// helper/server.go
func (s *server) handleCall(w http.ResponseWriter, r *http.Request) {
	if wait, ok := s.limiter.allow(); !ok { w.Header().Set("Retry-After", …); http.Error(w, "rate limit exceeded", 429); return }
	r.Body = http.MaxBytesReader(w, r.Body, callMaxBodyBytes)
	dec := json.NewDecoder(r.Body); dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil { http.Error(w, "bad request body", 400); return }
	if err := req.validate(); err != nil || strings.HasPrefix(req.Fn, "ps_helper") { http.Error(w, "invalid request", 400); return }
	ctx, cancel := context.WithCancel(r.Context()); defer cancel()
	if !s.jobs.register(req.ID, cancel) { http.Error(w, "duplicate id", 409); return }
	defer s.jobs.deregister(req.ID)
	rep, err := s.pool.call(ctx, &req)
	…
}
```

```go
// helper/rpool.go — a pool of `Rscript --vanilla worker.R.txt` processes; one JSON line in, one JSON line out
func (p *rPool) call(ctx context.Context, req *callRequest) (*callReply, error) {
	select { case w = <-p.free: case <-ctx.Done(): return nil, errCancelled }   // wait for a free R process
	line, _ := json.Marshal(req)
	if _, err := w.stdin.Write(append(line, '\n')); err != nil { p.kill(w); go p.replace(); return nil, errors.New("R stopped") }
	select {
	case out := <-w.lines:                       // the worker's reply line (marked, so stray output is ignored)
		var rep callReply
		if err := json.Unmarshal([]byte(out), &rep); err != nil || rep.ID != req.ID { p.kill(w); go p.replace(); return nil, errors.New("unreadable reply from R") }
		p.free <- w
		return &rep, nil
	case <-w.exited:  go p.replace(); return nil, errors.New("R stopped during the calculation (it may have run out of memory)")
	case <-ctx.Done(): p.kill(w); go p.replace(); return nil, errCancelled
	}
}
```

```r
# helper/r/worker.R — the R side of that line protocol: the bridge sourced once, only ps_* entry points callable
for (f in sort(list.files(commandArgs(trailingOnly = TRUE)[1], "\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())
PS_HELPER_CALLABLE <- Filter(function(n) { f <- get(n, envir = globalenv()); is.function(f) && identical(names(formals(f))[1], "req_json") },
  grep("^ps_[a-z0-9_]+$", ls(globalenv()), value = TRUE))
lockBinding("PS_HELPER_CALLABLE", globalenv())
reply(list(ready = TRUE, r = R.version.string, pid = Sys.getpid()))
con <- file("stdin", open = "r")
repeat {
  line <- readLines(con, n = 1, warn = FALSE); if (!length(line)) break
  msg <- jsonlite::fromJSON(line, simplifyVector = FALSE)
  # … msg$fn checked against PS_HELPER_CALLABLE, then: result <- ps_call(msg$fn, msg$req, export = isTRUE(msg$export))
  reply(list(id = msg$id, ok = TRUE, result = result))        # one line on stdout, prefixed with a marker the Go side looks for
}
```

The sequences, first pairing (once per browser), then a calculation:

```
Browser (ComputeSettings)         helper.ts                 pls-studio-helper (Go)              menu bar / tray
   │ Desktop R → Connect              │                              │                                │
   ├─────────────────────────────────▶│ GET /health (Origin: site)   │                                │
   │                                  ├─────────────────────────────▶│ origin on allow list? Host ok? │
   │                                  │◀─ 200 ──────────────────────┤                                │
   │                                  │ POST /connect                │                                │
   │                                  ├─────────────────────────────▶│ ─ "Allow pls.example.edu?" ──▶│
   │  "Click Allow in the helper"     │        (waits up to 2 min)   │◀────────── Allow ─────────────┤
   │                                  │◀─ {token} ──────────────────┤ token stored, mode 0600        │
   │                                  │ keepToken(): localStorage    │                                │
   │                                  │ GET /version (Bearer token)  │                                │
   │                                  ├─────────────────────────────▶│ {helper_version, r, workers, bridge: sha256(rsrc)}
   │                                  │◀────────────────────────────┤                                │
   │                                  │ bridge == bridgeHash(SOURCES)? else 'mismatch'                │
   │                                  │ POST /packages {packages}    │                                │
   │                                  │◀─ {versions} ───────────────┤                                │
   │◀─ "Paired: R 4.5 … 13 R processes"│ state 'ready'               │                                │

Calculate with Desktop R:

 runner.ts     rengine/pls.ts    bridge.viaHelper      helper.ts             Go server / rpool          R worker process
   │ run('estimate')  │                 │                   │                        │                        │
   ├─ estimatePlsR ──▶│ plsRequest()    │                   │                        │                        │
   │                  ├─ rCall ────────▶│ checkHelper()     │                        │                        │
   │                  │                 │ state 'ready'     │                        │                        │
   │                  │                 ├─ helperCall ─────▶│ POST /call {id, fn:"ps_pls", req, packages}     │
   │                  │                 │                   ├───────────────────────▶│ validate; jobs.register │
   │                  │                 │                   │                        ├─ pool.call: stdin line ▶│ ps_call("ps_pls", req)
   │                  │                 │                   │                        │◀─ stdout line {id,ok,result}┤
   │                  │                 │                   │◀─ {id, ok, result} ────┤                        │
   │                  │                 │◀─ JSON text ──────┤                        │                        │
   │                  │◀─ fromDesktop() ┤ engine.desktop = R version (shown with the results)                 │
   │◀─ PlsResult ─────┤ reported(): warnings/notes → Messages                                                 │
   │ setResults(); logCurrentRun()                                                                             │

If anything on the helper side fails (not running, unpaired, package missing, R crashed), viaHelper
returns null after one toast, and the same request runs in webR: the result is identical apart
from `engine.desktop`.
```

Security: an Origin allow list (dev origins by default; a deployment is added with
`pls-studio-helper allow-origin <url>`, and the app shows that command when it cannot reach the
helper from a deployed site), a Host check against DNS rebinding, a bearer token issued once per
browser after the person clicks Allow in the helper's dialog (or types a pairing code),
per-origin rate limits, a size cap on requests, a killed-and-replaced R process on cancel or
crash, and the helper's own injection test that replays the recorded request corpus
(`scripts/security/corpus.jsonl`) through the R bridge.

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
them itself).

```
Run on a card (Analyses tab):

 AnalysesWorkspace     analyses/store.runCard        the analysis type (e.g. nca.tsx)      rengine/nca.ts → bridge.rCall
   │ Run                    │                                  │                                   │
   ├───────────────────────▶│ t.blocked(options, ctx)? → error on the card, stop                    │
   │                        │ fp = t.fingerprint(options, ctx)    (the data columns / scores it reads)│
   │                        │ running[id] = true; cancelGroup   │                                   │
   │                        ├─ t.run(options, ctx, progress) ──▶│ ncaR(data, x, y, permutations) ──▶│ rCall('ps_nca', req, 'NCA')
   │                        │                                  │◀── result ────────────────────────┤
   │                        │◀── result ───────────────────────┤                                   │
   │                        │ packResult(result) → card.run = { at, fingerprint: fp, options: JSON, packed }
   │                        │ results[id] = result              │                                   │
   │◀── card shows t.View ──┤ (later: cardStatus() compares fp with the inputs now → "stale" when they changed)
``` `report.ts` builds a self-contained HTML report from the rendered cards; the
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

```ts
// src/cloud/collab.ts — the store and the Y.js document are kept equal in both directions
this.unsubs.push(useStore.subscribe((s, prev) => {
  if (this.applying || !this.initialised || s.cloud?.projectId !== projectId) return;
  if (s.model !== prev.model || s.settings !== prev.settings || s.projectName !== prev.projectName) this.push();   // writeDoc(): minimal diffs
  if (s.data !== prev.data && !this.fetchingData && s.data && s.dataInfo && s.cloud.role !== 'viewer') void this.uploadData();
  if (s.selection !== prev.selection) this.provider.awareness.setLocalStateField('selection', s.selection.nodes);
}));
this.unsubs.push(useAnalyses.subscribe((s, prev) => {
  if (!this.applying && this.initialised && s.cards !== prev.cards && useStore.getState().cloud?.role !== 'viewer') writeCards(this.doc, s.cards);
}));
```

```
An edit by one collaborator reaches the other:

 Alice: Canvas → store.commit     collab.ts (Alice)        server ws.ts (room)          collab.ts (Bob)          Bob: store
   │ add path                       │                          │                            │                       │
   ├───────────────────────────────▶│ subscribe: model changed │                            │                       │
   │                                │ writeDoc(): paths map += │                            │                       │
   │                                │ Y update (binary) ──────▶│ role editor? size cap ok?  │                       │
   │                                │                          │ persist(update) → Postgres │                       │
   │                                │                          │ broadcast ────────────────▶│ doc.on('update')      │
   │                                │                          │                            │ readDoc() → parseModelState
   │                                │                          │                            ├─ applying = true ────▶│ model replaced
   │                                │                          │                            │ loadCards(readCards())│ (selection kept
   │                                │                          │                            │                       │  where ids remain)
 Undo on either side goes through Y.UndoManager, scoped to that person's own changes.
```

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
