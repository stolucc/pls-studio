import { useEffect, useState } from 'react';
import { loadPackageExample, loadSample, newProject, newProjectFromData, openProject, openRecent } from '../io';
import { PACKAGE_EXAMPLES, type ExamplePackage } from '../examples/packages';
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
    tag: 'PLS-SEM',
    links: [] as { label: string; url: string }[],
    body: 'Synthetic survey (N = 300) with service quality, price fairness, trust, satisfaction and loyalty. Raw data with a few missing values: try PLS, PLSc, bootstrapping, IPMA, moderation and the fit test.',
  },
  {
    id: 'emse' as const,
    title: 'Gamification in software engineering',
    tag: 'CB-SEM',
    links: [{ label: 'Paper (EMSE 27:35)', url: 'https://doi.org/10.1007/s10664-021-10062-w' }, { label: 'Replication package (Zenodo)', url: 'https://doi.org/10.5281/zenodo.6322761' }],
    body: 'Stol, Schaarschmidt & Goldblit (2022), Empirical Software Engineering 27:35. The published model from the replication package’s covariance and NACOV matrices (N = 155): second-order engagement factor, covariates, robust MLM, MIIV-2SLS.',
  },
  {
    id: 'poldem' as const,
    title: 'Industrialisation and political democracy',
    tag: 'CB-SEM',
    links: [{ label: '?PoliticalDemocracy (lavaan)', url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html' }, { label: 'lavaan tutorial: SEM', url: 'https://lavaan.ugent.be/tutorial/sem.html' }],
    body: 'Bollen (1989), Structural Equations with Latent Variables: 75 developing countries, democracy measured in 1960 and 1965. The classic model with six correlated measurement errors, drawn as double-headed arrows between error terms.',
  },
];

interface CloudProject { id: string; name: string; role: 'owner' | 'editor' | 'viewer'; owner_name: string; members: number; updated_at: string }

function SharedProjects() {
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
        <h2>Shared projects</h2>
        <div className="start-card" style={{ cursor: 'default' }}>
          <b>Work together on a project</b>
          <span>Sign in to share projects with collaborators and edit them together in real time. Shared datasets are stored encrypted on the PLS Studio server.</span>
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
      <h2>Shared projects</h2>
      {list === null ? <div className="hint">Loading…</div> : list.length === 0 ? (
        <div className="hint">No shared projects yet. Open a project and use Share to invite people.</div>
      ) : (
        <div className="recent-grid">
          {list.map((p) => (
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

const PACKAGES: ExamplePackage[] = ['lavaan', 'MIIVsem', 'cSEM', 'seminr'];

/** Examples from the R packages' documentation, filterable by package. */
function PackageExamples() {
  const [pkg, setPkg] = useState<ExamplePackage | 'all'>('all');
  const shown = PACKAGE_EXAMPLES.filter((e) => pkg === 'all' || e.package === pkg);
  return (
    <section className="home-examples">
      <div className="section-head">
        <h2>From R packages</h2>
        <div className="segmented" role="radiogroup" aria-label="Package" style={{ width: 380 }}>
          {(['all', ...PACKAGES] as const).map((p) => (
            <button key={p} role="radio" aria-checked={pkg === p} className={pkg === p ? 'on' : ''} onClick={() => setPkg(p)}>{p === 'all' ? 'All' : p}</button>
          ))}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Datasets and models from each package’s own documentation. The data are loaded from the package in your browser’s R; results are calculated by that package.</p>
      <div className="example-grid">
        {shown.map((e) => (
          <div key={e.id} className="example-card">
            <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.package}</span></div>
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

        <SharedProjects />

        <section className="home-recent">
          <h2>Recent projects</h2>
          {!persistent && <div className="issue warning">This browser does not allow local storage here, so recent projects are not kept between visits. Use Save to keep project files.</div>}
          {recent === null ? <div className="hint">Loading…</div> : recent.length === 0 ? (
            <div className="hint">No recent projects yet. Projects you work on are kept here automatically, in this browser only.</div>
          ) : (
            <div className="recent-grid">
              {recent.map((r) => (
                <div key={r.id} className={`recent-card${r.id === projectId && hasCurrent ? ' current' : ''}`}>
                  <button className="recent-open" onClick={() => void openRecent(r.id)} title={`Open ${r.name}`}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-meta">
                      <span className="chip accent">{r.method === 'cbsem' ? 'CB-SEM' : 'PLS-SEM'}</span>
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
          {recent && recent.length > 0 && <div className="hint" style={{ marginTop: 8 }}>Kept in this browser only. Use Save in a project to keep a file you can share or back up.</div>}
        </section>

        <section className="home-examples">
          <h2>Examples</h2>
          <div className="example-grid">
            {EXAMPLES.map((e) => (
              <div key={e.id} className="example-card">
                <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.tag}</span></div>
                <p>{e.body}</p>
                <SourceLinks links={e.links} />
                <button className="btn" onClick={() => void loadSample(e.id)}>Open example</button>
              </div>
            ))}
          </div>
        </section>

        <PackageExamples />
      </main>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </div>
  );
}
