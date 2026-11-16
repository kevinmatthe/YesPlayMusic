import { describe, expect, it } from 'vitest'
import { artworkURL } from '../src/artwork'

const placeholder = '/music-cover.svg'

describe('artworkURL', () => {
  it.each([undefined, null, '', '   '])('uses the local placeholder for empty artwork: %s', value => {
    expect(artworkURL(value)).toBe(placeholder)
  })

  it.each([
    ['http://p1.music.126.net/cover.jpg?param=300y300', 'https://p1.music.126.net/cover.jpg?param=300y300'],
    ['http://p2.music.126.net/cover.jpg', 'https://p2.music.126.net/cover.jpg'],
    ['http://p3.music.126.net/cover.jpg', 'https://p3.music.126.net/cover.jpg'],
    ['http://p4.music.126.net/cover.jpg', 'https://p4.music.126.net/cover.jpg'],
    ['HTTP://P1.MUSIC.126.NET/cover.jpg', 'https://p1.music.126.net/cover.jpg'],
  ])('upgrades a trusted NetEase artwork CDN: %s', (value, expected) => {
    expect(artworkURL(value)).toBe(expected)
  })

  it.each([
    'https://p1.music.126.net/cover.jpg?param=300y300',
    'https://img.example.test/covers/one%20two.jpg?size=300',
    '/covers/album.jpg',
    'covers/album.jpg',
    './covers/album.jpg',
    '../covers/album.jpg',
    '/music-cover.svg',
  ])('preserves HTTPS and same-origin relative artwork: %s', value => {
    expect(artworkURL(value)).toBe(value)
  })

  it.each([
    'http://legacy.example.test/cover.jpg',
    'http://p1.music.126.net.evil.test/cover.jpg',
    'http://evilp1.music.126.net/cover.jpg',
    'http://music.126.net/cover.jpg',
    'http://p1.music.126.net:8080/cover.jpg',
    'https://user:password@img.example.test/cover.jpg',
    'http://user:password@p1.music.126.net/cover.jpg',
    'https://user@img.example.test/cover.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'blob:https://music.example.test/id',
    '//legacy.example.test/cover.jpg',
    '\\legacy.example.test/cover.jpg',
    '/\\legacy.example.test/cover.jpg',
    '/covers/\n/album.jpg',
    'https://',
    'https://img.example.test:bad/cover.jpg',
  ])('does not load unsafe or unknown HTTP artwork: %s', value => {
    expect(artworkURL(value)).toBe(placeholder)
  })
})
