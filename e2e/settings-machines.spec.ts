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
    await expect(page.getByRole('heading', { name: 'Library filters' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Game music only' }).first()).toBeChecked();

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

  test('settings Modern sound toggle persists amount and preset', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('retro-music-player:audio-fx'));
    await page.reload();

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Listening' })).toBeVisible();

    const modern = page.getByRole('checkbox', { name: 'Modern sound' });
    await expect(modern).not.toBeChecked();
    await modern.check();
    await expect(modern).toBeChecked();

    const preset = page.getByRole('combobox', { name: 'Audio FX preset' });
    await expect(preset).toBeEnabled();
    await preset.selectOption('hall');
    await expect(preset).toHaveValue('hall');

    const amount = page.getByRole('slider', { name: 'Modern sound amount', exact: true });
    await amount.fill('80');
    await expect(page.getByText(/Amount · 80%/)).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('checkbox', { name: 'Modern sound' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Audio FX preset' })).toHaveValue('hall');
    await expect(page.getByText(/Amount · 80%/)).toBeVisible();
  });

  test('settings player visualizer can switch to piano roll', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('retro-music-player:visualizer'));
    await page.reload();

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Player visualizer' })).toBeVisible();

    const spectrum = page.getByRole('radio', { name: 'Spectrum 3D' });
    const piano = page.getByRole('radio', { name: 'Piano roll' });
    await expect(spectrum).toBeChecked();
    await piano.check();
    await expect(piano).toBeChecked();

    await page.reload();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('radio', { name: 'Piano roll' })).toBeChecked();
  });

  test('settings Listening samples play one track per platform', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Try a sample' })).toBeVisible();
    const samples = page.getByRole('list', { name: 'FX preview samples' });
    await expect(samples).toBeVisible({ timeout: 20_000 });

    await expect(samples.getByRole('button', { name: /Play Last Ninja \(Atari ST\)/i })).toBeVisible();
    await expect(samples.getByRole('button', { name: /Play k8 \(Amiga\)/i })).toBeVisible();
    await expect(samples.getByRole('button', { name: /Play Robocop \(Amstrad CPC\)/i })).toBeVisible();
    await expect(samples.getByRole('button', { name: /Play Commando \(Commodore 64\)/i })).toBeVisible();

    await page.getByRole('checkbox', { name: 'Modern sound' }).check();
    await samples.getByRole('button', { name: /Play Last Ninja \(Atari ST\)/i }).click();
    await expect(samples.getByRole('button', { name: /Pause Last Ninja \(Atari ST\)/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
