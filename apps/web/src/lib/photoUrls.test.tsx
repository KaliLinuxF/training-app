import { photoThumbUrl, photoUrl } from '@legko/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OWN_PHOTO_URLS, PhotoUrlsProvider, usePhotoUrls, type PhotoUrls } from './photoUrls';

afterEach(cleanup);

const ID = 'aaaaaaaaaaaaaaaa';

function Probe() {
  const urls = usePhotoUrls();
  return (
    <p>
      <span data-testid="thumb">{urls.thumb(ID)}</span>
      <span data-testid="full">{urls.full(ID)}</span>
    </p>
  );
}

const shown = () => [screen.getByTestId('thumb').textContent, screen.getByTestId('full').textContent];

describe('photoUrls', () => {
  it('OWN_PHOTO_URLS are her own photo routes', () => {
    expect(OWN_PHOTO_URLS.thumb(ID)).toBe(photoThumbUrl(ID));
    expect(OWN_PHOTO_URLS.full(ID)).toBe(photoUrl(ID));
    expect(OWN_PHOTO_URLS.thumb(ID)).toBe(`/api/photos/${ID}/thumb`);
    expect(OWN_PHOTO_URLS.full(ID)).toBe(`/api/photos/${ID}`);
    expect(Object.isFrozen(OWN_PHOTO_URLS)).toBe(true);
  });

  it('without a provider the hook gives OWN_PHOTO_URLS (the same object every render)', () => {
    const seen: PhotoUrls[] = [];
    function Capture() {
      seen.push(usePhotoUrls());
      return null;
    }
    const { rerender } = render(<Capture />);
    rerender(<Capture />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(OWN_PHOTO_URLS);
    expect(seen[1]).toBe(OWN_PHOTO_URLS);
  });

  it('a provider serves its subtree only; the nearest one wins', () => {
    const coach: PhotoUrls = {
      thumb: (id) => `/api/coach/clients/7/photos/${id}/thumb`,
      full: (id) => `/api/coach/clients/7/photos/${id}`,
    };
    const inner: PhotoUrls = { thumb: (id) => `inner-t-${id}`, full: (id) => `inner-f-${id}` };
    const { rerender } = render(
      <PhotoUrlsProvider value={coach}>
        <Probe />
      </PhotoUrlsProvider>,
    );
    expect(shown()).toEqual([`/api/coach/clients/7/photos/${ID}/thumb`, `/api/coach/clients/7/photos/${ID}`]);

    rerender(
      <PhotoUrlsProvider value={coach}>
        <PhotoUrlsProvider value={inner}>
          <Probe />
        </PhotoUrlsProvider>
      </PhotoUrlsProvider>,
    );
    expect(shown()).toEqual([`inner-t-${ID}`, `inner-f-${ID}`]);

    rerender(<Probe />);
    expect(shown()).toEqual([`/api/photos/${ID}/thumb`, `/api/photos/${ID}`]);
  });
});
