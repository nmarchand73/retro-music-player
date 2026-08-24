import { expect, test } from '@playwright/test';

test.describe('CPC and C64 local libraries', () => {
  test('databases show CPC and C64 connected with counts', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: /Atari · Amiga · CPC · C64/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CPC Archive' })).toBeVisible();
    await expect(page.getByText(/\d[\d,]* local CPC files/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HVSC' })).toBeVisible();
    await expect(page.getByText(/\d[\d,]* local SID files/)).toBeVisible();
  });

  test('platform CPC search finds SNDH tracks with CPC badge', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(/\d[\d,]* local CPC files/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('cpc');
    await page.getByRole('combobox', { name: 'Search field' }).selectOption('author');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('whittaker');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const cpcRow = page
      .locator('.track-list li')
      .filter({ has: page.locator('[data-platform="cpc"]') })
      .filter({ has: page.locator('.chip', { hasText: 'SNDH' }) })
      .first();
    await expect(cpcRow).toBeVisible({ timeout: 15_000 });
    await expect(cpcRow.getByRole('button', { name: 'Search platform CPC' })).toBeVisible();
    const titleButton = cpcRow.getByRole('button', { name: /^Search title / });
    await expect(titleButton).toBeVisible();
    await expect(titleButton).toHaveText(/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/);
  });

  test('platform CPC finds mainstream YM game music (RoboCop)', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('cpc');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('robocop');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const ymRow = page
      .locator('.track-list li')
      .filter({ has: page.locator('[data-platform="cpc"]') })
      .filter({ has: page.locator('.chip', { hasText: 'YM' }) })
      .first();
    await expect(ymRow).toBeVisible({ timeout: 15_000 });
    await expect(ymRow.getByRole('button', { name: /Search title /i })).toContainText(/robocop/i);
  });

  test('platform CPC Commando SNDH is playable from library', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('cpc');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('commando');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const cpcRow = page
      .locator('.track-list li')
      .filter({ has: page.locator('[data-platform="cpc"]') })
      .filter({ has: page.locator('.chip', { hasText: 'SNDH' }) })
      .first();
    await expect(cpcRow).toBeVisible({ timeout: 15_000 });
    await expect(cpcRow.getByRole('button', { name: /Search title /i })).toContainText(/commando/i);
  });

  test('platform C64 search finds SID tracks with C64 badge', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('c64');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const c64Row = page.locator('.track-list li').filter({ has: page.locator('[data-platform="c64"]') }).first();
    await expect(c64Row).toBeVisible({ timeout: 60_000 });
    await expect(c64Row.getByText('SID')).toBeVisible();
    await expect(c64Row.getByRole('button', { name: 'Search platform C64' })).toBeVisible();
  });

  test('C64 multi-song SID can switch songs in the player', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('c64');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('Addicta Ball');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const row = page
      .locator('.track-list li')
      .filter({ has: page.locator('[data-platform="c64"]') })
      .filter({ has: page.getByRole('button', { name: /Search title Addicta Ball/i }) })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('.chip.subtunes')).toHaveText('2 songs');

    await row.getByRole('button', { name: /Play Addicta Ball/i }).click();
    const player = page.getByRole('contentinfo', { name: 'Player' });
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 60_000 });
    await expect(player.locator('[aria-label="SID songs"]')).toBeVisible();
    await expect(player.getByText('1/2')).toBeVisible();
    await expect(player.locator('.player-title-duration')).toHaveText('0:04');

    await player.getByRole('button', { name: 'Next song' }).click();
    await expect(player.getByText('2/2')).toBeVisible({ timeout: 10_000 });
    // Addicta Ball HVSC lengths: 0:04 then 0:02
    await expect(player.locator('.player-title-duration')).toHaveText('0:02', { timeout: 10_000 });
  });

  test('C64 SID channel mute toggles voice buttons', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('c64');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('Commando');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const row = page.locator('.track-list li').filter({ has: page.locator('[data-platform="c64"]') }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: /Play Commando/i }).click();

    const player = page.getByRole('contentinfo', { name: 'Player' });
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 60_000 });

    const voice1 = player.getByRole('button', { name: 'Mute SID voice 1' });
    await expect(voice1).toBeVisible();
    await voice1.click();
    await expect(player.getByRole('button', { name: 'Unmute SID voice 1' })).toBeVisible();
    await player.getByRole('button', { name: 'Unmute SID voice 1' }).click();
    await expect(player.getByRole('button', { name: 'Mute SID voice 1' })).toBeVisible();
  });
});
