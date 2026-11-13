import type { LyricLine } from './types';
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const time of times) {
      const fraction = time[3] ?? '';
      out.push({
        timeMs:
          Number(time[1]) * 60000 +
          Number(time[2]) * 1000 +
          (fraction ? Number(fraction.padEnd(3, '0')) : 0),
        text,
      });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}
export function withTranslation(lrc: string, translated: string): LyricLine[] {
  const translations = new Map(
    parseLrc(translated).map(line => [line.timeMs, line.text])
  );
  return parseLrc(lrc).map(line => ({
    ...line,
    ...(translations.has(line.timeMs)
      ? { translation: translations.get(line.timeMs) }
      : {}),
  }));
}
