"""The numbers the Mplus User's Guide outputs print, for the examples in the app.

Reads the Mplus 8 output pages of all the examples (statmodel.com/usersguide/chapN/exN.M.html,
saved to a folder) and writes src/engine/__fixtures__/textbook/mplus_printed.json: per example
the MODEL RESULTS (estimate and standard error of every parameter, by group) and the fit
information (log-likelihood, free parameters, AIC, BIC, chi-square, df), so the tests compare the
app with what Mplus prints, not with a rerun of our own.
    python3 -I scripts/validation/mplus_printed.py <folder with the ex*.html outputs>
"""
import html, json, os, re, sys

def _all(folder):
    return sorted((f[2:-5] for f in os.listdir(folder) if re.fullmatch(r'ex\d+\.\d+\w*\.html', f)),
                  key=lambda e: [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', e)])


EXAMPLES = []
NUM = r'(-?\d+\.\d+)'


def text(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    s = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S | re.I)
    s = re.sub(r'<br\s*/?>|</p>|</div>|</tr>', '\n', s, flags=re.I)
    s = html.unescape(re.sub(r'<[a-zA-Z/!][^>]*>', '', s))
    return s.split('\n')


def value(lines, label):
    for i, l in enumerate(lines):
        if l.strip().startswith(label):
            m = re.search(NUM + r'\*?\s*$', l) or re.search(r'(\d+)\s*$', l)
            if m:
                return float(m.group(1))
    return None


def fit(lines):
    start = next(i for i, l in enumerate(lines) if l.strip() == 'MODEL FIT INFORMATION')
    end = next(i for i, l in enumerate(lines) if l.strip() == 'MODEL RESULTS')
    block = lines[start:end]
    out = {'npar': value(block, 'Number of Free Parameters'), 'logl': value(block, 'H0 Value'),
           'aic': value(block, 'Akaike (AIC)'), 'bic': value(block, 'Bayesian (BIC)')}
    for i, l in enumerate(block):
        if l.strip().startswith('Chi-Square Test of Model Fit') and 'Baseline' not in l:
            out['chisq'] = value(block[i:i + 3], 'Value')
            out['df'] = value(block[i:i + 4], 'Degrees of Freedom')
            break
    return {k: v for k, v in out.items() if v is not None}


SECTIONS = ('Intercepts', 'Means', 'Variances', 'Residual Variances', 'Thresholds', 'New/Additional Parameters',
            'Dispersion', 'Scales', 'Base Hazard Parameters', 'Steps', 'Covariances')
# (Latent Class C1#1: a class of one of several latent class variables)
BLOCK = re.compile(r'^(Group \S+|Latent Class \d+.*|Latent Class Pattern .*|Latent Class \w+#\d+|Class \d+|Within Level|Between( \S+)? Level|'
                   r'Categorical Latent Variables|Class Proportions)\s*$')


def results(lines):
    """MODEL RESULTS: per parameter its estimate and standard error (posterior SD for Bayes), with the block
    it is printed under (a group, a latent class, a level) and, for groups, the group's number in print order."""
    i = next(k for k, l in enumerate(lines) if l.strip() == 'MODEL RESULTS')
    out, groups, group, block, sec = [], [], 1, '', None
    for l in lines[i + 1:]:
        s = l.strip()
        if re.match(r'^(QUALITY OF|STANDARDIZED|TECHNICAL|RESULTS IN|R-SQUARE|LOGISTIC|TOTAL, TOTAL|Beginning|EFA|IRT|'
                    r'ODDS RATIO|ALTERNATIVE PARAMETERIZATIONS|LATENT TRANSITION|BRANT|CONFIDENCE|MODEL COMMAND)', s):
            break
        if BLOCK.match(s) and not l.startswith(' '):
            block = s
            if s.startswith('Group '):
                if s not in groups:
                    groups.append(s)
                group = groups.index(s) + 1
            sec = None
            continue
        m = re.match(r'^ (\S+)\s+(BY|ON|WITH|\||XWITH)\s*$', l)
        if m:
            sec = (m.group(1).lower(), m.group(2))
            continue
        if l.startswith(' ') and not l.startswith('  ') and s in SECTIONS:
            sec = (s, None)
            continue
        m = re.match(r'^\s+(\S+)\s+' + NUM + r'\s+' + NUM + r'(\s|$)', l + ' ')
        if not (m and sec):
            continue
        name, est, se = m.group(1).lower(), float(m.group(2)), float(m.group(3))
        a, op = sec
        if op in ('BY', '|'):
            k = (a, '=~', name)
        elif op == 'ON':
            k = (a, '~', name.replace('x', ':', 1) if a != name and re.fullmatch(r'f\dxf\d', name) else name)
        elif op == 'WITH':
            k = (a, '~~', name)
        elif a in ('Intercepts', 'Means'):
            k = (name, '~1', '')
        elif a == 'Thresholds' and '$' in name:
            v, t = name.rsplit('$', 1)
            k = (v, '|', 't' + t)
        elif a in ('Variances', 'Residual Variances'):
            k = (name, '~~', name)
        else:
            k = (name, a, '')
        out.append({'lhs': k[0], 'op': k[1], 'rhs': k[2], 'group': group, 'block': block, 'est': est, 'se': se})
    return out


EFA_HEAD = re.compile(r'^EXPLORATORY FACTOR ANALYSIS WITH (\d+) FACTOR\(S\):\s*$')


def _efa_matrix(block, title):
    """A matrix Mplus prints under `title` (columns in chunks of five, each chunk under the title again):
    rows of a name and numbers ('*' marks significance), or, for factor correlations, the lower triangle."""
    rows, order = {}, []
    for i, l in enumerate(block):
        if l.strip() != title and not l.strip().startswith(title + ' (*'):
            continue
        for r in block[i + 3:]:
            m = re.match(r'^\s+(\S+)((\s+-?\d+\.\d+\*?)+)\s*$', r)
            if not m:
                break
            name = m.group(1).lower()
            if name not in rows:
                rows[name] = []
                order.append(name)
            rows[name] += [float(x.rstrip('*')) for x in m.group(2).split()]
    return [rows[n] for n in order], order


def _efa_vector(block, title):
    """Values Mplus prints under `title` as rows of names over rows of numbers (residual variances)."""
    out = {}
    for i, l in enumerate(block):
        if l.strip() != title:
            continue
        names, vals = block[i + 1].split(), block[i + 3].split()
        out.update({n.lower(): float(v.rstrip('*')) for n, v in zip(names, vals)})
    return out


def efa(lines):
    """TYPE = EFA (single level, no classes): the eigenvalues of the sample correlation matrix and, per number of
    factors, the fit and the rotated loadings, factor correlations and residual variances with their standard errors."""
    if any(re.search(r'Number of clusters|LATENT CLASSES|WITHIN FACTOR', l) for l in lines):
        return None
    heads = [(i, int(m.group(1))) for i, l in enumerate(lines) for m in [EFA_HEAD.match(l.strip())] if m]
    if not heads:
        return None
    eig = []
    for i, l in enumerate(lines):
        if l.strip() == 'EIGENVALUES FOR SAMPLE CORRELATION MATRIX':
            eig += [float(x) for x in lines[i + 3].split()]
    sols = []
    for n, (start, k) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        block = lines[start:end]
        rot = next((m.group(1) for l in block for m in [re.match(r'^\s*(\S+) ROTATED LOADINGS', l)] if m), None)
        if rot is None:
            continue
        f = {'npar': value(block, 'Number of Free Parameters'), 'logl': value(block, 'H0 Value'),
             'aic': value(block, 'Akaike (AIC)'), 'bic': value(block, 'Bayesian (BIC)'),
             'rmsea': value(block, 'Estimate'), 'cfi': value(block, 'CFI'), 'tli': value(block, 'TLI')}
        for i, l in enumerate(block):
            if l.strip().startswith('Chi-Square Test of Model Fit') and 'Baseline' not in l:
                f['chisq'] = value(block[i:i + 3], 'Value')
                f['df'] = value(block[i:i + 4], 'Degrees of Freedom')
            if l.strip().startswith('SRMR'):
                f['srmr'] = value(block[i:i + 3], 'Value')
        load, names = _efa_matrix(block, f'{rot} ROTATED LOADINGS')
        load_se, _ = _efa_matrix(block, f'S.E. {rot} ROTATED LOADINGS')
        phi, _ = _efa_matrix(block, f'{rot} FACTOR CORRELATIONS')
        phi_se, _ = _efa_matrix(block, f'S.E. {rot} FACTOR CORRELATIONS')
        res = _efa_vector(block, 'ESTIMATED RESIDUAL VARIANCES')
        res_se = _efa_vector(block, 'S.E. ESTIMATED RESIDUAL VARIANCES')
        sols.append({'factors': k, 'rotation': rot.lower(), 'fit': {a: b for a, b in f.items() if b is not None},
                     'variables': names, 'loadings': load, 'loadingsSE': load_se, 'phi': phi, 'phiSE': phi_se,
                     'residual': [res.get(v) for v in names], 'residualSE': [res_se.get(v) for v in names]})
    return {'eigenvalues': eig, 'solutions': sols} if sols else None


def new_parameters(lines):
    """MODEL CONSTRAINT's NEW parameters, which MODEL RESULTS prints last under 'New/Additional Parameters' at the
    margin (the parameter list above folds them into the section before): name -> estimate and standard error."""
    try:
        i = next(k for k, l in enumerate(lines) if l.strip() == 'MODEL RESULTS')
        j = next(k for k in range(i + 1, len(lines)) if lines[k].rstrip() == 'New/Additional Parameters')
    except StopIteration:
        return None
    out = {}
    for l in lines[j + 1:]:
        m = re.match(r'^\s+(\S+)\s+' + NUM + r'\s+' + NUM + r'(\s|$)', l + ' ')
        if not m:
            break
        out[m.group(1).lower()] = {'est': float(m.group(2)), 'se': float(m.group(3))}
    return out or None


def intervals(lines):
    """CONFIDENCE INTERVALS OF MODEL RESULTS (OUTPUT: CINTERVAL): per parameter the 95% limits (Lower 2.5%, Upper
    2.5%), keyed like MODEL RESULTS; bootstrap percentile limits when the analysis bootstraps."""
    try:
        i = next(k for k, l in enumerate(lines) if l.strip() == 'CONFIDENCE INTERVALS OF MODEL RESULTS')
    except StopIteration:
        return None
    out, block, sec = [], '', None
    for l in lines[i + 1:]:
        s = l.strip()
        if re.match(r'^[A-Z][A-Z ,.-]{15,}$', s) or s.startswith('Beginning Time'):
            break
        if BLOCK.match(s) and not l.startswith(' '):
            block, sec = s, None
            continue
        m = re.match(r'^ (\S+)\s+(BY|ON|WITH|\|)\s*$', l)
        if m:
            sec = (m.group(1).lower(), m.group(2))
            continue
        if l.startswith(' ') and not l.startswith('  ') and s in SECTIONS:
            sec = (s, None)
            continue
        m = re.match(r'^\s+(\S+)' + (r'\s+' + NUM) * 7 + r'\s*$', l)
        if not (m and sec):
            continue
        name, low, high = m.group(1).lower(), float(m.group(3)), float(m.group(7))
        a, op = sec
        k = ((a, '=~', name) if op in ('BY', '|') else (a, '~', name) if op == 'ON' else (a, '~~', name) if op == 'WITH'
             else (name, '~1', '') if a in ('Intercepts', 'Means') else (name, '~~', name) if a in ('Variances', 'Residual Variances') else (name, a, ''))
        out.append({'lhs': k[0], 'op': k[1], 'rhs': k[2], 'block': block, 'low': low, 'high': high})
    return out or None


def indirect(lines):
    """MODEL INDIRECT: per 'Effects from X to Y' the total, (sum of) indirect, specific indirect (with its path,
    outcome first) and direct effects, estimate and standard error."""
    try:
        i = next(k for k, l in enumerate(lines) if l.strip() == 'TOTAL, TOTAL INDIRECT, SPECIFIC INDIRECT, AND DIRECT EFFECTS')
    except StopIteration:
        return None
    out, cur, spec, path = [], None, None, []
    for l in lines[i + 1:]:
        s = l.strip()
        if re.match(r'^[A-Z][A-Z ,.-]{15,}$', s) or s.startswith('Beginning Time'):
            break
        m = re.match(r'^Effects from (\S+) to (\S+)', s)
        if m:
            cur, spec = (m.group(1).lower(), m.group(2).lower()), None
            continue
        m = re.match(r'^(Total|Total indirect|Sum of indirect|Indirect|Direct)\s+' + NUM + r'\s+' + NUM, s)
        if m and cur:
            out.append({'from': cur[0], 'to': cur[1], 'effect': m.group(1), 'est': float(m.group(2)), 'se': float(m.group(3))})
            spec = None
            continue
        m = re.match(r'^Specific indirect\s*(\d*)$', s)
        if m:
            spec, path = s, []
            continue
        m = re.match(r'^(\S+)\s+' + NUM + r'\s+' + NUM, s)
        if m and spec and cur:
            out.append({'from': cur[0], 'to': cur[1], 'effect': spec, 'path': path + [m.group(1).lower()], 'est': float(m.group(2)), 'se': float(m.group(3))})
            spec = None
            continue
        if spec and re.fullmatch(r'\S+', s):
            path.append(s.lower())
    return out or None


def main(folder):
    EXAMPLES[:] = _all(folder)
    data = {}
    for ex in EXAMPLES:
        path = os.path.join(folder, f'ex{ex}.html')
        if not os.path.exists(path):
            continue
        lines = text(path)
        try:
            data[f'ex{ex}'] = {'fit': fit(lines), 'estimates': results(lines)}
        except StopIteration:  # no MODEL RESULTS (EFA, TYPE = BASIC): parsed where an example needs it
            data[f'ex{ex}'] = {'fit': {}, 'estimates': []}
        e = efa(lines)  # TYPE = EFA: per number of factors (an extra key; fit and estimates as above)
        if e:
            data[f'ex{ex}']['efa'] = e
        n = new_parameters(lines)  # MODEL CONSTRAINT's NEW parameters (an extra key)
        if n:
            data[f'ex{ex}']['new'] = n
        ci = intervals(lines)  # OUTPUT: CINTERVAL, 95% limits (an extra key)
        if ci:
            data[f'ex{ex}']['ci'] = ci
        ind = indirect(lines)  # MODEL INDIRECT (an extra key)
        if ind:
            data[f'ex{ex}']['indirect'] = ind
    data['source'] = 'Mplus 8 outputs of the Mplus User’s Guide examples (Muthén & Muthén), statmodel.com/usersguide'
    dest = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json')
    with open(dest, 'w') as f:
        json.dump(data, f, indent=1)
    for ex in EXAMPLES:
        d = data.get(f'ex{ex}')
        if d is None:
            continue
        print(f'ex{ex:5} {len(d["estimates"]):3} parameters  fit {d["fit"]}')


if __name__ == '__main__':
    main(sys.argv[1])
