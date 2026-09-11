const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  extractSeasons,
  hasForeignEpisodeMarker,
  hasRequestedEpisodeMarker,
  hasAnyEpisodeMarker,
  torrentMatchesEpisode,
  filterByEpisode,
  findBestEpisodeFile
} = require('./episodeFilter')

const silent = () => {}

describe('episodeFilter — Dark Matter S01E01 vs S02E01 regresszió', () => {
  it('S02E01 címe S02 évadot ad (nem üres — a régi \\b-őr hibája)', () => {
    assert.deepEqual([...extractSeasons('Dark.Matter.S02E01.1080p.HUN.x264')], [2])
  })

  it('S02E01 NEM jó S01E01 kérésre', () => {
    assert.equal(torrentMatchesEpisode('Dark.Matter.S02E01.1080p.HUN.x264', 1, 1), false)
  })

  it('S02E01 jó S02E01 kérésre', () => {
    assert.equal(torrentMatchesEpisode('Dark.Matter.S02E01.1080p.HUN.x264', 2, 1), true)
  })

  it('filterByEpisode S01E01-re csak az S01E01-et tartja meg', () => {
    const list = [
      { id: 'a', title: 'Dark.Matter.S02E01.1080p.HUN.x264' },
      { id: 'b', title: 'Dark.Matter.S01E01.1080p.HUN.x264' }
    ]
    const res = filterByEpisode(list, 1, 1, silent)
    assert.deepEqual(res.map(t => t.id), ['b'])
  })

  it('csak-S02 lista S01E01 kérésre ÜRES (nincs rossz stream)', () => {
    const res = filterByEpisode([{ id: 'a', title: 'Dark.Matter.S02E01.1080p.HUN.x264' }], 1, 1, silent)
    assert.deepEqual(res, [])
  })

  it('idegen epizód-jelölés felismerése', () => {
    assert.equal(hasForeignEpisodeMarker('Dark.Matter.S02E01.1080p', 1, 1), true)
    assert.equal(hasForeignEpisodeMarker('Dark.Matter.S01E01.1080p', 1, 1), false)
    assert.equal(hasForeignEpisodeMarker('Show.1x05.HDTV', 1, 5), false)
    assert.equal(hasForeignEpisodeMarker('Show.1x06.HDTV', 1, 5), true)
  })

  it('NxM jelölés védett "16x9" típusú hamis találat ellen', () => {
    // A "16x9" képarány SOHA nem évad/epizód-jelölés: nem gyárt S16 évadot,
    // nem számít epizód-jelölésnek — a cím jelölés nélküli (semleges) marad.
    // (A jelölés nélküli cím semleges jelölt — ugyanúgy, mint a régi
    // fallback-ágban; a lényeg, hogy nem "S16-os" torrentként viselkedik.)
    assert.deepEqual([...extractSeasons('Movie.16x9.1080p')], [])
    assert.equal(hasAnyEpisodeMarker('Movie.16x9.1080p'), false)
    assert.equal(hasForeignEpisodeMarker('Movie.16x9.1080p', 1, 1), false)
  })
})

describe('episodeFilter — season pack / range viselkedés megmarad', () => {
  it('S01 pack jó bármely S01 epizódra', () => {
    assert.equal(torrentMatchesEpisode('Dark.Matter.S01.HUN.720p', 1, 5), true)
  })

  it('S01-S10 range fedi S01-et, de nem S11-et', () => {
    assert.equal(torrentMatchesEpisode('Csillagkapu.S01-S10.HUN.DVDRip', 1, 1), true)
    assert.equal(torrentMatchesEpisode('Csillagkapu.S01-S10.HUN.DVDRip', 11, 1), false)
  })

  it('1-10. évad range fedi S05-öt', () => {
    assert.equal(torrentMatchesEpisode('Show.1-10.evad.HUN', 5, 3), true)
  })

  it('több-epizódos cím (S01E01-E02) jó S01E02-re', () => {
    assert.equal(hasRequestedEpisodeMarker('Show.S01E01-E02.1080p', 1, 2), true)
    assert.equal(torrentMatchesEpisode('Show.S01E01-E02.1080p', 1, 2), true)
  })

  it('egy-epizódos cím nem jó más epizódra', () => {
    assert.equal(torrentMatchesEpisode('Show.S01E01.1080p', 1, 2), false)
  })

  it('Season 6 / 6. évad címek évad-szinten illeszkednek', () => {
    assert.equal(torrentMatchesEpisode('Show.Season.6.720p', 6, null), true)
    assert.equal(torrentMatchesEpisode('Show.6.evad.HUN', 6, null), true)
    assert.equal(torrentMatchesEpisode('Show.S06.720p', 6, null), true)
  })

  it('egyéni évad-fázis az S06E06-ot is megtalálja (nincs \\b-csapda)', () => {
    const res = filterByEpisode([{ id: 'x', title: 'Show.S06E06.720p' }], 6, 6, silent)
    assert.equal(res.length, 1)
  })

  it('Ep-fallback: E01 a tisztított szövegen nem talál idegen évadra', () => {
    const res = filterByEpisode(
      [{ id: 'x', title: 'Dark.Matter.S02E01.HUN' }],
      1, 1, silent
    )
    assert.deepEqual(res, [])
  })
})

describe('episodeFilter — debrid fájlválasztás', () => {
  it('S01E01 kérésre az S01E01 fájl nyer (nem a nagyobb S02E01)', () => {
    const best = findBestEpisodeFile([
      { name: 'Dark.Matter.S02E01.mkv' },
      { name: 'Dark.Matter.S01E01.mkv' }
    ], 1, 1)
    assert.equal(best?.name, 'Dark.Matter.S01E01.mkv')
  })

  it('csak idegen fájl esetén nincs magabiztos találat', () => {
    const best = findBestEpisodeFile([{ name: 'Dark.Matter.S02E01.mkv' }], 1, 1)
    assert.equal(best, null)
    assert.equal(hasAnyEpisodeMarker('Dark.Matter.S02E01.mkv'), true)
  })

  it('jelöletlen pack-nél nincs találat, de nincs jelölés sem', () => {
    const best = findBestEpisodeFile([{ name: 'disc1.mkv' }], 1, 1)
    assert.equal(best, null)
    assert.equal(hasAnyEpisodeMarker('disc1.mkv'), false)
  })

  it('_getDownloadLinkByEpisode: jó fájlt választ + idegenre null', async () => {
    const { DebridClient } = require('./debrid')
    const c = new DebridClient('test-key')
    c.client = { get: async () => ({ data: { value: { downloadUrl: 'SHOULD-NOT-BE-USED' } } }) }

    const good = await c._getDownloadLinkByEpisode([
      { name: 'Dark.Matter.S02E01.mkv', downloadUrl: 'URL-S02E01', length: 500 },
      { name: 'Dark.Matter.S01E01.mkv', downloadUrl: 'URL-S01E01', length: 100 }
    ], 1, 1)
    assert.equal(good, 'URL-S01E01')

    const bad = await c._getDownloadLinkByEpisode([
      { name: 'Dark.Matter.S02E01.mkv', downloadUrl: 'URL-S02E01', length: 500 }
    ], 1, 1)
    assert.equal(bad, null)
  })
})
