import { expect, test } from '@playwright/test';

test('C64 SID playback advances position (Martin Galway Wizball)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Platform' }).selectOption('c64');
  await page.getByRole('searchbox', { name: 'Search music' }).fill('Wizball');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const row = page
    .locator('.track-list li')
    .filter({ has: page.locator('[data-platform="c64"]') })
    .filter({ has: page.getByRole('button', { name: /Search author Martin Galway/i }) })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /Play Wizball/i }).click();

  const player = page.getByRole('contentinfo', { name: 'Player' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Expand player' }).click();

  await expect
    .poll(async () => {
      const seek = player.getByRole('slider', { name: 'Seek' });
      const value = Number(await seek.inputValue());
      return value > 0.5;
    }, { timeout: 15_000 })
    .toBe(true);
});
