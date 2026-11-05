"""The data of the Mplus User's Guide examples as CSV files for the app.

Reads each example's input (exN.M.inp) for its variable names and missing-value code and
its free-format data (the .dat the input names), and writes public/examples/mplus/exN.M.csv
with a header row and missing values as empty cells. Free format is read as Mplus reads it:
a stream of values, one record per len(NAMES) values, whatever the line breaks (a file with
one record per line and more columns than NAMES keeps the first len(NAMES)).
    python3 -I scripts/validation/mplus_data.py <folder with the ex*.inp and *.dat files> [ex5.1 ...]
"""
import os, re, sys


def statements(inp):
    """The input's statements, comments removed, keyed by command (DATA, VARIABLE, ...)."""
    s = re.sub(r'!.*', '', inp.replace('\r', ''))
    out, cmd = {}, None
    for part in re.split(r'(?im)^\s*([A-Z ]+):', s):
        if cmd is not None:
            out.setdefault(cmd, '')
            out[cmd] += part
            cmd = None
        elif part.strip().upper() in ('TITLE', 'DATA', 'VARIABLE', 'ANALYSIS', 'MODEL', 'OUTPUT', 'SAVEDATA', 'PLOT', 'DEFINE',
                                      'MONTECARLO', 'MODEL POPULATION', 'MODEL CONSTRAINT', 'MODEL INDIRECT', 'MODEL TEST',
                                      'MODEL PRIORS', 'DATA WIDETOLONG', 'DATA MISSING', 'DATA IMPUTATION', 'DATA TWOPART',
                                      'DATA SURVIVAL', 'MODEL MISSING', 'MODEL COVERAGE'):
            cmd = part.strip().upper()
    return out


def option(block, name):
    m = re.search(rf'(?is)\b{name}\s*(?:IS|ARE|=)\s*([^;]*);', block or '')
    return m.group(1).strip() if m else None


def expand(names):
    """Mplus list notation: y1-y6 is y1 ... y6; a31-a34 is a31 ... a34."""
    out = []
    for tok in names.split():
        m = re.fullmatch(r'([A-Za-z_]\w*?)(\d+)-([A-Za-z_]\w*?)(\d+)', tok)
        if m and m.group(1) == m.group(3):
            a, b = int(m.group(2)), int(m.group(4))
            out += [f'{m.group(1)}{i}' for i in range(a, b + 1)]
        else:
            out.append(tok)
    return [n.lower() for n in out]


def convert(folder, ex, dest):
    inp = open(os.path.join(folder, f'{ex}.inp'), encoding='latin-1').read()
    st = statements(inp)
    file = option(st.get('DATA'), 'FILE')
    names = option(st.get('VARIABLE'), 'NAMES')
    if not file or not names:
        return None
    path = os.path.join(folder, file.strip('"\''))
    if not os.path.exists(path):
        return None
    cols = expand(names)
    codes = set()
    miss = option(st.get('VARIABLE'), 'MISSING')
    if miss:
        for m in re.finditer(r'\(([^)]*)\)', miss):
            codes |= {float(v) for v in m.group(1).replace(',', ' ').split() if re.fullmatch(r'-?\d+(\.\d+)?', v)}
        if '*' in miss or '.' == miss.strip():
            codes.add('*')
    text = open(path, encoding='latin-1').read().replace('\0', '').replace(',', ' ')
    lines = [l.split() for l in text.splitlines() if l.strip()]
    widths = {len(l) for l in lines}
    if len(widths) == 1 and widths.pop() > len(cols):
        # One record per line with trailing columns the input does not name (the generating class): dropped.
        values = [v for l in lines for v in l[:len(cols)]]
    else:
        values = text.split()
    if len(values) % len(cols):
        raise ValueError(f'{ex}: {len(values)} values do not divide into records of {len(cols)}')

    def cell(v):
        if v in ('*', '.'):
            return ''
        try:
            if float(v) in codes:
                return ''
        except ValueError:
            pass
        return v
    with open(os.path.join(dest, f'{ex}.csv'), 'w') as f:
        f.write(','.join(cols) + '\n')
        for i in range(0, len(values), len(cols)):
            f.write(','.join(cell(v) for v in values[i:i + len(cols)]) + '\n')
    return len(values) // len(cols), len(cols)


def main(folder, only):
    dest = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'examples', 'mplus')
    os.makedirs(dest, exist_ok=True)
    exs = only or sorted({f[:-4] for f in os.listdir(folder) if re.fullmatch(r'ex\d+\.\d+\w*\.inp', f)})
    for ex in exs:
        try:
            r = convert(folder, ex, dest)
        except ValueError as e:
            print(e)
            continue
        print(f'{ex:12} ' + ('no data file' if r is None else f'{r[0]} rows, {r[1]} columns'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
