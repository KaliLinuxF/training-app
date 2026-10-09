import { minutesOf, zonedNow, type HM, type ISODate } from '@legko/shared';
import { BACKUP_TIMEZONE } from '../backup';
import { silentLogger, type Logger } from '../logger';
import type { PhotoStore } from './store';

/** Right after the daily backup (03:30 Kyiv), on the same scheduler tick. */
export const PHOTO_GC_TIME: HM = '03:40';

export interface PhotoGcJob {
  /** Called by the scheduler: collects garbage once a day after the slot (catching up after a restart). */
  tick(now: Date): void;
}

export interface PhotoGcJobOptions {
  photos: PhotoStore;
  logger?: Logger;
  time?: HM;
  timeZone?: string;
}

export function createPhotoGcJob({
  photos,
  logger = silentLogger,
  time = PHOTO_GC_TIME,
  timeZone = BACKUP_TIMEZONE,
}: PhotoGcJobOptions): PhotoGcJob {
  const slot = minutesOf(time);
  let lastRun: ISODate | null = null;

  return {
    tick(now) {
      const z = zonedNow(timeZone, now);
      if (z.minutes < slot || lastRun === z.date) return;
      lastRun = z.date;
      const { photos: removed, strayFiles } = photos.collectGarbage(now.getTime());
      const line = `photo gc: removed ${removed.length} unused photo(s), ${strayFiles.length} stray file(s)`;
      if (removed.length || strayFiles.length) logger.info(line);
      else logger.debug(line);
    },
  };
}
