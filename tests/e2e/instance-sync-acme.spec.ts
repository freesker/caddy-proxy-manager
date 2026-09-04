/**
 * Functional test: master → slave settings sync for the ACME group (issue #192).
 *
 * Verifies the cross-instance sync path end-to-end: a custom ACME directory set
 * on a master instance (web-master:3002) is pushed over HTTP to a slave
 * (web-slave:3003) and surfaces as the slave's effective ACME setting.
 *
 * Both instances have isolated Caddy sidecars, so they exercise the same atomic
 * settings-apply path as production without touching the shared E2E Caddy.
 *
 * Guards against the regression where a new setting group is added but not wired
 * into instance-sync's SyncSettings allowlist (so it silently never syncs).
 */
import { test, expect, type BrowserContext, type Browser } from '@playwright/test';

const MASTER = 'http://localhost:3002';
const SLAVE = 'http://localhost:3003';
const CUSTOM_DIR = 'https://ca.internal.example.com/acme/acme/directory';

/** Log into a standalone instance (no shared storageState) and return its context. */
async function loginContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
  await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await page.close();
  return context;
}

test.describe.serial('Instance sync — ACME settings (master → slave)', () => {
  let master: BrowserContext;
  let slave: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    master = await loginContext(browser, MASTER);
    slave = await loginContext(browser, SLAVE);
  });

  test.afterAll(async () => {
    // Reset the master's ACME setting and push the cleared value to the slave.
    await master.request.put(`${MASTER}/api/v1/settings/acme`, {
      data: { caUrl: '', caRootPem: '' },
      headers: { 'Content-Type': 'application/json', Origin: MASTER },
    });
    await master.request.post(`${MASTER}/api/v1/instances/sync`, { headers: { Origin: MASTER } });
    await master.close();
    await slave.close();
  });

  test('master propagates a custom ACME directory to the slave', async () => {
    // 1. Set the custom ACME directory on the master.
    const put = await master.request.put(`${MASTER}/api/v1/settings/acme`, {
      data: { caUrl: CUSTOM_DIR },
      headers: { 'Content-Type': 'application/json', Origin: MASTER },
    });
    expect(put.status()).toBe(200);

    // Sanity: the master reads it back.
    const masterGet = await master.request.get(`${MASTER}/api/v1/settings/acme`);
    expect((await masterGet.json()).caUrl).toBe(CUSTOM_DIR);

    // 2. Trigger a push to slaves (independent of Caddy reachability).
    const sync = await master.request.post(`${MASTER}/api/v1/instances/sync`, { headers: { Origin: MASTER } });
    expect(sync.status()).toBe(200);

    expect(await sync.json()).toMatchObject({ total: 1, success: 1, failed: 0 });

    // 3. The slave's effective ACME setting now reflects the master's value.
    await expect.poll(async () => {
      const res = await slave.request.get(`${SLAVE}/api/v1/settings/acme`);
      if (res.status() !== 200) return null;
      return (await res.json()).caUrl ?? null;
    }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(CUSTOM_DIR);
  });
});
