import { crc32, deflateSync } from 'node:zlib';

/**
 * A synthetic PNG made in memory: a colored gradient with a grid, so that
 * different crops look different. Nothing here is protected artwork.
 */
export function makePng(width: number, height: number, seed = 0): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const offset = y * row + 1 + x * 3;
      const grid = x % 200 < 4 || y % 200 < 4 ? 255 : 0;
      raw[offset] = grid || (x * 255) / width + seed * 40;
      raw[offset + 1] = grid || (y * 255) / height + seed * 70;
      raw[offset + 2] = grid || ((x + y) % 128) * 2 + seed * 20;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const pngFile = (name: string, width: number, height: number, seed = 0) => ({
  name,
  mimeType: 'image/png',
  buffer: makePng(width, height, seed),
});
