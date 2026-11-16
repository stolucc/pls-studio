// Charts drawn by ggplot2 (R/ggplot.R): the figure as a file in each format, the script that draws it, and the
// request checks that keep text and colours out of the code. In the browser's R: PDF and PNG (no svglite); with
// PS_NATIVE_R=1 desktop R also draws SVG.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHART_STYLE } from '../figure/chartStyle';
import { ggplotFile, ggplotScript, type FigureSpec } from '../figure/ggplot';
import { rCall } from './bridge';
import { helperLibrary } from './nativeR';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const grid = Array.from({ length: 21 }, (_, i) => -0.5 + i * 0.05);
const spec: FigureSpec = {
  title: 'Distribution of the estimates at N = 100',
  x: { title: 'Estimate' },
  y: { title: 'Density' },
  width: 520,
  height: 300,
  layers: [
    {
      geom: 'line',
      series: 'PLS mode A, centroid',
      color: '#2a78d6',
      x: grid,
      y: grid.map((x) => Math.exp(-(((x - 0.2) / 0.1) ** 2))),
    },
    {
      geom: 'line',
      series: 'Sum "scores"',
      color: '#eb6834',
      linetype: 'dashed',
      x: grid,
      y: grid.map((x) => Math.exp(-((x / 0.1) ** 2))),
    },
    { geom: 'vline', color: '#8a8f98', linetype: 'dashed', x: [0] },
    {
      geom: 'rect',
      series: 'Bins',
      color: '#1baf7a',
      xmin: [0],
      xmax: [0.1],
      ymin: [0],
      ymax: [0.5],
    },
  ],
};
const style = { ...DEFAULT_CHART_STYLE, theme: 'bw' as const, font: 'serif' as const };
// (svglite comes with the helper's setup from the release that added it; until then the SVG test waits for it)
const svglite = !!process.env.PS_NATIVE_R && existsSync(join(helperLibrary(), 'svglite'));
const head = async (b: Blob, n: number) => new Uint8Array(await b.arrayBuffer()).slice(0, n);

describe('charts drawn by ggplot2', () => {
  it('draws the figure as a PDF and a PNG', async () => {
    const pdf = await ggplotFile(spec, style, 'pdf');
    expect(new TextDecoder().decode(await head(pdf, 5))).toBe('%PDF-');
    expect(pdf.type).toBe('application/pdf');
    const png = await ggplotFile(spec, style, 'png');
    expect([...(await head(png, 4))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 120_000);

  it.runIf(svglite)(
    'draws an SVG in desktop R',
    async () => {
      const svg = await ggplotFile(spec, style, 'svg');
      expect(await svg.text()).toContain('<svg');
    },
    120_000,
  );

  it('writes a script with the data, a legend entry per series and the chart style', async () => {
    const script = await ggplotScript(spec, style);
    expect(script).toContain('library(ggplot2)');
    expect(script).toContain('layer_1 <- read.csv(text =');
    expect(script).toContain(
      'scale_colour_manual(values = c("PLS mode A, centroid" = "#2a78d6", "Sum \\"scores\\"" = "#eb6834"',
    );
    expect(script).toContain('scale_linetype_manual(values = c(');
    expect(script).toContain('"dashed"');
    expect(script).toContain('geom_vline(data = layer_3, aes(xintercept = x), colour = "#8a8f98"');
    expect(script).toContain('geom_rect(data = layer_4');
    expect(script).toContain('labs(x = "Estimate", y = "Density")');
    expect(script).toContain('theme_bw(base_size = 11, base_family = "serif")');
  }, 120_000);

  it('refuses a request that would put anything but its fixed words into the code', async () => {
    const req = (patch: Record<string, unknown>, layer: Record<string, unknown> = {}) => ({
      x: { title: 'x' },
      y: { title: 'y' },
      ...patch,
      layers: [{ geom: 'line', color: '#2a78d6', x: [1, 2], y: [1, 2], ...layer }],
    });
    for (const [patch, layer, msg] of [
      [{}, { color: 'red"); system("id") #' }, 'Invalid colour'],
      [{}, { geom: 'line); system("id"' }, 'Invalid geom'],
      [{ theme: 'theme_bw(); system("id")' }, {}, 'Invalid theme'],
      [{}, { linetype: 'solid"); system("id' }, 'Invalid line type'],
      [{ size: '11); system("id"' }, {}, 'Invalid font size'],
      [{}, { x: ['1', '2'] }, 'Invalid x'],
    ] as const)
      await expect(rCall('ps_ggplot', req(patch, layer), 'ggplot2')).rejects.toThrow(msg);
  }, 120_000);

  it('names a reference line in the legend and puts sample sizes on a log scale', async () => {
    const power: FigureSpec = {
      title: 'Power by sample size',
      x: { title: 'Sample size', log: true },
      y: { title: 'Power', limits: [0, 1], percent: true },
      width: 460,
      height: 240,
      layers: [
        { geom: 'line', series: 'PLS', color: '#2a78d6', x: [50, 100, 200], y: [0.3, null, 0.9] },
        { geom: 'point', series: 'PLS', color: '#2a78d6', x: [50, 100, 200], y: [0.3, null, 0.9] },
        { geom: 'hline', series: 'Power .80', color: '#8a8f98', linetype: 'dashed', y: [0.8] },
      ],
    };
    const script = await ggplotScript(power, style);
    expect(script).toContain(
      'geom_hline(data = layer_3, aes(yintercept = y, colour = series, linetype = series), linewidth = 0.7)',
    );
    expect(script).toContain('scale_x_log10() +');
    expect(script).toContain('scale_y_continuous(labels = scales::label_percent()) +');
    expect(script).toContain(
      'scale_linetype_manual(values = c("PLS" = "solid", "Power .80" = "dashed")',
    );
    const pdf = await ggplotFile(power, style, 'pdf');
    expect(new TextDecoder().decode(await head(pdf, 5))).toBe('%PDF-');
  }, 120_000);
});
