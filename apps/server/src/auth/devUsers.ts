import { usernameKey, usernameProblem } from '@legko/shared';
import type { Config } from '../config';
import type { Database } from '../db/sqlite';
import { createUserRepo } from '../db/users';
import type { Logger } from '../logger';
import { DEFAULT_SCRYPT, hashPassword, type ScryptParams } from './password';

/**
 * Development bootstrap (docs/multi-user.md §11.3): makes sure the `DEV_USERNAME` user (role user; the legacy owner
 * when there is none yet) and the `DEV_ADMIN_USERNAME` admin exist with their dev passwords. A missing user is
 * created; an existing one gets the password only when it has none. `config.devUsers` is always empty in production,
 * so this never touches a real installation.
 */
export async function applyDevUsers(
  db: Database,
  config: Pick<Config, 'devUsers'>,
  logger: Logger,
  scrypt: ScryptParams = DEFAULT_SCRYPT,
): Promise<void> {
  const users = createUserRepo(db);
  for (const dev of config.devUsers) {
    const problem = usernameProblem(dev.username, { allowAdmin: true });
    if (problem) {
      logger.warn(`dev user "${dev.username}" skipped: invalid username (${problem})`);
      continue;
    }
    const existing = users.byKey(usernameKey(dev.username));
    if (existing?.passwordHash) continue;
    const hash = await hashPassword(dev.password, scrypt);
    const now = Date.now();
    if (existing) {
      users.setPasswordHash(existing.id, hash, { now, via: 'cli', by: null });
      logger.warn(`dev password applied to ${existing.username} (development only)`);
      continue;
    }
    const legacyOwner = dev.role === 'user' && users.legacyOwner() === null;
    const created = users.create({
      username: dev.username,
      role: dev.role,
      passwordHash: hash,
      now,
      legacyOwner,
    });
    logger.warn(`dev user ${created.username} (${created.role}) created (development only)`);
  }
}
