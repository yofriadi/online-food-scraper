# GrabFood Scraper

- `npm run scrape`
  Loads the default restaurant page, captures the merchant response, and writes a normalized output JSON into `output/`.

## Commands

Run scraping:

```bash
npm run scrape https://food.grab.com/id/id/restaurant/ayam-katsu-katsunami-lokarasa-citraland-delivery/6-C7EYGBJDME3JRN
```

Optional environment variables for the scraper:

- `HEADLESS=false` set to true to run without a visible browser window
- `MAX_ATTEMPTS=3` to control retry count
- `RESPONSE_TIMEOUT_MS=30000` to control page and API wait timeout
- `MERCHANT_JSON_PATH=debug/merchant-6-C7EYGBJDME3JRN.json` use a saved Playwright session if needs an existing browser state
- `STORAGE_STATE_PATH=storageState.json` npm scrape with saved session state
