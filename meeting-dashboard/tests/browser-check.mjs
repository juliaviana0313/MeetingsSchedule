import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Europe/Berlin' });
  const errors = [], writes = [], paths = []; let configured = false, uncertain = false, receiptReady = false;
  const day = new Date(Date.now() + 3 * 86400000); day.setUTCHours(12, 0, 0, 0); const start = day.toISOString(), end = new Date(+day + 1800000).toISOString();
  const receipt = { reference: 'receipt-test', title: 'Conversation', start, end, timeZone: 'Europe/Berlin', status: 'accepted', format: 'Google Meet', participants: ['Alex B', 'Travis Ruiz'], meetingUrl: 'https://example.test/meet' };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); paths.push(url.pathname);
    let data = {}, status = 200;
    if (url.pathname === '/api/public/config') { status = configured ? 200 : 503; data = configured ? { ready: true, organizerEmail: 'hello@truemarch.fun', events: [{ id: 42, title: 'Conversation', duration: 30, description: 'A little time to talk things through.', formats: [{ id: 'integration:cal-video', label: 'Cal Video', input: null }, { id: 'integration:google-meet', label: 'Google Meet', input: null }] }] } : { ready: false, error: 'Booking is not available yet. The organizer needs to finish connecting the scheduling service.' }; }
    else if (url.pathname === '/api/public/slots') data = { slots: [start] };
    else if (url.pathname === '/api/public/bookings') { writes.push({ body: route.request().postDataJSON(), id: route.request().headers()['idempotency-key'] }); status = uncertain ? 409 : 200; data = uncertain ? { uncertain: true, error: 'Check the participants’ email before booking again.' } : { receipt }; }
    else if (url.pathname === '/api/public/receipt') { status = receiptReady ? 200 : 409; data = receiptReady ? { receipt } : { uncertain: true, error: 'The booking may still be processing.' }; }
    else { status = 404; data = { error: 'Unexpected API call' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Booking is not available yet' }).waitFor();
  assert.equal(await page.getByLabel('Work email').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Sign in|Sign out|Connect account/ }).count(), 0);
  configured = true; await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByLabel('Your name').waitFor();
  const sidebarBox = await page.locator('.workspace-sidebar').boundingBox(), mainBox = await page.locator('main').boundingBox();
  assert.ok(sidebarBox.x + sidebarBox.width <= mainBox.x, 'navigation is left of main content');
  assert.equal(await page.locator('.workspace-sidebar nav button').count(), 4);
  await page.getByRole('button', { name: 'Switch to light mode' }).focus(); await page.keyboard.press('Enter');
  await page.reload(); await page.getByRole('button', { name: 'Switch to dark mode' }).waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 245)');
  await page.getByLabel('Date', { exact: true }).fill(start.slice(0, 10));
  await page.getByRole('button', { name: 'Find available times' }).click();
  await page.locator('.slots button').first().click();
  await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
  assert.equal(await page.locator('.slots button').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Confirm booking' }).isDisabled(), true);
  await page.getByLabel('Time zone', { exact: true }).selectOption('Europe/Berlin');
  await page.getByRole('button', { name: 'Find available times' }).click(); await page.locator('.slots button').first().click();
  await page.getByLabel('Your name').fill('Alex B'); await page.getByLabel('Your email').fill('alex@gmail.com');
  assert.equal(await page.getByLabel('Person C name').count(), 0); assert.equal(await page.getByLabel('Person C email').count(), 0);
  await page.locator('.public-participants').getByText('Travis Ruiz', { exact: true }).waitFor();
  assert.equal(await page.locator('input[type=email]').count(), 1);
  await page.getByLabel('Meeting notes (optional)').fill('Discuss a proposal.');
  assert.equal(await page.getByRole('button', { name: 'Confirm booking' }).isDisabled(), true);
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: 'Confirm booking' }).isDisabled(), true, 'format is required');
  await page.getByLabel('Meeting format', { exact: true }).selectOption('integration:google-meet');
  await page.screenshot({ path: '/tmp/meetingschedule-public-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.waitForTimeout(200); // Let the existing button color transition finish after changing themes.
  await page.screenshot({ path: '/tmp/meetingschedule-public-dark.png', fullPage: true });
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator('.workspace-sidebar').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    if (width === 390) await page.screenshot({ path: '/tmp/meetingschedule-public-mobile.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await page.getByRole('heading', { name: 'Your meeting is booked.' }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].body.first.email, 'alex@gmail.com'); assert.equal(writes[0].body.second, undefined); assert.equal(writes[0].body.formatId, 'integration:google-meet'); assert.ok(writes[0].id);
  assert.equal(await page.locator('.meeting-timezone').textContent(), 'Europe/Berlin · UTC+01:00');
  assert.ok(paths.every(x => x.startsWith('/api/public/')), 'no authentication or private account API calls');
  assert.match(await page.locator('.public-receipt .booking-format').textContent(), /Google Meet/);
  await page.getByRole('button', { name: 'Book another meeting' }).click();
  await page.getByLabel('Meeting format', { exact: true }).selectOption('integration:cal-video');
  await page.getByRole('button', { name: 'Find available times' }).click(); await page.locator('.slots button').first().click();
  await page.getByLabel('Your name').fill('Alex B'); await page.getByLabel('Your email').fill('alex@gmail.com');
  assert.match(await page.locator('.sidebar-contact').textContent(), /hello@truemarch.fun/);
  assert.ok(!(await page.locator('.sidebar-contact').textContent()).includes('info@truemarch.fun'));
  await page.getByLabel('Your email').fill('hello@truemarch.fun');
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirm booking' }).click();
  await page.getByText('Enter your own email address, different from the host’s email.').waitFor(); assert.equal(writes.length, 1);
  await page.getByLabel('Your email').fill('alex@gmail.com'); uncertain = true;
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await page.getByRole('button', { name: 'Check booking status' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm booking' }).isDisabled(), true);
  await page.reload(); await page.getByRole('button', { name: 'Check booking status' }).waitFor();
  assert.equal(writes.length, 2, 'reload must not create another booking');
  receiptReady = true; await page.getByRole('button', { name: 'Check booking status' }).click();
  await page.getByRole('heading', { name: 'Your meeting is booked.' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('meetingschedule-pending-booking')), null);
  assert.deepEqual(errors, []);
  console.log('Public booking browser checks passed: no login, visitor/Travis booking, validation, theme persistence, time zones, responsive layout, and uncertain-result recovery; all upstream APIs mocked.');
} finally { await browser.close(); }
