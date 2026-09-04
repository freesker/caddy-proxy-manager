import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

function resetDbModuleState() {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __SQLITE_CLIENT__?: unknown }).__SQLITE_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

function createBrokenAccountsDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  sqlite.exec(`
    ALTER TABLE accounts RENAME TO accounts_old;
    CREATE TABLE accounts (
      id TEXT NOT NULL,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    )
    SELECT
      CAST(id AS TEXT), userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    FROM accounts_old;
    DROP TABLE accounts_old;
    CREATE UNIQUE INDEX accounts_provider_account_idx ON accounts (providerId, accountId);
    CREATE INDEX accounts_user_idx ON accounts (userId);
  `);

  sqlite.close();
}

function seedLegacyIssuerRows(dbPath: string) {
  const sqlite = new Database(dbPath);
  const now = new Date().toISOString();
  const insertUser = sqlite.prepare(`
    INSERT INTO users (
      email, name, role, provider, subject, status, emailVerified, createdAt, updatedAt
    ) VALUES (?, ?, 'user', ?, ?, 'active', 1, ?, ?)
  `);
  const credentialUser = insertUser.run(
    'legacy-credential@example.com',
    'Legacy Credential',
    'credentials',
    'legacy-credential',
    now,
    now
  );
  const oidcUser = insertUser.run(
    'legacy-oidc@example.com',
    'Legacy OIDC',
    'oidc-provider',
    'oidc-subject',
    now,
    now
  );
  const issuerlessUser = insertUser.run(
    'legacy-issuerless@example.com',
    'Legacy Issuerless',
    'plain/provider',
    'plain-subject',
    now,
    now
  );

  const insertProvider = sqlite.prepare(`
    INSERT INTO oauth_providers (
      id, name, type, clientId, clientSecret, issuer, scopes, autoLink,
      enabled, source, createdAt, updatedAt
    ) VALUES (?, ?, 'oidc', 'client-id', 'encrypted-secret', ?,
      'openid email profile', 0, 1, 'ui', ?, ?)
  `);
  insertProvider.run(
    'oidc-provider',
    'OIDC Provider',
    'https://issuer.example.com',
    now,
    now
  );
  insertProvider.run('plain/provider', 'Plain OAuth', null, now, now);

  const insertAccount = sqlite.prepare(`
    INSERT INTO accounts (
      id, userId, accountId, providerId, password, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertAccount.run(
    '101',
    Number(credentialUser.lastInsertRowid),
    String(credentialUser.lastInsertRowid),
    'credential',
    'legacy-password-hash',
    now,
    now
  );
  insertAccount.run(
    '102',
    Number(oidcUser.lastInsertRowid),
    'oidc-subject',
    'oidc-provider',
    null,
    now,
    now
  );
  insertAccount.run(
    '103',
    Number(issuerlessUser.lastInsertRowid),
    'plain-subject',
    'plain/provider',
    null,
    now,
    now
  );
  sqlite.close();
}

function seedLegacyIssuerCollision(dbPath: string) {
  const sqlite = new Database(dbPath);
  const now = new Date().toISOString();
  const insertUser = sqlite.prepare(`
    INSERT INTO users (
      email, name, role, provider, subject, status, emailVerified, createdAt, updatedAt
    ) VALUES (?, ?, 'user', ?, 'shared-subject', 'active', 1, ?, ?)
  `);
  const firstUser = insertUser.run('first@example.com', 'First', 'alias-a', now, now);
  const secondUser = insertUser.run('second@example.com', 'Second', 'alias-b', now, now);
  const insertProvider = sqlite.prepare(`
    INSERT INTO oauth_providers (
      id, name, type, clientId, clientSecret, issuer, scopes, autoLink,
      enabled, source, createdAt, updatedAt
    ) VALUES (?, ?, 'oidc', 'client-id', 'encrypted-secret',
      'https://shared-issuer.example.com', 'openid email profile', 0, 1, 'ui', ?, ?)
  `);
  insertProvider.run('alias-a', 'Alias A', now, now);
  insertProvider.run('alias-b', 'Alias B', now, now);
  const insertAccount = sqlite.prepare(`
    INSERT INTO accounts (
      id, userId, accountId, providerId, createdAt, updatedAt
    ) VALUES (?, ?, 'shared-subject', ?, ?, ?)
  `);
  insertAccount.run('201', Number(firstUser.lastInsertRowid), 'alias-a', now, now);
  insertAccount.run('202', Number(secondUser.lastInsertRowid), 'alias-b', now, now);
  sqlite.close();
}

describe('database compatibility for accounts schema', () => {
  afterEach(() => {
    process.env.DATABASE_URL = ':memory:';
    resetDbModuleState();
  });

  it('repairs legacy accounts.id schema and allows credential account creation', async () => {
    const tempDir = mkdtempSync(join(process.cwd(), 'tmp-db-compat-'));
    const dbPath = join(tempDir, 'compat.db');

    try {
      createBrokenAccountsDatabase(dbPath);

      process.env.DATABASE_URL = `file:${dbPath}`;
      resetDbModuleState();

      const { createUser } = await import('@/src/lib/models/user');
      await createUser({
        email: 'compat-user@example.com',
        name: 'Compat User',
        role: 'user',
        provider: 'credentials',
        subject: 'compat-user',
        passwordHash: 'hash123',
      });

      const sqlite = new Database(dbPath, { readonly: true });
      const accountColumns = sqlite.prepare('PRAGMA table_info("accounts")').all() as Array<{
        name: string;
        type: string;
        pk: number;
      }>;
      const idColumn = accountColumns.find((column) => column.name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn?.type.toUpperCase()).toBe('INTEGER');
      expect(idColumn?.pk).toBe(1);

      const user = sqlite.prepare('SELECT id FROM users WHERE email = ?').get('compat-user@example.com') as { id: number } | undefined;
      expect(user?.id).toBeDefined();

      const account = sqlite.prepare(
        'SELECT id, issuer, providerId, accountId, password FROM accounts WHERE userId = ? AND providerId = ?'
      ).get(user!.id, 'credential') as {
        id: number;
        issuer: string;
        providerId: string;
        accountId: string;
        password: string | null;
      } | undefined;

      expect(account).toBeDefined();
      expect(account?.id).toBeGreaterThan(0);
      expect(account?.issuer).toBe('local:credential');
      expect(account?.providerId).toBe('credential');
      expect(account?.accountId).toBe(String(user!.id));
      expect(account?.password).toBe('hash123');

      sqlite.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('backfills stable credential, configured-OIDC, and issuerless OAuth namespaces', async () => {
    const tempDir = mkdtempSync(join(process.cwd(), 'tmp-db-issuer-'));
    const dbPath = join(tempDir, 'issuer.db');

    try {
      createBrokenAccountsDatabase(dbPath);
      seedLegacyIssuerRows(dbPath);

      process.env.DATABASE_URL = `file:${dbPath}`;
      resetDbModuleState();
      await import('@/src/lib/db');

      const sqlite = new Database(dbPath, { readonly: true });
      const rows = sqlite.prepare(
        'SELECT providerId, issuer FROM accounts ORDER BY providerId'
      ).all() as Array<{ providerId: string; issuer: string }>;
      expect(rows).toEqual([
        { providerId: 'credential', issuer: 'local:credential' },
        { providerId: 'oidc-provider', issuer: 'https://issuer.example.com' },
        { providerId: 'plain/provider', issuer: 'local:oauth:plain%2Fprovider' },
      ]);

      const issuerColumn = (sqlite.prepare('PRAGMA table_info("accounts")').all() as Array<{
        name: string;
        notnull: number;
      }>).find((column) => column.name === 'issuer');
      expect(issuerColumn?.notnull).toBe(1);

      const indexColumns = sqlite.prepare(
        'PRAGMA index_info("accounts_issuer_account_idx")'
      ).all() as Array<{ name: string; seqno: number }>;
      expect(indexColumns.sort((a, b) => a.seqno - b.seqno).map((column) => column.name))
        .toEqual(['issuer', 'accountId']);
      sqlite.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses to merge colliding legacy identities during issuer backfill', async () => {
    const tempDir = mkdtempSync(join(process.cwd(), 'tmp-db-issuer-collision-'));
    const dbPath = join(tempDir, 'collision.db');

    try {
      createBrokenAccountsDatabase(dbPath);
      seedLegacyIssuerCollision(dbPath);

      process.env.DATABASE_URL = `file:${dbPath}`;
      resetDbModuleState();

      await expect(import('@/src/lib/db')).rejects.toThrow(/account identity collision/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
