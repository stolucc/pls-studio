// The guided tour's content: ten chapters, each step pointing at an element by its data-tour
// attribute. Every claim here describes what the app shows; keep it in step with public/guide.html.

import { calculateHere } from '../../analyses/calculate';
import { useStore } from '../../store';
import {
  addTourCard,
  ensureBootstrap,
  ensureHome,
  ensureResults,
  ensureWorkspace,
  clickTarget,
  hasFreshBootstrap,
  hasFreshResults,
  jobEnded,
  resultsTab,
  runTourCard,
  showResultsTab,
  tourCard,
  tourCardHasRun,
  tourUsesBuiltin,
} from './actions';
import { useTour } from './engine';
import type { TourChapter } from './types';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

const BUILTIN_NOTE =
  'R was still loading when the tour opened its example, so the tour set **Calculated by** to **Built-in**: PLS Studio’s own engine, which gives the same numbers as cSEM at once. Switch back to **R packages** whenever you like.';

/** A results-tab step: the tab is chosen first (after calculating, or bootstrapping). */
function resultsStep(id: string, boot = false) {
  return {
    target: 'results-panel',
    side: 'top' as const,
    uses: [resultsTab(id)],
    before: () => showResultsTab(id, { boot }),
  };
}

export const TOUR: TourChapter[] = [
  {
    id: 'welcome',
    title: 'Welcome and the home screen',
    summary: 'Starting a project, searching, recent projects and the examples.',
    steps: [
      {
        id: 'welcome',
        title: 'Welcome to PLS Studio',
        before: ensureHome,
        body: [
          'PLS Studio is an editor for structural equation models: PLS-SEM and consistent PLS, covariance-based SEM, and conditional process analysis. The numbers come from the reference R packages, running inside this page.',
          'This tour shows what each part of the screen does, in ten short chapters. On the way you calculate a real model, bootstrap it and read its results. It takes about ten minutes.',
          'Move with **Next** and **Back**, or the ← and → keys. **Contents** jumps to any chapter. Esc ends the tour; the **?** menu in the editor brings it back.',
        ],
      },
      {
        id: 'home-start',
        title: 'Start a project',
        target: 'home-start',
        side: 'bottom',
        before: ensureHome,
        body: [
          '**New project** opens an empty canvas: draw the model now and import the data later. **New project from data** starts from a file: CSV, SPSS, Stata or Excel, or a labelled covariance matrix.',
          '**Open project file…** reads a .plsproj.json file saved earlier. It holds the data, the model, the settings and the analysis log: one file is the whole project.',
          'Your data stay on this computer unless you choose to share a project.',
        ],
      },
      {
        id: 'home-search',
        title: 'Search projects and examples',
        target: 'home-search',
        side: 'bottom',
        before: ensureHome,
        body: [
          'Type words of a name or a topic, such as mediation, MIMIC or lavaan. The search covers your recent projects and every example at once.',
        ],
      },
      {
        id: 'home-recent',
        title: 'Recent projects',
        target: 'home-recent',
        side: 'bottom',
        before: ensureHome,
        body: [
          'Projects you work on are kept here automatically, in this browser only. Reopen one with a click; **PLS Studio** at the top left of the editor brings you back here.',
          'To keep a copy elsewhere or send it to a colleague, use **File → Save project** in the editor. Signed in, a project is also saved to your account.',
        ],
      },
      {
        id: 'home-examples',
        title: 'Examples to learn from',
        target: 'home-topics',
        side: 'bottom',
        before: ensureHome,
        body: [
          'Each example opens a complete project: data, model and settings. Filter them by topic, by author (the books and papers they reproduce) or by R package.',
          'Each card says **what it shows** and carries badges for the evidence its results were checked against. Chapter 9 explains those.',
          'Examples open as the original every time: change anything you like. To keep your changes, save the example as your own project.',
        ],
      },
    ],
  },
  {
    id: 'topbar',
    title: 'The top bar and the three workspaces',
    summary: 'Data, Model and Analyses; the File menu, the method and Calculate.',
    steps: [
      {
        id: 'example-open',
        title: 'The tour’s example',
        target: 'canvas',
        before: () => ensureWorkspace('model'),
        body: () => [
          'This is the Customer experience example: a synthetic survey of 300 customers with five constructs. Service quality and price fairness drive trust and satisfaction, which drive loyalty.',
          'Trust and satisfaction sit between the drivers and loyalty, so there is mediation to explore. The data have a few missing values, as real surveys do.',
          ...(tourUsesBuiltin() ? [BUILTIN_NOTE] : []),
        ],
      },
      {
        id: 'workspace-tabs',
        title: 'Data, Model and Analyses',
        target: 'workspace-tabs',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'The editor has three workspaces. **Data** shows the dataset itself: rows, descriptive statistics and how each variable is treated. **Model** is the diagram, where you draw and estimate. **Analyses** is a log of further analyses, kept with the project.',
          'A number on **Analyses** counts results that are out of date after a change, so you know what to rerun.',
        ],
      },
      {
        id: 'project-name',
        title: 'Name, undo and redo',
        target: 'project-name',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Click the name to rename the project. A dot beside it means changes not yet saved to a project file.',
          `Undo and redo sit left of centre, beside the tabs: ${mod}Z and ${mod}⇧Z. In a shared project, undo reverts only your own changes.`,
          'This is an example, so the button beside the name reads **Save example as project**: until you press it, changes to an example are not kept.',
        ],
      },
      {
        id: 'file-menu',
        title: 'The File menu',
        target: 'file-menu',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          `**New project**, **Open project…** (${mod}O) and **Save project** (${mod}S). **Replace data…** loads another file and keeps the model: indicators are matched by column name.`,
          '**Export report (HTML, Word)…** and **Create replication package…** prepare documents for a paper or a journal. **Download R script** writes the R code that reproduces the model.',
          'You can also build the diagram from lavaan or Mplus syntax, import an AMOS model, or download Mplus input.',
        ],
      },
      {
        id: 'method-switch',
        title: 'PLS-SEM, CB-SEM or CPA',
        target: 'method-switch',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          '**PLS-SEM** estimates composites and common factors by partial least squares (cSEM or seminr). With consistent PLS on, the button reads PLSc.',
          '**CB-SEM** fits the model to the covariance matrix by maximum likelihood and related estimators (lavaan), with χ² and fit indices. **CPA**, conditional process analysis, estimates Hayes’s PROCESS models by OLS regression (manymome).',
          'Switching keeps the diagram and the data; only the results are recalculated.',
        ],
      },
      {
        id: 'calculate-buttons',
        title: 'Bootstrap, Auto and Calculate',
        target: 'calculate',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          `**Calculate** (${mod}↵) estimates the model. **Bootstrap** (${mod}⇧↵) adds standard errors, p values and confidence intervals by resampling. Each bootstrap sample has its own seed, so results are the same on any computer.`,
          'With **Auto** on, the model is recalculated after every change. Leave it off for large models and press Calculate when you are ready.',
          'The eye beside the method shows or hides the estimates on the diagram. On the Analyses tab, Calculate becomes **Run**: it runs the selected card.',
        ],
      },
      {
        id: 'help-menu',
        title: 'Help, and this tour',
        target: 'help-menu',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'The **?** menu opens the user guide in a new tab, and starts this tour again: all of it, or one chapter. Finished chapters are ticked.',
          'On the home screen, **Validation** lists what every example and method is checked against, and **About & licences** names every component and dataset.',
        ],
      },
    ],
  },
  {
    id: 'data-panel',
    title: 'The Data panel',
    summary: 'The dataset, its variables, computed columns, filters and reverse-coding.',
    steps: [
      {
        id: 'data-meta',
        title: 'The dataset at a glance',
        target: 'data-meta',
        side: 'right',
        before: () => ensureWorkspace('model'),
        body: [
          'The Data panel names the file and counts observations, variables and missing values. How the estimation treats missing values is set in the Inspector: mean replacement, casewise deletion or multiple imputation, and for CB-SEM full-information maximum likelihood.',
          '**Filter cases…** analyses only the rows where a condition holds, such as age >= 18, without editing the file. A badge shows while a filter is on.',
        ],
      },
      {
        id: 'data-actions',
        title: 'Inspect, Compute and Replace',
        target: 'data-actions',
        side: 'right',
        before: () => ensureWorkspace('model'),
        body: [
          '**Inspect** opens the Data workspace with every row. **ƒ Compute…** adds a column from a formula over the existing ones: log(income), (x1 + x2) / 2, z(score), ifelse(age >= 18, 1, 0).',
          '**Replace** loads another data file and keeps the model.',
        ],
      },
      {
        id: 'var-list',
        title: 'Variables become indicators',
        target: 'var-list',
        side: 'right',
        before: () => ensureWorkspace('model'),
        body: [
          'Each row is a column of the data. The chip names the construct it measures; an unassigned variable shows its mean. Hover a row for its mean, SD and missing values. **Unassigned** above lists only the variables not yet in the model.',
          'To build a model, drag variables onto the canvas: together they become a new construct. Drop more onto a construct to add them as indicators. Shift- or ⌘-click to select several first.',
        ],
      },
      {
        id: 'selection-bar',
        title: 'Reverse-code and recode',
        target: 'selection-bar',
        side: 'right',
        before: async () => {
          if (!(await ensureWorkspace('model'))) return false;
          useStore.getState().setSelectedVars(['SQ1']);
        },
        body: [
          'Selecting variables shows what you can do with them. **Reverse-code…** turns negatively worded items around: x becomes lowest + highest − x on the answer scale, and the item is marked (R).',
          '**Recode…** (one variable) makes a new column from bins, or from old values to new ones. The original column stays as it was.',
        ],
      },
    ],
  },
  {
    id: 'canvas',
    title: 'The canvas',
    summary: 'Constructs, indicators and paths; the toolbar, right-click menus and figures.',
    steps: [
      {
        id: 'canvas',
        title: 'The diagram',
        target: 'canvas',
        before: () => ensureWorkspace('model'),
        body: [
          'The canvas holds the model. Ellipses are constructs measured as common factors; a hexagon is a composite, formed from its indicators. Rectangles are indicators: columns of the data. Arrows between constructs are paths.',
          'Scroll or pinch to zoom, and drag empty canvas with the right or middle mouse button to pan. The buttons at the bottom left zoom and fit the model into view; the minimap at the bottom right finds your way around a large model.',
        ],
      },
      {
        id: 'construct',
        title: 'A construct, and right-click',
        target: 'construct',
        before: () => ensureWorkspace('model'),
        body: [
          'Drag a construct to move it; its indicators move with it. Double-click its name to rename it. Selected, it is edited in the Inspector on the right.',
          'Right-click a construct, an indicator, a path or empty canvas for everything else: construct type, covariates, quadratic terms, labels and fixed values, ordinal items, deleting, and the figure export.',
        ],
      },
      {
        id: 'tool-dock',
        title: 'The toolbar',
        target: 'tool-dock',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'The toolbar sets what a click on the canvas does. The letter on each tool is its shortcut. **Select** (V) is the default: click to select, drag empty canvas to select a group, Delete removes the selection, Esc comes back here from any tool.',
          'Under CB-SEM the toolbar adds **Correlation** (R), **Constant** for the mean structure, **Std / Unstd** for standardised or unstandardised estimates, and **Errors** to show the error terms (ε) and disturbances (ζ).',
        ],
      },
      {
        id: 'tool-construct',
        title: 'Construct (C)',
        target: 'tool-construct',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Click the canvas to place a new construct. A double-click on empty canvas does the same with any tool. Then drop variables on it, or type the names of its indicators in the Inspector.',
        ],
      },
      {
        id: 'tool-connect',
        title: 'Path (P)',
        target: 'tool-connect',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Drag from one construct to another to draw a path: a hypothesised effect. With any tool, you can also drag from the dot on a construct’s edge.',
          'Drop a path onto another path and it becomes a moderation: an interaction term, drawn as an arrow onto the path.',
        ],
      },
      {
        id: 'tool-figure',
        title: 'Arrange, Comment and Figure',
        target: 'tool-figure',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          '**Arrange** lays the constructs out automatically. **Comment** adds a note to the diagram, saved with the project and exported with the figure.',
          '**Figure** turns the diagram into a publication figure: choose its style and notation, then download PDF, PNG or SVG.',
        ],
      },
      {
        id: 'model-version',
        title: 'Which version is on the canvas',
        target: 'model-version',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'This chip says whether the model on the canvas has been calculated. Each Calculate logs a numbered version on the Analyses tab (**Model v1**, v2, …), so earlier results are never lost.',
          'After an edit it reads, for example, “Model v1, edited”. Click it to see that version’s results.',
        ],
      },
    ],
  },
  {
    id: 'inspector',
    title: 'The Inspector',
    summary: 'Checks, the engine and where R runs, the PLS algorithm and bootstrapping.',
    steps: [
      {
        id: 'inspector',
        title: 'The Inspector',
        target: 'inspector',
        side: 'left',
        before: () => ensureWorkspace('model'),
        body: [
          'The Inspector edits whatever is selected. With nothing selected, as now, it shows the model: its checks first, then the estimation settings.',
          '**Checks** lists problems as you draw, such as a construct without indicators; click one to select the construct concerned. Here it reads **No problems found. Ready to calculate.**',
          '**Sampling weights** weights the estimation by a column of the data. Under CB-SEM, this panel also holds **Groups** (multigroup models and invariance), **Clusters** (two-level models) and **Constraints**.',
        ],
      },
      {
        id: 'inspector-construct',
        title: 'Select something to edit it',
        target: 'inspector',
        side: 'left',
        before: async () => {
          if (!(await ensureWorkspace('model'))) return false;
          const s = useStore.getState();
          const trust = s.model.constructs.find((c) => c.name === 'Trust') ?? s.model.constructs[0];
          if (trust) s.select('construct', trust.id);
        },
        body: [
          'With a construct selected (here Trust), the Inspector edits it: its name, its type (common factor or composite), its indicators and how they are drawn. After a calculation it adds the construct’s quality figures.',
          'Paths, moderations and correlations have panels of their own. Click empty canvas or press Esc to return to the model’s settings.',
        ],
      },
      {
        id: 'engine-choice',
        title: 'Calculated by',
        target: 'engine-choice',
        side: 'left',
        before: () => ensureWorkspace('model'),
        body: () => [
          '**R packages** run the reference implementations: cSEM or seminr for PLS-SEM, lavaan for CB-SEM. **Built-in** is PLS Studio’s own engine, validated against those packages: instant, with no download.',
          'With cSEM, **Weighting approach** can replace PLS path modelling by GSCA, PCA or sum scores. **Export R script** downloads the R code for exactly this model.',
          ...(tourUsesBuiltin() ? [BUILTIN_NOTE] : []),
        ],
      },
      {
        id: 'r-runs-in',
        title: 'Where R runs',
        target: 'r-runs-in',
        side: 'left',
        before: () => ensureWorkspace('model'),
        body: [
          '**This browser** runs R compiled for the web (webR): nothing to install, and the data stay in this tab. **Desktop R (helper)** runs the same packages in the R on your computer, several times faster, through the free PLS Studio Helper.',
          '**Parallel bootstrap and simulation** shares the work between several R sessions in this browser. With two or more, the results are the same whatever their number.',
        ],
      },
      {
        id: 'pls-algorithm',
        title: 'PLS algorithm',
        target: 'pls-algorithm',
        side: 'left',
        before: () => ensureWorkspace('model'),
        body: [
          '**Consistent PLS (PLSc)** corrects common factors for attenuation using ρA, so that their loadings and paths estimate the factor model. Composites are left as they are.',
          'The inner weighting scheme (path, factor or centroid), the maximum number of iterations and the stop criterion are set here too.',
        ],
      },
      {
        id: 'bootstrap-settings',
        title: 'Bootstrapping settings',
        target: 'bootstrap-settings',
        side: 'left',
        before: () => ensureWorkspace('model'),
        body: [
          'The number of subsamples, the random seed, the confidence level, one- or two-tailed tests, and the kind of interval (percentile, BCa, or studentised for PLS).',
          'The seed makes a bootstrap repeatable: the same seed gives the same results, and the exported R script uses it too.',
        ],
      },
    ],
  },
  {
    id: 'results',
    title: 'Calculating and reading results',
    summary: 'Calculate and bootstrap yourself; every results tab, its colours and its notes.',
    steps: [
      {
        id: 'do-calculate',
        title: 'Your turn: calculate',
        target: 'calculate',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Time to estimate the model. Calculate runs the PLS algorithm on the 300 responses; the results open in a panel under the diagram.',
        ],
        task: {
          prompt: 'Press **Calculate** in the top bar.',
          done: hasFreshResults,
          doIt: async () => {
            await calculateHere('estimate');
            await jobEnded();
          },
        },
      },
      {
        id: 'results-panel',
        title: 'The results panel',
        ...resultsStep('overview'),
        body: [
          'Results open under the diagram, in tabs. **Overview** has the algorithm, the observations, the iterations, whether it converged, the SRMR, and the R² of each endogenous construct.',
          'Drag the panel’s top edge to make it taller; the arrow on the right folds it away. The chip beside it names the engine or package that computed the numbers. **Messages** collects what the packages reported: warnings (amber) about the estimates, and notes (grey) that explain a result.',
        ],
      },
      {
        id: 'diagram-estimates',
        title: 'Estimates on the diagram',
        target: 'canvas',
        before: async () => {
          if (!(await ensureResults())) return false;
          useStore.getState().setShowResultsOnDiagram(true);
        },
        body: [
          'The diagram now carries the estimates: path coefficients on the arrows, loadings on the indicators, and the R² of each endogenous construct.',
          'The eye in the top bar hides them while you rearrange the drawing.',
        ],
      },
      {
        id: 'paths',
        title: 'Path coefficients, and copying tables',
        ...resultsStep('paths'),
        body: [
          'β is the standardised path coefficient. f² is the effect size of each predictor (0.02 small, 0.15 medium, 0.35 large, by Cohen’s rule of thumb), and VIF checks collinearity among a construct’s predictors.',
          'Every table has three buttons: **Copy** (tab-separated, to paste into Excel or Word), **CSV**, and **LaTeX**, a booktabs table that is downloaded and copied.',
          'There are no p values yet: they come with the bootstrap, in a moment.',
        ],
      },
      {
        id: 'loadings',
        title: 'Loadings, and what the colours mean',
        ...resultsStep('outer'),
        body: [
          'Green: a loading of 0.708 or more, so the construct explains at least half of the indicator’s variance. Amber: 0.40 to 0.708, worth a look. Red: below 0.40, or a sign that differs from the construct’s other loadings.',
          'A negative loading among positive ones is often a reverse-worded item that was not reverse-coded. A note then appears above this table asking just that, with a button to reverse-code the item.',
          'When an item loads below 0.708, the loading triage under the table re-estimates the construct without it and shows whether AVE and reliability improve. Nothing is deleted without your confirmation.',
        ],
      },
      {
        id: 'reliability',
        title: 'Reliability and convergent validity',
        ...resultsStep('reliability'),
        body: [
          'Cronbach’s α, ρA and ρC for each common factor: 0.70 to 0.95 is satisfactory (green). An AVE of 0.50 or more indicates convergent validity.',
          'Composites have no reliability: they are defined by their weights, so their rows stay empty.',
        ],
      },
      {
        id: 'discriminant',
        title: 'Discriminant validity',
        ...resultsStep('discriminant'),
        body: [
          'HTMT, HTMT2 and the Fornell–Larcker criterion. An HTMT above 0.90 (0.85 for clearly distinct concepts) is flagged.',
          'When a pair fails, a helper appears under the tables: a bootstrap test of the HTMT, the items that drive the value, and what you can do about it, each option with its source.',
        ],
      },
      {
        id: 'do-bootstrap',
        title: 'Your turn: bootstrap',
        target: 'bootstrap',
        side: 'bottom',
        before: ensureResults,
        body: [
          'PLS-SEM has no standard errors of its own: they come from bootstrapping, re-estimating the model on many resamples of the data. The progress bar shows in the results panel.',
        ],
        task: {
          prompt: 'Press **Bootstrap** in the top bar.',
          done: hasFreshBootstrap,
          doIt: async () => {
            await ensureBootstrap();
          },
        },
      },
      {
        id: 'effects',
        title: 'Indirect effects and mediation',
        ...resultsStep('effects', true),
        body: [
          'Indirect effects pass through mediators, such as service quality → trust → satisfaction. With the bootstrap, each has a confidence interval and a **Type**.',
          'The type follows Zhao, Lynch & Chen (2010): **complementary** or **competitive** mediation (indirect and direct effects both significant, with the same or opposite signs), **indirect-only**, **direct-only**, or **no effect**. Specific indirect effects split the total by route.',
        ],
      },
      {
        id: 'fit',
        title: 'Model fit, and the ⓘ buttons',
        target: 'fit-test',
        side: 'top',
        uses: [resultsTab('fit')],
        before: () => showResultsTab('fit', { boot: true }),
        body: [
          'SRMR, d_ULS and d_G compare the observed and model-implied correlations. **Run bootstrap test** tests exact fit: a value at or below HI95 fits.',
          'Hover or click an **ⓘ** for what an index means, its usual cut-offs and their sources. Under CB-SEM this tab shows χ², CFI, TLI, RMSEA and SRMR, each with its ⓘ, with checks of admissibility and help to diagnose misfit.',
        ],
      },
      {
        id: 'script',
        title: 'The R script',
        ...resultsStep('script', true),
        body: [
          '**R script** shows the R code that calculates this model, with the data embedded. Copy or download it, and anyone can reproduce the results in R or RStudio.',
          'The same script is behind **File → Download R script**; analysis cards have scripts of their own.',
        ],
      },
    ],
  },
  {
    id: 'analyses',
    title: 'The Analyses workspace',
    summary: 'The log of cards, frozen model runs, adding and running a card, the report.',
    steps: [
      {
        id: 'analyses-log',
        title: 'The analysis log',
        target: 'analyses-log',
        before: async () => {
          if (!(await ensureResults())) return false;
          return ensureWorkspace('analyses');
        },
        body: [
          'Analyses beyond the main model live here as cards in a log: data screening, factor analysis, PLSpredict, multigroup analysis, segmentation, regression, simulations and more. The log is saved with the project.',
          'The outline on the right lists the cards: click one to jump to it, drag entries to reorder them.',
        ],
      },
      {
        id: 'run-card',
        title: 'Model runs are frozen',
        target: 'run-card',
        side: 'bottom',
        before: async () => {
          if (!(await ensureResults())) return false;
          return ensureWorkspace('analyses');
        },
        body: [
          'Your Calculate logged this card: **Model v1**, with the model, its settings, the data it used, the diagram and the results, frozen as they were.',
          'Change the model and calculate again, and a new version is logged with a list of what changed. **Open model** puts any version back on the Model tab.',
        ],
      },
      {
        id: 'do-add-card',
        title: 'Your turn: add a card',
        target: 'add-analysis',
        side: 'bottom',
        before: async () => {
          if (!(await ensureResults())) return false;
          return ensureWorkspace('analyses');
        },
        body: [
          'Add the reviewer checklist: the checks reviewers typically ask for, each marked from your results with its evidence.',
        ],
        task: {
          prompt: 'Press **+ Add analysis**, type checklist, and choose **Reviewer checklist**.',
          done: () => !!tourCard(),
          doIt: addTourCard,
        },
      },
      {
        id: 'card-options',
        title: 'The card’s options',
        target: 'card-options',
        side: 'right',
        before: async () => {
          if (!(await ensureWorkspace('analyses'))) return false;
          addTourCard();
        },
        body: [
          'This pane shows the options of the selected card. Each card names the package that computes it, and its R script is one click away.',
          'The checklist needs no options: it reads the model and its current results.',
        ],
      },
      {
        id: 'do-run-card',
        title: 'Your turn: run it',
        target: 'calculate',
        side: 'bottom',
        before: async () => {
          if (!(await ensureWorkspace('analyses'))) return false;
          addTourCard();
        },
        body: [
          'With a card selected, Calculate in the top bar becomes **Run**: it runs that card. Each card also has a ▶ button of its own, and a card whose data or model changed is marked out of date.',
        ],
        task: {
          prompt: 'Press **Run** in the top bar.',
          done: tourCardHasRun,
          doIt: runTourCard,
        },
      },
      {
        id: 'report',
        title: 'Reports and replication',
        target: 'export-report',
        side: 'bottom',
        before: () => ensureWorkspace('analyses'),
        body: [
          '**Export report** writes the session as one document, HTML or Word: the model, its results, every card, the methods text, references and software versions.',
          '**Replication package** makes a zip with the data, an R script per analysis, the project and a README. A **Methods text** card drafts the methods paragraph, with package versions and citations.',
        ],
      },
    ],
  },
  {
    id: 'data-tab',
    title: 'The Data workspace',
    summary: 'Rows, descriptive statistics, measurement levels, value labels and missing codes.',
    steps: [
      {
        id: 'data-workspace',
        title: 'The Data workspace',
        target: 'data-workspace',
        before: () => ensureWorkspace('data'),
        body: [
          'The Data tab shows the dataset itself, 100 rows at a time; missing values show as NA. Hover a column header to see the construct the variable measures.',
          'The Data panel stays on the left, so you can compute, filter and reverse-code while you look at the rows.',
        ],
      },
      {
        id: 'data-view-tabs',
        title: 'Rows, Variables and Descriptives',
        target: 'data-view-tabs',
        side: 'bottom',
        before: () => ensureWorkspace('data'),
        body: [
          '**Rows** is the data grid. **Descriptives** gives each variable’s n, missing values, mean, SD, quartiles, skewness and excess kurtosis; few distinct values hint at Likert items.',
        ],
      },
      {
        id: 'variables-view',
        title: 'Value labels and missing codes',
        target: 'variables-view',
        uses: ['data-tab-variables'],
        before: async () => {
          if (!(await ensureWorkspace('data'))) return false;
          await clickTarget('data-tab-variables');
        },
        body: [
          '**Variables** works like SPSS’s Variable View: each column’s type, its measurement level (nominal, ordinal or scale), its value labels and its missing-value codes.',
          'Value labels name the categories (1 = Strongly disagree), and analyses that show categories use them. Missing codes such as -99 or 999 count as missing in every analysis; the values are kept, so removing a code brings them back.',
        ],
      },
    ],
  },
  {
    id: 'trust',
    title: 'Reproducibility and trust',
    summary: 'R in the browser, the Validation page and its evidence, the desktop helper.',
    steps: [
      {
        id: 'r-pill',
        title: 'R in your browser',
        target: 'r-pill',
        side: 'top',
        before: () => ensureWorkspace('model'),
        body: [
          'This indicator shows R starting in your browser, then **R environment ready**. The first visit downloads R and its packages, about 20 MB; later visits use the browser’s cache. Hover it for details.',
          'The app stays usable while R loads, and nothing is sent anywhere: R runs inside this page.',
        ],
      },
      {
        id: 'validation',
        title: 'The Validation page',
        target: 'validation-intro',
        side: 'bottom',
        before: async () => {
          if (!(await ensureWorkspace('model'))) return false;
          useStore.getState().openValidation();
        },
        body: [
          'Every example and method is checked against a reference that does not come from this app. **Published**: numbers printed by others with other software. **Native R**: the same package run in desktop R. **Same R**: the package’s own function called directly. **Simulated**: data with known true values. **Runs**: the documented example runs without unexpected warnings.',
          'These are different kinds of evidence, not a ranking. **Check this browser** reruns ten examples here and compares every number with the test suite’s. An example opened unchanged shows its badges beside its results too.',
        ],
      },
      {
        id: 'desktop-helper',
        title: 'Desktop R, for speed and Stan',
        target: 'engine-choice',
        side: 'left',
        before: async () => {
          const s = useStore.getState();
          if (s.view === 'validation') s.closeValidation();
          return ensureWorkspace('model');
        },
        body: [
          'The free PLS Studio Helper runs calculations in the R installed on your computer: several times faster, on all cores, with every package. Bayesian SEM with Stan (blavaan) and a few other analyses need it, as Stan does not run in a browser.',
          'Choose **R packages**, then **R runs in → Desktop R (helper)**. Your data travel only between this page and R on your own computer.',
        ],
      },
    ],
  },
  {
    id: 'saving',
    title: 'Saving and sharing',
    summary: 'Project files, keeping an example, accounts and working together.',
    steps: [
      {
        id: 'save-file',
        title: 'Save the project as a file',
        target: 'file-menu',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          `**File → Save project** (${mod}S) downloads a .plsproj.json file with everything: data, model, settings, and the analysis log with its results. **Open project…** (${mod}O) reads it back, here or on another computer.`,
          'Projects are also kept automatically in Recent projects on the home screen, in this browser.',
        ],
      },
      {
        id: 'example-pill',
        title: 'Keep an example as your own',
        target: 'example-pill',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Examples are not kept, so they open fresh every time. **Save example as project** makes this one, with your changes, a project of your own in Recent projects.',
        ],
      },
      {
        id: 'share',
        title: 'Accounts and working together',
        target: 'share',
        side: 'bottom',
        before: () => ensureWorkspace('model'),
        body: [
          'Signed in (with email or Google), a project you work on is saved to your account and appears on every computer you sign in on. Without an account, everything stays in this browser.',
          '**Share → Upload and share** invites colleagues by email as editors or viewers. Everyone edits the same model live, with cursors and presence; calculations run on each person’s computer, and shared datasets are stored encrypted.',
        ],
      },
      {
        id: 'finish',
        title: 'You are ready',
        body: () => {
          const previous = useTour.getState().previous;
          return [
            'That is the tour. You have calculated a model, bootstrapped it, read its results and logged an analysis.',
            'Next, open an example close to your study from the home screen, or start a new project from your own data. The user guide covers every feature in depth, and the **?** menu brings this tour back.',
            ...(previous
              ? [
                  `Your project “${previous.name}” is waiting: **Back to “${previous.name}”** reopens it.`,
                ]
              : []),
          ];
        },
      },
    ],
  },
];

/** Every data-tour attribute the tour relies on (step targets and the tabs their preparation clicks). */
export function tourTargets(chapters: TourChapter[] = TOUR): string[] {
  const keys = chapters.flatMap((c) =>
    c.steps.flatMap((s) => [...(s.target ? [s.target] : []), ...(s.uses ?? [])]),
  );
  return [...new Set(keys)];
}
