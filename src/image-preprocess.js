import sharp from 'sharp';

const TARGET_LONG_SIDE = 1600;
const MIN_LONG_SIDE = 1200;
const MAX_SCALE = 4;

/** Upscales a small photographed plate/label before OCR. A real phone photo of a nameplate is usually
 * high-resolution already, but photos sourced from listings or screenshots (small thumbnails, heavy
 * JPEG compression) often arrive well under 1000px on the long side — at that size, small printed text
 * (serial numbers, model codes) becomes illegible to the OCR recognizer even though the numbers
 * themselves are physically present in the image. Lanczos3 resampling plus a mild sharpen measurably
 * recovers those values in testing; below this size threshold the recognizer has nothing left to read
 * regardless of how the extraction logic is tuned. Returns the original buffer unchanged (never
 * throws) when the image is already large enough or preprocessing fails for any reason — this is a
 * best-effort quality improvement, not a requirement for the OCR call that follows it.
 * @param {Buffer} image */
export async function upscaleIfSmall(image) {
  try {
    const source = sharp(image, { failOn: 'none' });
    const metadata = await source.metadata();
    const longSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    if (!longSide || longSide >= MIN_LONG_SIDE) return image;
    const scale = Math.min(MAX_SCALE, TARGET_LONG_SIDE / longSide);
    return await source
      .resize({ width: Math.round((metadata.width ?? 0) * scale), height: Math.round((metadata.height ?? 0) * scale), kernel: 'lanczos3' })
      .sharpen()
      .png()
      .toBuffer();
  } catch { return image; }
}
