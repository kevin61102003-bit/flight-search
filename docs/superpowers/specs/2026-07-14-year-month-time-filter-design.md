# Design: Year/Month Selection & Configurable Time Filter

**Date:** 2026-07-14  
**Status:** Approved

## Overview

Two new features for the Google Flights price tracker:

1. **Free year/month selection** — replace the hardcoded September 2026 with a UI picker; each month gets its own isolated cache
2. **Configurable departure time filter** — replace the hardcoded 09:00–23:00 outbound filter with dual-range sliders for both outbound and return flights

## Cache Layer (`cache.js`)

**New directory structure:**
```
cache/
  2026-09/
    TPE_PUS_2026-09-01_2026-09-06.json
    TPE_PUS_2026-09-01_2026-09-07.json
  2026-10/
    ...
```

**API changes:**
- `get(key, year, month)` / `set(key, value, year, month)` — all operations require year/month
- `getAll(year, month)` — reads only the specified month's subdirectory; existing dedup logic unchanged
- `getLastUpdated(year, month)` — returns the mtime of the newest file in the month's subdirectory, or `null` if the directory doesn't exist
- `clearMonth(year, month)` — deletes the entire subdirectory

**Migration:** Existing files in `cache/` root are left in place and ignored. No migration needed.

## Scraper (`scraper.js`)

`scrapeFlights(params)` gains two new parameters:

```js
{
  origin, destination, departDate, returnDate,
  outboundTimeRange: { start: "06:00", end: "23:00" },
  returnTimeRange:   { start: "06:00", end: "23:00" },
}
```

**Outbound:** existing time-filtered selection logic uses `outboundTimeRange` instead of the hardcoded `09:00–23:00`.

**Return (new):** after navigating to the return flights page, apply the same time-filtered scan using `returnTimeRange` to find the cheapest qualifying return flight, then extract the displayed round-trip price.

**Defaults:** both ranges default to `06:00–23:00` to match current behavior. Passing `00:00–24:00` disables filtering entirely (includes red-eye flights).

## Server API (`server.js`)

**`GET /api/results?year=2026&month=9`**
- `year` and `month` query params (default: 2026/9 for backward compatibility)
- Response gains `lastUpdated` field (ISO string or `null`)

**`GET /api/stats?year=2026&month=9`**
- Same year/month params; response gains `lastUpdated`

**`POST /api/search`**
```js
{
  origin, destination, minStay, maxStay,
  year, month,
  outboundTimeRange: { start, end },
  returnTimeRange:   { start, end },
}
```

**`POST /api/clear-cache`**
- With `year` + `month`: clears only that month's subdirectory
- Without params: clears all cache (existing behavior preserved)

**`--scrape-all` CLI flag**
- Changed from hardcoded `generateDates(2026, 9)` to reading CLI args
- Usage: `node server.js --scrape-all --year=2026 --month=9`

## UI (`public/app.js` + `index.html` + `style.css`)

**Settings panel additions (header area):**

| Control | Type | Details |
|---|---|---|
| 年份 | number input | min 2026 |
| 月份 | select (1–12) | Chinese month names |
| 去程出發時間 | dual-range slider | 00:00–24:00, step 30 min, label shows current range |
| 回程出發時間 | dual-range slider | 00:00–24:00, step 30 min, label shows current range |
| 最後更新 | read-only text | "最後更新：YYYY/MM/DD HH:mm（YYYY年M月）" or "尚未抓取" |

**Dual-range slider:** implemented in vanilla JS/CSS (no library). Two overlapping `<input type="range">` elements with custom styling to show the filled track between handles.

**Default values:** outbound `06:00–23:00`, return `06:00–23:00`.

**On year/month change:** frontend re-fetches `/api/results` and `/api/stats` with the new params; the chart and table update in place. The last-updated timestamp updates to reflect the selected month's cache state.

**`getSearchParams()`:** reads year/month from the new inputs instead of the hardcoded values.

## Out of Scope

- Airport dropdown/autocomplete (origin/destination remain free-text inputs)
- Cache TTL / staleness expiry
- Round-trip URL verification in scraper (`CBwQAh` check)
