# Stremio nCore + Debrid-Link Addon — Terv

## Architektúra

```
Stremio (bármely eszköz)
    │
    ├── HTTPS ──► Our Addon (ezen a szerveren, Node.js)
    │                 │
    │                 ├── GET /manifest.json
    │                 ├── GET /catalog/movie/popular.json
    │                 ├── GET /catalog/series/popular.json
    │                 └── GET /stream/movie/{imdbId}.json
    │
    ├── ncore.pro ◄─ JSON API + scraping
    │       │
    │       └── Torrent keresés (konfigurálható seed limit)
    │
    └── Debrid-Link API ◄─ Magnet → Seedbox → Stream URL
```

## Fázisok

### Fázis 1: Egyszerű stream addon (MVP) ✅
- [x] Node.js projekt létrehozása
- [x] Stremio addon SDK integráció
- [x] ncore bejelentkezés + session kezelés
- [x] ncore torrent keresés IMDB ID alapján
- [x] Debrid-Link API: magnet → seed → stream URL
- [x] HTTPS beállítás (Caddy reverse proxy)

### Fázis 2: Catalog funkció ✅
- [x] ncore népszerű oldal scraping
- [x] Catalog endpoint Stremio részére
- [x] Kategória szűrés (film/sorozat)
- [x] Keresés a catalog-ban

### Fázis 3: Finomítások ✅
- [x] Seed count alapú rangsorolás
- [x] Hibaállapot kezelés
- [x] Konfigurációs fájl (config.json)

## Jelenlegi verzió: v1.16.1

### Funkciók
- **Seedbox cache**: Személyes gyorsítótár (⚡) + globális cache (🌐) támogatás
- **Epizód szűrés**: Sorozatoknál pontos SxxExx szűrés (range támogatással)
- **BingeGroup**: Minőség alapú csoportosítás a Stremio-ban
- **Proxy fallback**: Nem cache-ben lévő torrentek automatikus Debrid feltöltés
- **Stream megjelenítés**: nCore prefix + cache ikon + felbontás a name mezőben

## Konfiguráció (config.json)

| Kulcs | Alapérték | Leírás |
|---|---|---|
| `seedLimits.movie` | 300 | Minimális seed szám filmeknél |
| `seedLimits.series` | 200 | Minimális seed szám sorozatoknál |
| `catalogLimits.movie` | 100 | Max film a catalog-ban |
| `catalogLimits.series` | 100 | Max sorozat a catalog-ban |
| `catalogPages.movie` | 4 | Oldalak száma ncore scraping-nél |
| `catalogPages.series` | 4 | Oldalak száma ncore scraping-nél |
| `stream.maxCandidates` | 10 | Jelöltek száma stream keresésnél |
| `stream.maxUncachedToWait` | 2 | Várakozás nem cacheelt torrentre |
| `stream.checkGlobalCache` | false | Globális cache ellenőrzés |

## Technológia

| Komponens | Választás |
|---|---|
| **Futtató környezet** | Node.js (v20.18.0+) |
| **Web framework** | Express |
| **Stremio SDK** | `stremio-addon-sdk` |
| **HTTP client** | Axios (cookie kezeléssel) |
| **HTML parser** | Cheerio (ncore scraping) |
| **Debrid API** | Debrid-Link REST API |
| **HTTPS** | Caddy reverse proxy (auto SSL) |
