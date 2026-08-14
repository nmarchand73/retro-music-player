import { expect, test } from '@playwright/test';

test.describe('Local SNDH library golden path', () => {
  test('browse the local archive, search Last Ninja, and start playback', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Atari ST & Amiga Player' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SNDH Archive' })).toBeVisible();
    await expect(page.getByText(/5,897 local SNDH files/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Mod Archive' })).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search music' }).fill('Last Ninja');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const lastNinja = page.getByRole('button', { name: /Play Last Ninja/i }).first();
    await expect(lastNinja).toBeVisible();
    await lastNinja.click();

    const player = page.getByRole('contentinfo', { name: 'Player' });
    await expect(player.getByText('Last Ninja', { exact: true })).toBeVisible();
    await expect(player.getByText(/Mad Max/)).toBeVisible();
  });
});
