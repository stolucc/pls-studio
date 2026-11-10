import { useEffect, useState } from 'react';
import thirdParty from '../generated/third-party.json';
import { safeUrl } from '../format';
import { IconX } from './icons';
import { useEscape } from './useEscape';

interface RLicences {
  webr: { version: string; r: string; license: string; source: string | null; url: string };
  packages: { name: string; version: string; license: string; source: string | null; url: string; note?: string }[];
}

const base = `${import.meta.env.BASE_URL}webr/`;

/** Licences and sources of PLS Studio and everything it ships (GPL: source of every served component). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<RLicences | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`${base}licenses.json`).then((res) => (res.ok ? res.json() : Promise.reject())).then(setR).catch(() => setFailed(true));
  }, []);
  useEscape(onClose);
  const link = (url: string, label: string) => (safeUrl(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : label);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="share-head">
          <h3 id="about-title">About PLS Studio</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <p>
          Free software under the GNU General Public License, version 2 or (at your option) any later version.
          Source code: {link(thirdParty.app.url, thirdParty.app.url.replace('https://', ''))}.
        </p>
        <p className="hint">Calculations run in your browser with the R packages below (via webR). They keep their own licences; the source of each version served here is available below.</p>

        <h4>R runtime and packages</h4>
        {failed && <div className="issue warning">The R component list (webr/licenses.json) is not available in this build.</div>}
        {r && (
          <>
            <p className="hint">
              webR {r.webr.version} (R {r.webr.r}): {r.webr.license}. {r.webr.source ? <a href={base + r.webr.source} download>Source</a> : link(r.webr.url, 'Source')}
            </p>
            <div className="about-table">
              <table className="grid">
                <thead><tr><th>Package</th><th>Version</th><th>Licence</th><th>Source</th></tr></thead>
                <tbody>
                  {r.packages.map((p) => (
                    <tr key={p.name}>
                      <td>{link(p.url, p.name)}</td><td className="num">{p.version}</td><td>{p.license}</td>
                      <td>{p.source ? <a href={base + p.source} download>{p.source.replace('src/', '')}</a> : <span title={p.note}>{link(p.url, 'upstream')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h4>JavaScript libraries</h4>
        <p className="hint">{thirdParty.npm.map((p, i) => <span key={p.name}>{i ? ', ' : ''}{link(p.url, p.name)} {p.version} ({p.license})</span>)}</p>
        <h4>Fonts</h4>
        <p className="hint">{thirdParty.fonts.map((f, i) => <span key={f.name}>{i ? ', ' : ''}{link(f.url, f.name)} ({f.license})</span>)}</p>
        <h4>Datasets</h4>
        <ul className="hint about-list">
          {thirdParty.datasets.map((d) => <li key={d.name}><b>{d.name}</b> ({d.license}). {d.credit} {d.url && link(d.url, '↗')}</li>)}
        </ul>
        <h4>Published sources</h4>
        <p className="hint">The examples use numbers from these publications: matrices typed from the publication or its companion files as data, and printed estimates and fit statistics as the references the validation compares with. Only numbers are used; no text, tables or figures are reproduced.</p>
        <ul className="hint about-list">
          {thirdParty.publishedSources.map((p) => <li key={p.credit}>{p.credit} <i>{p.use}</i> {p.url && link(p.url, '↗')}</li>)}
        </ul>
        <h4>Trademarks</h4>
        <p className="hint">{thirdParty.trademarkNotice}</p>
        <ul className="hint about-list">
          {thirdParty.trademarks.map((t) => <li key={t.name}><b>{t.name}</b>: {t.owner}</li>)}
        </ul>
      </div>
    </div>
  );
}
