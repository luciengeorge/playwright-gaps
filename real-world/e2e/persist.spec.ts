import { test, expect } from 'playwright-gaps/persistent';
// Run twice as separate processes: PHASE=1 logs in, PHASE=2 (new process, same userDataDir) must still be logged in.
test(`login state across runs (phase ${process.env.PHASE})`, async ({ page, context }) => {
  await page.goto('http://127.0.0.1:5600/account');
  if (process.env.PHASE === '1') {
    await expect(page.locator('#who')).toHaveText('Please log in');
    await page.click('#login');
    await expect(page.locator('#who')).toHaveText('Welcome back, lucien');
    await page.evaluate(() => localStorage.setItem('token', 'abc123'));
  } else {
    await expect(page.locator('#who')).toHaveText('Welcome back, lucien');
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('abc123');
    const sid = (await context.cookies()).find((c) => c.name === 'sid');
    expect(sid?.httpOnly).toBe(true);
  }
});
