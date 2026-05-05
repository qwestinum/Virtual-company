import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, '..', 'public', 'avatars');

const SIZE = 256;

const AGENTS = [
  { filename: 'manager', color: '#1e3a8a', initials: 'MR' },
  { filename: 'cv-analyzer', color: '#0d9488', initials: 'CV' },
  { filename: 'mail-composer', color: '#d97706', initials: 'MC' },
  { filename: 'job-writer', color: '#7c3aed', initials: 'JW' },
  { filename: 'scheduler', color: '#16a34a', initials: 'SC' },
];

function svgFor({ color, initials }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.78"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 0.2}" fill="url(#bg)"/>
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE * 0.34}" fill="rgba(255,255,255,0.96)"/>
  <text
    x="50%" y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    font-size="${SIZE * 0.34}"
    font-weight="700"
    fill="${color}"
    letter-spacing="-2">${initials}</text>
</svg>`;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  for (const agent of AGENTS) {
    const svg = svgFor(agent);
    const out = join(outputDir, `${agent.filename}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
    process.stdout.write(`  ✓ ${out}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
