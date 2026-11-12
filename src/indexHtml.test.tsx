// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
// index.html: the start-up splash shows before the JavaScript bundle loads and goes when React mounts, and the page
// needs nothing inline that the Content-Security-Policy would have to allow (no inline script, style or handler; the
// policy itself has no 'unsafe-inline' for scripts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');

describe('start-up splash', () => {
  it('is in the page itself, accessible, with its stylesheet linked in the head', () => {
    const splash = page.querySelector('#root > .splash')!;
    expect(splash).not.toBeNull();
    expect(splash.getAttribute('role')).toBe('status');
    expect(splash.getAttribute('aria-live')).toBe('polite');
    expect(splash.textContent).toContain('PLS Studio');
    expect(splash.textContent).toContain('Loading');
    expect(
      page.head.querySelector('link[rel="stylesheet"][href="/src/splash.css"]'),
    ).not.toBeNull();
  });

  it('respects the colour scheme and reduced motion', () => {
    const css = readFileSync(join(root, 'src', 'splash.css'), 'utf8');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.splash-bar span \{ animation: none;/,
    );
  });

  it('is replaced when React mounts', () => {
    document.body.innerHTML = page.getElementById('root')!.outerHTML;
    const container = document.getElementById('root')!;
    expect(container.querySelector('.splash')).not.toBeNull();
    const reactRoot = createRoot(container);
    act(() => reactRoot.render(<div className="app">app</div>));
    expect(container.querySelector('.splash')).toBeNull();
    expect(container.querySelector('.app')?.textContent).toBe('app');
    act(() => reactRoot.unmount());
  });
});

describe('index.html under the Content-Security-Policy', () => {
  it('has no inline script: every script is a same-origin file', () => {
    const scripts = [...page.querySelectorAll('script')];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s.getAttribute('src')).toMatch(/^\/(?!\/)/);
      expect(s.textContent?.trim()).toBe('');
    }
  });

  it('has no inline style or event handler, and stylesheets only from allowed origins', () => {
    expect(page.querySelectorAll('style')).toHaveLength(0);
    for (const el of page.querySelectorAll('*')) {
      expect(el.hasAttribute('style'), `<${el.tagName.toLowerCase()} style>`).toBe(false);
      for (const a of el.getAttributeNames()) expect(a.startsWith('on'), a).toBe(false);
    }
    for (const link of page.querySelectorAll('link[rel="stylesheet"]'))
      expect(link.getAttribute('href')).toMatch(/^(\/(?!\/)|https:\/\/fonts\.googleapis\.com\/)/);
  });

  it('is served under a script policy without unsafe-inline (the production build’s policy)', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    const scriptSrc = config.match(/"script-src [^"]*"/)?.[0];
    expect(scriptSrc).toBe(`"script-src 'self' 'wasm-unsafe-eval'"`);
  });
});
