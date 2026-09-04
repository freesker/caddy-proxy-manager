import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

// docker/clickhouse/config.d/low-disk-write.xml is mounted into the ClickHouse
// container by docker-compose.yml and turns the diagnostic system-log tables off
// with remove="1". On stock ClickHouse they flush every 7.5s even when the proxy
// is idle — metric_log alone writes ~1.3 MiB per four idle minutes — so disabling
// them keeps disk writes proportional to real traffic. The override file is the
// single source of truth here; reading it means this test cannot drift from it.
const overrideXml = readFileSync(
  fileURLToPath(new URL('../../docker/clickhouse/config.d/low-disk-write.xml', import.meta.url)),
  'utf8',
);
const DISABLED_SYSTEM_LOGS = [...overrideXml.matchAll(/<([a-z_]+_log)\s+remove="1"\s*\/>/g)].map((m) => m[1]);

// Log tables we deliberately leave enabled. crash_log only writes when the
// server actually crashes, so it costs nothing at idle.
const ALLOWED_PERSISTENT_LOGS = new Set(['crash_log']);

// ClickHouse HTTP port is exposed to the host by tests/docker-compose.test.yml.
function makeClient(): ClickHouseClient {
  return createClient({
    url: 'http://localhost:8123',
    username: 'cpm',
    password: 'test-clickhouse-password-2026',
    database: 'analytics',
  });
}

test.describe('ClickHouse internal system logs disabled', () => {
  test('the override actually lists the timer-driven writers', () => {
    // Guards against an empty or malformed file silently disabling nothing.
    expect(DISABLED_SYSTEM_LOGS).toEqual(
      expect.arrayContaining(['metric_log', 'asynchronous_metric_log', 'error_log', 'query_metric_log']),
    );
  });

  test('none of the disabled diagnostic system-log tables exist', async () => {
    const ch = makeClient();
    // Table names come from our own config file, so an inline IN list is fine.
    const inList = DISABLED_SYSTEM_LOGS.map((n) => `'${n}'`).join(', ');
    try {
      // remove="1" stops ClickHouse from ever setting up these log queues, so
      // the tables are never created. If the override is dropped or unmounted,
      // they reappear in system.tables and this assertion fails.
      const result = await ch.query({
        query: `SELECT name FROM system.tables WHERE database = 'system' AND name IN (${inList}) ORDER BY name`,
        format: 'JSONEachRow',
      });
      const present = (await result.json<{ name: string }>()).map((r) => r.name);
      expect(present, `disabled system-log tables should not exist, found: ${present.join(', ')}`).toEqual([]);
    } finally {
      await ch.close();
    }
  });

  test('no unlisted system log table is writing to disk', async () => {
    // The failure mode this catches: ClickHouse adds a new *_log to its defaults
    // on an upgrade, our enumerated override does not cover it, and it quietly
    // starts filling the data volume again. Only MergeTree-backed tables store
    // anything — views such as system.user_query_log hold no data of their own.
    const ch = makeClient();
    try {
      const result = await ch.query({
        query: `SELECT name FROM system.tables
                WHERE database = 'system'
                  AND match(name, '_log(_[0-9]+)?$')
                  AND engine LIKE '%MergeTree%'
                ORDER BY name`,
        format: 'JSONEachRow',
      });
      const unexpected = (await result.json<{ name: string }>())
        .map((r) => r.name)
        .filter((name) => !ALLOWED_PERSISTENT_LOGS.has(name));
      expect(
        unexpected,
        `unlisted persistent system-log tables found: ${unexpected.join(', ')}. ` +
          `Add them to docker/clickhouse/config.d/low-disk-write.xml and to ` +
          `DISABLED_SYSTEM_LOGS in src/lib/clickhouse/client.ts.`,
      ).toEqual([]);
    } finally {
      await ch.close();
    }
  });
});
