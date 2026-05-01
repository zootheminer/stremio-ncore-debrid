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
    ├── ncore.pro ◄─ Cookie/SSN alapú scraping
    │       │
    │       └── Torrent keresés seed > 100
    │
    └── Debrid-Link API ◄─ Magnet → Debrid → Stream URL
```

## Fázisok

### Fázis 1: Egyszerű stream addon (MVP)
- [ ] Node.js projekt létrehozása
- [ ] Stremio addon SDK integráció
- [ ] ncore bejelentkezés + session kezelés
- [ ] ncore torrent keresés IMDB ID alapján
- [ ] Debrid-Link API: magnet → seed → stream URL
- [ ] HTTPS beállítás (Caddy vagy reverse proxy)

### Fázis 2: Catalog funkció
- [ ] ncore népszerű oldal scraping (seed > 100)
- [ ] Catalog endpoint Stremio részére
- [ ] Kategória szűrés (film/sorozat)

### Fázis 3: Finomítások
- [ ] Seed count alapú rangsorolás
- [ ] Hibaállapot kezelés
- [ ] Konfigurációs felület

## Technológia

| Komponens | Választás |
|---|---|
| **Futtató környezet** | Node.js (már van: v20.18.0) |
| **Web framework** | Express (egyszerű) |
| **Stremio SDK** | `stremio-addon-sdk` |
| **HTTP client** | Axios (cookie kezeléssel) |
| **HTML parser** | Cheerio (ncore scraping) |
| **Debrid API** | Debrid-Link REST API |
| **HTTPS** | Caddy reverse proxy (auto SSL) |
