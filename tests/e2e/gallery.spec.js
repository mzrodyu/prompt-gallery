const { test, expect } = require('@playwright/test');

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2f8kUAAAAASUVORK5CYII=';

const tallSvgDataUrl =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400"><rect width="100%" height="100%" fill="#10b981"/></svg>',
  ).toString('base64');

test('register, upload and infinite scroll work', async ({ page, request }) => {
  const username = `e2e_${Date.now()}`;
  const password = 'test1234';
  const tagKey = `e2e_tag_${Date.now()}`;

  await page.goto('/');

  const registerRes = await request.post('/api/auth/register', {
    data: { username, password },
  });
  expect(registerRes.ok()).toBeTruthy();

  const registerJson = await registerRes.json();
  const token = registerJson.token;
  expect(token).toBeTruthy();

  await page.evaluate((t) => localStorage.setItem('mj_token', t), token);
  await page.reload();

  await expect(page.locator('#appWrapper')).toBeVisible();

  await page.click('#btnUpload');
  await page.setInputFiles('#uploadFileInput', {
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: Buffer.from(tinyPngBase64, 'base64'),
  });
  await page.fill('#inputPrompt', 'smoke prompt');
  await page.click('#uploadSave');

  await expect(page.locator('#galleryGrid .gallery-card').first()).toBeVisible();

  for (let i = 0; i < 30; i += 1) {
    const res = await request.post('/api/gallery', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        image: tallSvgDataUrl,
        prompt: `bulk item ${i}`,
        params: { version: 'niji 7' },
        tags: [tagKey],
        note: '',
      },
    });
    expect(res.ok()).toBeTruthy();
  }

    const page1Res = await request.get(`/api/gallery?limit=24&offset=0&q=${encodeURIComponent(tagKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(page1Res.ok()).toBeTruthy();
  const page1Items = await page1Res.json();
  const totalFromHeader = Number(page1Res.headers()['x-total-count']);
  expect(page1Items.length).toBe(24);
  expect(totalFromHeader).toBeGreaterThanOrEqual(30);

  const page2Res = await request.get(`/api/gallery?limit=24&offset=24&q=${encodeURIComponent(tagKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(page2Res.ok()).toBeTruthy();
  const page2Items = await page2Res.json();
  expect(page2Items.length).toBeGreaterThan(0);
  await page.reload();
  await page.fill('#searchInput', tagKey);
  await page.waitForTimeout(1000);
  await expect(page.locator('#galleryGrid .gallery-card').first()).toBeVisible();

  const firstBatchCount = await page.locator('#galleryGrid .gallery-card').count();
  let finalCount = firstBatchCount;

  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    finalCount = await page.locator('#galleryGrid .gallery-card').count();
    if (finalCount >= totalFromHeader) break;
  }

  expect(finalCount).toBeGreaterThanOrEqual(firstBatchCount);
  expect(finalCount).toBe(totalFromHeader);
});

