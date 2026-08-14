import { expect, test } from '@playwright/test';

test.describe('Machine settings defaults', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('retro-music-player.machines');
    });
  });

  test('settings tab toggles default machines and filters All platforms search', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const c64 = page.getByRole('checkbox', { name: /Commodore 64/i });
    await expect(c64).toBeChecked();
    await c64.uncheck();
    await expect(c64).not.toBeChecked();

    await expect(page.getByText(/Atari ST · Amiga · Amstrad CPC enabled by default/)).toBeVisible();

    await page.getByRole('tab', { name: 'Library' }).click();
    const platform = page.getByRole('combobox', { name: 'Platform' });
    await expect(platform).toContainText('Enabled (3)');
    await expect(platform.locator('option[value="c64"]')).toHaveCount(0);

    await platform.selectOption('all');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.locator('.track-list [data-platform="c64"]')).toHaveCount(0, {
      timeout: 20_000,
    });
  });
});
