import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Writes a few synthetic pictures for trying the image editor by hand: several
 * sizes and ratios, with a labelled grid so that frames are easy to check. They
 * are generated, free of any rights, and written to a directory that git
 * ignores (default `./test-images`).
 *
 *   pnpm samples:generate
 *   pnpm samples:generate ./some-other-ignored-folder
 */
const SAMPLES = [
  { name: 'landscape-1215x717', width: 1215, height: 717 },
  { name: 'landscape-1920x1080', width: 1920, height: 1080 },
  { name: 'portrait-1000x1800', width: 1000, height: 1800 },
  { name: 'square-1500x1500', width: 1500, height: 1500 },
  { name: 'high-res-3840x2160', width: 3840, height: 2160 },
  { name: 'very-high-res-6000x3375', width: 6000, height: 3375 },
] as const;

const out = path.resolve(process.argv[2] ?? './test-images');
await mkdir(out, { recursive: true });

for (const [index, sample] of SAMPLES.entries()) {
  const { width, height, name } = sample;
  const cell = Math.round(Math.min(width, height) / 10);
  const lines: string[] = [];
  for (let x = 0; x <= width; x += cell)
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
  for (let y = 0; y <= height; y += cell)
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
  const labels: string[] = [];
  for (let column = 0; column * cell < width; column += 1) {
    for (let row = 0; row * cell < height; row += 1) {
      labels.push(
        `<text x="${column * cell + cell / 2}" y="${row * cell + cell / 2}" font-size="${cell / 3}" text-anchor="middle" dominant-baseline="middle">${String.fromCharCode(65 + (column % 26))}${row + 1}</text>`,
      );
    }
  }
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<g stroke="rgba(255,255,255,0.55)" stroke-width="${Math.max(1, cell / 40)}">${lines.join('')}</g>` +
      `<g fill="rgba(255,255,255,0.9)" font-family="sans-serif">${labels.join('')}</g>` +
      `<text x="${width / 2}" y="${height / 2}" font-size="${cell * 1.2}" fill="white" stroke="black" stroke-width="${cell / 25}" font-family="sans-serif" text-anchor="middle">${width}x${height}</text>` +
      `</svg>`,
  );
  const hue = (index * 55) % 360;
  const file = path.join(out, `${name}.png`);
  await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 40, b: 70 } } })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,35%)"/><stop offset="1" stop-color="hsl(${(hue + 120) % 360},70%,55%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
        ),
      },
      { input: overlay },
    ])
    .png()
    .toFile(file);
  console.log(`${file}  (${width} x ${height})`);
}
console.log(`\n${SAMPLES.length} synthetic pictures written to ${out} (ignored by git).`);
