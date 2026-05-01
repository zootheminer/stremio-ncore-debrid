require('dotenv').config()
const fs = require('fs')

const express = require('express')
const cors = require('cors')
const { addonBuilder, getRouter } = require('stremio-addon-sdk')
const { NcoreClient } = require('./ncore')
const { DebridClient } = require('./debrid')
const path = require('path')
const os = require('os')

// ─── Konfiguráció betöltése ──────────────────────────────────────
const configPath = path.join(__dirname, 'config.json')
let config = {}
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  console.log('[CONFIG] Betöltve:', JSON.stringify(config, null, 2))
} catch (err) {
  console.warn('[CONFIG] Nem található config.json, alapértékek használata')
  config = {}
}

// seedLimits betöltése vagy alapérték
const SEED_LIMIT_MOVIE = config.seedLimits?.movie ?? 300
const SEED_LIMIT_SERIES = config.seedLimits?.series ?? 200
const CATALOG_LIMIT_MOVIE = config.catalogLimits?.movie ?? 100
const CATALOG_LIMIT_SERIES = config.catalogLimits?.series ?? 100
const CATALOG_PAGES_MOVIE = config.catalogPages?.movie ?? 3
const CATALOG_PAGES_SERIES = config.catalogPages?.series ?? 3
const STREAM_MAX_CANDIDATES = config.stream?.maxCandidates ?? 10
const STREAM_MAX_UNCACHED_WAIT = config.stream?.maxUncachedToWait ?? 2
const CHECK_GLOBAL_CACHE = config.stream?.checkGlobalCache === true

// ─── Környezeti változók ─────────────────────────────────────────
const PORT = process.env.PORT || 7000
const PUBLIC_URL = process.env.PUBLIC_URL || ''
const NCORE_USER = process.env.NCORE_USER
const NCORE_PASS = process.env.NCORE_PASS
const DEBRID_API_KEY = process.env.DEBRID_API_KEY

// ─── Validáció ─────────────────────────────────────────────────
const missing = []
if (!NCORE_USER) missing.push('NCORE_USER')
if (!NCORE_PASS) missing.push('NCORE_PASS')
if (!DEBRID_API_KEY) missing.push('DEBRID_API_KEY')

if (missing.length > 0) {
  console.error(`\n❌ Hiányzó környezeti változók: ${missing.join(', ')}`)
  console.error('   Másold a .env.example fájlt .env-re és töltsd ki!\n')
  process.exit(1)
}

// ─── Kliensek inicializálása ────────────────────────────────────
const ncore = new NcoreClient(NCORE_USER, NCORE_PASS)
const debrid = new DebridClient(DEBRID_API_KEY)

// ─── Segéd: poszter URL készítése IMDB ID-ből ──────────────────
function getPoster(imdbId) {
  if (!imdbId) return undefined
  return `https://images.metahub.space/poster/medium/${imdbId}/img`
}

// ─── Segéd: seed limit lekérése típus alapján ──────────────────
function getSeedLimit(type) {
  if (type === 'movie') return SEED_LIMIT_MOVIE
  if (type === 'series') return SEED_LIMIT_SERIES
  return 100
}

function getCatalogLimit(type) {
  if (type === 'movie') return CATALOG_LIMIT_MOVIE
  return CATALOG_LIMIT_SERIES
}

function getCatalogPages(type) {
  if (type === 'movie') return CATALOG_PAGES_MOVIE
  return CATALOG_PAGES_SERIES
}

// ─── Addon Builder ───────────────────────────────────────────────
const builder = new addonBuilder({
  id: 'io.github.ncore-debrid',
  version: '1.11.0',
  name: 'nCore + Debrid-Link',
  description: 'nCore torrent kereső + Debrid-Link streaming. Filmek és sorozatok magyar torrentekből.',
  logo: 'https://ncore.pro/favicon.ico',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    {
      type: 'movie',
      id: 'ncore-latest-movies',
      name: 'nCore Friss Filmek',
      extra: [
        { name: 'search', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'ncore-latest-series',
      name: 'nCore Friss Sorozatok',
      extra: [
        { name: 'search', isRequired: false }
      ]
    }
  ]
})

// ─── Catalog handler ─────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    const searchQuery = extra?.search
    const minSeed = getSeedLimit(type)
    const maxCount = getCatalogLimit(type)
    const catalogPages = getCatalogPages(type)
    console.log(`[CATALOG] type=${type}, id=${id}, search=${searchQuery || '-'}, minSeed=${minSeed}, max=${maxCount}, pages=${catalogPages}`)

    if (!ncore.isLoggedIn()) {
      await ncore.login()
    }

    let torrents
    if (searchQuery) {
      torrents = await ncore.search(searchQuery, type, minSeed)
    } else {
      torrents = await ncore.getLatest(type, minSeed, catalogPages)
    }

    // Limitálás
    if (torrents.length > maxCount) {
      torrents = torrents.slice(0, maxCount)
    }

    const metas = torrents.map(t => {
      const qualParts = [t.quality, t.resolution].filter(Boolean)
      const qual = qualParts.filter((v, i, a) => a.indexOf(v) === i).join(' ')
      const langLabel = t.language ? ` [${t.language}]` : ''

      // IMDB nélküli torrenteknél a nevet + torrent ID-t kódoljuk az ID-be
      const metaId = t.imdbId || `ncore-${encodeURIComponent(t.title.replace(/\s+/g, ' ').trim())}-${t.id}`

      return {
        id: metaId,
        type: type,
        name: t.title.replace(/\./g, ' ').replace(/\s+/g, ' ').trim(),
        year: t.year ? parseInt(t.year) : undefined,
        poster: getPoster(t.imdbId),
        posterShape: 'poster',
        overview: [
          `📁 ${t.size || '?'}`,
          `🌱 Seed: ${t.seeders}  🔄 Leech: ${t.leechers}`
        ].concat(qual ? [`🎬 ${qual}`] : [])
         .concat(langLabel ? [`🔊 ${langLabel}`] : [])
         .join('\n'),
        releaseInfo: [t.year, qual, `🌱${t.seeders}`].filter(Boolean).join(' · ')
      }
    })

    return { metas }
  } catch (err) {
    console.error('[CATALOG ERROR]', err.message)
    return { metas: [] }
  }
})

// ─── Stream handler ──────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
  try {
    console.log(`[STREAM] type=${type}, id=${id}`)

    // 🔁 nCore saját ID (ncore-<name>-<torrentId>) — nincs IMDB
    if (id.startsWith('ncore-')) {
      const match = id.match(/^ncore-(.+)-(\d+)$/)
      if (match) {
        const name = decodeURIComponent(match[1])
        const torrentId = match[2]
        console.log(`[STREAM] nCore ID: torrent=${torrentId}, name="${name.substring(0, 40)}"`)
        
        // Letöltjük a .torrent fájlt és ellenőrizzük a seedboxban
        try {
          const buf = await ncore.downloadTorrent(torrentId)
          if (buf) {
            const result = await debrid.checkCache(buf)
            const isCached = result && result.cached && result.streamUrl
            const cacheType = isCached ? 'personal' : null
            console.log(`[STREAM] ${isCached ? '✅' : '⏳'} Cache: ${name.substring(0, 40)}`)
            return { streams: [{
              name: cacheType === 'personal' ? 'nCore ⚡' : 'nCore ⏳',
              title: [
                name.substring(0, 55),
                `📦 ? · 🌱 ?`
              ].join('\n'),
              url: isCached ? result.streamUrl : `${PUBLIC_URL}/play/${torrentId}`,
              behaviorHints: { notWebReady: !isCached, bingeGroup: 'ncore-debrid' }
            }]}
          }
        } catch (e) {
          console.log(`[STREAM] ⚠️ nCore ID hiba: ${e.message}`)
        }
      }
      console.log(`[STREAM] Nincs stream nCore ID-hoz: ${id}`)
      return { streams: [] }
    }

    // IMDB ID alapú keresés
    const { imdbId, season, episode } = parseImdbId(id)
    const epLabel = season && episode ? `S${season}E${String(episode).padStart(2,'0')}` : null
    console.log(`[STREAM] IMDB: ${imdbId}${epLabel ? ' · ' + epLabel : ''}`)

    if (!ncore.isLoggedIn()) {
      await ncore.login()
    }

    let torrents = await ncore.searchByImdb(imdbId, type, 1)

    if (!torrents || torrents.length === 0) {
      // 🔁 IMDB alapú keresés nem talált → Cinemeta a film címéért,
      //    majd cím alapján keresés az nCore-on (sok torrent nincs IMDB-hez rendelve)
      console.log(`[STREAM] IMDB keresés nem talált: ${imdbId}, Cinemeta név lookup...`)
      try {
        const cinRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`)
        const cinData = await cinRes.json()
        const meta = cinData?.meta

        if (meta?.id && meta.id !== imdbId) {
          // Sorozat epizód → sorozat IMDB feloldása
          console.log(`[STREAM] Cinemeta → series IMDB: ${meta.id}`)
          torrents = await ncore.searchByImdb(meta.id, type, 1)
        }

        if ((!torrents || torrents.length === 0) && meta?.name) {
          // Cím alapján keresés (mert IMDB nem talált semmit)
          const searchName = meta.name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
          console.log(`[STREAM] Cím alapú keresés: "${searchName}"`)
          torrents = await ncore.searchByName(searchName, type, 1)
        }

        // Ha Cinemeta se adott nevet, próbáljuk ki a "tt" + számot névként
        if (!torrents || torrents.length === 0) {
          const ttNumber = imdbId.replace('tt', '')
          console.log(`[STREAM] nCore keresés IMDB számként: "${ttNumber}"`)
          torrents = await ncore.searchByName(ttNumber, type, 1)
        }

        // Ha még mindig nincs, próbáljuk rövidebb névvel (csak ha van név)
        if ((!torrents || torrents.length === 0) && meta?.name) {
          const shortName = meta.name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ')
          if (shortName !== meta.name) {
            console.log(`[STREAM] Rövidített cím: "${shortName}"`)
            torrents = await ncore.searchByName(shortName, type, 1)
          }
        }
      } catch (cinErr) {
        console.log(`[STREAM] Cinemeta lookup sikertelen: ${cinErr.message}`)
      }
    }

    if (!torrents || torrents.length === 0) {
      console.log(`[STREAM] Nincs torrent: ${imdbId}`)
      return { streams: [] }
    }

    // Sorozatoknál: CSAK a keresett évad/rész torrenteket tartsuk meg
    if (type === 'series' && season) {
      const before = torrents.length
      torrents = filterByEpisode(torrents, season, episode)
      console.log(`[STREAM] Epizód szűrés: ${before} → ${torrents.length} (S${season}E${episode || '?'})`)
      if (torrents.length === 0) {
        console.log(`[STREAM] Nincs S${season}E${episode || '?'} torrent`)
        return { streams: [] }
      }
    }

    const candidates = torrents.sort((a, b) => b.seeders - a.seeders).slice(0, STREAM_MAX_CANDIDATES)
    console.log(`[STREAM] ${candidates.length} találat, gyorsítótár ellenőrzés...`)

    const result = await checkAllTorrents(candidates, season, episode, imdbId)

    if (!result || result.streams.length === 0) {
      console.log('[STREAM] ❌ Nem sikerült streamet találni')
      return { streams: [] }
    }

    console.log(`[STREAM] ✅ ${result.streams.length} stream opció visszaadva`)
    return { streams: result.streams }
  } catch (err) {
    console.error('[STREAM ERROR]', err.message)
    return { streams: [] }
  }
})

// ─── Segéd: stream cím formázás ──────────────────────────────────
function makeStreamDisplay(torrent, isCached, cacheType, season, episode) {
  const qual = torrent.resolution || torrent.quality || ''
  const lang = torrent.language || ''
  const flag = { 'HUN': '🇭🇺', 'ENG': '🇬🇧', 'MULTi': '🌍', 'HUN+ENG': '🇭🇺+🇬🇧' }[lang] || ''
  const cacheIcon = cacheType === 'personal' ? '⚡' : cacheType === 'global' ? '🌐' : '⏳'
  
  const name = torrent.title
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  
  // name mező: 1. sor nCore + ikon, 2. sor zászló + felbontás
  const nameParts = [`nCore ${cacheIcon}`]
  const badgeParts = []
  if (flag) badgeParts.push(flag)
  if (qual) badgeParts.push(qual)
  if (badgeParts.length > 0) nameParts.push(badgeParts.join(' · '))
  const streamName = nameParts.join('\n')
  
  // Title sorok
  const lines = []
  
  // 1. sor: stream név
  lines.push(name)
  
  // 2. sor: S01E01 (sorozat) · 📦méret
  const infoParts = []
  if (season && episode) {
    const s = String(season).padStart(2, '0')
    const e = String(episode).padStart(2, '0')
    infoParts.push(`S${s}E${e}`)
  }
  if (torrent.size && torrent.size !== '?') infoParts.push(`📦${torrent.size}`)
  if (infoParts.length > 0) lines.push(infoParts.join(' · '))
  
  // 3. sor: 🌱 seed
  lines.push(`🌱 ${torrent.seeders}`)
  
  return { name: streamName, title: lines.join('\n') }
}

// ─── Segéd: sorozat epizód szűrés ───────────────────────────────
function filterByEpisode(torrents, season, episode) {
  if (!season) return torrents
  
  const patterns = []
  // S01E01, S1E1, S01.E01, stb.
  const s1 = String(season)
  const s2 = String(season).padStart(2, '0')
  const e1 = String(episode)
  const e2 = String(episode).padStart(2, '0')
  
  if (episode) {
    patterns.push(new RegExp(`[Ss]${s1}[Ee]${e1}`, 'i'))
    patterns.push(new RegExp(`[Ss]${s2}[Ee]${e2}`, 'i'))
    patterns.push(new RegExp(`[Ss]${s1}\\.?[Ee]${e1}`, 'i'))
    patterns.push(new RegExp(`[Ss]${s2}\\.?[Ee]${e2}`, 'i'))
  }
  // S01 vagy S01 complete
  patterns.push(new RegExp(`[Ss]${s2}`, 'i'))
  
  const filtered = torrents.filter(t =>
    patterns.some(p => p.test(t.title))
  )
  
  if (filtered.length > 0) return filtered
  return torrents // ha nincs pontos egyezés, visszaadjuk az összeset
}

// ─── Segéd: IMDB ID kinyerése (sorozatoknál :season:episode levágása)
function parseImdbId(id) {
  // Formátum: "tt1234567" vagy "tt1234567:1:5"
  const match = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/)
  if (!match) return { imdbId: id, season: null, episode: null }
  return {
    imdbId: match[1],
    season: match[2] ? parseInt(match[2]) : null,
    episode: match[3] ? parseInt(match[3]) : null
  }
}

// ─── Segéd: minden torrent ellenőrzése (cache státusszal) ────────
const HASH_CACHE_FILE = path.join(os.tmpdir(), 'ncore_hash_cache.json')
let hashCache = {}
try { hashCache = JSON.parse(fs.readFileSync(HASH_CACHE_FILE, 'utf-8')) } catch (_) {}

function saveHashCache() {
  try { fs.writeFileSync(HASH_CACHE_FILE, JSON.stringify(hashCache)) } catch (_) {}
}

async function checkAllTorrents(candidates, season, episode, imdbId) {
  const topCandidates = candidates.slice(0, 5)
  const streams = []
  const baseUrl = PUBLIC_URL || `http://localhost:${PORT}`

  // 1. Info_hash beszerzése: cache-ből, vagy .torrent letöltéssel (top 3)
  //    Ha CHECK_GLOBAL_CACHE be van kapcsolva, mindig letöltjük a .torrent fájlt
  //    (mert kell a buffer a globális cache ellenőrzéshez)
  const top3 = topCandidates.slice(0, 3)
  const hashResults = await Promise.allSettled(top3.map(async (t) => {
    const needBuffer = CHECK_GLOBAL_CACHE  // globális cache check-hez mindig kell buffer
    if (!needBuffer && hashCache[t.id]) return { torrentId: t.id, infoHash: hashCache[t.id], buffer: null }
    try {
      const buf = await ncore.downloadTorrent(t.id, t.downloadUrl)
      const infoHash = debrid._parseInfoHash(buf)
      if (infoHash) {
        hashCache[t.id] = infoHash
        saveHashCache()
      }
      return { torrentId: t.id, infoHash, buffer: needBuffer ? buf : null }
    } catch (_) { return { torrentId: t.id, infoHash: null, buffer: null } }
  }))

  const hashes = {}
  const buffers = {}  // buffer-ek a globális cache ellenőrzéshez
  for (const r of hashResults) {
    if (r.status === 'fulfilled' && r.value.infoHash) {
      hashes[r.value.torrentId] = r.value.infoHash
      if (r.value.buffer) buffers[r.value.torrentId] = r.value.buffer
    }
  }

  // 2. Seedbox lekérdezése (egy API hívás)
  let seedboxHashes = new Set()
  let seedboxData = []
  try {
    const seedboxRes = await debrid.client.get('/seedbox/list')
    if (seedboxRes.data?.success) {
      seedboxData = seedboxRes.data.value || []
      for (const t of seedboxData) {
        if (t.hashString && t.downloadPercent === 100) {
          seedboxHashes.add(t.hashString.toLowerCase())
        }
      }
    }
  } catch (_) {}

  // 3. Státusz ellenőrzés és stream generálás
  let globalCacheChecked = false  // csak 1x próbálkozunk
  for (const torrent of topCandidates) {
    let isCached = false
    let cacheType = null  // 'personal', 'global', vagy null
    let streamUrl = null
    const th = hashes[torrent.id]
    if (th) {
      isCached = seedboxHashes.has(th.toLowerCase())
      // Ha cache-ben van, keressük ki a seedboxból a stream URL-t
      if (isCached) {
        cacheType = 'personal'
        const cachedTorrent = seedboxData.find(t => 
          t.hashString && t.hashString.toLowerCase() === th.toLowerCase() && t.downloadPercent === 100
        )
        if (cachedTorrent && cachedTorrent.files) {
          streamUrl = await debrid._getDownloadLink(cachedTorrent.files)
        }
      }
    }
    
    // Globális cache ellenőrzés (csak a legjobb ⏳ kandidátusra)
    if (!isCached && CHECK_GLOBAL_CACHE && !globalCacheChecked && th && buffers[torrent.id]) {
      console.log(`[STREAM] Globális cache ellenőrzés: ${torrent.title.substring(0, 40)}...`)
      const globalResult = await debrid.checkGlobalCache(buffers[torrent.id])
      if (globalResult && globalResult.cached && globalResult.streamUrl) {
        isCached = true
        cacheType = 'global'
        streamUrl = globalResult.streamUrl
        console.log(`[STREAM] ✅ Globális cache-ben: ${torrent.title.substring(0, 40)}`)
      }
      globalCacheChecked = true
      delete buffers[torrent.id]  // takarítás
    }
    
    const display = makeStreamDisplay(torrent, isCached, cacheType, season, episode)
    const dlParam = encodeURIComponent(torrent.downloadUrl || '')
    const imdbParam = encodeURIComponent(imdbId || '')
    streams.push({
      name: display.name,
      title: display.title,
      url: isCached && streamUrl 
        ? streamUrl  // ⚡ közvetlen Debrid-Link URL
        : `${baseUrl}/play/${torrent.id}?dl=${dlParam}&imdb=${imdbParam}`,  // ⏳ proxy
      behaviorHints: { notWebReady: !(isCached && streamUrl), bingeGroup: 'ncore-debrid' }
    })
  }
  
  return { streams }
}

// ─── Express szerver ─────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Stremio addon route-ok (getRouter, mert serveHTTP nem használja a server: app opciót)
const stremioInterface = builder.getInterface()
app.use(getRouter(stremioInterface))

/**
 * Proxy endpoint: amikor a Stremio elindít egy nem cache-ben lévő torrentet,
 * ez letölti a .torrent fájlt, feltölti a Debrid-Link-re, és átirányít a stream URL-re.
 * 
 * GET /play/:torrentId
 */
app.get('/play/:torrentId', async (req, res) => {
  const { torrentId } = req.params
  const downloadUrl = req.query.dl ? decodeURIComponent(req.query.dl) : null
  console.log(`[PLAY] Kérés: torrentId=${torrentId}${downloadUrl ? ' (+dl)' : ''}`)

  try {
    if (!ncore.isLoggedIn()) {
      await ncore.login()
    }

    const torrentBuffer = await ncore.downloadTorrent(torrentId, downloadUrl)
    if (!torrentBuffer) {
      return res.status(404).json({ error: 'Torrent nem található' })
    }
    console.log(`[PLAY] buffer: ${torrentBuffer.length} byte, info_hash: ${debrid._parseInfoHash(torrentBuffer)?.slice(0, 12) || 'NULL'}`)

    console.log(`[PLAY] Debrid-Link: ${torrentId}`)
    const result = await debrid.addTorrentFile(torrentBuffer)
    if (!result) {
      return res.status(502).json({ error: 'Debrid-Link hiba (maxTorrent?)' })
    }

    if (result.streamUrl) {
      console.log(`[PLAY] ✅ Stream URL: ${result.streamUrl.slice(0, 60)}...`)
      return res.redirect(302, result.streamUrl)
    }

    if (result.torrentId) {
      console.log(`[PLAY] ⏳ Várakozás: ${result.torrentId}`)
      const waitResult = await debrid.waitForTorrent(result.torrentId)
      if (waitResult && waitResult.streamUrl) {
        console.log(`[PLAY] ✅ Stream URL: ${waitResult.streamUrl.slice(0, 60)}...`)
        return res.redirect(302, waitResult.streamUrl)
      }
    }

    return res.status(502).json({ error: 'Nem sikerült stream URL-t generálni' })
  } catch (err) {
    console.error(`[PLAY] Hiba: ${err.message}`)
    if (err.response) {
      console.error(`[PLAY] API: ${err.response.status}`, JSON.stringify(err.response.data).slice(0, 200))
    }
    return res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`\n🎬 nCore + Debrid-Link Stremio Addon v1.11.0`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`   Szerver: http://localhost:${PORT}`)
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`)
  console.log(`   Telepítés: ${PUBLIC_URL || `http://localhost:${PORT}`}`)
  console.log(`   Filmek: ${SEED_LIMIT_MOVIE}+ seed  |  Sorozatok: ${SEED_LIMIT_SERIES}+ seed`)
  console.log(`   Oldalak: ${CATALOG_PAGES_MOVIE} film / ${CATALOG_PAGES_SERIES} sorozat  |  Max: ${CATALOG_LIMIT_MOVIE}/${CATALOG_LIMIT_SERIES}`)
  console.log(`   Config: ${configPath}`)
  console.log(`\n   ⏳ nCore bejelentkezés folyamatban...\n`)
  
  // Bejelentkezés és fiók ellenőrzés
  ncore.login().catch(err => console.error('[STARTUP] ❌ nCore login hiba:', err.message))
  debrid.checkAccount().then(ok => {
    if (!ok) console.warn('[STARTUP] ⚠️ Debrid-Link fiók nem elérhető')
  })
})
