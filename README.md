# Stremio nCore + Debrid-Link Addon

A [Stremio](https://www.stremio.com/) addon that searches Hungarian torrents on [nCore.pro](https://ncore.pro) and streams them via [Debrid-Link](https://debrid-link.fr/).

## How It Works

```
Stremio Client  ──►  This Addon (Express.js)  ──►  nCore.pro (JSON API)
                         │                           Debrid-Link API v2
                         │
                         ├── /manifest.json          → Addon metadata
                         ├── /catalog/{type}/...     → Browse torrents by seed count
                         ├── /stream/{type}/{id}.json → Find cached/uncached streams
                         └── /play/:torrentId        → Upload .torrent → start seeding → redirect to stream URL
```

### Stream Flow

1. **User clicks a movie/series** in Stremio → addon receives the IMDB ID
2. **Searches nCore** for matching torrents (IMDB → Cinemeta fallback → title search → short title → IMDB number)
3. **Downloads .torrent files** for top 3 candidates, computes info_hash
4. **Checks Debrid-Link seedbox** — all torrents compared against seedbox hash list (single API call)
5. **Returns streams to Stremio**:
   - ⚡ **Cached**: direct Debrid-Link stream URL → instant playback
   - ⏳ **Not cached**: proxy URL (`/play/:torrentId`) → uploads on click → polls until ready

### Key Design Decisions

| Decision | Why |
|---|---|
| **nCore JSON API** (`jsons=true`) | Fast, structured, no HTML scraping |
| **curl for nCore HTTP** | Cookie-jar handling is rock-solid vs axios cookie jars |
| **Custom bencode parser** | Reliable info_hash extraction without `parse-torrent` dependency bugs |
| **IMDB → Cinemeta fallback** | Many nCore torrents lack IMDB tags; Cinemeta resolves series episodes |
| **Single seedbox API call** | Batch-compare all hashes instead of N separate API calls |
| **Sample exclusion** | Filters out `sample.mkv` files, picks the largest video file for playback |
| **No seedbox cleanup** | Debrid-Link seedbox is never cleared — relies on user's own management |
| **Path-based auth** (`/yourtoken/...`) | Stremio doesn't support Basic Auth in URLs; token in path is compatible |

## Quick Start

### Prerequisites

- **Node.js** 18+
- **nCore.pro** premium account
- **Debrid-Link** account with API key ([get it here](https://debrid-link.com/api_doc/v2/))
- (Optional) A domain with HTTPS for public access (DuckDNS + Caddy recommended)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/stremio-ncore-debrid.git
cd stremio-ncore-debrid
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your credentials:
```

```ini
# Required
NCORE_USER=your_username
NCORE_PASS=your_password
DEBRID_API_KEY=***      # Get it at https://debrid-link.com/api_doc/v2/

# Optional
PORT=7000
PUBLIC_URL=https://your-domain.com/your-token
```

#### `config.json` — Detailed Settings Reference

Every setting in `config.json` controls how the addon behaves. Below is a complete reference with explanations and trade-offs.

```json
{
  "seedLimits": { "movie": 50, "series": 20 },
  "catalogLimits": { "movie": 50, "series": 50 },
  "catalogPages": { "movie": 2, "series": 2 },
  "stream": { "checkGlobalCache": true, "maxCandidates": 10, "maxUncachedToWait": 2 }
}
```

##### `seedLimits`

| Field | Default | What it does |
|---|---|---|
| `movie` | `50` | Minimum seeders for **movies** in the catalog and search results |
| `series` | `20` | Minimum seeders for **series** in the catalog and search results |

**How it works:** When the addon fetches torrents from nCore's JSON API, it filters the results and **discards any torrent with fewer seeders than this number**. This means only well-seeded (healthy) torrents appear in your Stremio catalog.

> ⚠️ **Important:** This filter is applied **after** the API call, not before. nCore returns all matching results, and the addon strips the low-seeded ones. Higher values = fewer results but better quality (faster downloads on Debrid-Link).

**Trade-offs:**
- **Low values** (e.g. 5–20): More torrents shown, but some may have no seeders and can't be downloaded by Debrid-Link
- **High values** (e.g. 100+): Only popular torrents shown, but might miss niche or old content
- **Movie vs series:** Series torrents naturally have fewer seeders than movies, so the threshold is lower for series
- **Advisory:** The minimum viable seeder count is 1 (Debrid-Link needs at least one seeder to start). Setting below 5 may result in many "stuck" torrents that never finish downloading on Debrid-Link

---

##### `catalogLimits`

| Field | Default | What it does |
|---|---|---|
| `movie` | `50` | Maximum **movies** to show in the catalog |
| `series` | `50` | Maximum **series** to show in the catalog |

**How it works:** After filtering by seed count, the addon limits the catalog to at most this many items. The results are sorted by **upload date** (newest first).

**Trade-offs:**
- **Low values** (10–30): Smaller catalog but faster loading in Stremio
- **High values** (100+): More content to browse, but may slow down the initial catalog load
- The actual number may be lower if nCore has fewer uploads matching your seed threshold

---

##### `catalogPages`

| Field | Default | What it does |
|---|---|---|
| `movie` | `2` | Number of nCore **result pages** to fetch for movies |
| `series` | `2` | Number of nCore **result pages** to fetch for series |

**How it works:** nCore's JSON API returns ~100 results per page. Setting `catalogPages` to `2` means the addon fetches 2 pages (~200 results), then filters by seed limit, then trims to `catalogLimits`.

**Why you'd change this:** nCore sorts by upload date (`fid` = upload order). The newest torrents are on page 1. If the latest page doesn't have enough high-seeded torrents, fetching more pages older content may include more matches.

**Example scenario:** Say your `seedLimits.movie` is 50 and `catalogLimits.movie` is 50, but page 1 only has 40 torrents above 50 seeders. With 2 pages, the addon fetches both pages (200 torrents total), and finds enough to fill the catalog limit.

**Performance impact:** Each page adds ~1 second to the catalog request time (nCore API latency). Setting `catalogPages` above 3–4 is not recommended.

---

##### `stream.maxCandidates`

| Field | Default | What it does |
|---|---|---|
| `maxCandidates` | `10` | Maximum number of stream options shown per movie/series |

**How it works:** When you click on a movie or series, the addon finds all matching torrents on nCore, sorts them by **seed count** (highest first), and returns at most this many as stream options in Stremio.

**Why you'd change this:**
- **Low values** (3–5): Less cluttered stream list, only the best-seeded torrents
- **High values** (10–20): More choices (different quality, language, release groups)
- **Advisory:** Each candidate means downloading a `.torrent` file from nCore and computing its info_hash for cache checking. More candidates = more concurrent requests to nCore and slower stream loading

**What gets checked for each candidate:**
1. Addon downloads the .torrent file (for top 3 candidates)
2. Computes info_hash using the custom bencode parser
3. Compares against Debrid-Link's seedbox list (single API call for all)
4. Returns ⚡ if cached (direct Debrid-Link URL) or ⏳ if not (play proxy URL)

---

##### `stream.maxUncachedToWait`

| Field | Default | What it does |
|---|---|---|
| `maxUncachedToWait` | `2` | Maximum number of uncached (⏳) torrents that will wait for the user to select one |

**How it works:** This limits how many ⏳ candidates are shown before the addon stops checking. If `maxUncachedToWait` is 2, and the addon has already found 2 uncached torrents, any further candidates are still shown but flagged as uncached.

**Current status:** This field is **reserved for future use**. Currently, the addon checks all candidates regardless of this limit. The limit will affect behavior once the /play endpoint properly handles queuing (e.g. showing a "waiting" state for uncached torrents).

---

##### `stream.checkGlobalCache`

| Field | Default | What it does |
|---|---|---|
| `checkGlobalCache` | `true` | When enabled, the addon attempts to upload the `.torrent` file to Debrid-Link to check if it exists in the **global cache** (i.e., someone else has previously downloaded it). |

**How it works:** When you browse a movie or series, the addon checks your personal seedbox for cached torrents (⚡). Torrents not in your seedbox are shown as ⏳. If `checkGlobalCache` is enabled, the addon additionally:

1. Uploads the `.torrent` file of the **top ⏳ candidate** to Debrid-Link
2. If Debrid-Link responds with `downloadPercent: 100` → the torrent exists in the **global cache** → shows 🌐 with a direct stream URL
3. If NOT globally cached → **immediately deletes** the torrent from the seedbox → stays ⏳
4. Only the top candidate is checked (one upload per stream request), to avoid hitting API rate limits

**Does this consume seedbox slots?** No. If the torrent is globally cached, it's deleted from the seedbox after retrieving the stream URL. If it's not cached, it's also deleted. The upload is purely for cache detection, not for seeding.

**Limitations:**
- Requires at least **one free slot** in your Debrid-Link seedbox (max 100 torrents). If your seedbox is full, the check is skipped.
- Adds ~1-2 seconds to the stream loading time (one upload per request).
- The 🌐 badge means **some Debrid-Link user** has this cached — playback should start quickly, but may be slower than ⚡.

**Why disable it?**
- To save API calls / avoid rate limiting
- If you prefer only ⚡ (your own seedbox) to indicate instant availability
- If your seedbox is frequently full and the check always fails anyway

**Console log example:**
```
[STREAM] Globális cache ellenőrzés: For All Mankind S01...
[DEBRID] ✅ Globális cache-ben van!
```

---

### Default Values

If `config.json` is missing or a specific field is not set, the addon falls back to these built-in defaults:

```json
{
  "seedLimits": { "movie": 300, "series": 200 },
  "catalogLimits": { "movie": 100, "series": 100 },
  "catalogPages": { "movie": 3, "series": 3 },
  "stream": { "maxCandidates": 10, "maxUncachedToWait": 2 }
}
```

These defaults are deliberately **conservative** (high seed limits, many pages) to ensure quality results on first run. The recommended values for typical usage are the ones in the example above (50/20 seed limits, 2 pages).

---

### Quick Reference: What to Tune

| Problem | What to increase | What to decrease |
|---|---|---|
| Not enough movies in catalog | `catalogPages.movie`, `catalogLimits.movie` | `seedLimits.movie` |
| Not enough series in catalog | `catalogPages.series`, `catalogLimits.series` | `seedLimits.series` |
| Too many low-quality torrents | `seedLimits.movie`, `seedLimits.series` | — |
| Stream list too slow to appear | — | `stream.maxCandidates` |
| Too many stream options | — | `stream.maxCandidates` |
| Missing older content | `catalogPages.movie` or `catalogPages.series` | `seedLimits`

### Run

```bash
npm start
```

### Install in Stremio

Open Stremio → Addons → "Add addon" → paste your addon's manifest URL:

```
http://localhost:7000/manifest.json          # local
https://your-domain.com/yourtoken/manifest.json  # public
```

## HTTPS Setup (DuckDNS + Caddy)

For public access (so you can use the addon outside your home network):

```caddyfile
your-domain.duckdns.org {
    handle_path /yourtoken/* {
        reverse_proxy localhost:7000
    }
    handle {
        respond 404
    }
}
```

```bash
# Install Caddy and start:
sudo apt install caddy
sudo systemctl enable --now caddy
```

Caddy auto-obtains Let's Encrypt certificates. The path-based token (`/yourtoken/...`) protects your addon from unauthorized use — only URLs with the token are proxied to the addon, all other paths return 404.

## Project Structure

```
.
├── index.js          # Main entry: Express server, Stremio addon routes, /play endpoint
├── ncore.js          # nCore.pro client — curl-based, JSON API, cookie management
├── debrid.js         # Debrid-Link API client — torrent upload, seedbox check, stream URLs
├── config.json       # Seed limits, catalog limits, stream candidates
├── .env.example      # Environment variables template (copy to .env)
├── .gitignore        # Excludes .env, node_modules, temp files
├── package.json
└── README.md
```

### `index.js` — Main Entry Point

- **Manifest**: `/manifest.json` — Stremio addon metadata (v1.10.0)
- **Catalog**: `/catalog/{movie|series}/ncore-latest-{movies|series}.json` — browses nCore's latest torrents above seed limits, supports search via `extra.search`
- **Stream**: `/stream/{movie|series}/tt1234567.json` — finds matching torrents, checks Debrid-Link cache, returns stream list
- **Play**: `/play/:torrentId` — proxy endpoint: downloads .torrent from nCore, uploads to Debrid-Link, polls until ready, redirects to stream URL

### `ncore.js` — nCore Client

- Uses **curl** subprocess for HTTP (reliable cookie-jar vs. axios cookie plugins)
- nCore JSON API (`jsons=true` parameter) for structured results
- Login flow: GET login page → POST credentials → verify via JSON API call
- Search methods: `searchByImdb()`, `searchByName()`, `getLatest()`
- Hungarian accent normalization for title search (`á→a`, `é→e`, `ő→o`, etc.)
- Quality/language parsing from release names (e.g., `BDRip`, `HUN`, `1080p`)

### `debrid.js` — Debrid-Link Client

- Custom **bencode parser** for info_hash extraction (walks the binary structure byte-by-byte to correctly handle string lengths)
- `checkCache()` — checks if a torrent exists in the seedbox **without uploading** (read-only)
- `addTorrentFile()` — uploads .torrent file; first checks by hash, only uploads if not already present
- `_getDownloadLink()` — selects the largest video file, **excludes `sample` files**
- `waitForTorrent()` — polls seedbox status (up to 60 attempts × 3s = 3 minutes)

## Local Network Gotcha (Hairpin NAT)

If you're running the server on your home network and accessing it from the same network via the public domain, your router may not support **NAT loopback** (hairpin NAT). You'll get "failed to fetch" even though the server is reachable from outside.

**Fix:** Add the domain to your local machine's hosts file pointing to the server's local IP:

```
# Windows: C:\Windows\System32\drivers\etc\hosts
# Linux/macOS: /etc/hosts
10.0.0.1  your-domain.duckdns.org
```

## Pitfalls & Lessons Learned

### nCore

1. **`download_url` is session-dependent** — The URL from nCore API responses doesn't contain the session key. Always download via the cookie-authenticated curl session.
2. **IMDB search is incomplete** — Many torrents on nCore have no IMDB tag. The addon falls back through 4 stages: IMDB → Cinemeta title → short title → IMDB number.
3. **Hungarian accents break search** — nCore's search engine returns no results for accented queries (`Szerencsétlen`). Always normalize: `á→a`, `é→e`, `ő→o`, `ű→u`.
4. **JSON API returns HTML on auth failure** — If the session expires mid-request, nCore returns the HTML login page instead of JSON. The parser handles this gracefully (defaults to empty results).

### Debrid-Link

5. **Seedbox slot limit** — If your seedbox is full (100/100), uploads fail silently. The addon doesn't purge old torrents — manage space manually at [debrid-link.com](https://debrid-link.com/).
6. **Cache check ≠ upload** — The `checkCache()` method only reads the seedbox list. It never uploads. This is critical for fast stream listings — the addon checks cache status for display but only uploads when the user clicks ⏳.
7. **`.torrent` download is slow** — Downloading .torrent files from nCore takes ~1-2s each. The addon limits to top 3 (display only) and caches info_hashes to `/tmp/ncore_hash_cache.json`.
8. **Sample files ruin playback** — Many torrents include `sample.mkv`. The file selector explicitly filters these and picks the **largest** video file by byte size.
9. **`notWebReady` behavior hint** — Stremio uses this to decide whether to show a loading spinner. ⚡ (cached) → `notWebReady: false` → instant. ⏳ (not cached) → `notWebReady: true` → loading.

### Stremio Addon SDK

10. **Relative URLs don't work** — Stremio requires **absolute** URLs in stream objects. Always prepend the base URL.
11. **`description` field breaks display** — The `stream.description` field causes Stremio to not render anything. All info goes into `stream.title` with `\n` for multi-line display.
12. **Multi-line titles** — Stremio supports `\n` in titles. Format: name on line 1, metadata on line 2, status on line 3.
13. **`serveHTTP` doesn't propagate `server: app`** — Use `getRouter()` + `app.use()` instead of `serveHTTP()` for Express integration.

### Caddy / HTTPS

14. **Hairpin NAT** — See "Local Network Gotcha" above.
15. **`handle_path` strips prefix** — When Caddy proxies `/yourtoken/*` to `localhost:7000`, the path becomes `/...` (token stripped). Express routes don't need the token prefix.
16. **TLS cert auto-renewal** — Caddy handles Let's Encrypt automatically. No manual cert management needed.

## For AI / LLM Agents

If you're an AI assistant continuing development on this project, here's what you need to know:

### Code Conventions

- **ES Module style but CommonJS**: Uses `require()`/`module.exports`, not `import`/`export`
- **No TypeScript**: Plain JavaScript with JSDoc-style comments
- **Error handling**: Most functions return `null` or empty arrays on failure; errors are caught and logged
- **curl subprocess**: `ncore.js` shells out to `curl` for HTTP — don't replace with axios/fetch without ensuring cookie-jar parity

### State Management

- **nCore session**: Stored as boolean flag + cookie file in `/tmp/`. The cookie file contains PHPSESSID.
- **Hash cache**: `/tmp/ncore_hash_cache.json` — maps torrent IDs to info_hashes
- **No database**: Everything is stateless between restarts (except the hash cache)

### Critical Paths (Don't Break These)

1. **nCore login** → session cookie → all API calls depend on it
2. **Quality parsing regexes** → determines what Stremio displays (resolution, language)
3. **File selector** → must exclude `sample`, must pick largest video file
4. **Cache check flow** → read-only seedbox list → compute hash → compare → never upload here

### Testing Without Credentials

Set dummy values in `.env` and use mock mode (not implemented yet — add a `--mock` flag that returns canned data if needed).

### Versioning

The version in `manifest.json` (inside `index.js` builder config) must match the one in the console startup message. Current: **1.10.0**. Bump both on every change that affects Stremio behavior.

### What's Hardcoded (Move to Config Eventually)

- nCore base URL: `https://ncore.pro` (in `ncore.js`)
- Debrid-Link base URL: `https://debrid-link.fr/api/v2` (in `debrid.js`)
- Metahub poster URL: `https://images.metahub.space/poster/medium/{imdbId}/img` (in `index.js`)
- Cinemeta API: `https://v3-cinemeta.strem.io/meta/{type}/{imdbId}.json` (in `index.js`)
- Cookie/user-agent strings (in `ncore.js`)

### Common Issues to Debug

| Symptom | Likely Cause |
|---|---|
| "Cannot GET /manifest.json" | Server not running or wrong port |
| Empty catalog | nCore session expired → re-login |
| ⚡ but playback fails | Wrong file selected (sample), or Debrid-Link stream URL expired |
| ⏳ never resolves | Seedbox full (100/100), or torrent has 0 seeders |
| "failed to fetch" in Stremio | Hairpin NAT (see above), or Caddy not running |

## License

MIT
