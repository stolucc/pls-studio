// Figures go into the HTML report as inline SVG. The SVG comes from the app's
// own drawing code, but it carries user text (construct and indicator names),
// so it is parsed and rebuilt from an allowlist: no scripts, no foreign
// content, no links or references outside the figure, and element ids made
// unique per figure (several inline SVGs share one document).

const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'marker',
  'title',
  'desc',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'mask',
  'use',
  'symbol',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A local reference ("#id") or none. */
const localRef = (v: string) => /^#[A-Za-z_][\w.-]*$/.test(v.trim());

/** CSS in a style attribute or presentation attribute: only url(#local) references. */
function safeCss(v: string): boolean {
  if (/expression|@import|javascript:/i.test(v)) return false;
  const urls = [...v.matchAll(/url\(\s*['"]?([^'")]*)['"]?\s*\)/gi)];
  return urls.every((m) => localRef(m[1]));
}

/**
 * The SVG document rebuilt from the allowlist, with ids prefixed by `prefix`
 * and an accessible name (role="img", aria-label). Null when it does not parse.
 */
export function sanitizeSvg(svg: string, prefix: string, label: string): string | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) {
    return null;
  }
  const rename = (v: string) =>
    v.replace(/url\(\s*['"]?#([^'")]+)['"]?\s*\)/g, `url(#${prefix}$1)`);
  const clean = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ELEMENTS.has(child.localName) || child.namespaceURI !== SVG_NS) {
        child.remove();
        continue;
      }
      clean(child);
    }
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      const value = a.value;
      let keep = !name.startsWith('on');
      if (name === 'href' || name === 'xlink:href') keep = localRef(value);
      if (keep && /url\(|expression|@import|javascript:/i.test(value)) keep = safeCss(value);
      if (!keep) {
        el.removeAttribute(a.name);
        continue;
      }
      if (name === 'id') el.setAttribute(a.name, prefix + value);
      else if (name === 'href' || name === 'xlink:href') {
        el.setAttribute(a.name, `#${prefix}${value.trim().slice(1)}`);
      } else if (value.includes('url(')) el.setAttribute(a.name, rename(value));
    }
  };
  clean(root);
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  root.removeAttribute('aria-hidden');
  return new XMLSerializer().serializeToString(root);
}

/** The SVG text inside a base64 data URL (an <img> of a diagram), or null. */
export function svgFromDataUrl(src: string): string | null {
  const m = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
