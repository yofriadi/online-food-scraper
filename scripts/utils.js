const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);

function extractMerchantId(url) {
  const trimmed = url.replace(/\/+$/, '');
  const merchantId = trimmed.split('/').pop();

  if (!merchantId || !merchantId.includes('-')) {
    throw new Error(`Unable to extract merchant ID from URL: ${url}`);
  }

  return merchantId;
}

function parseDisplayedAmount(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function minorToPrice(minor, priceV2) {
  if (priceV2?.amountDisplay) {
    const displayedAmount = parseDisplayedAmount(priceV2.amountDisplay);
    if (displayedAmount !== null) {
      return displayedAmount;
    }
  }

  if (typeof minor !== 'number') {
    return null;
  }

  return Math.round(minor / 100);
}

function calculateDiscountPercentage(originalPrice, finalPrice) {
  if (
    typeof originalPrice !== 'number' ||
    typeof finalPrice !== 'number' ||
    originalPrice <= 0 ||
    finalPrice >= originalPrice
  ) {
    return 0;
  }

  return Number((((originalPrice - finalPrice) / originalPrice) * 100).toFixed(2));
}

async function retry(operationName, fn, attempts = MAX_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }

      const backoffMs = attempt * 1500;
      console.warn(`${operationName} attempt ${attempt} failed: ${error.message}`);
      console.warn(`Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

function normalizeMenuItem(item) {
  const price = minorToPrice(item.priceInMinorUnit, item.priceV2);
  const priceAfterDiscount = minorToPrice(item.discountedPriceInMin, item.discountedPriceV2) ?? price;
  const discountAmount =
    typeof price === 'number' && typeof priceAfterDiscount === 'number'
      ? Math.max(price - priceAfterDiscount, 0)
      : null;
  const discountPercentage = calculateDiscountPercentage(price, priceAfterDiscount);

  return {
    name: item.name ?? null,
    description: item.description ?? null,
    price,
    discount: discountAmount,
    priceAfterDiscount,
    discountPercentage,
    available: Boolean(item.available)
  };
}

function normalizeMerchantPayload(payload) {
  const merchant = payload?.merchant;

  if (!merchant?.menu?.categories) {
    throw new Error('Merchant payload does not include menu categories.');
  }

  const categories = merchant.menu.categories.map(category => ({
    name: category.name ?? null,
    items: (category.items || []).map(item => normalizeMenuItem(item))
  }));

  return {
    outletName: merchant.name ?? null,
    categories
  };
}

function merchantToCsv(data) {
  const rows = [];

  rows.push(['Category', 'Item Name', 'Description', 'Original Price', 'Discount Amount', 'Discounted Price', 'Discount %', 'Available']);

  for (const category of data.categories) {
    for (const item of category.items) {
      rows.push([
        category.name ?? '',
        item.name ?? '',
        (item.description ?? '').replace(/"/g, '""'),
        item.price ?? '',
        item.discount ?? '',
        item.priceAfterDiscount ?? '',
        item.discountPercentage ?? '',
        item.available ? 'Yes' : 'No'
      ].map(field => `"${field}"`).join(','));
    }
  }

  return rows.join('\n');
}

module.exports = {
  extractMerchantId,
  retry,
  normalizeMerchantPayload,
  merchantToCsv
};
