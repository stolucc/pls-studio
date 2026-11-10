// SEM tree card (semtree; Brandmaier et al. 2013): the CB-SEM model on the canvas split recursively on chosen
// covariates into groups whose parameters differ most; every node is the model estimated in its cases. Drawn as a tree
// (SVG in a ChartFrame), with each node's estimates; optionally a SEM forest's permutation variable importance.
// semtree runs on OpenMx: desktop R only.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { NEGATIVE_COLOR, POSITIVE_COLOR, OTHER_COLOR } from '../figure/palette';
import { fmt } from '../format';
import { useCompute } from '../rengine/compute';
import { useStore } from '../store';
import type { CovariateType, SemTreeCovariate, SemTreeNode, SemTreeResult } from '../rengine/semtree';
import { fingerprint } from './codec';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { Choice, clampNum, columnsFingerprint, flag, isObj, name, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface SemTreeOptions {
  covariates: SemTreeCovariate[]; method: 'naive' | 'score' | 'fair'; alpha: number; maxDepth: number; minN: number;
  forest: boolean; trees: number;
}
const TYPES: [CovariateType, string][] = [['numeric', 'Numeric'], ['ordered', 'Ordered'], ['categorical', 'Categorical']];
const modelVars = (ctx: AnalysisCtx) => new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators));

/** A covariate's likely scale: categories or two values → categorical; a few whole numbers → ordered; else numeric. */
export function guessType(col: ArrayLike<number>, labelled: boolean): CovariateType {
  const vals = new Set<number>();
  for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) { vals.add(col[i]); if (vals.size > 10) return 'numeric'; }
  if (labelled || vals.size <= 2) return 'categorical';
  return [...vals].every(Number.isInteger) ? 'ordered' : 'numeric';
}

// ---------- the tree's layout ----------

export interface TreeLayout { x: Map<number, number>; depth: Map<number, number>; leaves: number; depthMax: number }
/** Leaves side by side in order (the rule's false side first), each split centred over its two children. */
export function treeLayout(nodes: SemTreeNode[]): TreeLayout {
  const kids = (id: number) => nodes.filter((n) => n.parent === id).sort((a, b) => (a.edge ?? 0) - (b.edge ?? 0));
  const x = new Map<number, number>(), depth = new Map<number, number>();
  let next = 0, depthMax = 0;
  const visit = (n: SemTreeNode, d: number): number => {
    depth.set(n.id, d); depthMax = Math.max(depthMax, d);
    const ch = kids(n.id);
    const v = ch.length ? ch.map((k) => visit(k, d + 1)).reduce((a, b) => a + b, 0) / ch.length : next++;
    x.set(n.id, v);
    return v;
  };
  const root = nodes.find((n) => n.parent === undefined);
  if (root) visit(root, 0);
  return { x, depth, leaves: next, depthMax };
}

/** The condition on one side of a split: semtree's left child is the rule false, the right child true. */
export function edgeLabel(rule: NonNullable<SemTreeNode['rule']>, edge: 0 | 1, labels?: string[]): string {
  const v = rule.value.map((x) => (labels && /^\d+$/.test(x) && labels[Number(x) - 1] !== undefined ? labels[Number(x) - 1] : x));
  if (rule.relation === '%in%') return `${rule.variable} ${edge ? '∈' : '∉'} {${v.join(', ')}}`;
  if (rule.relation === '>') return `${rule.variable} ${edge ? '>' : '≤'} ${v.join(', ')}`;
  if (rule.relation === '>=') return `${rule.variable} ${edge ? '≥' : '<'} ${v.join(', ')}`;
  return `${edge ? '' : 'not '}${rule.variable} ${rule.relation} ${v.join(', ')}`;
}

const pText = (p?: number) => (p === undefined ? '' : p < 0.001 ? 'p < .001' : `p = ${fmt(p, 3)}`);
const paramName = (p: SemTreeNode['params'][number]) => (p.op === '~1' ? `${p.lhs} (mean)` : `${p.lhs} ${p.op} ${p.rhs}`);

function TreeChart({ r, picked, pick, labels }: { r: SemTreeResult; picked: number; pick: (id: number) => void; labels: Record<string, string[]> }) {
  const L = treeLayout(r.nodes);
  const BW = 150, BH = 54, GAP = 24, LEVEL = 110, M = 16;
  const W = Math.max(420, L.leaves * (BW + GAP) + 2 * M), H = (L.depthMax + 1) * LEVEL + BH - LEVEL + 2 * M + 20;
  const cx = (id: number) => M + BW / 2 + L.x.get(id)! * (BW + GAP) + (W - 2 * M - L.leaves * (BW + GAP) + GAP) / 2;
  const cy = (id: number) => M + L.depth.get(id)! * LEVEL;
  return (
    <ChartFrame id="semtree:tree" name="sem-tree" width={W} height={H} defaults={{ x: '', y: '' }} axes={false}
      caption={<span className="hint">Each split: the covariate and cut that separate the groups whose model parameters differ most (likelihood ratio LR on df parameters). Left branch: the condition false. Click a node for its estimates below.</span>}>
      {() => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="SEM tree">
          {r.nodes.filter((n) => n.parent !== undefined).map((n) => {
            const p = r.nodes.find((q) => q.id === n.parent)!;
            const x1 = cx(p.id), y1 = cy(p.id) + BH, x2 = cx(n.id), y2 = cy(n.id);
            return (
              <g key={`e${n.id}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={OTHER_COLOR} strokeWidth={1.5} />
                {p.rule && <text x={(x1 + x2) / 2 + (n.edge ? 6 : -6)} y={(y1 + y2) / 2} textAnchor={n.edge ? 'start' : 'end'} fontSize="0.85em">{edgeLabel(p.rule, n.edge ?? 0, labels[p.rule.variable])}</text>}
              </g>
            );
          })}
          {r.nodes.map((n) => {
            const x = cx(n.id) - BW / 2, y = cy(n.id), on = n.id === picked;
            return (
              <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => pick(n.id)} role="button" aria-label={`Node ${n.id}`}>
                <rect x={x} y={y} width={BW} height={BH} rx={6} fill="var(--surface, #f6f7f9)" stroke={on ? NEGATIVE_COLOR : n.terminal ? POSITIVE_COLOR : OTHER_COLOR} strokeWidth={on ? 2.5 : 1.5} />
                <text x={x + BW / 2} y={y + 17} textAnchor="middle" fontWeight={600}>{n.terminal ? `Node ${n.id}` : n.rule?.variable ?? `Node ${n.id}`}</text>
                <text x={x + BW / 2} y={y + 33} textAnchor="middle" fontSize="0.85em">N = {n.n}</text>
                {!n.terminal && <text x={x + BW / 2} y={y + 47} textAnchor="middle" fontSize="0.8em">LR {fmt(n.lr ?? NaN, 1)}, {pText(n.p)}</text>}
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

function ImportanceChart({ f }: { f: NonNullable<SemTreeResult['forest']> }) {
  const rows = f.variables.map((v, i) => ({ v, imp: f.importance[i] })).sort((a, b) => (b.imp ?? -Infinity) - (a.imp ?? -Infinity));
  const W = 520, bar = 26, padL = 130, padR = 70, H = rows.length * bar + 50;
  const max = Math.max(1e-12, ...rows.map((x) => Math.abs(x.imp ?? 0)));
  const sx = (v: number) => padL + (Math.max(0, v) / max) * (W - padL - padR);
  return (
    <ChartFrame id="semtree:importance" name="semforest-importance" width={W} height={H} defaults={{ x: 'Permutation importance', y: '' }}
      caption={<span className="hint">The loss in the forest’s log-likelihood when a covariate’s values are permuted, averaged over the {f.trees} trees that used it (semtree::varimp); a covariate no tree split on has none.</span>}>
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="Variable importance">
          {rows.map((x, i) => (
            <g key={x.v}>
              <text x={padL - 8} y={14 + i * bar + bar / 2} textAnchor="end">{x.v}</text>
              {x.imp !== null && <rect x={padL} y={14 + i * bar + 4} width={Math.max(1, sx(x.imp) - padL)} height={bar - 8} fill={POSITIVE_COLOR}><title>{`${x.v}: ${fmt(x.imp, 2)}`}</title></rect>}
              <text x={x.imp === null ? padL + 4 : sx(x.imp) + 4} y={14 + i * bar + bar / 2 + 4} fontSize="0.85em">{x.imp === null ? 'not used' : fmt(x.imp, 1)}</text>
            </g>
          ))}
          <text x={padL + (W - padL - padR) / 2} y={H - 6} textAnchor="middle" className="axis-title">{labels.x}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function SemTreeView({ r }: { r: SemTreeResult }) {
  const [picked, setPicked] = useState(r.nodes[0]?.id ?? 1);
  // (category labels of coded covariates, for the split conditions)
  const cats = useStore((s) => s.data?.categories) ?? {};
  const node = r.nodes.find((n) => n.id === picked) ?? r.nodes[0];
  const leaves = r.nodes.filter((n) => n.terminal);
  const path = (n: SemTreeNode): string[] => { const p = r.nodes.find((q) => q.id === n.parent); return p?.rule ? [...path(p), edgeLabel(p.rule, n.edge ?? 0, cats[p.rule.variable])] : []; };
  const leafRows: Row[] = (leaves[0]?.params ?? []).map((p, k) => [c(paramName(p)), ...leaves.map((l) => c(l.params[k]?.est ?? null))]);
  const splits = r.nodes.filter((n) => !n.terminal);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.n} cases; {splits.length} split{splits.length === 1 ? '' : 's'}, {leaves.length} leaves; splits by {r.method === 'naive' ? 'likelihood-ratio tests of every cut' : r.method === 'score' ? 'score-based tests' : 'the fair two-stage selection'} at α = {r.alpha}, depth at most {r.maxDepth}, nodes of at least {r.minN} cases. semtree {r.engine.version}{r.engine.openmx ? `, OpenMx ${r.engine.openmx}` : ''}{r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.</p>
      <TreeChart r={r} picked={node.id} pick={setPicked} labels={cats} />
      {splits.length > 0 && <Table title="Splits" file="semtree-splits" columns={['Node', 'Covariate', 'Cases', 'LR', 'df', 'p']}
        rows={splits.map((n) => [c(n.id, undefined, 0), c(n.rule ? edgeLabel(n.rule, 1, cats[n.rule.variable]) : ''), c(n.n, undefined, 0), c(n.lr ?? null, undefined, 2), c(n.df ?? null, undefined, 0), pCell(n.p ?? NaN)])}
        note="Each split’s likelihood-ratio test: the model fitted separately in the two groups against one model for both (df: the model’s free parameters). The p value is that of the best cut, not corrected for having searched the cuts (semtree’s naive selection)." />}
      <Table title={`Node ${node.id}${node.terminal ? ' (leaf)' : ''}: N = ${node.n}${path(node).length ? `, ${path(node).join(' and ')}` : ' (all cases)'}`} file={`semtree-node-${node.id}`} columns={['Parameter', 'Estimate']}
        rows={node.params.map((p) => [c(paramName(p)), c(p.est)])} note="The model’s free parameters estimated in this node’s cases (semtree’s node estimates); click another node in the tree to show its own." />
      {leaves.length > 1 && <Table title="Estimates by leaf" file="semtree-leaves" columns={['Parameter', ...leaves.map((l) => `Node ${l.id} (N = ${l.n})`)]} rows={leafRows}
        note={leaves.map((l) => `Node ${l.id}: ${path(l).join(' and ') || 'all cases'}`).join('; ') + '.'} />}
      {r.forest && <>
        <ImportanceChart f={r.forest} />
        <Table title="Variable importance (SEM forest)" file="semforest-importance" columns={['Covariate', 'Importance']}
          rows={r.forest.variables.map((v, i) => [c(v), c(r.forest!.importance[i], undefined, 2)])}
          note={`A forest of ${r.forest.trees} trees, each on a subsample of the cases and a random subset of the covariates (semforest, seed ${r.forest.seed}); importance by permutation (varimp).`} />
      </>}
    </div>
  );
}

function SemTreeForm({ options: o, set, ctx, disabled }: OptionsProps<SemTreeOptions>) {
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const used = modelVars(ctx);
  const free = ds.names.filter((n) => !used.has(n) && !o.covariates.some((c) => c.name === n));
  const add = (name: string) => { const k = ds.names.indexOf(name); if (k >= 0) set({ ...o, covariates: [...o.covariates, { name, type: guessType(ds.cols[k], !!ds.categories?.[name]) }] }); };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>SEM trees (semtree): the CB-SEM model on the canvas, split on covariates into groups whose parameters differ most. Covariates are columns outside the model. Runs in desktop R (OpenMx).</p>
      <div className="field"><label>Covariates</label>
        {o.covariates.map((cv, i) => (
          <div key={cv.name} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ minWidth: 100 }}>{cv.name}</span>
            <select className="select" style={{ width: 'auto' }} aria-label={`Scale of ${cv.name}`} value={cv.type} onChange={(e) => set({ ...o, covariates: o.covariates.map((x, j) => (j === i ? { ...x, type: e.target.value as CovariateType } : x)) })}>{TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
            <button className="btn sm ghost" aria-label={`Remove ${cv.name}`} title="Remove" onClick={() => set({ ...o, covariates: o.covariates.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <select className="select" aria-label="Add a covariate" value="" onChange={(e) => add(e.target.value)}>
          <option value="">{free.length ? 'Add a covariate…' : 'No other columns'}</option>
          {free.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="hint">Numeric and ordered covariates are split at a cut (≤ / &gt;); categorical ones into two sets of categories.</div>
      </div>
      <Choice label="Split selection" value={o.method} options={[['naive', 'Likelihood ratio'], ['score', 'Score-based'], ['fair', 'Fair']]} onChange={(method) => set({ ...o, method })}
        hint={o.method === 'naive' ? 'Every cut of every covariate compared by its likelihood-ratio test (semtree’s default; exhaustive, favours covariates with many cuts).' : o.method === 'score' ? 'Score-based tests (Arnold et al. 2021): fast and unbiased between covariates; not with equality constraints between parameters.' : 'Half the sample chooses each covariate’s best cut, the other half compares the covariates (Brandmaier et al. 2013).'} />
      <div className="row2">
        <div className="field"><label>α</label><input className="input num" type="number" aria-label="α" min={0.0001} max={0.5} step={0.01} value={o.alpha} onChange={(e) => set({ ...o, alpha: clampNum(e.target.value, 0.0001, 0.5, 0.05) })} /></div>
        <div className="field"><label>Depth at most</label><input className="input num" type="number" aria-label="Depth at most" min={1} max={10} value={o.maxDepth} onChange={(e) => set({ ...o, maxDepth: clampNum(e.target.value, 1, 10, 3, true) })} /></div>
        <div className="field"><label>Cases per node at least</label><input className="input num" type="number" aria-label="Cases per node at least" min={2} max={100000} value={o.minN} onChange={(e) => set({ ...o, minN: clampNum(e.target.value, 2, 100000, 20, true) })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={o.forest} onChange={(e) => set({ ...o, forest: e.target.checked })} /> SEM forest and variable importance</label>
      {o.forest && <div className="field"><label>Trees</label><input className="input num" type="number" aria-label="Trees" min={2} max={1000} value={o.trees} onChange={(e) => set({ ...o, trees: clampNum(e.target.value, 2, 1000, 50, true) })} />
        <div className="hint">Each tree is grown on a subsample with a random subset of the covariates; the seed is the project’s. A forest takes about a tree’s time per tree.</div></div>}
    </fieldset>
  );
}

const inputOf = (o: SemTreeOptions, ctx: AnalysisCtx) => ({ covariates: o.covariates, method: o.method, alpha: o.alpha, maxDepth: o.maxDepth, minN: o.minN, ...(o.forest ? { forest: { trees: o.trees, seed: ctx.settings.seed } } : {}) });

export const semTreeAnalysis: AnalysisType<SemTreeOptions, SemTreeResult> = {
  id: 'semtree', title: 'SEM trees (semtree)', group: 'CB-SEM model',
  sub: 'the model on the canvas split on covariates into groups with different parameters; SEM forest variable importance; desktop R',
  fitsModel: true,
  defaults: () => ({ covariates: [], method: 'naive', alpha: 0.05, maxDepth: 3, minN: 20, forest: false, trees: 50 }),
  parseOptions: (raw) => (isObj(raw) ? {
    covariates: (Array.isArray(raw.covariates) ? raw.covariates.slice(0, 50) : []).filter(isObj).map((x) => ({ name: name(x.name), type: oneOf(x.type, TYPES.map(([t]) => t), 'numeric') }))
      .filter((x, i, all) => x.name && all.findIndex((y) => y.name === x.name) === i),
    method: oneOf(raw.method, ['naive', 'score', 'fair'] as const, 'naive'), alpha: clampNum(raw.alpha, 0.0001, 0.5, 0.05), maxDepth: clampNum(raw.maxDepth, 1, 10, 3, true), minN: clampNum(raw.minN, 2, 100000, 20, true),
    forest: flag(raw.forest), trees: clampNum(raw.trees, 2, 1000, 50, true),
  } : null),
  Options: SemTreeForm,
  View: ({ result }) => <SemTreeView r={result} />,
  blocked: (o, ctx) => {
    if (useCompute.getState().backend !== 'helper') return 'SEM trees run in desktop R (semtree needs OpenMx, which does not run in the browser): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    const m = cbModelBlocked(ctx, 'SEM trees');
    if (m) return m;
    if (ctx.model?.multigroup) return 'SEM trees split one sample: remove the grouping (and add the grouping column as a covariate).';
    if (!o.covariates.length) return 'Choose the covariates to split on.';
    const ds = rawData(ctx)!;
    const gone = o.covariates.filter((c) => !ds.names.includes(c.name));
    if (gone.length) return `Not in the data: ${gone.map((c) => c.name).join(', ')}.`;
    const inModel = o.covariates.filter((c) => modelVars(ctx).has(c.name));
    return inModel.length ? `${inModel.map((c) => c.name).join(', ')} ${inModel.length === 1 ? 'is a variable' : 'are variables'} of the model, not a covariate.` : null;
  },
  fingerprint: (o, ctx) => {
    const m = cbFingerprint(ctx), cols = columnsFingerprint(ctx, o.covariates.map((c) => c.name));
    return m && cols && fingerprint([m, cols, o.forest ? ctx.settings.seed : null]);
  },
  run: async (o, ctx) => (await import('../rengine/semtree')).semTreeR(cbCall(ctx), inputOf(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/semtree')).semTreeScriptR(cbCall(ctx), inputOf(o, ctx)),
  summary: (o) => `${o.covariates.map((c) => c.name).join(', ') || 'no covariates'}${o.forest ? ` · forest of ${o.trees}` : ''}`,
};
