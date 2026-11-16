// The measurement checks of PLS reports in a simulation, as Rönkkö & Evermann
// (2013) and Henseler et al. (2015) study them: how the usual checks behave
// across replications, and how often each fails its cutoff, whether the model
// is right or wrong. Per common-factor construct with two or more indicators:
// - ρc (composite reliability) from the loadings, ≥ 0.70;
// - AVE, the mean squared loading, ≥ 0.50;
// - the Fornell–Larcker margin √AVE − max |r| with the other constructs, > 0;
// per pair of them HTMT (from the indicator correlations), < 0.85; and for the
// model GoF = √(mean AVE · mean R²) (Tenenhaus et al. 2005), ≥ 0.36.
// The true values are the same checks of the population: loadings are the
// indicator–construct correlations, the construct and indicator correlations
// the population's. R/mc.R computes the same (validity_values).

export type McValidityRule = 'cr' | 'ave' | 'fl' | 'htmt' | 'gof';

export const MC_VALIDITY_RULES: Record<
  McValidityRule,
  { label: string; cutoff: number; poorBelow: boolean }
> = {
  cr: { label: 'ρc', cutoff: 0.7, poorBelow: true },
  ave: { label: 'AVE', cutoff: 0.5, poorBelow: true },
  fl: { label: 'Fornell–Larcker margin', cutoff: 0, poorBelow: true },
  htmt: { label: 'HTMT', cutoff: 0.85, poorBelow: false },
  gof: { label: 'GoF', cutoff: 0.36, poorBelow: true },
};

/** The checks' inputs, index-aligned: blocks index indicators, constructs index C and r2. */
export interface ValidityInputs {
  constructs: string[];
  blocks: number[][];
  /** Common-factor constructs (the checks apply to those with two or more indicators). */
  factor: boolean[];
  /** Each indicator's loading on its own construct. */
  loadings: number[];
  /** Construct correlations. */
  C: number[][];
  /** Indicator correlations. */
  R: number[][];
  /** R² of each construct (null: exogenous). */
  r2: (number | null)[];
}

/** The constructs the checks apply to. */
export const checkedConstructs = (v: Pick<ValidityInputs, 'blocks' | 'factor'>) =>
  v.blocks.map((_, j) => j).filter((j) => v.factor[j] && v.blocks[j].length >= 2);

/** Every check, keyed `<rule>:<construct>`, `htmt:<a>:<b>` and `gof`. */
export function validityValues(v: ValidityInputs): Map<string, number> {
  const out = new Map<string, number>();
  const checked = checkedConstructs(v);
  const ave = new Map<number, number>();
  for (const j of checked) {
    const lam = v.blocks[j].map((i) => v.loadings[i]);
    const sum = lam.reduce((s, l) => s + l, 0);
    const error = lam.reduce((s, l) => s + (1 - l * l), 0);
    const a = lam.reduce((s, l) => s + l * l, 0) / lam.length;
    ave.set(j, a);
    const name = v.constructs[j];
    out.set(`cr:${name}`, (sum * sum) / (sum * sum + error));
    out.set(`ave:${name}`, a);
    let largest = 0;
    v.constructs.forEach((_, k) => {
      if (k !== j) largest = Math.max(largest, Math.abs(v.C[j][k]));
    });
    out.set(`fl:${name}`, Math.sqrt(a) - largest);
  }
  const mono = (b: number[]) => {
    let s = 0;
    let count = 0;
    for (let x = 0; x < b.length; x++)
      for (let y = x + 1; y < b.length; y++) {
        s += Math.abs(v.R[b[x]][b[y]]);
        count++;
      }
    return s / count;
  };
  checked.forEach((i, x) =>
    checked.slice(x + 1).forEach((j) => {
      let s = 0;
      for (const a of v.blocks[i]) for (const b of v.blocks[j]) s += Math.abs(v.R[a][b]);
      const hetero = s / (v.blocks[i].length * v.blocks[j].length);
      out.set(
        `htmt:${v.constructs[i]}:${v.constructs[j]}`,
        hetero / Math.sqrt(mono(v.blocks[i]) * mono(v.blocks[j])),
      );
    }),
  );
  const r2 = v.r2.filter((x): x is number => x !== null);
  if (ave.size && r2.length) {
    const meanAve = [...ave.values()].reduce((s, x) => s + x, 0) / ave.size;
    const meanR2 = r2.reduce((s, x) => s + x, 0) / r2.length;
    out.set('gof', Math.sqrt(meanAve * meanR2));
  }
  return out;
}

/** 1 when a value fails its rule's cutoff, 0 when it passes (NaN: no value). */
export function failsCutoff(rule: McValidityRule, value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const r = MC_VALIDITY_RULES[rule];
  return (r.poorBelow ? value < r.cutoff : value > r.cutoff) ? 1 : 0;
}
