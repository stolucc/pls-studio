// What the canvas's context menu actions do (canvasMenu.ts decides which each target offers): edits through the
// store, and dialogs for values, labels and held parameters.

import { newId, endogenousIds } from '../../model/project';
import { heldText, parseHeldValue, type HeldValue } from '../../model/heldValue';
import { nameError } from '../../model/expr';
import { useStore } from '../../store';
import { heldOf, type MenuAction, type MenuTarget } from '../canvasMenu';
import type { CorrelationPick } from '../CovarianceLayer';
import { formDialog, numberDialog, textDialog } from '../Overlays';

/** What the canvas offers the menu actions: the correlation tool and its dialogs. */
export interface MenuUi {
  startCorrelate: (p: CorrelationPick) => void;
  setParcelFor: (id: string) => void;
  setFigureOpen: (open: boolean) => void;
  setTemplatesOpen: (open: boolean) => void;
}

const st = useStore.getState;
/** The parameter a menu target stands for: a path coefficient, a loading or a drawn covariance. */
const paramOf = (target: MenuTarget): Parameters<ReturnType<typeof st>['fixParameter']>[0] | null =>
  target.kind === 'path' ? { kind: 'path', id: target.id }
    : target.kind === 'indicator' ? { kind: 'loading', construct: target.construct, indicator: target.name }
      : target.kind === 'correlation' ? { kind: 'correlation', id: target.id } : null;
const fixValue = async (target: MenuTarget) => {
  const t = paramOf(target);
  if (!t) return;
  const m = st().model;
  const current = t.kind === 'path' ? m.paths.find((p) => p.id === t.id)?.fixed
    : t.kind === 'correlation' ? m.correlations?.find((k) => k.id === t.id)?.fixed
      : m.constructs.find((c) => c.id === t.construct)?.fixedLoadings?.[t.indicator];
  const what = t.kind === 'path' ? 'coefficient' : t.kind === 'loading' ? 'loading' : 'covariance';
  const v = await numberDialog({
    title: `Fix the ${what} at a value`,
    body: `CB-SEM holds it at this unstandardised value instead of estimating it (lavaan: value*name), one fewer free parameter. Use it to test a hypothesised value or to set a scale.`,
    confirmLabel: 'Fix',
    field: { label: 'Value', min: -1e6, max: 1e6, initial: current !== undefined ? String(current) : '' },
  });
  if (v !== null) st().fixParameter(t, v);
};
const setLabel = async (target: MenuTarget) => {
  const t = paramOf(target);
  if (!t) return;
  const m = st().model;
  const current = t.kind === 'path' ? m.paths.find((p) => p.id === t.id)?.label
    : t.kind === 'correlation' ? m.correlations?.find((k) => k.id === t.id)?.label
      : m.constructs.find((c) => c.id === t.construct)?.loadingLabels?.[t.indicator];
  const variables = new Set([...m.constructs.map((c) => c.name), ...m.constructs.flatMap((c) => c.indicators)]);
  const label = await textDialog({
    title: 'Label this parameter',
    body: 'Parameters with the same label are constrained to be equal. Labels can be used in defined parameters (e.g. ind := a*b) and Wald tests (Model inspector). Leave empty to remove the label.',
    confirmLabel: 'Apply',
    text: { label: 'Label', initial: current ?? '', allowEmpty: true, check: (x) => nameError(x) ?? (variables.has(x) ? 'A label must differ from construct and variable names.' : null) },
  });
  if (label !== null) st().setLabel(t, label || null);
};
// Held or labelled variances, intercepts, thresholds and values per group: one text field (heldValue.ts).
const HELD_HINT = 'A number holds it at that value; a name labels it (equal labels are equal; usable in defined parameters and constraints); empty estimates it freely.';
const GROUP_HINT = ' With groups, one entry per group separated by commas (a number, NA for free, or a label), e.g. 1, NA, a.';
const heldOpts = () => {
  const m = st().model;
  return { groups: !!m.multigroup, reserved: new Set([...m.constructs.map((c) => c.name), ...m.constructs.flatMap((c) => c.indicators)]) };
};
const checkHeld = (x: string) => { const r = parseHeldValue(x, heldOpts()); return r && 'error' in r ? r.error : null; };
const heldDialog = async (title: string, body: string, initial: string): Promise<HeldValue | undefined> => {
  const text = await textDialog({ title, body: `${body} ${HELD_HINT}${heldOpts().groups ? GROUP_HINT : ''}`, confirmLabel: 'Apply', text: { label: 'Value or label', initial, allowEmpty: true, check: checkHeld } });
  return text === null ? undefined : parseHeldValue(text, heldOpts()) as HeldValue;
};
const heldParameter = async (target: MenuTarget, kind: 'variance' | 'intercept' | 'threshold') => {
  const m = st().model;
  if (target.kind === 'indicator') {
    if (kind === 'threshold') {
      const first = heldOf(m, { kind, target: target.name, indicator: true, threshold: 1 });
      const values = await formDialog({
        title: `A threshold of ${target.name}`,
        body: `Threshold k separates categories k and k + 1 of the ordinal indicator (lavaan ${target.name} | t1; Mplus [${target.name}$1]). ${HELD_HINT}${heldOpts().groups ? GROUP_HINT : ''}`,
        confirmLabel: 'Apply',
        fields: [
          { label: 'Threshold', initial: '1', check: (x) => (/^\d{1,2}$/.test(x) && Number(x) >= 1 ? null : 'A threshold number: 1, 2, …') },
          // (the value of the threshold the first field names, refilled when that number changes)
          { label: 'Value or label', initial: heldText(first), check: (x) => checkHeld(x),
            follow: (all, changed) => (changed === 0 && /^\d{1,2}$/.test(all[0]) && Number(all[0]) >= 1
              ? heldText(heldOf(st().model, { kind, target: target.name, indicator: true, threshold: Number(all[0]) })) : undefined) },
        ],
      });
      if (values) st().setHeldParameter({ kind, target: target.name, indicator: true, threshold: Number(values[0]) }, parseHeldValue(values[1], heldOpts()) as HeldValue);
      return;
    }
    const key = { kind, target: target.name, indicator: true };
    const what = kind === 'variance' ? `the error variance of ${target.name}` : `the intercept of ${target.name}`;
    const v = await heldDialog(kind === 'variance' ? `Error variance of ${target.name}` : `Intercept of ${target.name}`,
      `Hold or label ${what} (lavaan ${kind === 'variance' ? `${target.name} ~~ v*${target.name}` : `${target.name} ~ i*1`}; Mplus ${kind === 'variance' ? `${target.name} (v)` : `[${target.name}] (i)`}).`, heldText(heldOf(m, key)));
    if (v !== undefined) st().setHeldParameter(key, v);
    return;
  }
  const id = target.kind === 'construct' || target.kind === 'disturbance' ? target.id : null;
  const c = id ? m.constructs.find((k) => k.id === id) : undefined;
  if (!c) return;
  const disturbance = endogenousIds(m).has(c.id);
  const key = { kind: 'variance' as const, target: c.id };
  const v = await heldDialog(disturbance ? `Disturbance variance of ${c.name}` : `Variance of ${c.name}`,
    `Hold or label the ${disturbance ? 'variance of the disturbance (what its predictors leave unexplained)' : 'variance'} of ${c.name} (lavaan ${c.name} ~~ v*${c.name}; Mplus ${c.name}@1 or ${c.name} (v)).`, heldText(heldOf(m, key)));
  if (v !== undefined) st().setHeldParameter(key, v);
};
const groupValues = async (target: MenuTarget) => {
  if (target.kind !== 'correlation') return;
  const k = st().model.correlations?.find((x) => x.id === target.id);
  if (!k) return;
  const v = await heldDialog('Covariance per group', 'Give the covariance a value or label in each group (lavaan c(…); Mplus group-specific MODEL commands), or one for all groups.', heldText(k));
  if (v !== undefined) st().setCorrelationValue(k.id, v);
};
/** Specification search: mark a path or a covariance as optional (drawn differently; the search fits the model with and without it), or required again. */
export function toggleOptional(target: MenuTarget) {
  const flip = <T extends { id: string; optional?: true }>(x: T): T => { if (x.id !== (target as { id?: string }).id) return x; const { optional, ...rest } = x; return (optional ? rest : { ...rest, optional: true }) as T; };
  if (target.kind === 'path') st().commit((m) => ({ ...m, paths: m.paths.map(flip) }));
  else if (target.kind === 'correlation') st().commit((m) => ({ ...m, correlations: (m.correlations ?? []).map(flip) }));
}

/** Carries out a context menu's action on its target. */
export function runMenuAction(target: MenuTarget, a: MenuAction, ui: MenuUi) {
  const s = st();
  switch (a) {
    case 'edit': if (target.kind === 'construct') s.select('construct', target.id); break;
    case 'make-composite': if (target.kind === 'construct') s.updateConstruct(target.id, { type: 'composite' }); break;
    case 'make-factor': if (target.kind === 'construct') s.updateConstruct(target.id, { type: 'factor' }); break;
    case 'correlate':
      if (target.kind === 'indicator') ui.startCorrelate({ kind: 'indicator', id: target.name });
      else if (target.kind === 'disturbance') ui.startCorrelate({ kind: 'construct', id: target.id, via: 'disturbance' });
      else if (target.kind === 'construct') {
        // Endogenous constructs correlate through their disturbance.
        const via = endogenousIds(s.model).has(target.id) ? 'disturbance' as const : undefined;
        ui.startCorrelate({ kind: 'construct', id: target.id, ...(via ? { via } : {}) });
      }
      break;
    case 'delete-construct': if (target.kind === 'construct') s.deleteItems([target.id], []); break;
    case 'remove-indicator': if (target.kind === 'indicator') s.removeIndicator(target.construct, target.name); break;
    case 'reverse-path': if (target.kind === 'path') s.reversePath(target.id); break;
    case 'add-quadratic': if (target.kind === 'path') s.addQuadratic(target.id); break;
    case 'make-parcels': if (target.kind === 'construct') ui.setParcelFor(target.id); break;
    case 'toggle-copula': if (target.kind === 'path') s.toggleCopula(target.id); break;
    case 'delete-path': if (target.kind === 'path') s.deleteItems([], [target.id]); break;
    case 'delete-moderation': if (target.kind === 'moderation') s.deleteItems([], [], [target.id]); break;
    case 'delete-correlation': if (target.kind === 'correlation') s.deleteItems([], [], [], [target.id]); break;
    case 'add-construct': if (target.kind === 'pane') s.addConstruct(Math.round(target.x), Math.round(target.y)); break;
    case 'arrange': s.layout(); break;
    case 'figure': ui.setFigureOpen(true); break;
    case 'make-covariate': if (target.kind === 'construct') s.updateConstruct(target.id, { covariate: true }); break;
    case 'unmake-covariate': if (target.kind === 'construct') s.updateConstruct(target.id, { covariate: false }); break;
    case 'process-template': ui.setTemplatesOpen(true); break;
    case 'fix-zero': if (target.kind === 'implied') s.addCorrelation('construct', target.a, target.b, true); break;
    case 'fix-value': void fixValue(target); break;
    case 'set-label': void setLabel(target); break;
    case 'held-variance': void heldParameter(target, 'variance'); break;
    case 'held-intercept': void heldParameter(target, 'intercept'); break;
    case 'held-threshold': void heldParameter(target, 'threshold'); break;
    case 'group-values': void groupValues(target); break;
    case 'toggle-optional': toggleOptional(target); break;
    case 'make-esem': {
      const m = st().model;
      const free = st().selection.nodes.filter((x) => !m.esem?.blocks.some((b) => b.constructs.includes(x)) && m.constructs.some((c) => c.id === x && !c.covariate && !c.components?.length));
      // A factor without indicators first: a bifactor rotation's general factor is the block's first.
      const empty = (x: string) => !m.constructs.find((c) => c.id === x)?.indicators.length;
      const ordered = [...free.filter(empty), ...free.filter((x) => !empty(x))];
      const rotation = m.esem?.rotation ?? 'geomin';
      s.setEsem({ ...(m.esem ?? {}), rotation, blocks: [...(m.esem?.blocks ?? []), { id: newId('e'), constructs: ordered }] });
      s.toast('info', `ESEM block: each of its factors now loads on all the block’s indicators (rotated, ${rotation}). Rotation and blocks are listed in the Model inspector.`);
      break;
    }
    case 'leave-esem': {
      const m = st().model;
      if (target.kind === 'construct' && m.esem) s.setEsem({ ...m.esem, blocks: m.esem.blocks.map((b) => ({ ...b, constructs: b.constructs.filter((x) => x !== target.id) })) });
      break;
    }
    case 'toggle-free-path': {
      const mg = st().model.multigroup;
      const p = target.kind === 'path' ? st().model.paths.find((q) => q.id === target.id) : undefined;
      if (!mg || !p) break;
      const same = (f: (typeof mg.free)[number]) => f.kind === 'regression' && f.from === p.from && f.to === p.to;
      s.setMultigroup({ ...mg, free: mg.free.some(same) ? mg.free.filter((f) => !same(f)) : [...mg.free, { kind: 'regression', from: p.from, to: p.to }] });
      break;
    }
    case 'toggle-free-loading':
    case 'toggle-free-intercept': {
      const mg = st().model.multigroup;
      if (target.kind !== 'indicator' || !mg) break;
      const kind = a === 'toggle-free-loading' ? 'loading' : 'intercept';
      const same = (f: (typeof mg.free)[number]) => f.kind === kind && f.indicator === target.name && (f.kind === 'intercept' || f.construct === target.construct);
      s.setMultigroup({ ...mg, free: mg.free.some(same) ? mg.free.filter((f) => !same(f)) : [...mg.free, kind === 'loading' ? { kind, construct: target.construct, indicator: target.name } : { kind, indicator: target.name }] });
      break;
    }
    case 'toggle-ordinal':
      if (target.kind === 'indicator') {
        const on = !(st().model.ordered ?? []).includes(target.name);
        s.setOrdered([target.name], on);
        if (on && st().settings.estimator !== 'WLSMV') s.toast('info', `${target.name} is ordinal now. Ordinal indicators are estimated with WLSMV: choose it under Estimator (Model inspector).`);
      }
      break;
    case 'free-value': {
      const t = paramOf(target);
      if (t) s.fixParameter(t, null);
      break;
    }
  }
}
