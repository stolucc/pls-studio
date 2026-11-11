// Make parcels of a construct's items: item-to-construct balance (the usual choice), random, or by hand. Each parcel is
// a computed column (the mean of its items), and the construct is measured by the parcels instead of the items.

import { useMemo, useState } from 'react';
import { computeColumn, nameError } from '../data/compute';
import { transformData } from '../data/pipeline';
import {
  balanceParcels,
  itemLoadings,
  parcelExpr,
  parcelSizes,
  randomParcels,
  type ParcelMethod,
} from '../engine/parcels';
import { mean, mulberry32 } from '../engine/stats';
import { fmt } from '../format';
import type { Construct } from '../model/project';
import { useStore } from '../store';
import { IconX } from './icons';
import { useEscape } from './useEscape';

export function ParcelDialog({ c, onClose }: { c: Construct; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const seed0 = useStore((s) => s.settings.seed);
  const n = c.indicators.length;
  const [method, setMethod] = useState<ParcelMethod>('balance');
  const [k, setK] = useState(Math.min(3, Math.floor(n / 2)));
  const [seed, setSeed] = useState(seed0);
  const [manual, setManual] = useState<Record<string, number>>(() =>
    Object.fromEntries(c.indicators.map((i, r) => [i, r % Math.min(3, Math.floor(n / 2))])),
  );
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const loadings = useMemo(() => {
    if (!data) return null;
    try {
      return itemLoadings(data, c.indicators);
    } catch {
      return null;
    }
  }, [data, c.indicators]);
  const groups = useMemo((): string[][] => {
    if (method === 'balance') return loadings ? balanceParcels(loadings, k) : [];
    if (method === 'random')
      return randomParcels(c.indicators, parcelSizes(n, k), mulberry32(seed));
    // (an item assigned to a parcel beyond a lowered count goes to the last one, never out of every parcel)
    return Array.from({ length: k }, (_, p) =>
      c.indicators.filter((i) => Math.min(manual[i] ?? 0, k - 1) === p),
    );
  }, [method, loadings, k, seed, manual, c.indicators, n]);
  const loadingOf = (item: string) => loadings?.find((x) => x.item === item)?.loading ?? null;
  const base = c.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  const names = groups.map((_, p) => `${base}_P${p + 1}`);
  const weak = loadings?.filter((x) => x.loading < 0.3).map((x) => x.item) ?? [];

  const create = () => {
    if (!data || !info) return;
    if (groups.some((g) => g.length === 0)) {
      setError('Every parcel needs at least one item.');
      return;
    }
    if (groups.flat().length !== n) {
      setError('Every item must be in exactly one parcel.');
      return;
    }
    let next: ReturnType<typeof transformData>;
    try {
      // Computed over every case (the data filter applies afterwards).
      next = transformData(data, info, (base, baseInfo) => {
        let out = { data: base, info: baseInfo };
        for (let p = 0; p < groups.length; p++) {
          const clash = nameError(names[p], out.data, out.info);
          if (clash) throw new Error(`${names[p]}: ${clash}`);
          out = computeColumn(out.data, out.info, names[p], parcelExpr(groups[p]));
        }
        return out;
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const s = useStore.getState();
    s.setData(next.data, next.info);
    s.updateConstruct(c.id, { indicators: names });
    s.toast(
      'success',
      `${c.name} is measured by ${names.length} parcels now: ${names.join(', ')}. Undo restores its items.`,
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal parcel-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parcel-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-head">
          <h3 id="parcel-title">Parcels for {c.name}</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="hint">
          A parcel is the mean of a few items; the construct is then measured by its parcels. Use
          them only for a unidimensional construct whose items you are not testing: parcels can hide
          misfit and cross-loadings (Bandalos 2002; Marsh et al. 2013). Three parcels per construct
          are usual (Little et al. 2013).
        </p>
        <div className="field">
          <label>How items are assigned</label>
          <div className="segmented">
            <button
              className={method === 'balance' ? 'on' : ''}
              onClick={() => setMethod('balance')}
              title="Little et al. (2002): items ranked by their loading in a one-factor model, dealt to the parcels in serpentine order, so that the parcels are equally strong"
            >
              Balanced by loading
            </button>
            <button className={method === 'random' ? 'on' : ''} onClick={() => setMethod('random')}>
              Random
            </button>
            <button
              className={method === 'manual' ? 'on' : ''}
              onClick={() => setMethod('manual')}
              title="By content: items of one facet together (facet-representative), or each facet spread across the parcels (domain-representative)"
            >
              By hand
            </button>
          </div>
        </div>
        <div className="row2">
          <label className="field">
            Parcels
            <input
              className="input num"
              type="number"
              min={2}
              max={Math.max(2, n - 1)}
              value={k}
              onChange={(e) =>
                setK(
                  Math.min(
                    Math.max(2, n - 1),
                    Math.max(2, Math.round(Number(e.target.value) || 3)),
                  ),
                )
              }
            />
          </label>
          {method === 'random' && (
            <label className="field">
              Seed
              <input
                className="input num"
                type="number"
                value={seed}
                onChange={(e) => setSeed(Math.round(Number(e.target.value) || 0))}
              />
            </label>
          )}
        </div>
        {method === 'balance' && !loadings && (
          <div className="hint" role="alert">
            The one-factor model of these items could not be estimated, so they cannot be balanced
            by loading. Choose Random or By hand.
          </div>
        )}
        {weak.length > 0 && (
          <div className="hint" role="alert">
            Weak loadings (below 0.3): {weak.join(', ')}. Reverse-code negatively worded items first
            (Data → ƒ Compute…, e.g. 7 − x for a 1–6 scale), and drop items that do not belong.
          </div>
        )}
        {method === 'manual' ? (
          <table className="grid parcel-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Loading</th>
                <th>Parcel</th>
              </tr>
            </thead>
            <tbody>
              {c.indicators.map((i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td className="num">{loadingOf(i) === null ? '' : fmt(loadingOf(i)!)}</td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Parcel of ${i}`}
                      value={Math.min(manual[i] ?? 0, k - 1)}
                      onChange={(e) => setManual({ ...manual, [i]: Number(e.target.value) })}
                    >
                      {Array.from({ length: k }, (_, p) => (
                        <option key={p} value={p}>
                          {names[p] ?? `P${p + 1}`}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="grid parcel-table">
            <thead>
              <tr>
                <th>Parcel</th>
                <th>Items</th>
                <th>Mean loading</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, p) => {
                const ls = g.map(loadingOf).filter((v): v is number => v !== null);
                return (
                  <tr key={p}>
                    <td>{names[p]}</td>
                    <td>{g.join(', ')}</td>
                    <td className="num">{ls.length ? fmt(mean(ls)) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {error && (
          <div className="hint" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        <p className="hint">
          The parcels are computed columns (Data tab), so they follow the items. Check how much the
          results depend on the assignment with the card Parcel allocation variability (Analyses
          tab).
        </p>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={create}
            disabled={!data || !info || groups.length < 2 || (method === 'balance' && !loadings)}
          >
            Make {groups.length} parcels
          </button>
        </div>
      </div>
    </div>
  );
}

/** The button in a common factor's panel that opens the dialog. */
export function ParcelButton({ c }: { c: Construct }) {
  const [open, setOpen] = useState(false);
  const hasData = useStore((s) => !!s.data && s.data.cols.length > 0);
  return (
    <>
      <button
        className="btn"
        disabled={!hasData}
        onClick={() => setOpen(true)}
        title={
          hasData
            ? 'Average the items in groups and use those parcels as the indicators'
            : 'Parcels need raw data'
        }
      >
        Make parcels…
      </button>
      {open && <ParcelDialog c={c} onClose={() => setOpen(false)} />}
    </>
  );
}
