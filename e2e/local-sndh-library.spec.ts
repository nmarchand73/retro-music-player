import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectBoxScan(page: Page, img: Locator, game: string): Promise<void> {
  await expect(img).toBeVisible();
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  const response = await page.request.get(new URL(src ?? '', page.url()).toString());
  expect(response.ok()).toBeTruthy();
  const latin = Buffer.from(await response.body()).toString('latin1');
  expect(latin).not.toMatch(/File:Alcatraz/i);
  const compact = game.toLowerCase().replace(/[^a-z0-9]+/g, '');
  expect(latin.toLowerCase().replace(/[^a-z0-9]+/g, '')).toContain(compact);
}

test.describe('Local SNDH library golden path', () => {
  test('browse the local archive, search Last Ninja, and start playback', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Atari ST & Amiga Player' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SNDH Archive' })).toBeVisible();
    await expect(page.getByText(/5,897 local SNDH files/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Mod Archive' })).toHaveCount(0);
    await expect(page.locator('.track-list [data-platform="atari"]').first()).toBeVisible();
    await expect(page.locator('.track-list [data-platform="amiga"]').first()).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Top Games' })).toBeVisible();
    await page.getByRole('tab', { name: 'Top Games' }).click();
    await expect(page.getByRole('heading', { name: 'Top Games' })).toBeVisible();
    await page.getByRole('button', { name: 'Search game Last Ninja' }).click();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('game');
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue('Last Ninja');
    await expect(page.getByRole('combobox', { name: 'Platform' })).toHaveValue('all');
    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Play Last Ninja/i }).first()).toBeVisible();

    await page.getByRole('combobox', { name: 'Search field' }).selectOption('any');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('ninja mad');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Sort' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Playable only' })).toBeChecked();
    await expect(page.getByRole('button', { name: /Play Last Ninja/i }).first()).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search music' }).fill('Last Ninja');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    const lastNinja = page.getByRole('button', { name: /Play Last Ninja/i }).first();
    await expect(lastNinja).toBeVisible();
    const lastNinjaRow = page.locator('.track-list li').filter({ hasText: 'Last Ninja' }).first();
    await expect(lastNinjaRow.getByText('3:27')).toBeVisible();

    await lastNinjaRow.getByRole('button', { name: 'Search author Mad Max' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue('Mad Max');
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('author');
    await expect(page.getByRole('button', { name: /Play Last Ninja/i }).first()).toBeVisible();

    await lastNinjaRow.getByRole('button', { name: 'Search platform ATARI' }).click();
    await expect(page.getByRole('combobox', { name: 'Platform' })).toHaveValue('atari');

    const ninjaGame = lastNinjaRow.getByRole('button', { name: /Search game /i });
    if (await ninjaGame.count()) {
      await ninjaGame.first().click();
      await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('game');
    }

    await lastNinjaRow.getByRole('button', { name: 'Search title Last Ninja' }).click();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('title');
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue('Last Ninja');

    await lastNinja.click();

    const player = page.getByRole('contentinfo', { name: 'Player' });
    await expect(player.getByText('Last Ninja', { exact: true })).toBeVisible();
    await expect(player.getByText(/Mad Max/)).toBeVisible();
    await expect(player.getByText('3:27').first()).toBeVisible();
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand player' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand player' }).click();
    await expect(page.getByRole('button', { name: 'Minimize player' })).toBeVisible();
    await expect(player.getByRole('button', { name: 'Next track' })).toBeVisible();

    await player.getByRole('button', { name: 'Bookmark Last Ninja' }).click();
    await page.getByRole('tab', { name: 'Bookmarks (1)' }).click();
    await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible();
    await expect(page.getByRole('button', { name: /(Play|Pause) Last Ninja/i }).first()).toBeVisible();

    const seek = player.getByRole('slider', { name: 'Seek' });
    await expect(seek).toBeEnabled();
    await seek.fill('60');
    await expect
      .poll(async () => Number(await seek.inputValue()), { timeout: 8_000 })
      .toBeGreaterThan(50);
    await expect
      .poll(async () => Number(await seek.inputValue()), { timeout: 8_000 })
      .toBeLessThan(80);
  });

  test('search the local UnExoticA Amiga archive and play a module', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'UnExoticA' })).toBeVisible();
    await expect(page.getByText(/local Amiga modules/)).toBeVisible();

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('amiga');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('anarchy norrish');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Playable only' })).toBeChecked();
    const anarchy = page.getByRole('button', { name: /Play anarchy2/i }).first();
    await expect(anarchy).toBeVisible();
    const anarchyRow = page.locator('.track-list li').filter({ hasText: 'anarchy2' }).first();
    await anarchyRow.getByRole('button', { name: 'Search platform AMIGA' }).click();
    await expect(page.getByRole('combobox', { name: 'Platform' })).toHaveValue('amiga');
    await anarchyRow.getByRole('button', { name: /Search author .*Norrish/i }).click();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('author');
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue(/Norrish/i);
    const gameFacet = anarchyRow.getByRole('button', { name: /Search game /i });
    if (await gameFacet.count()) {
      await gameFacet.first().click();
      await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('game');
    }
    await page.getByRole('button', { name: /Search title anarchy2/i }).first().click();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('title');
    await page.getByRole('button', { name: /Play anarchy2/i }).first().click();

    const player = page.getByRole('contentinfo', { name: 'Player' });
    await expect(player.getByText('anarchy2', { exact: true })).toBeVisible();
    await expect(player.getByText(/Norrish/)).toBeVisible();
    const anarchyArt = page.getByRole('listitem').filter({ hasText: 'anarchy2' }).getByRole('img', { name: /Anarchy box/i });
    await expect(player.getByRole('img', { name: /Anarchy box/i })).toBeVisible();
    await expect(anarchyArt).toBeVisible();
    await expectBoxScan(page, anarchyArt, 'Anarchy');
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(anarchyRow).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tracker pattern' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand player' }).click();
    await expect(page.getByRole('region', { name: 'Tracker pattern' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pat / })).toBeVisible();
    await page.getByRole('button', { name: 'Minimize player' }).click();
    await expect(page.getByRole('region', { name: 'Tracker pattern' })).toHaveCount(0);
    await expect(anarchyRow).toBeVisible();

    await anarchyRow.getByRole('button', { name: 'Bookmark anarchy2' }).click();
    await page.getByRole('tab', { name: /Bookmarks/ }).click();
    await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible();
    const bookmarkArt = page.locator('.track-list li').filter({ hasText: 'anarchy2' }).getByRole('img', { name: /Anarchy box/i });
    await expectBoxScan(page, bookmarkArt, 'Anarchy');
  });

  test('show the UnExoticA box scan on the Atari version of the same game', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('all');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('Blood Money');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const atari = page.locator('.track-list li').filter({ has: page.getByRole('button', { name: 'Search platform ATARI' }) }).filter({ hasText: /Blood(y)? Money/i });
    const amiga = page.locator('.track-list li').filter({ has: page.getByRole('button', { name: 'Search platform AMIGA' }) }).filter({ hasText: /Blood Money/i });
    const amigaArt = amiga.getByRole('img', { name: /Blood Money box/i }).first();
    const atariArt = atari.getByRole('img', { name: /Blood Money box/i }).first();
    await expect(amigaArt).toBeVisible();
    await expect(atariArt).toBeVisible();
    await expectBoxScan(page, amigaArt, 'Blood Money');
    await expectBoxScan(page, atariArt, 'Blood Money');
  });
});
