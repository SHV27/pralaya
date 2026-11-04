/**
 * PRALAYA end to end, on the production build (CLAUDE.md verifier 4): names can be typed (digits and letters never trigger hotkeys),
 * and a whole match plays from the lobby to the crown with zero console errors and no stalled beat, at laptop, tablet and phone sizes.
 */
import { expect, test } from '@playwright/test';

test('names can be typed in the lobby, keys never hijacked', async ({ page }) => {
  await page.goto('/?mute=1');
  const first = page.getByLabel('Player 1 name');
  await first.fill('');
  await first.pressSequentially('Asha 2N');
  await expect(first).toHaveValue('Asha 2N');
  await expect(page.locator('.lobby')).toBeVisible();
});

test('a whole match plays to the crown with zero console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?auto=1&speed=24&players=3&seed=5&mute=1');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __pralaya?: { crowns?: number } }).__pralaya?.crowns ?? 0),
      {
        timeout: 1_440_000,
        intervals: [2000],
      },
    )
    .toBeGreaterThan(0);
  const stalls = await page.evaluate(() => (window as unknown as { __stalls?: string[] }).__stalls ?? []);
  expect(stalls).toEqual([]);
  expect(errors).toEqual([]);
});
