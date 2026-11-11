// The works cited by the methods text as a formatted reference list (APA-like),
// read from the BibTeX the methods card produces (reporting/citations.ts). The
// entries there are regular: one `field = {value}` per line.

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

/** The entries of a BibTeX text written by citations.ts. */
export function parseBibtex(bib: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const re = /@(\w+)\{([^,\s]+),\n([\s\S]*?)\n\}/g;
  for (const m of bib.matchAll(re)) {
    const fields: Record<string, string> = {};
    for (const line of m[3].split('\n')) {
      const f = /^\s*(\w+)\s*=\s*\{(.*)\},?\s*$/.exec(line);
      if (f) fields[f[1].toLowerCase()] = f[2];
    }
    entries.push({ type: m[1].toLowerCase(), key: m[2], fields });
  }
  return entries;
}

const ACCENTS: Record<string, Record<string, string>> = {
  '"': { o: 'ö', a: 'ä', u: 'ü', O: 'Ö', A: 'Ä', U: 'Ü', e: 'ë', i: 'ï' },
  "'": { e: 'é', a: 'á', o: 'ó', i: 'í', u: 'ú', E: 'É' },
  '`': { e: 'è', a: 'à', o: 'ò' },
  '^': { e: 'ê', o: 'ô', a: 'â' },
  '~': { n: 'ñ', a: 'ã', o: 'õ' },
};

/** BibTeX field text as plain text: accents, escapes, protective braces and dashes. */
export function bibText(s: string): string {
  return s
    .replace(/\{\\(["'`^~])\{?(\w)\}?\}/g, (all, mark: string, ch: string) => {
      return ACCENTS[mark]?.[ch] ?? all;
    })
    .replace(/\\(["'`^~])\{?(\w)\}?/g, (all, mark: string, ch: string) => {
      return ACCENTS[mark]?.[ch] ?? all;
    })
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Hair, Joseph F." → "Hair, J. F."; a corporate author ("{R Core Team}") stays. */
function initials(name: string): string {
  const trimmed = name.trim();
  if (/^\{.*\}$/.test(trimmed)) return bibText(trimmed);
  const [last, first] = trimmed.split(/,\s*/);
  if (first === undefined) return bibText(last);
  const given = bibText(first)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      // Hyphenated given names keep their hyphen: "Jan-Michael" → "J.-M."
      return part
        .split('-')
        .map((p) => (p.endsWith('.') && p.length <= 2 ? p : `${p[0]}.`))
        .join('-');
    })
    .join(' ');
  return `${bibText(last)}, ${given}`;
}

/** APA author list: "A, B, & C". */
function authors(field: string | undefined): string {
  if (!field) return '';
  const names = field.split(/\s+and\s+/).map(initials);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** One entry as an APA-like reference (plain text). */
export function formatReference(e: BibEntry): string {
  const f = e.fields;
  const who = authors(f.author) || bibText(f.organization ?? f.institution ?? '');
  const year = f.year ? bibText(f.year) : 'n.d.';
  const title = bibText(f.title ?? e.key);
  const parts: string[] = [`${end(who)} (${year}).`];
  if (e.type === 'article') {
    parts.push(end(title));
    let source = bibText(f.journal ?? '');
    if (f.volume) source += `, ${bibText(f.volume)}`;
    if (f.number) source += `(${bibText(f.number)})`;
    if (f.pages) source += `, ${bibText(f.pages)}`;
    if (source) parts.push(end(source));
  } else if (e.type === 'incollection') {
    parts.push(end(title));
    const editors = f.editor ? `In ${authors(f.editor)} (Eds.), ` : 'In ';
    const pages = f.pages ? ` (pp. ${bibText(f.pages)})` : '';
    parts.push(end(`${editors}${bibText(f.booktitle ?? '')}${pages}`));
    if (f.publisher) parts.push(end(bibText(f.publisher)));
  } else if (e.type === 'book') {
    const edition = f.edition ? ` (${bibText(f.edition)} ed.)` : '';
    parts.push(end(`${title}${edition}`));
    if (f.publisher) parts.push(end(bibText(f.publisher)));
  } else if (e.type === 'techreport') {
    parts.push(end(`${title}${f.type ? ` [${bibText(f.type)}]` : ''}`));
    if (f.institution) parts.push(end(bibText(f.institution)));
  } else {
    // Software manuals and anything else: title [version note], organisation.
    const note = f.note ? ` (${bibText(f.note)})` : '';
    parts.push(end(`${title}${note}`));
    if (f.organization && who !== bibText(f.organization)) {
      parts.push(end(bibText(f.organization)));
    }
  }
  if (f.doi) parts.push(`https://doi.org/${bibText(f.doi)}`);
  else if (f.url) parts.push(bibText(f.url));
  return parts.join(' ');
}

/** The reference list of a BibTeX text, sorted by first author as APA asks. */
export function referenceList(bib: string): string[] {
  return parseBibtex(bib)
    .map(formatReference)
    .sort((a, b) => a.localeCompare(b, 'en'));
}
