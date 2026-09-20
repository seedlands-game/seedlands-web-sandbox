import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const reconstructedCommit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const betaWikiCommit = '8bcc41aee34334c2b916e7b500abe6853b4fd704';
const allowed = [
  new RegExp(`^https://github\\.com/jacobo-mc/mc_b1\\.7\\.3_release/blob/${reconstructedCommit}/`),
  new RegExp(`^https://raw\\.githubusercontent\\.com/jacobo-mc/mc_b1\\.7\\.3_release/${reconstructedCommit}/`),
  new RegExp(`^https://github\\.com/OfficialPixelBrush/beta-wiki/blob/${betaWikiCommit}/`),
  new RegExp(`^https://raw\\.githubusercontent\\.com/OfficialPixelBrush/beta-wiki/${betaWikiCommit}/`),
  /^https:\/\/wiki\.retromc\.org\/index\.php\?title=B1\.7\.3_data_values&oldid=9822$/,
  /^https:\/\/piston-meta\.mojang\.com\/v1\/packages\/44f6969326bd45aa00dcd3c4ca3a7c05ebb24c04\/b1\.7\.3\.json$/,
];

function collectUrls(value, urls) {
  function visit(node) {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/https?:\/\/[^\s<>"']+/g)) urls.add(match[0]);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  }
  visit(value);
}

export function findUnpinnedUrls(value) {
  const urls = new Set();
  collectUrls(value, urls);
  return { uniqueUrls: urls.size, unpinned: [...urls].filter((uri) => !allowed.some((pattern) => pattern.test(uri))) };
}

export async function verifySourcePinPolicy(root) {
  const names = (await readdir(root)).filter((name) => name.endsWith('.json') && name !== 'contract-snapshot.json');
  const urls = new Set();
  for (const name of names) {
    const text = await readFile(join(root, name), 'utf8');
    collectUrls(JSON.parse(text), urls);
  }
  const result = findUnpinnedUrls([...urls]);
  if (result.unpinned.length) throw new Error(`Unpinned source URLs: ${result.unpinned.slice(0, 8).join(', ')}`);
  return { jsonFiles: names.length, uniqueUrls: result.uniqueUrls, unpinned: 0 };
}
