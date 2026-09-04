import { test, expect, type Page } from '@playwright/test';

/**
 * Regression tests for analytics page resilience when the API misbehaves.
 *
 * The analytics endpoints answer failures with `{ error: "…" }` and a 5xx
 * status. The client used to call `response.json()` without checking
 * `response.ok`, so that error object landed in array-typed state and the first
 * `allHosts.some(...)` / `timeline.map(...)` threw during render. React
 * unmounted the entire page — the user saw a blank Analytics screen with no map
 * and no explanation. A single unreachable ClickHouse was enough to trigger it.
 *
 * Routes are stubbed here rather than stopping the ClickHouse container so the
 * failure modes are exact and the shared test stack stays untouched.
 */

const ANALYTICS_API = '**/api/analytics/**';

/** Collects uncaught render errors — the symptom of the original crash. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function pageShellRendered(page: Page) {
  // The header renders above the data section; if the component tree crashed,
  // React unmounts it along with everything else.
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '24h' })).toBeVisible();
}

test.describe('Analytics API failures', () => {
  test('page survives every analytics endpoint returning 500', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.route(ANALYTICS_API, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'ClickHouse unreachable' }),
      }),
    );

    await page.goto('/analytics');
    await pageShellRendered(page);

    const banner = page.getByTestId('analytics-load-error');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('ClickHouse unreachable');
    expect(errors, `uncaught errors crashed the page: ${JSON.stringify(errors)}`).toEqual([]);
  });

  test('error banner still appears when the server sends an empty error message', async ({ page }) => {
    // @clickhouse/client throws an AggregateError with an empty `message` on
    // ECONNREFUSED, which reaches the browser as {"error":""}. An empty string
    // is falsy, so a naive `{error && <Banner/>}` renders nothing and the user
    // is left with a silently blank page.
    const errors = trackPageErrors(page);
    await page.route(ANALYTICS_API, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '' }),
      }),
    );

    await page.goto('/analytics');
    await pageShellRendered(page);

    await expect(page.getByTestId('analytics-load-error')).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test('page survives when only the hosts endpoint fails', async ({ page }) => {
    // This is the exact original crash: `allHosts.some is not a function`.
    // Everything else succeeds, so the map must still render.
    const errors = trackPageErrors(page);
    await page.route('**/api/analytics/hosts', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'hosts query failed' }),
      }),
    );

    await page.goto('/analytics');
    await pageShellRendered(page);

    await expect(page.getByText('Traffic by Country')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    expect(errors, `uncaught errors crashed the page: ${JSON.stringify(errors)}`).toEqual([]);
  });

  test('page survives list endpoints returning a non-array payload', async ({ page }) => {
    // A 200 with an unexpected shape must not reach `.map()` unguarded.
    const errors = trackPageErrors(page);
    for (const path of ['countries', 'timeline', 'protocols', 'user-agents']) {
      await page.route(`**/api/analytics/${path}?**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unexpected: 'shape' }),
        }),
      );
    }

    await page.goto('/analytics');
    await pageShellRendered(page);

    await expect(page.getByText('Traffic by Country')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    expect(errors, `uncaught errors crashed the page: ${JSON.stringify(errors)}`).toEqual([]);
  });
});
