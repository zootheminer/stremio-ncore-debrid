const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')

// NcoreClient importálása (login nélkül tesztelhető metódusok)
const { NcoreClient } = require('./ncore')

describe('NcoreClient', () => {
  describe('constructor', () => {
    it('should use fixed cookie file path (no Date.now)', () => {
      const client = new NcoreClient('user', 'pass')
      const expected = path.join(os.tmpdir(), 'ncore_cookies.txt')
      assert.equal(client.cookieFile, expected)
    })

    it('should store username and password', () => {
      const client = new NcoreClient('testuser', 'testpass')
      assert.equal(client.username, 'testuser')
      assert.equal(client.password, 'testpass')
    })

    it('should start with session = null', () => {
      const client = new NcoreClient('user', 'pass')
      assert.equal(client.session, null)
    })

    it('isLoggedIn should return false initially', () => {
      const client = new NcoreClient('user', 'pass')
      assert.equal(client.isLoggedIn(), false)
    })
  })

  describe('cleanup', () => {
    it('should delete cookie file if it exists', () => {
      const client = new NcoreClient('user', 'pass')
      // Create the cookie file
      fs.writeFileSync(client.cookieFile, 'test cookies')
      assert.ok(fs.existsSync(client.cookieFile))

      client.cleanup()
      assert.ok(!fs.existsSync(client.cookieFile))
    })

    it('should not throw if cookie file does not exist', () => {
      const client = new NcoreClient('user', 'pass')
      // Ensure no file
      try { fs.unlinkSync(client.cookieFile) } catch (_) {}
      assert.doesNotThrow(() => client.cleanup())
    })
  })

  describe('_formatSize', () => {
    const client = new NcoreClient('user', 'pass')

    it('should return "?" for 0 bytes', () => {
      assert.equal(client._formatSize(0), '?')
    })

    it('should return "?" for null/undefined', () => {
      assert.equal(client._formatSize(null), '?')
      assert.equal(client._formatSize(undefined), '?')
    })

    it('should format bytes correctly', () => {
      assert.equal(client._formatSize(500), '500 B')
    })

    it('should format KB correctly', () => {
      assert.equal(client._formatSize(1024), '1.0 KB')
    })

    it('should format MB correctly', () => {
      assert.equal(client._formatSize(1024 * 1024), '1.0 MB')
    })

    it('should format GB correctly', () => {
      assert.equal(client._formatSize(1024 * 1024 * 1024), '1.0 GB')
    })

    it('should format TB correctly', () => {
      assert.equal(client._formatSize(1024 * 1024 * 1024 * 1024), '1.0 TB')
    })
  })

  describe('_parseQuality', () => {
    const client = new NcoreClient('user', 'pass')

    it('should detect BDRip quality', () => {
      const result = client._parseQuality('Titanic.1997.HUN.BDRiP.x264-DWP', 'hd_hun')
      assert.equal(result.quality, 'BDRip')
      assert.equal(result.language, 'HUN')
    })

    it('should detect 4K quality', () => {
      const result = client._parseQuality('Movie.2024.2160p.WEB-DL.HUN.x265', 'hd_hun')
      assert.equal(result.quality, '4K')
      assert.equal(result.resolution, '2160p')
    })

    it('should detect WEB-DL quality', () => {
      const result = client._parseQuality('Movie.2024.WEB-DL.1080p.ENG.x264', 'hd')
      assert.equal(result.quality, 'WEB-DL')
      assert.equal(result.language, 'ENG')
    })

    it('should detect HUN+ENG language', () => {
      const result = client._parseQuality('Movie.2024.HUN.ENG.1080p.BDRip', 'hd_hun')
      assert.equal(result.language, 'HUN+ENG')
    })

    it('should detect MULTI language', () => {
      const result = client._parseQuality('Movie.2024.MULTI.1080p.BDRip', 'hd_hun')
      assert.equal(result.language, 'MULTi')
    })

    it('should fallback to category for language detection', () => {
      const result = client._parseQuality('Some.Movie.2024.720p.x264', 'xvid_hun')
      assert.equal(result.language, 'HUN')
    })

    it('should fallback to category for English', () => {
      const result = client._parseQuality('Some.Movie.2024.720p.x264', 'xvid')
      assert.equal(result.language, 'ENG')
    })

    it('should detect resolution', () => {
      const result = client._parseQuality('Movie.720p.x264', 'hd')
      assert.equal(result.resolution, '720p')
    })

    it('should detect BluRay quality', () => {
      const result = client._parseQuality('Movie.2024.BluRay.1080p', 'hd')
      assert.equal(result.quality, 'BluRay')
    })

    it('should detect DVDRip quality', () => {
      const result = client._parseQuality('Movie.DVDRip.XviD', 'dvd')
      assert.equal(result.quality, 'DVDRip')
    })
  })

  describe('_parseJsonResponse', () => {
    const client = new NcoreClient('user', 'pass')

    it('should return empty array for null input', () => {
      assert.deepEqual(client._parseJsonResponse(null), [])
    })

    it('should return empty array for missing results', () => {
      assert.deepEqual(client._parseJsonResponse({}), [])
    })

    it('should filter by minSeeders', () => {
      const data = {
        results: [
          { torrent_id: '1', seeders: '50', leechers: '10', size: '1000000', category: 'hd_hun', release_name: 'Test.720p.HUN' },
          { torrent_id: '2', seeders: '5', leechers: '1', size: '500000', category: 'hd', release_name: 'Test.480p.ENG' }
        ]
      }
      const result = client._parseJsonResponse(data, 10)
      assert.equal(result.length, 1)
      assert.equal(result[0].id, '1')
    })

    it('should parse torrent results correctly', () => {
      const data = {
        results: [
          {
            torrent_id: '123',
            seeders: '100',
            leechers: '20',
            size: '1073741824',
            category: 'hd_hun',
            release_name: 'Movie.2024.1080p.HUN.BDRip.x264',
            imdb_id: 'tt1234567',
            imdb_rating: '8.5',
            freeleech: true,
            download_url: '/download?id=123',
            details_url: '/details?id=123'
          }
        ]
      }
      const result = client._parseJsonResponse(data, 1)
      assert.equal(result.length, 1)
      assert.equal(result[0].id, '123')
      assert.equal(result[0].title, 'Movie.2024.1080p.HUN.BDRip.x264')
      assert.equal(result[0].seeders, 100)
      assert.equal(result[0].leechers, 20)
      assert.equal(result[0].size, '1.0 GB')
      assert.equal(result[0].sizeBytes, 1073741824)
      assert.equal(result[0].imdbId, 'tt1234567')
      assert.equal(result[0].imdbRating, '8.5')
      assert.equal(result[0].freeleech, true)
    })
  })
})

describe('normalizeHungarian (via NcoreClient)', () => {
  // normalizeHungarian is not exported, but it's used by search methods
  // We can test it indirectly, but let's test the internal behavior
  const client = new NcoreClient('user', 'pass')

  it('should handle empty results from _parseJsonResponse', () => {
    const result = client._parseJsonResponse({ results: [] }, 1)
    assert.deepEqual(result, [])
  })
})
