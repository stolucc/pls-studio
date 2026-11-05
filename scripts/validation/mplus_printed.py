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
BLOCK = re.compile(r'^(Group \S+|Latent Class \d+.*|Latent Class Pattern .*|Class \d+|Within Level|Between( \S+)? Level|'
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
