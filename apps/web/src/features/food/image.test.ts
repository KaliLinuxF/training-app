import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoError } from './errors';
import {
  checkPhotoFile,
  decodeImage,
  fitWithin,
  FULL_SPEC,
  MAX_PHOTO_BYTES,
  preparePhoto,
  stripDataUrl,
  THUMB_SPEC,
  type PhotoDeps,
  type Size,
} from './image';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin({ width: 3024, height: 4032 }, 1280)).toEqual({ width: 960, height: 1280 });
    expect(fitWithin({ width: 1280, height: 960 }, 320)).toEqual({ width: 320, height: 240 });
    expect(fitWithin({ width: 3000, height: 3000 }, 1280)).toEqual({ width: 1280, height: 1280 });
  });

  it('never upscales and rounds to whole pixels', () => {
    expect(fitWithin({ width: 800, height: 600 }, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: 1281, height: 721 }, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin({ width: 5000, height: 2 }, 320)).toEqual({ width: 320, height: 1 });
  });

  it('degenerate sizes become 0×0', () => {
    expect(fitWithin({ width: 0, height: 100 }, 320)).toEqual({ width: 0, height: 0 });
    expect(fitWithin({ width: Number.NaN, height: 100 }, 320)).toEqual({ width: 0, height: 0 });
  });
});

describe('checkPhotoFile', () => {
  const file = (type: string, size: number, name = 'IMG_0001.jpg') => ({ type, size, name });

  it('accepts images up to 25 MB', () => {
    expect(() => checkPhotoFile(file('image/jpeg', 3_000_000))).not.toThrow();
    expect(() => checkPhotoFile(file('image/heic', MAX_PHOTO_BYTES))).not.toThrow();
    // Some pickers leave the type empty: the extension decides then.
    expect(() => checkPhotoFile(file('', 1000, 'photo.HEIC'))).not.toThrow();
  });

  it('rejects other files and huge ones with a friendly reason', () => {
    const reason = (f: ReturnType<typeof file>) => {
      try {
        checkPhotoFile(f);
        return null;
      } catch (e) {
        return e instanceof PhotoError ? e.problem : 'other';
      }
    };
    expect(reason(file('application/pdf', 1000, 'menu.pdf'))).toBe('not_image');
    expect(reason(file('', 1000, 'notes.txt'))).toBe('not_image');
    expect(reason(file('image/jpeg', MAX_PHOTO_BYTES + 1))).toBe('too_big');
    expect(reason(file('image/jpeg', 0))).toBe('unreadable');
  });
});

describe('stripDataUrl', () => {
  it('drops the data: prefix', () => {
    expect(stripDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
    expect(stripDataUrl('/9j/4AAQ')).toBe('/9j/4AAQ');
  });
});

describe('preparePhoto', () => {
  function fakeDeps(size: Size) {
    const encodes: { from: string; size: Size; quality: number }[] = [];
    const release = vi.fn();
    const deps: PhotoDeps = {
      decode: vi.fn(async () => ({ source: { tag: 'original' } as unknown as CanvasImageSource, ...size, release })),
      encode: vi.fn(async (src: CanvasImageSource, s: Size, quality: number) => {
        const from = (src as unknown as { tag: string }).tag;
        encodes.push({ from, size: s, quality });
        const canvas = { tag: `canvas${s.width}` } as unknown as CanvasImageSource;
        return { canvas, blob: new Blob([`${s.width}x${s.height}`]) };
      }),
      toBase64: vi.fn(async (blob: Blob) => btoa(await blob.text())),
    };
    return { deps, encodes, release };
  }

  it('makes a 1280px full JPEG and a 320px thumbnail drawn from it', async () => {
    const { deps, encodes, release } = fakeDeps({ width: 4032, height: 3024 });
    const file = new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' });
    const out = await preparePhoto(file, deps);
    expect(encodes).toEqual([
      { from: 'original', size: { width: 1280, height: 960 }, quality: FULL_SPEC.quality },
      { from: 'canvas1280', size: { width: 320, height: 240 }, quality: THUMB_SPEC.quality },
    ]);
    expect(out.full).toBe(btoa('1280x960'));
    expect(out.thumb).toBe(btoa('320x240'));
    expect(out.previewUrl).toBe(`data:image/jpeg;base64,${btoa('320x240')}`);
    expect(out.size).toEqual({ width: 1280, height: 960 });
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps small photos at their size', async () => {
    const { deps, encodes } = fakeDeps({ width: 300, height: 200 });
    await preparePhoto(new File(['x'], 'a.png', { type: 'image/png' }), deps);
    expect(encodes.map((e) => e.size)).toEqual([
      { width: 300, height: 200 },
      { width: 300, height: 200 },
    ]);
  });

  it('rejects before decoding when the file is not an image', async () => {
    const { deps } = fakeDeps({ width: 10, height: 10 });
    await expect(preparePhoto(new File(['x'], 'a.pdf', { type: 'application/pdf' }), deps)).rejects.toMatchObject({
      problem: 'not_image',
    });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('turns decode and encode failures into «unreadable» and still releases the bitmap', async () => {
    const { deps, release } = fakeDeps({ width: 10, height: 10 });
    deps.decode = vi.fn(async () => {
      throw new Error('HEIC not supported');
    });
    await expect(preparePhoto(new File(['x'], 'a.heic', { type: 'image/heic' }), deps)).rejects.toMatchObject({
      problem: 'unreadable',
    });

    const second = fakeDeps({ width: 10, height: 10 });
    second.deps.encode = vi.fn(async () => {
      throw new Error('canvas tainted');
    });
    await expect(preparePhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), second.deps)).rejects.toMatchObject({
      problem: 'unreadable',
    });
    expect(second.release).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('decodeImage', () => {
  it('uses createImageBitmap with EXIF orientation', async () => {
    const bitmap = { width: 3024, height: 4032, close: vi.fn() };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', create);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const img = await decodeImage(blob);
    expect(create).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' });
    expect(img).toMatchObject({ width: 3024, height: 4032, source: bitmap });
    img.release();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('falls back to an <img> when createImageBitmap rejects', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new TypeError('options not supported');
      }),
    );
    // jsdom has no object URLs: install fakes for this test only.
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const revokeUrl = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = revokeUrl;
    // …nor HTMLImageElement#decode.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      value: vi.fn(async () => undefined),
      configurable: true,
      writable: true,
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1600);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1200);
    try {
      const img = await decodeImage(new Blob(['x'], { type: 'image/jpeg' }));
      expect(img.source).toBeInstanceOf(HTMLImageElement);
      expect((img.source as HTMLImageElement).src).toBe('blob:photo');
      expect(img).toMatchObject({ width: 1600, height: 1200 });
      img.release();
      expect(revokeUrl).toHaveBeenCalledWith('blob:photo');
    } finally {
      URL.createObjectURL = saved.create;
      URL.revokeObjectURL = saved.revoke;
      Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    }
  });
});
