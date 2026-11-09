#!/usr/bin/env python3
"""Build the open sample datasets in public/examples/samples from their Zenodo records.

Only the numeric item columns are kept (no timestamps, names, ages or free text).
  TAM     10.5281/zenodo.22206708 (CC BY 4.0), Verisya: AI-based UI design tools, 272 designers
  UTAUT   10.5281/zenodo.21942087 (CC BY 4.0), Purba: SeaBank in Medan; the 194 eligible of 200 respondents
  Retention 10.5281/zenodo.4602319 (CC0), Inegbedion et al. 2020: workload balance and job satisfaction, 783 employees
  Bifactor 10.5281/zenodo.23301690 (CC BY 4.0), Canizares-Cedeno: Customer Participation Behavior scale, 429 students
Run from the repository root: python3 -I scripts/examples/open_samples.py
"""
import csv, io, re, sys, urllib.parse, urllib.request, xml.etree.ElementTree as E, zipfile

OUT = 'public/examples/samples'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def fetch(record, name):
    url = f'https://zenodo.org/api/records/{record}/files/{urllib.parse.quote(name)}/content'
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def sheet(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    strings = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    rows = []
    for r in E.fromstring(z.read('xl/worksheets/sheet1.xml')).iter('{%s}row' % NS['m']):
        row = {}
        for c in r.findall('m:c', NS):
            col = 0
            for ch in re.match(r'[A-Z]+', c.get('r')).group():
                col = col * 26 + ord(ch) - 64
            v = c.find('m:v', NS)
            if v is not None:
                row[col] = strings[int(v.text)] if c.get('t') == 's' else v.text
        rows.append(row)
    return rows


def write(name, header, rows):
    with open(f'{OUT}/{name}.csv', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        # Items only: anything else in a cell (a stray note, a blank line) is missing, and an empty row is dropped.
        clean = [[v.strip() if re.fullmatch(r'\s*\d+(\.\d+)?\s*', v or '') else '' for v in r] for r in rows]
        rows = [r for r in clean if any(r)]
        w.writerows(rows)
    print(name, len(rows), 'rows', len(header), 'columns')


def tam():
    text = fetch(22206708, 'Dataset Perceptions and Intentions of Designers In Using AI -Based User Interface Design Tools.csv').decode('utf-8-sig')
    all_rows = list(csv.reader(io.StringIO(text), delimiter=';'))
    header = [h.strip() for h in all_rows[0]]
    keep = [i for i, h in enumerate(header) if re.fullmatch(r'(SE|TR|PEOU|PU|BI)\d', h)]
    write('tam_ai_design_tools', [header[i] for i in keep], [[r[i] for i in keep] for r in all_rows[1:] if len(r) >= len(header)])


def utaut():
    rows = sheet(fetch(21942087, 'Dataset Penelitian Pengaruh Faktor UTAUT terhadap Keputusan Menggunakan SeaBank di Medan.xlsx'))
    head = rows[0]
    items = [(i, v) for i, v in sorted(head.items()) if re.fullmatch(r'(PE|EE|SI|FC|BI)\d', v or '')]
    live, used = [i for i, v in head.items() if 'domisili' in (v or '')][0], [i for i, v in head.items() if 'pernah' in (v or '')][0]
    eligible = [r for r in rows[1:] if r.get(live) == 'Ya' and r.get(used) == 'Ya']
    write('utaut_seabank', [v for _, v in items], [[r.get(i, '') for i, _ in items] for r in eligible])


def retention():
    rows = sheet(fetch(4602319, 'Data_Employee_Perception_of_workload_2.xlsx'))
    # The questionnaire's columns: workload relative to others, then "If I have opportunity to leave this job I will not hesitate"
    # and "I have fulfillment in my job". ("My work is challenging", column 18, is an exact copy of 17 in the deposit: left out.)
    # A codebook follows the data in the sheet, from the row headed "Research Items".
    end = next(k for k, r in enumerate(rows) if 'Research Items' in r.values())
    cols = {'WL1': 4, 'WL2': 5, 'WL3': 6, 'WL4': 7, 'WL5': 8, 'LEAVE': 15, 'FULFIL': 17}
    body = [[r.get(i, '') for i in cols.values()] for r in rows[1:end]]
    write('retention_workload', list(cols), [b for b in body if any(b)])


def bifactor():
    all_rows = list(csv.reader(io.StringIO(fetch(23301690, 'CPB_data_N429_anonymized_v2.csv').decode('utf-8-sig'))))
    keep = [i for i, h in enumerate(all_rows[0]) if re.fullmatch(r'(IS|ISH|RB|PI)\d', h)]
    write('bifactor_cpb', [all_rows[0][i] for i in keep], [[r[i] for i in keep] for r in all_rows[1:]])


if __name__ == '__main__':
    tam(); utaut(); retention(); bifactor()
