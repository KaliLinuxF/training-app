/**
 * Food photo pipeline (SPEC §3.7): decode on the device with EXIF orientation applied,
 * downscale on a canvas to a full JPEG (≤ 1280 px, q 0.82) and a thumbnail (≤ 320 px, q 0.75),
 * and hand both to the API as base64 without the `data:` prefix.
 */
import { PhotoError } from './errors';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export interface JpegSpec {
  /** Longest side, px. */
  maxSide: number;
  quality: number;
}

export const FULL_SPEC: JpegSpec = { maxSide: 1280, quality: 0.82 };
export const THUMB_SPEC: JpegSpec = { maxSide: 320, quality: 0.75 };

export interface Size {
  width: number;
  height: number;
}

/** Scales `size` down (never up) so its longest side is at most `maxSide`; keeps the aspect ratio. */
export function fitWithin(size: Size, maxSide: number): Size {
  const { width, height } = size;
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const k = maxSide / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;

/** Rejects non-images and files over 25 MB. Some pickers leave `type` empty, so the extension counts too. */
export function checkPhotoFile(file: Pick<File, 'type' | 'size' | 'name'>): void {
  const isImage = file.type ? file.type.startsWith('image/') : IMAGE_EXT.test(file.name);
  if (!isImage) throw new PhotoError('not_image');
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoError('too_big');
  if (file.size === 0) throw new PhotoError('unreadable');
}

/** `data:image/jpeg;base64,AAAA` → `AAAA`. */
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export const jpegDataUrl = (base64: string): string => `data:image/jpeg;base64,${base64}`;

/** A decoded picture ready to draw on a canvas. */
export interface DecodedImage extends Size {
  source: CanvasImageSource;
  release: () => void;
}

export interface PhotoDeps {
  decode: (file: Blob) => Promise<DecodedImage>;
  /** Draws `src` at `size` and encodes it as JPEG. Returns the canvas (to draw the thumbnail from) and the blob. */
  encode: (src: CanvasImageSource, size: Size, quality: number) => Promise<{ canvas: CanvasImageSource; blob: Blob }>;
  toBase64: (blob: Blob) => Promise<string>;
}

export interface PreparedPhoto {
  full: string;
  thumb: string;
  /** Thumbnail as a `data:` URL for the loading and result cards. */
  previewUrl: string;
  size: Size;
}

/** Validates, decodes and downscales a chosen photo. Throws `PhotoError` for anything unusable. */
export async function preparePhoto(file: File, deps: PhotoDeps = browserPhotoDeps): Promise<PreparedPhoto> {
  checkPhotoFile(file);
  let img: DecodedImage;
  try {
    img = await deps.decode(file);
  } catch {
    throw new PhotoError('unreadable');
  }
  try {
    const fullSize = fitWithin(img, FULL_SPEC.maxSide);
    if (!fullSize.width) throw new PhotoError('unreadable');
    const full = await deps.encode(img.source, fullSize, FULL_SPEC.quality);
    // The thumbnail comes from the already downscaled canvas: cheaper and smoother than the original.
    const thumbSize = fitWithin(fullSize, THUMB_SPEC.maxSide);
    const thumb = await deps.encode(full.canvas, thumbSize, THUMB_SPEC.quality);
    const [fullB64, thumbB64] = await Promise.all([deps.toBase64(full.blob), deps.toBase64(thumb.blob)]);
    return { full: fullB64, thumb: thumbB64, previewUrl: jpegDataUrl(thumbB64), size: fullSize };
  } catch (err) {
    throw err instanceof PhotoError ? err : new PhotoError('unreadable');
  } finally {
    img.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Browser implementation

/** `createImageBitmap` with EXIF orientation; falls back to an <img> (which also honours EXIF). */
export async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Older Safari rejects the options bag or the format; the <img> path below handles both.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded =
      typeof img.decode === 'function'
        ? null
        : new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new PhotoError('unreadable'));
          });
    img.src = url;
    await (loaded ?? img.decode());
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function encodeJpeg(
  src: CanvasImageSource,
  size: Size,
  quality: number,
): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new PhotoError('unreadable'));
  // JPEG has no alpha: paint transparent PNGs on white instead of black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ canvas, blob }) : reject(new PhotoError('unreadable'))),
      'image/jpeg',
      quality,
    );
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUrl(String(reader.result)));
    reader.onerror = () => reject(reader.error ?? new PhotoError('unreadable'));
    reader.readAsDataURL(blob);
  });
}

export const browserPhotoDeps: PhotoDeps = { decode: decodeImage, encode: encodeJpeg, toBase64: blobToBase64 };
