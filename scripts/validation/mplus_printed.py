"""The numbers the Mplus User's Guide outputs print, for the examples in the app.

Reads the Mplus 8 output pages of the examples (statmodel.com/usersguide/chapN/exN.M.html,
saved to a folder) and writes src/engine/__fixtures__/textbook/mplus_printed.json: per example
the MODEL RESULTS (estimate and standard error of every parameter, by group) and the fit
information (log-likelihood, free parameters, AIC, BIC, chi-square, df), so the tests compare the
app with what Mplus prints, not with a rerun of our own.
    python3 -I scripts/validation/mplus_printed.py <folder with the ex*.html outputs>
"""
import html, json, os, re, sys

EXAMPLES = ['3.1', '3.5', '3.7', '3.11', '5.1', '5.2', '5.6', '5.8', '5.11', '5.12', '5.13', '5.14', '5.15', '5.25', '6.1', '6.8', '6.9', '6.10']
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


def results(lines):
    i = next(k for k, l in enumerate(lines) if l.strip() == 'MODEL RESULTS')
    out, group, sec = [], 1, None
    for l in lines[i + 1:]:
        s = l.strip()
        if re.match(r'^(QUALITY OF|STANDARDIZED|TECHNICAL|RESULTS IN|R-SQUARE|LOGISTIC|TOTAL, TOTAL|Beginning|EFA|IRT)', s):
            break
        if s.startswith('Group '):
            group = 2 if 'FEMALE' in s.upper() else 1
            continue
        m = re.match(r'^ (\S+)\s+(BY|ON|WITH|\|)\s*$', l)
        if m:
            sec = (m.group(1).lower(), m.group(2))
            continue
        if s in ('Intercepts', 'Means', 'Variances', 'Residual Variances', 'Thresholds'):
            sec = (s, None)
            continue
        m = re.match(r'^\s+(\S+)\s+' + NUM + r'\s+' + NUM + r'\s', l + ' ')
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
        elif a == 'Thresholds':
            v, t = name.split('$')
            k = (v, '|', 't' + t)
        else:
            k = (name, '~~', name)
        out.append({'lhs': k[0], 'op': k[1], 'rhs': k[2], 'group': group, 'est': est, 'se': se})
    return out


def main(folder):
    data = {}
    for ex in EXAMPLES:
        path = os.path.join(folder, f'ex{ex}.html')
        lines = text(path)
        data[f'ex{ex}'] = {'fit': fit(lines), 'estimates': results(lines)}
    data['source'] = 'Mplus 8 outputs of the Mplus User’s Guide examples (Muthén & Muthén), statmodel.com/usersguide'
    dest = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json')
    with open(dest, 'w') as f:
        json.dump(data, f, indent=1)
    for ex in EXAMPLES:
        d = data[f'ex{ex}']
        print(f'ex{ex:5} {len(d["estimates"]):3} parameters  fit {d["fit"]}')


if __name__ == '__main__':
    main(sys.argv[1])
