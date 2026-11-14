// The helper release workflow holds the release key (HELPER_SIGNING_KEY):
// whatever runs in it can sign a helper that every installed helper accepts.
// These checks pin down that only pinned code runs there, that only the
// publish job sees the key (in the protected environment helper-release, only
// for helper-v* tags), and that the signed version manifest is published.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(__dirname, '..', '.github', 'workflows', 'helper-release.yml'),
  'utf8',
);

/** The jobs of the workflow: name → its lines (two-space indented keys under `jobs:`). */
function jobs(text: string): Map<string, string> {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  const out = new Map<string, string>();
  let name = '';
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      name = header[1];
      out.set(name, '');
    } else if (name) {
      out.set(name, out.get(name) + line + '\n');
    }
  }
  return out;
}

describe('helper-release workflow', () => {
  it('pins every action by full commit SHA, with the version as a comment', () => {
    const uses = workflow.split('\n').filter((l) => /^\s*(-\s*)?uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, line).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/);
    }
  });

  it('gives the signing key only to the publish job, in the helper-release environment, for helper-v* tags', () => {
    const all = jobs(workflow);
    expect([...all.keys()]).toEqual(['build', 'release']);
    const withKey = [...all].filter(([, body]) => body.includes('secrets.HELPER_SIGNING_KEY'));
    expect(withKey.map(([name]) => name)).toEqual(['release']);
    const release = all.get('release') ?? '';
    expect(release).toMatch(/^ {4}environment: helper-release$/m);
    expect(release).toMatch(/^ {4}if: startsWith\(github\.ref, 'refs\/tags\/helper-v'\)$/m);
    // The key is only an environment variable of the signing step, never written out or echoed.
    expect(workflow.match(/secrets\.HELPER_SIGNING_KEY/g)).toHaveLength(1);
  });

  it('builds, signs and publishes the version manifest next to SHA256SUMS', () => {
    const release = jobs(workflow).get('release') ?? '';
    const manifest = release.indexOf('> RELEASE.json');
    const sign = release.indexOf('for f in SHA256SUMS RELEASE.json; do');
    const publish = release.indexOf('gh release create');
    expect(release.indexOf('> SHA256SUMS')).toBeLessThan(manifest);
    expect(manifest).toBeLessThan(sign);
    expect(sign).toBeLessThan(publish);
    // The version comes from the tag, checked to be a release version, and SHA256SUMS is hashed into it.
    expect(release).toContain('VERSION="${GITHUB_REF_NAME#helper-v}"');
    expect(release).toContain('=~ ^[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(release).toContain('--arg sums "$(sha256sum SHA256SUMS | cut -d\' \' -f1)"');
    expect(release).toContain(
      "'{version: $version, tag: $tag, sha256sums: $sums, published: $published}'",
    );
    // Old helpers keep using SHA256SUMS(.sig); new ones also need RELEASE.json(.sig).
    expect(release).toContain(
      'dist/SHA256SUMS dist/SHA256SUMS.sig dist/RELEASE.json dist/RELEASE.json.sig',
    );
  });
});
