const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Magyar ékezetes karakterek normalizálása ASCII megfelelőjükre
 * Pl.: "Szép és jó" → "Szep es jo"
 */
function normalizeHungarian(text) {
  const accents = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ő': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ű': 'u',
    'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A',
    'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
    'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
    'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ő': 'O',
    'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'Ű': 'U'
  }
  return text.replace(/[áàâãäéèêëíìîïóòôõöőúùûüűÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖŐÚÙÛÜŰ]/g, ch => accents[ch] || ch)
}

/**
 * nCore.pro kliens — JSON API alapú (jsons=true)
 *
 * Használja a curl CLI-t a cookie-k megbízható kezeléséhez.
 */

const CATEGORIES = {
  movie: 'xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd',
  series: 'xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser'
}

class NcoreClient {
  constructor(username, password) {
    this.username = username
    this.password = password
    this.session = null
    this.baseUrl = 'https://ncore.pro'
    this.cookieFile = path.join(os.tmpdir(), `ncore_cookies_${Date.now()}.txt`)
    this._ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  /**
   * curl hívás wrapper
   */
  _curl(url, options = {}) {
    const { method = 'GET', data, referer } = options

    const args = ['-s', '-L', '-b', this.cookieFile, '-c', this.cookieFile]

    // Headerek
    args.push('-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    args.push('-H', 'Accept-Language: hu-HU,hu;q=0.9,en;q=0.8')

    // Referer
    if (referer) {
      args.push('-H', `Referer: ${referer}`)
    } else {
      args.push('-H', `Referer: ${this.baseUrl}/`)
    }

    // Method és adat
    if (method === 'POST') {
      args.push('-X', 'POST')
      if (data) {
        args.push('--data-raw', data)
      }
    }

    // URL
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`
    args.push(fullUrl)

    try {
      const result = require('child_process').execFileSync('curl', args, {
        encoding: 'utf-8',
        timeout: 20000,
        maxBuffer: 10 * 1024 * 1024
      })
      return { data: result, binary: false }
    } catch (err) {
      throw new Error(`curl hiba: ${err.message}`)
    }
  }

  isLoggedIn() {
    return this.session !== null
  }

  /**
   * Bejelentkezés nCore-ra curl-lel
   */
  async login() {
    console.log('[NCORE] Bejelentkezés...')

    try {
      // 1. GET login oldal (PHPSESSID megszerzése)
      this._curl('/login.php')

      // 2. POST bejelentkezés
      const loginData = 'nev=' + encodeURIComponent(this.username) +
        '&pass=' + encodeURIComponent(this.password) +
        '&ne_leptessen_ki=1&submitted=1&set_lang=hu'

      this._curl('/login.php', {
        method: 'POST',
        data: loginData,
        referer: `${this.baseUrl}/login.php`
      })

      // 3. Ellenőrzés: JSON API hívás
      try {
        const data = this._jsonApi({
          jsons: 'true',
          mire: 'a',
          miben: 'name',
          miszerint: 'seeders',
          kivalasztott_tipus: 'xvid_hun,xvid',
          tipus: 'kivalasztottak_kozott',
          oldal: 1
        })

        if (data && data.results !== undefined && Array.isArray(data.results)) {
          this.session = true
          console.log('[NCORE] ✅ Sikeres bejelentkezés! (JSON API)')
          return
        }
      } catch (_) {}

      // Fallback: HTML ellenőrzés
      const homeHtml = this._curl('/').data
      if (homeHtml.includes('Kijelentkezés') || homeHtml.includes(this.username)) {
        this.session = true
        console.log('[NCORE] ✅ Sikeres bejelentkezés!')
      } else {
        throw new Error('Bejelentkezés sikertelen')
      }
    } catch (err) {
      console.error('[NCORE] ❌ Bejelentkezési hiba:', err.message)
      throw err
    }
  }

  /**
   * JSON API hívás
   */
  _jsonApi(params) {
    const queryStr = new URLSearchParams(params).toString()
    const result = this._curl(`/torrents.php?${queryStr}`, {
      referer: `${this.baseUrl}/`,
      headers: { 'Accept': 'application/json,text/html,*/*' }
    })

    const text = result.data.trim()
    if (text.startsWith('{') || text.startsWith('[')) {
      return JSON.parse(text)
    }
    return { results: [], total_results: '0', onpage: 0, perpage: '0' }
  }

  async search(query, type, minSeeders = 1, searchBy = 'name') {
    const isMovie = type === 'movie'
    // Ékezetmentesítés (nCore kereső nem szereti az ékezeteket)
    const normalizedQuery = normalizeHungarian(query)
    console.log(`[NCORE] JSON keresés: "${normalizedQuery}" (${type}, miben=${searchBy}, minSeed: ${minSeeders})`)

    try {
      const data = this._jsonApi({
        jsons: 'true',
        mire: normalizedQuery,
        miben: searchBy,
        miszerint: 'seeders',
        hogyan: 'DESC',
        kivalasztott_tipus: isMovie ? CATEGORIES.movie : CATEGORIES.series,
        tipus: 'kivalasztottak_kozott',
        oldal: 1
      })
      return this._parseJsonResponse(data, minSeeders)
    } catch (err) {
      console.error('[NCORE] JSON keresési hiba:', err.message)
      return []
    }
  }

  async searchByImdb(imdbId, type, minSeeders = 1) {
    return this.search(imdbId, type, minSeeders, 'imdb')
  }

  async searchByName(name, type, minSeeders = 1) {
    return this.search(name, type, minSeeders, 'name')
  }

  async getPopular(type, minSeeders = 100) {
    const isMovie = type === 'movie'
    console.log(`[NCORE] Népszerű lista: ${type} (minSeed: ${minSeeders})`)

    try {
      const data = this._jsonApi({
        jsons: 'true',
        mire: '',
        miben: 'name',
        miszerint: 'seeders',
        hogyan: 'DESC',
        kivalasztott_tipus: isMovie ? CATEGORIES.movie : CATEGORIES.series,
        tipus: 'kivalasztottak_kozott',
        oldal: 1
      })
      return this._parseJsonResponse(data, minSeeders)
    } catch (err) {
      console.error('[NCORE] Népszerű lista hiba:', err.message)
      return []
    }
  }

  /**
   * Legfrissebb torrentek lekérése (fid = feltöltési idő szerint)
   * @param {number} minSeeders - Minimum seederek
   * @param {number} pages - Hány oldalt kérjünk le (1 oldal = 100 találat)
   */
  async getLatest(type, minSeeders = 1, pages = 1) {
    const isMovie = type === 'movie'
    console.log(`[NCORE] Legfrissebb lista: ${type} (minSeed: ${minSeeders}, pages: ${pages})`)

    try {
      let allResults = []
      for (let p = 1; p <= pages; p++) {
        const data = this._jsonApi({
          jsons: 'true',
          mire: '',
          miben: 'name',
          miszerint: 'fid',
          hogyan: 'DESC',
          kivalasztott_tipus: isMovie ? CATEGORIES.movie : CATEGORIES.series,
          tipus: 'kivalasztottak_kozott',
          oldal: p
        })
        const parsed = this._parseJsonResponse(data, minSeeders)
        allResults = allResults.concat(parsed)
        // Ha az API kevesebb eredményt adott, mint amennyi egy oldal, nincs több oldal
        if (!data.results || data.results.length < 100) break
      }
      console.log(`[NCORE] Összesen ${allResults.length} találat (${pages} oldalról)`)
      return allResults
    } catch (err) {
      console.error('[NCORE] Legfrissebb lista hiba:', err.message)
      return []
    }
  }

  async downloadTorrent(torrentId, downloadUrl) {
    if (!downloadUrl) {
      downloadUrl = `/torrents.php?action=download&id=${torrentId}`
    }

    const url = downloadUrl.startsWith('http') ? downloadUrl : `${this.baseUrl}${downloadUrl}`
    console.log(`[NCORE] Torrent letöltés: ${torrentId}`)

    const outputFile = `/tmp/ncore_torrent_${torrentId}_${Date.now()}.torrent`
    try {
      require('child_process').execFileSync('curl', ['-s', '-L', '-b', this.cookieFile, '-o', outputFile, url], {
        timeout: 30000
      })
      return fs.readFileSync(outputFile)
    } catch (err) {
      throw new Error(`Torrent letöltési hiba: ${err.message}`)
    } finally {
      try { fs.unlinkSync(outputFile) } catch (_) {}
    }
  }

  _parseJsonResponse(data, minSeeders = 1) {
    if (!data || !data.results || !Array.isArray(data.results)) return []

    return data.results
      .filter(t => parseInt(t.seeders) >= minSeeders)
      .map(t => {
        const quality = this._parseQuality(t.release_name || '')
        return {
          id: t.torrent_id,
          title: t.release_name,
          seeders: parseInt(t.seeders) || 0,
          leechers: parseInt(t.leechers) || 0,
          size: this._formatSize(parseInt(t.size) || 0),
          sizeBytes: parseInt(t.size) || 0,
          type: t.type,
          category: t.category,
          imdbId: t.imdb_id || null,
          imdbRating: t.imdb_rating || null,
          freeleech: t.freeleech || false,
          downloadUrl: t.download_url,
          detailsUrl: t.details_url,
          year: t.release_name.match(/[.\s(](\d{4})[.\s)]/)?.[1] || null,
          quality: quality.quality,
          resolution: quality.resolution,
          language: quality.language
        }
      })
  }

  /**
   * Minőség és nyelv kinyerése a torrent címből
   * Pl: "Titanic.1997.HUN.BDRiP.x264-DWP" -> { quality: "BDRip", resolution: "1080p", language: "HUN", codec: "x264" }
   */
  _parseQuality(title) {
    const upper = title.toUpperCase()
    const result = { quality: null, resolution: null, language: null, hasHungarian: false, hasEnglish: false }

    // Felbontás
    const resMatch = title.match(/[.\s(](\d{3,4}[pi])[.\s)]/)
    if (resMatch) result.resolution = resMatch[1]

    // Minőség típus (csak ha nem egyezik a felbontással)
    if (/\b(4K|2160P)\b/.test(upper)) {
      result.quality = '4K'
      result.resolution = '2160p'
    } else if (/\bBDRIP\b/.test(upper)) result.quality = 'BDRip'
    else if (/\bWEB-DL\b/.test(upper)) result.quality = 'WEB-DL'
    else if (/\bWEBRIP\b/.test(upper)) result.quality = 'WebRip'
    else if (/\bBLURAY\b/.test(upper)) result.quality = 'BluRay'
    else if (/\bDVDRIP\b/.test(upper)) result.quality = 'DVDRip'
    else if (/\bDVD(R)?\b/.test(upper)) result.quality = 'DVD'
    else if (/\bHDTV\b/.test(upper)) result.quality = 'HDTV'
    else if (/\bHDRIP\b/.test(upper)) result.quality = 'HDRip'
    else if (/\bCAM(RIP)?\b/.test(upper)) result.quality = 'CAM'
    else if (/\bTS\b/.test(upper) && !result.quality) result.quality = 'TS'
    else if (/\bREMUX\b/.test(upper)) result.quality = 'Remux'
    // Ha nincs más minőség, de van felbontás, azt használjuk
    else if (result.resolution) result.quality = result.resolution

    // Nyelv
    result.hasHungarian = /\bHUN\b/.test(upper)
    result.hasEnglish = /\bENG\b/.test(upper) || /\bEN\b/.test(upper)
    if (/\bMULTI\b/.test(upper)) result.language = 'MULTi'
    else if (result.hasHungarian && result.hasEnglish) result.language = 'HUN+ENG'
    else if (result.hasHungarian) result.language = 'HUN'
    else if (result.hasEnglish) result.language = 'ENG'

    return result
  }

  _formatSize(bytes) {
    if (!bytes) return '?'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let size = bytes
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
  }

  /**
   * Takarítás
   */
  cleanup() {
    try { fs.unlinkSync(this.cookieFile) } catch (_) {}
  }
}

module.exports = { NcoreClient }
