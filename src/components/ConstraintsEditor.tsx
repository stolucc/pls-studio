import { useState } from 'react';
import {
  endogenousIds,
  labelUses,
  newId,
  type DefinedParameter,
  type ModelState,
  type ParameterTerm,
  type WaldTest,
} from '../model/project';
import { heldState } from './canvasMenu';
import { useStore } from '../store';
import { IconX } from './icons';

/** A text input that commits on blur or Enter (one undo step per edit, not per keystroke). */
function Field({
  value,
  onCommit,
  placeholder,
  mono,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const props = {
    className: `input${mono ? ' mono' : ''}`,
    value: draft ?? value,
    placeholder,
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea {...props} rows={2} />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** What a held or labelled parameter is, in words. */
function heldWhat(model: ModelState, t: ParameterTerm): string {
  if (t.indicator) {
    if (t.kind === 'variance') return `Error variance of ${t.target}`;
    if (t.kind === 'intercept') return `Intercept of ${t.target}`;
    return `Threshold ${t.threshold ?? 1} of ${t.target}`;
  }
  const c = model.constructs.find((k) => k.id === t.target);
  const explained = c && endogenousIds(model).has(c.id);
  return `${explained ? 'Disturbance variance' : 'Variance'} of ${c?.name ?? '?'}`;
}

/**
 * CB-SEM (lavaan): labels in use (equal labels = equality constraints),
 * defined parameters (name := expression) and Wald tests (left == right).
 */
export function ConstraintsEditor() {
  const model = useStore((s) => s.model);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setDefined = useStore((s) => s.setDefined);
  const setWaldTests = useStore((s) => s.setWaldTests);
  const setInequalities = useStore((s) => s.setInequalities);
  const setPositiveVariances = useStore((s) => s.setPositiveVariances);
  const setHeldParameter = useStore((s) => s.setHeldParameter);
  const held = model.parameters ?? [];
  const labels = [...labelUses(model)];
  const defined = model.defined ?? [];
  const tests = model.waldTests ?? [];
  const patchDefined = (i: number, p: Partial<DefinedParameter>) =>
    setDefined(defined.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const patchTest = (i: number, p: Partial<WaldTest>) =>
    setWaldTests(tests.map((t, k) => (k === i ? { ...t, ...p } : t)));
  return (
    <div className="section">
      <div className="section-title">Labels, defined parameters, tests</div>
      {labels.length === 0 ? (
        <div className="hint">
          Right-click a path, loading or covariance → Label… Parameters with the same label are
          equal; labels can be used below.
        </div>
      ) : (
        <div className="label-list">
          {labels.map(([l, uses]) => (
            <div key={l} className="label-row">
              <span className="plabel-name">{l}</span>
              <span className="hint">
                {uses.join(', ')}
                {uses.length > 1 ? ' (constrained equal)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Held and labelled variances, intercepts, thresholds</label>
        {held.length === 0 ? (
          <div className="hint">
            Right-click a construct, its disturbance or an indicator → Variance…, Error variance…,
            Intercept… or a threshold, to hold one at a value, label it, or give values per group.
          </div>
        ) : (
          held.map((t) => (
            <div className="label-row" key={t.id}>
              <span>{heldWhat(model, t)}</span>
              <span className="hint">{heldState(t)}</span>
              {!readOnly && (
                <button
                  className="btn icon ghost sm"
                  aria-label={`Estimate ${heldWhat(model, t)} freely`}
                  title="Estimate it freely again"
                  onClick={() => setHeldParameter(t, null)}
                >
                  <IconX size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="field">
        <label>Defined parameters</label>
        {defined.map((d, i) => (
          <div className="def-row" key={d.id}>
            <Field
              value={d.name}
              placeholder="ind"
              mono
              onCommit={(v) => patchDefined(i, { name: v.trim() })}
            />
            <span className="muted">:=</span>
            <Field
              value={d.expr}
              placeholder="a*b"
              mono
              onCommit={(v) => patchDefined(i, { expr: v })}
            />
            {!readOnly && (
              <button
                className="btn icon ghost sm"
                aria-label="Remove defined parameter"
                onClick={() => setDefined(defined.filter((_, k) => k !== i))}
              >
                <IconX size={13} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            className="btn sm"
            onClick={() =>
              setDefined([
                ...defined,
                { id: newId('d'), name: `def${defined.length + 1}`, expr: '' },
              ])
            }
          >
            Add defined parameter
          </button>
        )}
        <div className="hint">
          Functions of labelled parameters, e.g. an indirect effect a*b or a difference a - b, with
          delta-method standard errors (lavaan :=).
        </div>
      </div>
      <div className="field">
        <label>Wald tests</label>
        {tests.map((t, i) => (
          <div className="wald-row" key={t.id}>
            <div className="def-row">
              <Field
                value={t.name}
                placeholder="Test name"
                onCommit={(v) => patchTest(i, { name: v.trim() || `Test ${i + 1}` })}
              />
              {!readOnly && (
                <button
                  className="btn icon ghost sm"
                  aria-label="Remove test"
                  onClick={() => setWaldTests(tests.filter((_, k) => k !== i))}
                >
                  <IconX size={13} />
                </button>
              )}
            </div>
            <Field
              value={t.constraints}
              placeholder={'a == b\nc == 0'}
              mono
              multiline
              onCommit={(v) => patchTest(i, { constraints: v })}
            />
          </div>
        ))}
        {!readOnly && (
          <button
            className="btn sm"
            onClick={() =>
              setWaldTests([
                ...tests,
                { id: newId('w'), name: `Test ${tests.length + 1}`, constraints: '' },
              ])
            }
          >
            Add Wald test
          </button>
        )}
        <div className="hint">
          One hypothesis per line (left == right); all lines are tested jointly
          (lavaan::lavTestWald).
        </div>
      </div>
      <div className="field">
        <label>Constraints</label>
        <Field
          value={model.inequalities ?? ''}
          placeholder={'a > 0\na < b\nrel1 == rel2'}
          mono
          multiline
          onCommit={(v) => setInequalities(v)}
        />
        <div className="hint">
          One per line (left &gt; right, left &lt; right, or left == right), on labels and defined
          parameters; lavaan estimates under them. A parameter on its bound has no standard error,
          and χ² tests that involve active bounds are not standard.
        </div>
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={!!model.positiveVariances}
            disabled={readOnly}
            onChange={(e) => setPositiveVariances(e.target.checked)}
          />
          <span>
            Keep variances non-negative
            <br />
            <span className="hint">
              Bounds every variance at 0 (lavaan bounds = “pos.var”): instead of a negative variance
              (a Heywood case) the estimate stays at 0. Consider why it would be negative first: a
              misspecified model or too few cases.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
