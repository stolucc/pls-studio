// Export the path diagram as vector PDF, PNG or SVG (from renderFigureSvg).

import { downloadBlob } from '../format';

export type FigureFormat = 'pdf' | 'png' | 'svg';

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Raster at `scale` × the figure size (scale 3 ≈ 300 dpi at the figure's natural size in points). */
export async function pngBlob(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not render the figure.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the PNG.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Vector PDF, one page the size of the figure (1 px = 1 pt). */
export async function pdfBlob(svg: string, width: number, height: number): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ unit: 'pt', format: [width, height], orientation: width > height ? 'landscape' : 'portrait' });
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as Element;
  // svg2pdf.js adds doc.svg().
  await (doc as unknown as { svg: (e: Element, o: object) => Promise<unknown> }).svg(el, { x: 0, y: 0, width, height });
  return doc.output('blob');
}

export async function exportFigure(format: FigureFormat, svg: string, width: number, height: number, name: string, scale = 3) {
  const blob = format === 'svg' ? svgBlob(svg) : format === 'png' ? await pngBlob(svg, width, height, scale) : await pdfBlob(svg, width, height);
  downloadBlob(`${name}.${format}`, blob);
}
