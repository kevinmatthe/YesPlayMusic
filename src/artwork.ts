const placeholder = '/music-cover.svg'
const trustedHTTPHosts = new Set([
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
])
const relativeBase = 'https://music-artwork.invalid/'

/** Guard legacy metadata before it reaches an image request on an HTTPS page. */
export function artworkURL(value?: string | null): string {
  const input = value?.trim()
  if (!input || /[\u0000-\u001f\u007f\\]/.test(input) || input.startsWith('//')) {
    return placeholder
  }
  try {
    const url = new URL(input, relativeBase)
    if (url.username || url.password) return placeholder
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(input)
    if (!absolute) return url.origin === new URL(relativeBase).origin ? input : placeholder
    if (url.protocol === 'https:') return input
    if (url.protocol === 'http:' && !url.port && trustedHTTPHosts.has(url.hostname)) {
      url.protocol = 'https:'
      return url.href
    }
  } catch {
    return placeholder
  }
  return placeholder
}
