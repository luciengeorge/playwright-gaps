import { test, expect } from 'playwright-gaps/persistent';
test('popup renders', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('#popup')).toHaveText('hello from the extension popup');
});
