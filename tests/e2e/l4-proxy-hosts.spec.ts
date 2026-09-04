/**
 * E2E tests: L4 Proxy Hosts page.
 *
 * Verifies the L4 Proxy Hosts UI — navigation, list, create/edit/delete dialogs.
 */
import { test, expect } from '@playwright/test';

test.describe('L4 Proxy Hosts page', () => {
  test('is accessible from sidebar navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /l4 proxy hosts/i }).click();
    await expect(page).toHaveURL(/\/l4-proxy-hosts/);
    await expect(page.getByRole('heading', { name: 'L4 Proxy Hosts' })).toBeVisible();
  });

  test('shows empty state when search has no results', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    await page.getByPlaceholder(/search/i).fill('zzz-nonexistent-host-zzz');
    await expect(page.getByText(/no l4 hosts match/i).last()).toBeVisible({ timeout: 5_000 });
  });

  test('create dialog opens and contains expected fields', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    await page.getByRole('button', { name: /create l4 host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Verify key form fields exist
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Protocol' }).first()).toBeVisible();
    await expect(page.getByLabel('Listen Address')).toBeVisible();
    await expect(page.getByLabel('Upstreams')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Matcher' }).first()).toBeVisible();
  });

  test('clicking Name / Matcher header sorts the table', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const sortBtn = page.getByRole('button', { name: 'Name / Matcher' });
    await expect(sortBtn).toBeVisible();

    await sortBtn.click();
    await expect(page).toHaveURL(/sortBy=name/);
    await expect(page).toHaveURL(/sortDir=asc/);

    // Click again to toggle direction
    await sortBtn.click();
    await expect(page).toHaveURL(/sortDir=desc/);
  });

  test('clicking Protocol header sorts by protocol', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const sortBtn = page.getByRole('button', { name: 'Protocol' });
    await expect(sortBtn).toBeVisible();

    await sortBtn.click();
    await expect(page).toHaveURL(/sortBy=protocol/);
  });

  test('clicking Listen header sorts by listen address', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const sortBtn = page.getByRole('button', { name: 'Listen' });
    await expect(sortBtn).toBeVisible();

    await sortBtn.click();
    await expect(page).toHaveURL(/sortBy=listenAddress/);
  });

  test('creates a new L4 proxy host', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    await page.getByRole('button', { name: /create l4 host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('E2E Test Host');
    await page.getByLabel('Listen Address').fill(':19999');
    await page.getByLabel('Upstreams').fill('10.0.0.1:5432');

    await page.getByRole('button', { name: /create/i }).click();

    // Dialog should close and host should appear in table
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('table').getByText('E2E Test Host')).toBeVisible();
    await expect(page.getByRole('table').getByText(':19999', { exact: true })).toBeVisible();
  });

  test('deletes the created L4 proxy host', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    await expect(page.getByRole('table').getByText('E2E Test Host')).toBeVisible();

    // Open the dropdown menu for that row and click Delete
    const row = page.locator('tr', { hasText: 'E2E Test Host' });
    await row.getByRole('button').first().click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Confirm deletion
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/are you sure/i)).toBeVisible();
    await page.getByRole('button', { name: /delete/i }).click();

    // Host should be removed
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Test Host')).not.toBeVisible({ timeout: 5_000 });
  });

  /**
   * Regression (#241): creating multiple L4 hosts back-to-back left the table
   * stale until a manual browser refresh — the create dialog's form state
   * survived between opens and revalidation raced the close. Each save must
   * be reflected in the table with no reload, even on rapid successive saves.
   */
  test('rapid successive creates are all reflected in the table without reload', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');

    for (let i = 1; i <= 3; i++) {
      // Re-open the dialog each iteration — this is what exercised the stale
      // useActionState bug (dialog remount now resets form state).
      await page.getByRole('button', { name: /create l4 host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByLabel('Name').fill(`E2E Rapid Host ${i}`);
      await page.getByLabel('Listen Address').fill(`:2000${i}`);
      await page.getByLabel('Upstreams').fill('10.0.0.1:5432');

      await page.getByRole('button', { name: /create/i }).click();

      // Dialog closes on success, host appears in table — no page.reload()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('table').getByText(`E2E Rapid Host ${i}`)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('cleanup rapid hosts', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    for (let i = 1; i <= 3; i++) {
      const row = page.locator('tr', { hasText: `E2E Rapid Host ${i}` });
      await expect(row).toBeVisible();
      await row.getByRole('button').first().click();
      await page.getByRole('menuitem', { name: /delete/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: /delete/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(`E2E Rapid Host ${i}`)).not.toBeVisible({ timeout: 5_000 });
    }
  });

  /**
   * Regression (#241): toggling a host's enabled switch updated the DB but
   * the row kept showing the old status until a browser refresh.
   */
  test('toggling enabled updates the row status without reload', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    await page.getByRole('button', { name: /create l4 host/i }).click();
    await page.getByLabel('Name').fill('E2E Toggle Host');
    await page.getByLabel('Listen Address').fill(':20010');
    await page.getByLabel('Upstreams').fill('10.0.0.1:5432');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    const row = page.locator('tr', { hasText: 'E2E Toggle Host' });
    const rowSwitch = row.getByRole('switch').first();
    await expect(row).toBeVisible();

    // Toggle off — the row must show the new status without a reload
    await expect(rowSwitch).toHaveAttribute('data-state', 'checked');
    await rowSwitch.click();
    await expect(rowSwitch).toHaveAttribute('data-state', 'unchecked', { timeout: 10_000 });

    // Toggle back on
    await rowSwitch.click();
    await expect(rowSwitch).toHaveAttribute('data-state', 'checked', { timeout: 10_000 });

    // Cleanup
    await row.getByRole('button').first().click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /delete/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Toggle Host')).not.toBeVisible({ timeout: 5_000 });
  });
});
