const crypto = require('crypto')

const axios = require('axios')

/**
 * Debrid-Link API kliens (v2)
 * 
 * API dokumentáció: https://debrid-link.fr/api_doc/v2/
 * 
 * Base URL: https://debrid-link.fr/api/v2
 * 
 * Válasz formátum: { success: true/false, value: ..., error: "..." }
 */
class DebridClient {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.baseUrl = 'https://debrid-link.fr/api/v2'
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000,
      headers: {
        'User-Agent': 'Stremio-nCore-Debrid/1.0',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
  }

  /**
   * Torrent fájl feltöltése (gyors verzió - poll nélkül)
   * Először info_hash alapján ellenőrzi a seedbox-ot, csak ha nincs meg, tölt fel újat.
   * @param {Buffer} torrentBuffer - .torrent fájl
   * @param {number} [season] - Évad (season pack esetén)
   * @param {number} [episode] - Epizód (season pack esetén)
   */
  async addTorrentFile(torrentBuffer, season, episode) {
    // 1. Info_hash kinyerése a .torrent-ből
    const infoHash = this._parseInfoHash(torrentBuffer)
    if (infoHash) {
      // 2. Ellenőrizzük, hogy már létezik-e a seedboxban
      const existing = await this._findByHash(infoHash)
      if (existing) {
        console.log('[DEBRID] ✅ Már a seedboxban van (hash alapján)!')
        const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(existing.files, season, episode)
          : this._getDownloadLink(existing.files))
        if (streamUrl) {
          return { torrentId: existing.id, streamUrl, files: existing.files || [] }
        }
      }
    }

    // 3. Ha nincs meg, feltöltjük (csak innentől foglal slot-ot)
    console.log('[DEBRID] Torrent feltöltés (gyors)...')

    try {
      const FormData = require('form-data')
      const form = new FormData()
      form.append('file', torrentBuffer, {
        filename: 'torrent.torrent',
        contentType: 'application/x-bittorrent'
      })

      const addRes = await this.client.post('/seedbox/add', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.apiKey}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000
      })

      const data = addRes.data
      if (!data.success || !data.value) {
        console.log('[DEBRID] Hiba:', data.error || 'ismeretlen')
        return null
      }

      const tv = data.value
      // Ha cache-ben van, azonnal stream URL
      if (tv.downloaded || tv.downloadPercent === 100) {
        console.log('[DEBRID] ✅ Cache-ben van!')
        const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(tv.files, season, episode)
          : this._getDownloadLink(tv.files))
        return { torrentId: tv.id, streamUrl, files: tv.files || [] }
      }

      // Nincs cache-ben → jelezzük, hogy várni kell
      console.log('[DEBRID] ⏳ Nincs cache-ben (downloadPercent:', tv.downloadPercent || 0, '%)')
      return null
    } catch (err) {
      console.error('[DEBRID] Hiba:', err.message)
      if (err.response) {
        console.error('[DEBRID] API részletes:', err.response.status, JSON.stringify(err.response.data).slice(0, 300))
      }
      return null
    }
  }

  /**
   * Torrent fájl feltöltése várással (lassú verzió)
   * Feltölti a .torrent fájlt, és ha kell, pollol amíg kész nem lesz.
   */
  async addTorrentFileSlow(torrentBuffer) {
    console.log('[DEBRID] Torrent fájl feltöltése...')

    try {
      const FormData = require('form-data')
      const form = new FormData()
      form.append('file', torrentBuffer, {
        filename: 'torrent.torrent',
        contentType: 'application/x-bittorrent'
      })

      const addRes = await this.client.post('/seedbox/add', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.apiKey}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      })

      const data = addRes.data
      console.log('[DEBRID] Válasz:', data.success ? 'OK' : 'HIBÁS')

      if (!data.success || !data.value) {
        throw new Error(`Debrid-Link hiba: ${data.error || 'ismeretlen'}`)
      }

      const torrentValue = data.value
      const torrentId = torrentValue.id

      if (!torrentId) {
        throw new Error('Debrid-Link nem adott torrent ID-t')
      }

      console.log('[DEBRID] Torrent ID:', torrentId, '-', (torrentValue.name || '').substring(0, 40))

      // Ha már letöltődött
      if (torrentValue.downloaded || torrentValue.downloadPercent === 100) {
        console.log('[DEBRID] ✅ Torrent már letöltve!')
        const streamUrl = await this._getDownloadLink(torrentValue.files)
        return { torrentId, streamUrl, files: torrentValue.files || [] }
      }

      // Várakozás
      const finalInfo = await this._waitForSeed(torrentId)
      if (!finalInfo) throw new Error('Debrid-Link timeout')

      const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(finalInfo.files, season, episode)
          : this._getDownloadLink(finalInfo.files))
      if (!streamUrl) throw new Error('Nem sikerült stream URL-t generálni')

      return { torrentId, streamUrl, files: finalInfo.files }
    } catch (err) {
      console.error('[DEBRID] Hiba:', err.message)
      if (err.response) {
        console.error('[DEBRID] API válasz:', err.response.status, JSON.stringify(err.response.data).slice(0, 300))
      }
      throw err
    }
  }

  /**
   * Torrent hozzáadása URL vagy magnet link alapján
   */
  async addTorrent(url) {
    console.log('[DEBRID] Torrent hozzáadása URL alapján...')

    try {
      const addRes = await this.client.post('/seedbox/add', 
        new URLSearchParams({
          url: url,
          wait: false,
          async: false
        })
      )

      const data = addRes.data
      console.log('[DEBRID] Válasz:', data.success ? 'OK' : 'HIBÁS')

      if (!data.success || !data.value) {
        throw new Error(`Debrid-Link hiba: ${data.error || 'ismeretlen'}`)
      }

      const torrentValue = data.value
      const torrentId = torrentValue.id

      if (!torrentId) {
        throw new Error('Debrid-Link nem adott torrent ID-t')
      }

      console.log('[DEBRID] Torrent ID:', torrentId, '-', (torrentValue.name || '').substring(0, 40))

      // Ha már letöltődött, azonnal stream URL
      if (torrentValue.downloaded || torrentValue.downloadPercent === 100) {
        console.log('[DEBRID] ✅ Torrent már letöltve!')
        const streamUrl = await this._getDownloadLink(torrentValue.files)
        return { torrentId, streamUrl, files: torrentValue.files || [] }
      }

      // 2. Várakozás
      const finalInfo = await this._waitForSeed(torrentId)
      if (!finalInfo) {
        throw new Error('Debrid-Link timeout')
      }

      // 3. Stream URL
      const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(finalInfo.files, season, episode)
          : this._getDownloadLink(finalInfo.files))
      if (!streamUrl) {
        throw new Error('Nem sikerült stream URL-t generálni')
      }

      return { torrentId, streamUrl, files: finalInfo.files }
    } catch (err) {
      console.error('[DEBRID] Hiba:', err.message)
      if (err.response) {
        console.error('[DEBRID] API válasz:', err.response.status, JSON.stringify(err.response.data).slice(0, 300))
      }
      throw err
    }
  }

  async addMagnet(magnetLink) {
    return this.addTorrent(magnetLink)
  }

  async checkAccount() {
    try {
      const res = await this.client.get('/seedbox/list')
      return res.data?.success === true
    } catch (err) {
      return false
    }
  }

  /**
   * Torrent törlése a Debrid-Link seedbox-ból.
   * Használjuk: globális cache ellenőrzés után takarításhoz.
   */
  async deleteTorrent(torrentId) {
    try {
      const res = await this.client.delete(`/seedbox/${torrentId}/delete`)
      return res.data?.success === true
    } catch (err) {
      console.warn('[DEBRID] Törlési hiba:', torrentId, err.message)
      return false
    }
  }

  /**
   * Globális cache ellenőrzés.
   * Feltölti a .torrent fájlt, és megnézi, hogy a Debrid-Link globális
   * cache-ében van-e (azonnali 100%). Ha nincs, törli a seedbox-ból
   * (nem foglal slot-ot feleslegesen).
   * 
   * @param {Buffer} torrentBuffer - .torrent fájl tartalma
   * @returns {object|null} - { cached: true, streamUrl } vagy { cached: false }
   */
  async checkGlobalCache(torrentBuffer) {
    // 1. Először nézzük a saját seedbox-ot (gyors, nincs feltöltés)
    const infoHash = this._parseInfoHash(torrentBuffer)
    if (infoHash) {
      const existing = await this._findByHash(infoHash)
      if (existing && existing.downloadPercent === 100) {
        console.log('[DEBRID] ✅ Már a saját seedbox-ban van!')
        const streamUrl = await this._getDownloadLink(existing.files)
        if (streamUrl) return { cached: true, streamUrl }
      }
    }

    // 2. Feltöltés → megnézzük, hogy globális cache-ben van-e
    console.log('[DEBRID] Globális cache ellenőrzés...')
    try {
      const FormData = require('form-data')
      const form = new FormData()
      form.append('file', torrentBuffer, {
        filename: 'torrent.torrent',
        contentType: 'application/x-bittorrent'
      })

      const addRes = await this.client.post('/seedbox/add', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.apiKey}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000
      })

      const data = addRes.data
      if (!data.success || !data.value) {
        console.log('[DEBRID] ⚠️ Globális cache ellenőrzés: API hiba')
        return { cached: false }
      }

      const tv = data.value
      const torrentId = tv.id

      if (tv.downloadPercent === 100) {
        console.log('[DEBRID] ✅ Globális cache-ben van!')
        const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(tv.files, season, episode)
          : this._getDownloadLink(tv.files))
        if (streamUrl) {
          // Megvan → töröljük a seedbox-ból (nem kell, stream URL van)
          await this.deleteTorrent(torrentId)
          return { cached: true, streamUrl }
        }
      }

      // Nincs cache-ben → töröljük (nem foglal slot-ot)
      console.log('[DEBRID] ⏳ Nincs globális cache-ben, törlés...')
      await this.deleteTorrent(torrentId)
      return { cached: false }

    } catch (err) {
      console.error('[DEBRID] Globális cache hiba:', err.message)
      if (err.response) {
        const errCode = err.response.data?.error
        if (errCode === 'maxTorrent') {
          console.log('[DEBRID] ⚠️ Seedbox tele, globális cache ellenőrzés kihagyva')
        } else {
          console.error('[DEBRID]   API:', err.response.status, JSON.stringify(err.response.data).slice(0, 300))
        }
      }
      return { cached: false }
    }
  }

  /**
   * Info_hash kinyerése .torrent fájlból
   * 
   * Megbízható bencoding parser: byte-szinten dolgozik, és helyesen kezeli
   * a sztring hosszakat (nem téveszti meg, ha a sztring tartalom 'd' vagy 'e'
   * karaktereket tartalmaz).
   */
  _parseInfoHash(torrentBuffer) {
    try {
      const buf = torrentBuffer
      
      // 1. "4:info" keresése a nyers bájtokban
      const infoKey = Buffer.from('4:info')
      const idx = buf.indexOf(infoKey)
      if (idx === -1) return null
      
      // 2. A "4:info" után közvetlenül d-nek kell jönnie
      const infoDictStart = idx + infoKey.length
      if (buf[infoDictStart] !== 0x64) return null // 'd' = 0x64
      
      // 3. Bejárjuk a bencoding dict-et a sztring hosszak figyelembevételével
      let pos = infoDictStart
      let depth = 0
      
      while (pos < buf.length) {
        const byte = buf[pos]
        
        if (byte === 0x64 || byte === 0x6c) {  // 'd' vagy 'l'
          depth++
          pos++
        } else if (byte === 0x65) {  // 'e' — dict/list vége
          depth--
          pos++
          if (depth === 0) {
            const infoBlock = buf.slice(infoDictStart, pos)
            const hash = crypto.createHash('sha1').update(infoBlock).digest('hex')
            return hash
          }
        } else if (byte >= 0x30 && byte <= 0x39) {  // '0'-'9' — sztring hossz kezdete
          let numEnd = pos
          while (numEnd < buf.length && buf[numEnd] >= 0x30 && buf[numEnd] <= 0x39) numEnd++
          if (numEnd >= buf.length || buf[numEnd] !== 0x3a) return null // ':' = 0x3a
          const len = parseInt(buf.toString('ascii', pos, numEnd))
          pos = numEnd + 1 + len  // átugorjuk a "hossz:" és a sztring tartalmat
        } else if (byte === 0x69) {  // 'i' — integer
          const endIdx = buf.indexOf(0x65, pos + 1)
          if (endIdx === -1) return null
          pos = endIdx + 1
        } else {
          return null // ismeretlen bencode típus
        }
      }
      return null
    } catch (err) {
      console.warn('[DEBRID] Info_hash parse hiba:', err.message)
      return null
    }
  }

  /**
   * Seedbox keresése info_hash alapján
   */
  async _findByHash(infoHash) {
    try {
      const res = await this.client.get('/seedbox/list')
      const data = res.data
      if (!data.success || !Array.isArray(data.value)) return null

      const match = data.value.find(t => t.hashString && t.hashString.toLowerCase() === infoHash.toLowerCase())
      if (match && match.downloadPercent === 100) {
        return match
      }
      return null
    } catch (err) {
      console.warn('[DEBRID] Seedbox keresési hiba:', err.message)
      return null
    }
  }

  /**
   * Várakozás egy már feltöltött torrent befejeződésére
   * @param {string} torrentId - Debrid-Link torrent ID
   * @returns {object|null} - { torrentId, streamUrl } vagy null
   */
  async waitForTorrent(torrentId, season, episode) {
    console.log(`[DEBRID] Várakozás torrentre: ${torrentId}`)
    try {
      const finalInfo = await this._waitForSeed(torrentId)
      if (!finalInfo) {
        console.error('[DEBRID] ❌ Timeout')
        return null
      }

      const streamUrl = await (season && episode
          ? this._getDownloadLinkByEpisode(finalInfo.files, season, episode)
          : this._getDownloadLink(finalInfo.files))
      if (!streamUrl) {
        console.error('[DEBRID] ❌ Nincs stream URL')
        return null
      }
      console.log(`[DEBRID] ✅ Stream URL: ${streamUrl.slice(0, 60)}...`)
      return { torrentId, streamUrl }
    } catch (err) {
      console.error('[DEBRID] Hiba várakozás közben:', err.message)
      return null
    }
  }

  /**
   * Csak cache státusz ellenőrzése info_hash alapján.
   * NEM tölt fel semmit! Ez a kulcsfontosságú különbség az addTorrentFile-hoz képest.
   * @param {Buffer} torrentBuffer - .torrent fájl tartalma
   * @returns {object|null} - { streamUrl: string, files: array } vagy null ha nincs cache-ben
   */
  async checkCache(torrentBuffer) {
    const infoHash = this._parseInfoHash(torrentBuffer)
    if (!infoHash) return null

    const existing = await this._findByHash(infoHash)
    if (!existing) {
      console.log(`[DEBRID] ⚠️ Nincs cache-ben: ${infoHash.slice(0, 8)}...`)
      return { cached: false }
    }

    console.log(`[DEBRID] ✅ Cache-ben: ${infoHash.slice(0, 8)}...`)
    const streamUrl = await this._getDownloadLink(existing.files)
    if (!streamUrl) return { cached: false }
    return { cached: true, streamUrl, files: existing.files || [] }
  }

  // ─── Privát metódusok ────────────────────────────────────────

  async _waitForSeed(torrentId, maxAttempts = 60, intervalMs = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs))

      try {
        const res = await this.client.get('/seedbox/list', {
          params: { ids: torrentId }
        })

        const data = res.data
        if (!data.success) continue

        const torrents = Array.isArray(data.value) ? data.value : [data.value]
        const torrent = torrents.find(t => t.id === torrentId)
        if (!torrent) continue

        const progress = torrent.downloadPercent
        console.log(`[DEBRID] Seedbox állapot [${i+1}/${maxAttempts}]: ${progress}%`)

        if (progress === 100 || torrent.downloaded) {
          console.log('[DEBRID] ✅ Torrent letöltve!')
          return { files: torrent.files || [], downloadPercent: progress }
        }

        if (torrent.error) {
          throw new Error(`Debrid-Link hiba: ${torrent.errorString || 'ismeretlen'}`)
        }
      } catch (err) {
        if (err.message.includes('Debrid-Link hiba')) throw err
      }
    }

    console.error('[DEBRID] ❌ Timeout')
    return null
  }

  // ─── Privát metódusok ────────────────────────────────────────

  /**
   * Stream URL keresése fájl listából, a legnagyobb videó fájl alapján.
   * (Alapértelmezett viselkedés)
   */
  async _getDownloadLink(files) {
    if (!files || files.length === 0) return null

    // Videó kiterjesztések (csak ezeket választjuk)
    const videoExt = /\.(mkv|mp4|avi|ts|m2ts|mov|wmv|flv|webm)$/i

    // Szűrés: csak videó fájlok, NEM sample, NEM nfo/txt/etc
    const videos = files.filter(f => {
      if (!f.name) return false
      if (/sample/i.test(f.name)) return false   // sample fájlok kizárása
      return videoExt.test(f.name)                // csak videó kiterjesztés
    })

    // Ha nincs videó fájl, próbáljuk az összeset (fallback)
    const candidates = videos.length > 0 ? videos : files

    // Legnagyobb fájl kiválasztása
    const sorted = [...candidates].sort((a, b) => (b.length || 0) - (a.length || 0))
    const biggest = sorted[0]

    if (biggest.downloadUrl) return biggest.downloadUrl

    if (biggest.id) {
      try {
        const res = await this.client.get('/download/add', {
          params: { id: biggest.id }
        })
        return res.data?.value?.downloadUrl || res.data?.value?.url
      } catch (_) {}
    }

    return null
  }

  /**
   * Stream URL keresése epizód alapján — season pack-ekhez.
   * Először próbál epizód-specifikus fájlt találni (S01E14, 1x14, stb.),
   * ha nincs, visszaesik a legnagyobb fájlra.
   * 
   * @param {Array} files - Debrid-Link fájl lista
   * @param {number} season - Évad száma
   * @param {number} episode - Epizód száma
   * @returns {string|null} - Stream URL
   */
  async _getDownloadLinkByEpisode(files, season, episode) {
    if (!files || files.length === 0) return null

    const videoExt = /\.(mkv|mp4|avi|ts|m2ts|mov|wmv|flv|webm)$/i

    // Videó fájlok szűrése
    const videos = files.filter(f => {
      if (!f.name) return false
      if (/sample/i.test(f.name)) return false
      return videoExt.test(f.name)
    })

    if (videos.length === 0) return null

    // Ha van season/episode, próbáljunk epizód-specifikus fájlt találni
    if (season && episode) {
      const s2 = String(season).padStart(2, '0')
      const e2 = String(episode).padStart(2, '0')

      const episodePatterns = [
        new RegExp(`[Ss]${s2}[Ee]${e2}(\\b|[^\\d])`),         // S01E14
        new RegExp(`[Ss]${s2}\\.[Ee]${e2}(\\b|[^\\d])`),       // S01.E14
        new RegExp(`[Ss]${s2}[\\s._-][Ee]${e2}(\\b|[^\\d])`),   // S01 E14, S01_E14
        new RegExp(`${s2}x${e2}(\\b|[^\\d])`, 'i'),             // 1x14
        new RegExp(`[Ee]p?${e2}(\\b|[^\\d])`, 'i'),             // Episode 14, Ep14, E14
        new RegExp(`[Ss]${s2}[Ee]${e2}`, 'i'),                  // S01E14 (szóhatár nélkül, fallback)
      ]

      // Rendezés: aki epizód mintára illeszkedik, az legyen elől
      const scored = videos.map(f => {
        const score = episodePatterns.findIndex(p => p.test(f.name))
        return { file: f, score: score >= 0 ? score : 999 }
      })
      scored.sort((a, b) => a.score - b.score)

      // Ha van epizód-egyezéses fájl, használjuk azt
      if (scored[0].score < 999) {
        const best = scored[0].file
        if (best.downloadUrl) return best.downloadUrl
        if (best.id) {
          try {
            const res = await this.client.get('/download/add', {
              params: { id: best.id }
            })
            return res.data?.value?.downloadUrl || res.data?.value?.url
          } catch (_) {}
        }
      }
    }

    // Fallback: legnagyobb fájl
    const sorted = [...videos].sort((a, b) => (b.length || 0) - (a.length || 0))
    const biggest = sorted[0]

    if (biggest.downloadUrl) return biggest.downloadUrl
    if (biggest.id) {
      try {
        const res = await this.client.get('/download/add', {
          params: { id: biggest.id }
        })
        return res.data?.value?.downloadUrl || res.data?.value?.url
      } catch (_) {}
    }
    return null
  }
}

module.exports = { DebridClient }
