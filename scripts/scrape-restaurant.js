const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  extractMerchantId,
  retry,
  normalizeMerchantPayload,
  merchantToCsv
} = require('./utils');

const DEFAULT_TARGET_URL =
  'https://food.grab.com/id/id/restaurant/ayam-katsu-katsunami-lokarasa-citraland-delivery/6-C7EYGBJDME3JRN';
const targetUrl = process.argv[2] || DEFAULT_TARGET_URL;
const outputDir = path.join(__dirname, '..', 'output');
const debugDir = path.join(__dirname, '..', 'debug');
const inputPayloadPath = process.env.MERCHANT_JSON_PATH || '';
const RESPONSE_TIMEOUT_MS = Number(process.env.RESPONSE_TIMEOUT_MS || 30000);

async function captureMerchantPayload(page, merchantId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      page.off('response', handleResponse);
      reject(new Error('Timed out waiting for merchant API response.'));
    }, RESPONSE_TIMEOUT_MS);

    async function handleResponse(response) {
      const url = response.url();
      const matchesMerchantEndpoint = url.includes(`/merchants/${merchantId}`) && url.includes('/foodweb/guest/v2/');

      if (!matchesMerchantEndpoint) {
        return;
      }

      try {
        const payload = await response.json();
        clearTimeout(timeoutId);
        page.off('response', handleResponse);
        resolve({ payload, url });
      } catch (error) {
        clearTimeout(timeoutId);
        page.off('response', handleResponse);
        reject(error);
      }
    }

    page.on('response', handleResponse);
  });
}

async function waitForLazyContent(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  const menuAnchors = [
    page.getByText(/menu/i).first(),
    page.getByText(/recommended/i).first(),
    page.getByText(/promo/i).first()
  ];

  for (const anchor of menuAnchors) {
    try {
      await anchor.waitFor({ state: 'visible', timeout: 3000 });
      break;
    } catch (_error) {
      // Continue trying the next likely menu anchor.
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1000);
  }
}

async function fetchMerchantPayload(targetUrl, merchantId) {
  return retry('Scrape flow', async attempt => {
    const browser = await chromium.launch({
      headless: process.env.HEADLESS === 'true',
      slowMo: process.env.HEADLESS === 'true' ? 0 : 100
    });

    try {
      const contextOptions = {};
      const storageStatePath = process.env.STORAGE_STATE_PATH;
      if (storageStatePath && fs.existsSync(storageStatePath)) {
        contextOptions.storageState = storageStatePath;
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const merchantResponsePromise = captureMerchantPayload(page, merchantId);

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: RESPONSE_TIMEOUT_MS
      });
      await waitForLazyContent(page);

      const captured = await merchantResponsePromise;
      return captured;
    } catch (error) {
      throw new Error(`attempt ${attempt}: ${error.message}`);
    } finally {
      await browser.close();
    }
  });
}

async function run() {
  const merchantId = extractMerchantId(targetUrl);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(debugDir, { recursive: true });

  let payload;
  let merchantEndpointUrl = null;

  if (inputPayloadPath) {
    payload = JSON.parse(fs.readFileSync(inputPayloadPath, 'utf8'));
  } else {
    const captured = await fetchMerchantPayload(targetUrl, merchantId);
    payload = captured.payload;
    merchantEndpointUrl = captured.url;
  }

  const normalized = normalizeMerchantPayload(payload, targetUrl);

  const debugPath = path.join(debugDir, `merchant-${merchantId}.json`);
  const outputCsvPath = path.join(outputDir, `restaurant-${merchantId}.csv`);

  fs.writeFileSync(debugPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(outputCsvPath, merchantToCsv(normalized));

  if (merchantEndpointUrl) {
    console.log(`Merchant endpoint: ${merchantEndpointUrl}`);
  }
  console.log(`Outlet: ${normalized.outletName}`);
  console.log(`Categories: ${normalized.categories.length}`);
  console.log(`Menu items: ${normalized.categories.reduce((count, category) => count + category.items.length, 0)}`);
  console.log(`Saved raw payload to ${path.relative(process.cwd(), debugPath)}`);
  console.log(`Saved CSV output to ${path.relative(process.cwd(), outputCsvPath)}`);
}

run().catch(error => {
  console.error(`Scrape failed: ${error.message}`);
  process.exit(1);
});
