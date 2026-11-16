import { describe, expect, it } from 'vitest'
import { completeMP3DurationMs, validateCompleteMP3 } from '../src/core/device-audio-cache-mp3'

// Structural MP3 test data only: silent frame bodies exercise the envelope
// validator, not decoded audio, recording identity, or real playback.
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
function frame(header: number[] = [0xff, 0xfb, 0x90, 0], size = 417): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(header)
  return bytes
}
function repeat(part: Uint8Array, count: number): Uint8Array {
  return join(...Array.from({ length: count }, () => part))
}
const mpeg1 = repeat(frame(), 120)
const mpeg1Ms = Math.floor(120 * 1152 * 1000 / 44100)
function id3(version: number, flags = 0, payload = new Uint8Array()): Uint8Array {
  const size = payload.length
  return join(new Uint8Array([0x49, 0x44, 0x33, version, 0, flags,
    (size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f]), payload)
}

describe('complete MP3 cache envelope validation', () => {
  it('can inspect complete short content without accepting it as a canonical full track', () => {
    expect(completeMP3DurationMs(mpeg1)).toBe(mpeg1Ms)
    expect(validateCompleteMP3(mpeg1, 227_093)).toBeUndefined()
  })

  it('does not infer a duration from a truncated frame envelope', () => {
    expect(completeMP3DurationMs(mpeg1.subarray(0, mpeg1.length - 1))).toBeUndefined()
  })

  it('accepts an exact complete MPEG-1 Layer III stream and reports sample duration', () => {
    expect(validateCompleteMP3(mpeg1, mpeg1Ms)).toEqual({ durationMs: mpeg1Ms })
  })

  it.each([
    { version: 'MPEG-2', header: [0xff, 0xf3, 0x80, 0], size: 208, rate: 22050 },
    { version: 'MPEG-2.5', header: [0xff, 0xe3, 0x80, 0], size: 417, rate: 11025 },
  ])('accepts complete $version low-sampling-frequency frames', ({ header, size, rate }) => {
    const durationMs = Math.floor(120 * 576 * 1000 / rate)
    expect(validateCompleteMP3(repeat(frame(header, size), 120), durationMs)).toEqual({ durationMs })
  })

  it('accepts varying bitrates and frame padding without changing sample identity', () => {
    const bytes = repeat(join(frame(), frame([0xff, 0xfb, 0xb0, 0], 626), frame([0xff, 0xfb, 0x92, 0], 418)), 40)
    expect(validateCompleteMP3(bytes, mpeg1Ms)).toEqual({ durationMs: mpeg1Ms })
  })

  it.each([2, 3, 4])('accepts bounded ID3v2.%i metadata and an optional ID3v1 tail', version => {
    const tail = new Uint8Array(128)
    tail.set([0x54, 0x41, 0x47])
    expect(validateCompleteMP3(join(id3(version, 0, new Uint8Array([9, 8, 7])), mpeg1, tail), mpeg1Ms)).toEqual({ durationMs: mpeg1Ms })
  })

  it('accepts an ID3v2.4 footer only when it exactly mirrors its header', () => {
    const metadata = id3(4, 0x10, new Uint8Array([9, 8]))
    const footer = new Uint8Array([0x33, 0x44, 0x49, 4, 0, 0x10, 0, 0, 0, 2])
    expect(validateCompleteMP3(join(metadata, footer, mpeg1), mpeg1Ms)).toEqual({ durationMs: mpeg1Ms })
    footer[9] = 3
    expect(validateCompleteMP3(join(metadata, footer, mpeg1), mpeg1Ms)).toBeUndefined()
    expect(validateCompleteMP3(join(metadata, mpeg1), mpeg1Ms)).toBeUndefined()
  })

  it.each([0, -1, NaN, Infinity, Number.MAX_VALUE])('rejects unusable canonical duration %s', duration => {
    expect(validateCompleteMP3(mpeg1, duration)).toBeUndefined()
  })

  it('does not store a short preview as the canonical full track', () => {
    const preview = repeat(frame(), 1200)
    expect(validateCompleteMP3(preview, 227_093)).toBeUndefined()
  })

  it('allows the bounded canonical timing tolerance but rejects a real mismatch', () => {
    const full = repeat(frame(), 8000)
    const durationMs = Math.floor(8000 * 1152 * 1000 / 44100)
    expect(validateCompleteMP3(full, durationMs + 5000)).toEqual({ durationMs })
    expect(validateCompleteMP3(full, durationMs + 5001)).toBeUndefined()
    expect(validateCompleteMP3(mpeg1, mpeg1Ms + 1500)).toEqual({ durationMs: mpeg1Ms })
    expect(validateCompleteMP3(mpeg1, mpeg1Ms + 1501)).toBeUndefined()
  })

  it.each([
    ['truncated final frame', mpeg1.subarray(0, mpeg1.length - 1)],
    ['trailing junk', join(mpeg1, new Uint8Array([1]))],
    ['a single frame', frame()],
    ['no frames', new Uint8Array()],
    ['an HTML response', new TextEncoder().encode('<html>Access denied</html>')],
    ['metadata only', id3(4)],
  ])('rejects %s rather than treating received bytes as a complete song', (_name, bytes) => {
    expect(validateCompleteMP3(bytes as Uint8Array, mpeg1Ms)).toBeUndefined()
  })

  it.each([
    ['missing sync', [0xfe, 0xfb, 0x90, 0]],
    ['reserved version', [0xff, 0xeb, 0x90, 0]],
    ['wrong layer', [0xff, 0xfd, 0x90, 0]],
    ['free bitrate', [0xff, 0xfb, 0x00, 0]],
    ['invalid bitrate', [0xff, 0xfb, 0xf0, 0]],
    ['reserved sample rate', [0xff, 0xfb, 0x9c, 0]],
    ['reserved emphasis', [0xff, 0xfb, 0x90, 2]],
  ])('rejects a frame with %s', (_name, header) => {
    expect(validateCompleteMP3(join(frame(header as number[]), mpeg1), mpeg1Ms)).toBeUndefined()
  })

  it('rejects version or sampling-rate changes partway through the stream', () => {
    expect(validateCompleteMP3(join(mpeg1, frame([0xff, 0xf3, 0x80, 0], 208)), mpeg1Ms)).toBeUndefined()
    expect(validateCompleteMP3(join(mpeg1, frame([0xff, 0xfb, 0x94, 0], 384)), mpeg1Ms)).toBeUndefined()
  })

  it.each([
    ['unsupported version', new Uint8Array([0x49, 0x44, 0x33, 5, 0, 0, 0, 0, 0, 0])],
    ['invalid revision', new Uint8Array([0x49, 0x44, 0x33, 4, 255, 0, 0, 0, 0, 0])],
    ['invalid flags', id3(3, 0x10)],
    ['invalid synchsafe size', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 128, 0, 0, 0])],
    ['oversized tag', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f])],
    ['truncated header', new Uint8Array([0x49, 0x44, 0x33])],
  ])('rejects ID3 metadata with %s', (_name, metadata) => {
    expect(validateCompleteMP3(join(metadata as Uint8Array, mpeg1), mpeg1Ms)).toBeUndefined()
  })
})
