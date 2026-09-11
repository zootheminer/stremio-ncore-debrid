'use strict'

/**
 * episodeFilter.js — sorozat évad/epizód szűrés és fájlválasztás.
 *
 * HÁTTÉR (Dark Matter S01E01 → S02E01 hiba):
 * A régi `filterByEpisode` 1b fázisa ("Ep01/E01 fallback") egy
 * `[Ss](\d{1,2})\b` őrrel próbálta kizárni az idegen évados torrenteket.
 * A `\b` (szóhatár) viszont "S02E01"-ben SOHA nem illeszkedik az "S02"-re,
 * mert a "2" és az "E" között nincs szóhatár (mindkettő szó-karakter).
 * Így az őr nem látott évadot, az `[Ee]p?01` minta pedig az "E01"-re
 * illeszkedett az "S02E01"-ben → S01E01 kérésre S02E01-et adott vissza.
 *
 * A javítás: évadokat külön `extractSeasons()` szedi ki (SxxEyy, NxM,
 * "Season N", "N. évad", range-ek), és MINDEN fallback-ág ezt használja.
 */

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Képarány-minták: SOHA nem epizód-jelölések ("16x9", "4x3").
function isAspectRatio(s, e) {
  return (s === 16 && e === 9) || (s === 4 && e === 3)
}

function addRange(set, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  let a = Math.min(start, end)
  let b = Math.max(start, end)
  // irreálisan nagy range (pl. dátum-ütközés) ellen védekezünk
  if (b - a > 100) return
  for (let i = a; i <= b; i++) {
    if (i >= 1 && i <= 100) set.add(i)
  }
}

/**
 * Kinyeri a címben szereplő explicit évad-számokat.
 * Pl. "Dark.Matter.S02E01" → {2}, "Show S01-S10" → {1..10}
 * @returns {Set<number>}
 */
function extractSeasons(title) {
  const seasons = new Set()
  if (!title || typeof title !== 'string') return seasons
  let m

  // S02E01 / S02 E01 / S02.E01 / S6E2
  const sxxeyy = /[Ss](\d{1,2})\s*[. _-]?\s*[Ee]\d{1,3}(?![\d])/g
  while ((m = sxxeyy.exec(title)) !== null) {
    seasons.add(parseInt(m[1], 10))
  }

  // 2x01 (körülötte nem alfanumerikus; 5+ jegyű felbontást nem nézünk:
  // "16x9" 2-jegyű formátum, azt az s>=1 && s<=60 szűrés engedi át —
  // ezért a hívó oldalon (torrentMatchesEpisode) az SxxEyy-jelölés az úr)
  const nxm = /(?:^|[^0-9a-zA-Z])(\d{1,2})x(\d{1,3})(?![\d])/gi
  while ((m = nxm.exec(title)) !== null) {
    const s = parseInt(m[1], 10)
    const e = parseInt(m[2], 10)
    // képarány ("16x9", "4x3") SOHA nem évad-jelölés
    if (s >= 1 && s <= 60 && !isAspectRatio(s, e)) seasons.add(s)
  }

  // Season 6
  const seasonWord = /[Ss]eason\s*(\d{1,2})(?![\d])/g
  while ((m = seasonWord.exec(title)) !== null) {
    seasons.add(parseInt(m[1], 10))
  }

  // 6. évad / 6. evad — NEM kötőjel után (az range vége: "1-10. évad")
  const evad = /(?:^|[^\d-])(\d{1,2})\.\s*[ÉéEe]vad/g
  while ((m = evad.exec(title)) !== null) {
    seasons.add(parseInt(m[1], 10))
  }

  // range: S01-S10 / S01 - S10
  const range1 = /[Ss](\d{1,2})\s*[-–]\s*[Ss]?(\d{1,2})/g
  while ((m = range1.exec(title)) !== null) {
    addRange(seasons, parseInt(m[1], 10), parseInt(m[2], 10))
  }

  // range szavakkal: 1-10. évad / 1-10 season (a pont opcionális)
  const range2 = /(\d{1,2})\s*[-–]\s*(\d{1,2})\.?\s*(?:évad|evad|season)/gi
  while ((m = range2.exec(title)) !== null) {
    addRange(seasons, parseInt(m[1], 10), parseInt(m[2], 10))
  }

  // önálló S06 — csak ha NEM szám/szó-karakter követi.
  // (S02E01-ben az "E" miatt itt nincs találat — azt az sxxeyy fedi.)
  const bare = /[Ss]\s?(\d{1,2})(?![\d\w])/g
  while ((m = bare.exec(title)) !== null) {
    seasons.add(parseInt(m[1], 10))
  }

  return seasons
}

/**
 * Van-e a címben a kért (season, episode)-tól ELTÉRŐ epizód-jelölés?
 * Pl. ("Show.S01E05", 1, 1) → true ; ("Dark.Matter.S02E01", 1, 1) → true.
 * A képarány-minták ("16x9", "4x3") nem számítanak epizódnak.
 */
function hasForeignEpisodeMarker(title, season, episode) {
  if (!title || typeof title !== 'string') return false
  let m
  const sxxeyy = /[Ss](\d{1,2})\s*[. _-]?\s*[Ee](\d{1,3})(?![\d])/g
  while ((m = sxxeyy.exec(title)) !== null) {
    if (parseInt(m[1], 10) !== season || parseInt(m[2], 10) !== episode) return true
  }
  const nxm = /(?:^|[^0-9a-zA-Z])(\d{1,2})x(\d{1,3})(?![\d])/gi
  while ((m = nxm.exec(title)) !== null) {
    const ms = parseInt(m[1], 10)
    const me = parseInt(m[2], 10)
    if (isAspectRatio(ms, me)) continue
    if (ms !== season || me !== episode) return true
  }
  return false
}

/**
 * Tartalmazza-e a cím a KÉRT epizódot — több-epizódos címekhez
 * ("Show.S01E01-E02" S01E02 kérésre IGEN, mert az E02 benne van).
 * Az idegen évadhoz tartozó kombinációkat előbb kivágjuk, hogy pl.
 * "S02E01" E01-je ne számítson S01E01 kérésre találatnak.
 */
function hasRequestedEpisodeMarker(title, season, episode) {
  if (!title || typeof title !== 'string') return false
  const s2 = pad2(season)
  const e2 = pad2(episode)

  // idegen SxxEyy kombinációk kivágása (a kértet meghagyjuk)
  let rest = title.replace(/[Ss]\d{1,2}\s*[. _-]?\s*[Ee]\d{1,3}(?![\d])/g, (m) => {
    const mm = m.match(/[Ss](\d{1,2})\s*[. _-]?\s*[Ee](\d{1,3})/)
    return (parseInt(mm[1], 10) === season && parseInt(mm[2], 10) === episode) ? m : ' '
  })
  // idegen NxM kombinációk kivágása (a kértet meghagyjuk)
  rest = rest.replace(/(?:^|[^0-9a-zA-Z])\d{1,2}x\d{1,3}(?![\d])/gi, (m) => {
    const mm = m.match(/(\d{1,2})x(\d{1,3})/i)
    return (parseInt(mm[1], 10) === season && parseInt(mm[2], 10) === episode) ? m : ' '
  })

  const patterns = [
    new RegExp(`[Ss]${s2}[Ee]${e2}(\\b|[^\\d])`),
    new RegExp(`[Ee]p${e2}(\\b|[^\\d])`, 'i'),          // Ep01 (de nem csupasz E01 — az túl mohó)
    new RegExp(`[Ee]${e2}(\\b|[^\\d])`),                // csupasz E01 — már tisztított szövegen biztonságos
    new RegExp(`[Ee]pisode\\s*${episode}(?!\\d)`, 'i'), // Episode 1
    new RegExp(`(^|[^\\d])${episode}\\.\\s*r[eé]sz`, 'i') // 1. rész
  ]
  return patterns.some(p => p.test(rest))
}

/**
 * Van-e a fájlnévben BÁRMILYEN epizód-jelölés (évadtól függetlenül)?
 * A debrid fallback-döntéshez kell: jelöletlen pack-nál maradhat a
 * "legnagyobb fájl" logika, jelölt de idegen fájloknál viszont
 * inkább ne szolgáljunk ki rossz részt.
 */
function hasAnyEpisodeMarker(name) {
  if (!name || typeof name !== 'string') return false
  // képarány-minta kivágása, hogy a "16x9" ne számítson epizód-jelölésnek
  const cleaned = name.replace(/(?:^|[^0-9a-zA-Z])(?:16x9|4x3)(?![\d])/gi, ' ')
  return (
    /[Ss]\d{1,2}\s*[. _-]?\s*[Ee]\d{1,3}(?![\d])/.test(cleaned) ||
    /(?:^|[^0-9a-zA-Z])\d{1,2}x\d{1,3}(?![\d])/i.test(cleaned) ||
    /[Ee]p\d{1,3}(\b|[^\d])/i.test(name) ||
    /[Ee]pisode\s*\d+/i.test(name) ||
    /(^|[^\d])\d{1,3}\.\s*r[eé]sz/i.test(name)
  )
}

/**
 * Központi döntés: ez a torrent-cím szóba jöhet-e a kért epizódra?
 * (episode nélkül csak évad-szinten szűr.)
 */
function torrentMatchesEpisode(title, season, episode) {
  const seasons = extractSeasons(title)
  if (seasons.size > 0 && !seasons.has(season)) return false
  if (!episode) return true
  if (!hasForeignEpisodeMarker(title, season, episode)) return true
  // idegen kombináció van benne — de több-epizódos címként
  // tartalmazhatja a kért részt is (pl. S01E01-E02 S01E02-re)
  return hasRequestedEpisodeMarker(title, season, episode)
}

/**
 * Sorozat torrent-lista szűrése a kért évad/epizódra.
 *
 * Fázisok:
 *  1. pontos SxxEyy / NxM egyezés
 *  1b. Ep-fallback (évad-jel nélkül) — JAVÍTOTT évad-őrrel
 *  2. range pack-ek (S01-S10, 1-10. évad) — range ELŐBB, lásd index.js komment
 *  3. egyéni évad (S06, Season 6, 6. évad) — idegen-epizód kizárással
 *  4. nincs egyezés → CSAK évad-semleges címek (régen: minden!)
 */
function filterByEpisode(torrents, season, episode, log) {
  const logFn = typeof log === 'function' ? log : console.log
  if (!season) return torrents
  const s2 = pad2(season)
  const e2 = episode ? pad2(episode) : null

  // 1. fázis: pontos epizód — S01E05, S01.E05, S01 E05, 1x05 / 01x05
  if (episode && e2) {
    const seasonEpisodePatterns = [
      new RegExp(`[Ss]${s2}[Ee]${e2}(\\b|[^\\d])`),        // S05E01 (nem S05E019)
      new RegExp(`[Ss]${s2}\\.[Ee]${e2}(\\b|[^\\d])`),      // S05.E01
      new RegExp(`[Ss]${s2}[\\s._-][Ee]${e2}(\\b|[^\\d])`), // S05 E01, S05_E01
      new RegExp(`(^|[^0-9a-zA-Z])${s2}x${e2}(?![\\d])`, 'i'),   // 05x01
      new RegExp(`(^|[^0-9a-zA-Z])${season}x${episode}(?![\\d])`, 'i') // 5x1
    ]
    const exact = torrents.filter(t => seasonEpisodePatterns.some(p => p.test(t.title)))
    if (exact.length > 0) {
      logFn(`[STREAM] Epizód szűrés: ${torrents.length} → ${exact.length} (pontos: S${s2}E${e2})`)
      return exact
    }

    // 1b. Fallback: Ep01/E01 keresés (évad jel nélkül) —
    //     JAVÍTVA: extractSeasons() őr a törött `[Ss](\d{1,2})\b` helyett.
    //     Az "S02E01" évada {2}, így S01E01 kérésre kiesik.
    const epOnlyPattern = new RegExp(`[Ee]p?${e2}(\\b|[^\\d])`, 'i')
    const epOnly = torrents.filter(t => {
      if (!epOnlyPattern.test(t.title)) return false
      return torrentMatchesEpisode(t.title, season, episode)
    })
    if (epOnly.length > 0) {
      logFn(`[STREAM] Epizód szűrés: ${torrents.length} → ${epOnly.length} (E${e2} fallback)`)
      return epOnly
    }
  }

  // 2. fázis: range pack-ek (S01-S10, 1-10. évad, Complete Series range)
  // ⚠️ KRITIKUS SORREND: range ELŐBB, egyéni évad (S06) UTÁNA!
  // (Részletek: index.js — "Csillagkapu S01-S10" season pack esete.)
  const rangeResults = torrents.filter(t => {
    const rangeMatch = t.title.match(/[Ss](\d+)\s*[-–]\s*[Ss]?(\d+)/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      return season >= start && season <= end
    }
    const rangeMatch2 = t.title.match(/(\d+)\s*[-–]\s*(\d+)\s*(évad|season)/i)
    if (rangeMatch2) {
      const start = parseInt(rangeMatch2[1], 10)
      const end = parseInt(rangeMatch2[2], 10)
      return season >= start && season <= end
    }
    return false
  })

  // 3. fázis: egyéni évad (S06, Season 6, 6. évad)
  // JAVÍTVA: `(?![\d])` a `\b` helyett (az S06E06-ban sincs szóhatár),
  // + idegen-epizód kizárás (pl. S01E05 nem jó S01E01-re).
  const seasonPatterns = [
    new RegExp(`[Ss]${s2}(?![\\d])`, 'i'),          // S06 (S06E06-ban is talál)
    new RegExp(`[Ss]eason\\s*${season}(?![\\d])`, 'i'), // Season 6
    new RegExp(`${season}\\.\\s*[EeÉé]vad`, 'i')    // 6. évad
  ]
  const seasonMatch = torrents.filter(t => {
    if (!seasonPatterns.some(p => p.test(t.title))) return false
    if (episode && !torrentMatchesEpisode(t.title, season, episode)) return false
    const seasons = extractSeasons(t.title)
    if (seasons.size > 0 && !seasons.has(season)) return false
    return true
  })

  // Összegyűjtjük mindkettőt (deduplikálás ID alapján)
  const all = [...rangeResults]
  for (const t of seasonMatch) {
    if (!all.find(x => x.id === t.id)) all.push(t)
  }

  if (all.length > 0) {
    const rangeCount = rangeResults.length
    const seasonCount = all.length - rangeCount
    logFn(`[STREAM] Epizód szűrés: ${torrents.length} → ${all.length} (range: ${rangeCount}, évad: ${seasonCount})`)
    return all
  }

  // 4. fázis: nincs egyezés → CSAK az évad-semleges címek.
  // JAVÍTVA: régen a TELJES listát adta vissza, így egyértelműen idegen
  // évados torrent (pl. csak S02 pack S01E01 kérésre) is bekerült —
  // rossz rész kiszolgálását okozva. Üres lista → nincs stream (nem rossz stream).
  const neutral = torrents.filter(t => torrentMatchesEpisode(t.title, season, episode))
  if (neutral.length !== torrents.length) {
    logFn(`[STREAM] Epizód szűrés: ${torrents.length} → ${neutral.length} (idegen évad kizárva)`)
  } else {
    logFn(`[STREAM] Epizód szűrés: ${torrents.length} → ${neutral.length} (nincs egyezés)`)
  }
  return neutral
}

/**
 * Epizód-specifikus fájl választása season pack fájllistából.
 * @returns a legjobb fájl, vagy null (nincs magabiztos találat).
 * Idegen évados fájl SOHA nem nyerhet magabiztosan.
 */
function findBestEpisodeFile(files, season, episode) {
  if (!files || files.length === 0) return null
  const s2 = pad2(season)
  const e2 = pad2(episode)

  const episodePatterns = [
    new RegExp(`[Ss]${s2}[Ee]${e2}(\\b|[^\\d])`),       // S01E14
    new RegExp(`[Ss]${s2}\\.[Ee]${e2}(\\b|[^\\d])`),     // S01.E14
    new RegExp(`[Ss]${s2}[\\s._-][Ee]${e2}(\\b|[^\\d])`), // S01 E14, S01_E14
    new RegExp(`(^|[^0-9a-zA-Z])${s2}x${e2}(?![\\d])`, 'i'),   // 01x14
    new RegExp(`(^|[^0-9a-zA-Z])${season}x${episode}(?![\\d])`, 'i'), // 1x14
    new RegExp(`[Ee]p${e2}(\\b|[^\\d])`, 'i'),           // Ep14
    new RegExp(`[Ee]pisode\\s*${episode}(?!\\d)`, 'i')   // Episode 14
  ]

  let best = null
  let bestScore = Infinity
  for (const f of files) {
    if (!f || !f.name) continue
    const score = episodePatterns.findIndex(p => p.test(f.name))
    if (score === -1) continue
    // idegen évados fájl nem nyerhet (kivéve több-epizódos név, ami a kértet is tartalmazza)
    if (hasForeignEpisodeMarker(f.name, season, episode) &&
        !hasRequestedEpisodeMarker(f.name, season, episode)) continue
    if (score < bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

module.exports = {
  pad2,
  extractSeasons,
  hasForeignEpisodeMarker,
  hasRequestedEpisodeMarker,
  hasAnyEpisodeMarker,
  torrentMatchesEpisode,
  filterByEpisode,
  findBestEpisodeFile
}
