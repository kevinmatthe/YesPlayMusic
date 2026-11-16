// Matches the backend complete-MP3 frame-envelope and canonical-duration check.
// This is not an audio decoder, CRC check, or proof of recording identity.
export function completeMP3DurationMs(bytes: Uint8Array): number | undefined {
  let start = 0
  let end = bytes.length
  const matches = (at: number, values: number[]) => values.every((value, index) => bytes[at + index] === value)

  if (matches(0, [0x49, 0x44, 0x33])) {
    if (end < 10 || bytes[3] < 2 || bytes[3] > 4 || bytes[4] === 0xff) return undefined
    const version = bytes[3]
    const allowedFlags = version === 4 ? 0xf0 : version === 3 ? 0xe0 : 0xc0
    if ((bytes[5] & ~allowedFlags) !== 0) return undefined
    let tagSize = 0
    for (let pos = 6; pos < 10; pos++) {
      if ((bytes[pos] & 0x80) !== 0) return undefined
      tagSize = tagSize * 128 + bytes[pos]
    }
    if (tagSize > end - 10) return undefined
    start = 10 + tagSize
    // ID3v2.4's declared size excludes both its header and optional footer.
    if (version === 4 && (bytes[5] & 0x10) !== 0) {
      if (end - start < 10 || !matches(start, [0x33, 0x44, 0x49])) return undefined
      for (let pos = 3; pos < 10; pos++) {
        if (bytes[start + pos] !== bytes[pos]) return undefined
      }
      start += 10
    }
  }
  if (end - start >= 128 && matches(end - 128, [0x54, 0x41, 0x47])) end -= 128

  const bitratesMPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const bitratesLSF = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const baseRates = [44100, 48000, 32000]
  let frames = 0
  let streamVersion = -1
  let streamRate = 0
  let totalSamples = 0
  for (let pos = start; pos < end;) {
    if (end - pos < 4) return undefined
    const h1 = bytes[pos + 1]
    const h2 = bytes[pos + 2]
    const h3 = bytes[pos + 3]
    const version = (h1 >>> 3) & 3
    const layer = (h1 >>> 1) & 3
    const bitrateIndex = h2 >>> 4
    const rateIndex = (h2 >>> 2) & 3
    if (bytes[pos] !== 0xff || (h1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 ||
        bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3 || (h3 & 3) === 2) return undefined

    let rate = baseRates[rateIndex]
    let bitrate = bitratesMPEG1[bitrateIndex]
    let coefficient = 144000
    let samples = 1152
    let sideInfo = h3 >>> 6 === 3 ? 17 : 32
    if (version !== 3) {
      rate /= version === 0 ? 4 : 2
      bitrate = bitratesLSF[bitrateIndex]
      coefficient = 72000
      samples = 576
      sideInfo = h3 >>> 6 === 3 ? 9 : 17
    }
    if (frames !== 0 && (version !== streamVersion || rate !== streamRate)) return undefined
    const frameSize = Math.floor(coefficient * bitrate / rate) + ((h2 >>> 1) & 1)
    const minimumSize = 4 + sideInfo + ((h1 & 1) === 0 ? 2 : 0)
    if (frameSize < minimumSize || frameSize > end - pos) return undefined
    streamVersion = version
    streamRate = rate
    frames++
    totalSamples += samples
    pos += frameSize
  }
  if (frames < 2) return undefined
  return Math.floor(totalSamples * 1000 / streamRate)
}

export function validateCompleteMP3(bytes: Uint8Array, canonicalMs: number): { durationMs: number } | undefined {
  if (!Number.isSafeInteger(canonicalMs) || canonicalMs <= 0) return undefined
  const durationMs = completeMP3DurationMs(bytes)
  if (durationMs === undefined) return undefined
  const tolerance = Math.min(5000, Math.max(1500, Math.floor(canonicalMs * 0.03)))
  return Math.abs(durationMs - canonicalMs) <= tolerance ? { durationMs } : undefined
}
