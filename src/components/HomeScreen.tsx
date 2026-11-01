import { useEffect, useState } from 'react';
import { loadPackageExample, loadSample, newProject, newProjectFromData, openProject, openRecent } from '../io';
import { EXAMPLE_PACKAGES, PACKAGE_EXAMPLES, type ExamplePackage } from '../examples/packages';
import { allTags, exampleTags } from '../examples/tags';
import { listRecent, recentPersistent, relativeTime, removeRecent, type RecentMeta } from '../recent';
import { useStore } from '../store';
import { confirmDialog } from './Overlays';
import { useAuth } from '../cloud/auth';
import { api } from '../cloud/api';
import { openCloudProject } from '../cloud/collab';
import { AccountMenu } from './cloud/AccountMenu';
import { AboutDialog } from './AboutDialog';
import { IconLogo, IconNew, IconOpen, IconTrash, IconUpload } from './icons';

const EXAMPLES = [
  {
    id: 'customer' as const,
    title: 'Customer experience survey',
    tags: ['PLS-SEM', 'Mediation', 'Missing values', 'Bootstrap'],
    links: [] as { label: string; url: string }[],
    body: 'Synthetic survey (N = 300) with service quality, price fairness, trust, satisfaction and loyalty. Raw data with a few missing values: try PLS, PLSc, bootstrapping, IPMA, moderation and the fit test.',
  },
  {
    id: 'emse' as const,
    title: 'Gamification in software engineering',
    tags: ['CB-SEM', 'MLM', 'Second-order', 'Covariates', 'Mediation', 'Covariance input', 'Published study'],
    links: [{ label: 'Paper (EMSE 27:35)', url: 'https://doi.org/10.1007/s10664-021-10062-w' }, { label: 'Replication package (Zenodo)', url: 'https://doi.org/10.5281/zenodo.6322761' }],
    body: 'Stol, Schaarschmidt & Goldblit (2022), Empirical Software Engineering 27:35. The published model from the replication package’s covariance and NACOV matrices (N = 155): second-order engagement factor, covariates, robust MLM, MIIV-2SLS.',
  },
  {
    id: 'poldem' as const,
    title: 'Industrialisation and political democracy',
    tags: ['CB-SEM', 'Mediation', 'Correlated errors'],
    links: [{ label: '?PoliticalDemocracy (lavaan)', url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html' }, { label: 'lavaan tutorial: SEM', url: 'https://lavaan.ugent.be/tutorial/sem.html' }],
    body: 'Bollen (1989), Structural Equations with Latent Variables: 75 developing countries, democracy measured in 1960 and 1965. The classic model with six correlated measurement errors, drawn as double-headed arrows between error terms.',
  },
  {
    id: 'mimic' as const,
    title: 'Social participation (MIMIC model)',
    tags: ['CB-SEM', 'MIMIC', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Schumacker & Lomax, A Beginner’s Guide to SEM', url: 'https://www.routledge.com/A-Beginners-Guide-to-Structural-Equation-Modeling/Whittaker-Schumacker/p/book/9780367477967' }, { label: 'Hodge & Treiman (1968)', url: 'https://doi.org/10.2307/2092317' }],
    body: 'Multiple indicators, multiple causes: income, occupation and education cause social participation, measured by church attendance, memberships and friends seen. Jöreskog & Sörbom’s LISREL example (Hodge & Treiman 1968, N = 530), the worked MIMIC example in Schumacker & Lomax; the correlation matrix and maximum likelihood, reproducing its coefficients.',
  },
  {
    id: 'wheaton' as const,
    title: 'Stability of alienation (Wheaton et al. 1977)',
    tags: ['CB-SEM', 'Panel model', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Wheaton, Muthén, Alwin & Summers (1977)', url: 'https://doi.org/10.2307/270754' }, { label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }],
    body: 'Alienation (anomia, powerlessness) measured in 1967 and 1971, explained by socio-economic status (education, occupational index), N = 932. The model in Bollen (1989), Jöreskog & Sörbom’s LISREL manual and the SAS/STAT PROC CALIS manual, with the errors of each item correlated across the waves: χ² = 4.73 on 4 df.',
  },
  {
    id: 'thurstone' as const,
    title: 'Thurstone mental tests: second-order factor',
    tags: ['CB-SEM', 'Second-order', 'CFA', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }, { label: 'SAS/STAT PROC CALIS: second-order CFA', url: 'https://go.documentation.sas.com/doc/en/statug/latest/statug_calis_examples.htm' }],
    body: 'Nine tests from Thurstone & Thurstone (1941), N = 213: verbal, word-fluency and reasoning factors, with a general ability factor at the second order, as in the SAS/STAT PROC CALIS manual. A correlation matrix, maximum likelihood.',
  },
  {
    id: 'kerckhoff' as const,
    title: 'Ambition and attainment (Kerckhoff 1974)',
    tags: ['CB-SEM', 'Path analysis', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }],
    body: 'The LISREL manual’s observed-variable path model: intelligence, number of siblings, father’s education and occupation explain grades, educational expectations and occupational aspirations of 737 boys. Four fixed exogenous variables, a just-identified recursive model: coefficients and R² only.',
  },
  {
    id: 'hayduk' as const,
    title: 'Smoking behaviour and antismoking acts (Hayduk 1987)',
    tags: ['CB-SEM', 'Single indicators', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Chapter 4’s “real model”: sex, age, education and religious attendance explain current smoking, antismoking views and antismoking acts (N = 432). Each concept has one indicator whose error variance is fixed from an assessed reliability (1% for sex, 5% to 10% for the rest), Hayduk’s way of modelling measurement error without multiple indicators; the figure reproduces his LISREL estimates (Figure 4.7). The matrix carries all thirteen indicators of Figure 4.5, so the other religion and smoking measures can be swapped in.',
  },
  {
    id: 'hayduk-stacked' as const,
    title: 'Stacked smoking model: younger and older (Hayduk 1987)',
    tags: ['CB-SEM', 'Multigroup', 'Stacked model', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Chapter 9’s stacked model: the smoking model fitted to younger (N = 213) and older (N = 219) respondents at once, one covariance matrix per group (Figure 9.2), each group’s error variances fixed from its own variances. The path coefficients are held equal across the groups except the heavy arrows of Figure 9.1 (the effects of age and education, of sex on acts, and of smoking), which may differ (read from the figure; the fit is checked against native lavaan: χ² = 3.33 on 6 df for the six equalities); the χ² of the equalities tests whether the groups share one model. Groups: pick a group or All groups in the results.',
  },
  {
    id: 'hayduk-revised' as const,
    title: 'Revised smoking model: a reciprocal effect (Hayduk 1987)',
    tags: ['CB-SEM', 'Non-recursive', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Figure 8.6: antismoking views now also cause smoking, a loop with the effect of smoking on views. Identified by two exclusions, sex → smoking and religion → views (the instruments). Reproduces the LISREL estimates on the page: smoking → views −1.26, views → smoking 0.03, the latter with a standard error eight times its size: the data cannot tell the two directions apart, which is the chapter’s lesson.',
  },
  {
    id: 'dhp' as const,
    title: 'Peer influences on aspirations (Duncan, Haller & Portes 1968)',
    tags: ['CB-SEM', 'Non-recursive', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }, { label: 'Duncan, Haller & Portes (1968), AJS 74', url: 'https://doi.org/10.1086/224615' }],
    body: 'The classic non-recursive model: a respondent’s and a best friend’s general aspirations (each measured by occupational and educational aspiration) influence each other, with parental aspiration, intelligence and socio-economic status of both as fixed background variables and correlated disturbances. The first example of the sem package’s documentation (correlation matrix, N = 329): χ² = 26.8 on 15 df, reciprocal effects .18 and .24.',
  },
];

/** Whether every word of a query occurs in one of the texts (case-insensitive). */
export function matchesQuery(query: string, texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter((t): t is string => !!t).join(' \n ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

interface CloudProject { id: string; name: string; role: 'owner' | 'editor' | 'viewer'; owner_name: string; members: number; updated_at: string }

function SharedProjects({ query }: { query: string }) {
  const auth = useAuth();
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<CloudProject[] | null>(null);
  useEffect(() => {
    if (!auth.user) { setList(null); return; }
    api.get<{ projects: CloudProject[] }>('/api/projects').then((r) => setList(r.projects)).catch(() => setList([]));
  }, [auth.user]);
  if (!auth.available) return null;
  if (!auth.user) {
    return (
      <section>
        <h2>Your projects</h2>
        <div className="start-card" style={{ cursor: 'default' }}>
          <b>Keep projects in an account</b>
          <span>Sign in and the projects you work on are saved to your account and listed here on every computer; share them with collaborators and edit together in real time. Datasets are stored encrypted on the PLS Studio server.</span>
          <button className="btn primary" style={{ marginTop: 6 }} onClick={() => auth.openDialog('signin')}>Sign in or create an account</button>
        </div>
      </section>
    );
  }
  const open = async (id: string) => {
    try { await openCloudProject(id, auth.user!); } catch (e) { toast('error', (e as Error).message); }
  };
  return (
    <section>
      <h2>Your projects</h2>
      {list === null ? <div className="hint">Loading…</div> : list.length === 0 ? (
        <div className="hint">No projects in your account yet. A project you work on while signed in is saved here as soon as it has a model or data; Share invites others to it.</div>
      ) : list.filter((p) => matchesQuery(query, [p.name, p.owner_name])).length === 0 ? (
        <div className="hint">No project of yours matches “{query}”.</div>
      ) : (
        <div className="recent-grid">
          {list.filter((p) => matchesQuery(query, [p.name, p.owner_name])).map((p) => (
            <div key={p.id} className="recent-card">
              <button className="recent-open" onClick={() => void open(p.id)} title={`Open ${p.name}`}>
                <span className="recent-name">{p.name}</span>
                <span className="recent-meta">
                  <span className="chip accent">{p.role === 'owner' ? 'Owner' : p.role === 'editor' ? 'Can edit' : 'Can view'}</span>
                  {p.members} member{p.members === 1 ? '' : 's'} · {p.role === 'owner' ? 'yours' : `by ${p.owner_name}`}
                </span>
                <span className="recent-time">edited {relativeTime(new Date(p.updated_at).getTime())}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Links to an example's original documentation, opened in a new tab. */
function SourceLinks({ links }: { links: { label: string; url: string }[] }) {
  if (!links.length) return null;
  return (
    <div className="source-links">
      {links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
    </div>
  );
}

/** What an example is about, as chips. */
export function ExampleTags({ tags }: { tags: string[] }) {
  return <div className="example-tags" aria-label="Topics">{tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>;
}

/** Examples from the R packages' documentation, filterable by package and by topic. */
function PackageExamples({ query }: { query: string }) {
  const [pkg, setPkg] = useState<ExamplePackage | 'all'>('all');
  const [topic, setTopic] = useState<string>('all');
  const topics = allTags(PACKAGE_EXAMPLES);
  const shown = PACKAGE_EXAMPLES.filter((e) => (pkg === 'all' || e.package === pkg) && (topic === 'all' || exampleTags(e).includes(topic)) && matchesQuery(query, [e.title, e.description, e.source, e.package, ...exampleTags(e)]));
  return (
    <section className="home-examples">
      <div className="section-head">
        <h2>From R packages</h2>
        <div className="segmented wrap" role="radiogroup" aria-label="Package">
          {(['all', ...EXAMPLE_PACKAGES] as const).map((p) => (
            <button key={p} role="radio" aria-checked={pkg === p} className={pkg === p ? 'on' : ''} onClick={() => setPkg(p)}>{p === 'all' ? 'All' : p}</button>
          ))}
        </div>
      </div>
      <div className="segmented wrap topics" role="radiogroup" aria-label="Topic">
        {['all', ...topics].map((t) => (
          <button key={t} role="radio" aria-checked={topic === t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>{t === 'all' ? 'All topics' : t}</button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Datasets and models from each package’s own documentation. The data are loaded from the package in your browser’s R; results are calculated by that package.</p>
      {shown.length === 0 && <p className="hint">No example{pkg === 'all' ? '' : ` of ${pkg}`}{topic === 'all' ? '' : ` on ${topic}`}{query.trim() ? ` matches “${query.trim()}”` : ''}.</p>}
      <div className="example-grid">
        {shown.map((e) => (
          <div key={e.id} className="example-card">
            <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.package}</span></div>
            <ExampleTags tags={exampleTags(e)} />
            <p>{e.description}</p>
            <span className="hint">{e.source}</span>
            <SourceLinks links={e.links} />
            <button className="btn" onClick={() => void loadPackageExample(e.id)}>Open example</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomeScreen() {
  const projectId = useStore((s) => s.projectId);
  const currentName = useStore((s) => s.projectName);
  const hasCurrent = useStore((s) => s.model.constructs.length > 0 || s.data !== null);
  const setView = useStore((s) => s.setView);
  const [recent, setRecent] = useState<RecentMeta[] | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [about, setAbout] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = () => { void listRecent().then(setRecent); };
  useEffect(() => {
    refresh();
    void recentPersistent().then(setPersistent);
  }, []);

  const remove = async (r: RecentMeta) => {
    const ok = await confirmDialog({
      title: 'Remove from Recent projects?',
      body: `“${r.name}” will be removed from this browser’s list. Project files you saved are not affected.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await removeRecent(r.id);
    refresh();
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand"><span className="brand-mark"><IconLogo size={17} /></span>PLS Studio</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a className="btn ghost" href="guide.html" target="_blank" rel="noopener">User guide</a>
          <a className="btn ghost" href="architecture.html" target="_blank" rel="noopener" title="For developers: how PLS Studio is designed and how it talks to R">How it works</a>
          <button className="btn ghost" onClick={() => setAbout(true)}>About &amp; licences</button>
          {hasCurrent && <button className="btn primary" onClick={() => setView('editor')}>Back to “{currentName}”</button>}
          <AccountMenu />
        </div>
      </header>
      <main className="home-body">
        <section className="home-intro">
          <h1>Structural equation modelling in your browser</h1>
          <p>PLS-SEM, consistent PLS and composites, and covariance-based SEM (ML, robust, least squares, MIIV-2SLS), validated against lavaan, seminr, cSEM, plspm and MIIVsem. Data stays on your computer.</p>
        </section>

        <section className="home-start">
          <h2>Start</h2>
          <div className="start-grid">
            <button className="start-card" onClick={() => void newProject()}>
              <IconNew size={22} /><b>New project</b><span>Empty model; import data next.</span>
            </button>
            <button className="start-card" onClick={() => void newProjectFromData()}>
              <IconUpload size={22} /><b>New project from data</b><span>CSV with one column per indicator, or a labelled covariance matrix.</span>
            </button>
            <button className="start-card" onClick={() => void openProject()}>
              <IconOpen size={22} /><b>Open project file…</b><span>A .plsproj.json file saved earlier.</span>
            </button>
          </div>
        </section>

        <section className="home-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects and examples"
            placeholder="Search your projects and the examples: words in the name, a topic (e.g. mediation, MIMIC, lavaan)…" />
        </section>

        <SharedProjects query={query} />

        <section className="home-recent">
          <h2>Recent projects</h2>
          {!persistent && <div className="issue warning">This browser does not allow local storage here, so recent projects are not kept between visits. Use Save to keep project files.</div>}
          {recent === null ? <div className="hint">Loading…</div> : recent.length === 0 ? (
            <div className="hint">No recent projects yet. Projects you work on are kept here automatically, in this browser only.</div>
          ) : recent.filter((r) => matchesQuery(query, [r.name, r.method, r.dataLabel])).length === 0 ? (
            <div className="hint">No recent project matches “{query}”.</div>
          ) : (
            <div className="recent-grid">
              {recent.filter((r) => matchesQuery(query, [r.name, r.method, r.dataLabel])).map((r) => (
                <div key={r.id} className={`recent-card${r.id === projectId && hasCurrent ? ' current' : ''}`}>
                  <button className="recent-open" onClick={() => void openRecent(r.id)} title={`Open ${r.name}`}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-meta">
                      <span className="chip accent">{r.method === 'cbsem' ? 'CB-SEM' : r.method === 'process' ? 'Process' : 'PLS-SEM'}</span>
                      {r.constructs} construct{r.constructs === 1 ? '' : 's'} · {r.dataLabel}
                    </span>
                    <span className="recent-time">{r.id === projectId && hasCurrent ? 'open now · ' : ''}edited {relativeTime(r.updated)}</span>
                  </button>
                  <button className="btn icon ghost sm" onClick={() => void remove(r)} aria-label={`Remove ${r.name} from recent projects`} title="Remove from list">
                    <IconTrash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {recent && recent.length > 0 && <div className="hint" style={{ marginTop: 8 }}>Kept in this browser only. Use Save in a project to keep a file you can share or back up; sign in and a project you open is saved to your account.</div>}
        </section>

        <section className="home-examples">
          <h2>Examples</h2>
          {EXAMPLES.filter((e) => matchesQuery(query, [e.title, e.body, ...e.tags])).length === 0 && <p className="hint">No built-in example matches “{query}”.</p>}
          <div className="example-grid">
            {EXAMPLES.filter((e) => matchesQuery(query, [e.title, e.body, ...e.tags])).map((e) => (
              <div key={e.id} className="example-card">
                <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.tags[0]}</span></div>
                <ExampleTags tags={e.tags} />
                <p>{e.body}</p>
                <SourceLinks links={e.links} />
                <button className="btn" onClick={() => void loadSample(e.id)}>Open example</button>
              </div>
            ))}
          </div>
        </section>

        <PackageExamples query={query} />
      </main>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </div>
  );
}
