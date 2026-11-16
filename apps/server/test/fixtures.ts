import sharp from 'sharp';

/**
 * Synthetic test pictures, generated in memory. They are small, free of any
 * rights, and made of a colored pattern so that every call can give a
 * different file (a different hash) and crops are visibly different.
 */
export async function makeImage(options: {
  width: number;
  height: number;
  format?: 'png' | 'jpeg' | 'webp';
  /** Changes the pattern, hence the hash. */
  seed?: number;
  /** EXIF orientation tag (1-8), written into the file. */
  orientation?: number;
  /** Adds readable EXIF text so tests can check it is stripped. */
  secret?: string;
}): Promise<Buffer> {
  const { width, height, format = 'png', seed = 0 } = options;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      raw[offset] = (x * 255) / width + seed * 37;
      raw[offset + 1] = (y * 255) / height + seed * 91;
      raw[offset + 2] = ((x + y) % 64) * 4 + seed * 13;
    }
  }
  let image = sharp(raw, { raw: { width, height, channels: 3 } });
  const metadata =
    options.secret !== undefined || options.orientation !== undefined
      ? {
          ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
          ...(options.secret === undefined
            ? {}
            : { exif: { IFD0: { Copyright: options.secret, ImageDescription: options.secret } } }),
        }
      : undefined;
  if (metadata) image = image.withMetadata(metadata);
  if (format === 'jpeg') return image.jpeg({ quality: 90 }).toBuffer();
  if (format === 'webp') return image.webp({ quality: 90 }).toBuffer();
  return image.png().toBuffer();
}
