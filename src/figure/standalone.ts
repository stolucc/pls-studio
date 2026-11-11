// An SVG drawn on screen (styled by the app's stylesheet) as a standalone
// document for export: the computed presentation styles of every element are
// written onto it as attributes, so PDF (svg2pdf.js) and PNG renderers that
// never see the stylesheet draw it as it looks.

const PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
] as const;

export function standaloneSvg(el: SVGSVGElement, width: number, height: number): string {
  const clone = el.cloneNode(true) as SVGSVGElement;
  const src = [el, ...el.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((node, i) => {
    const cs = getComputedStyle(node);
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) dst[i].setAttribute(p, v);
    }
    dst[i].removeAttribute('class');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // A white page behind the chart (fonts are the PDF standard families chosen in the chart style).
  const bg = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    fill: '#ffffff',
  }))
    bg.setAttribute(k, v);
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
