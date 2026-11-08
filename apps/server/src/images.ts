/**
 * Uploaded images become one-page decks (media uploads plan, U13): reduced to fit the
 * screen, upright, on black, as JPEG, with a small copy for phones.
 */
import sharp, { type OutputInfo } from 'sharp';
import { join } from 'node:path';
import type { ConvertedDeck } from './decks/convert';

/** Images over this many pixels are refused before decoding (M0.1). */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** An image that cannot be used, with the reason for the operator. */
export class ImageError extends Error {}

/**
 * Writes `001.jpg`, fitting within 1920 × 1080 and never enlarged, and its small copy
 * `t-001.jpg` within 320 × 240, into `outDir`, as a deck converter would.
 */
export async function convertImage(source: string, outDir: string): Promise<ConvertedDeck> {
  const image = join(outDir, '001.jpg');
  const thumbnail = join(outDir, 't-001.jpg');
  let info: OutputInfo;
  try {
    info = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
      .rotate()
      .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#000000' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/pixel limit/i.test(message)) {
      throw new ImageError('This image is too large: it has more than 100 megapixels.', {
        cause: error,
      });
    }
    throw new ImageError('This file is not an image Worship Q can read.', { cause: error });
  }
  await sharp(image)
    .resize({ width: 320, height: 240, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(thumbnail);
  return {
    width: info.width,
    height: info.height,
    pages: [{ image: '001.jpg', thumbnail: 't-001.jpg', slide: 1, step: 0, text: [] }],
  };
}
