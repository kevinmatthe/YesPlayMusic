import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicApi, descriptorIdentity } from '../../src/core/api';

afterEach(() => vi.restoreAllMocks());
describe('typed same-origin API', () => {
  it('distinguishes an incorrect entry origin from a missing first-visit session', async () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'origin_denied'}),{status:403}));
    const api=createMusicApi(fetcher);
    await expect(api.ensureGuest()).rejects.toThrow('访问地址');
    fetcher.mockResolvedValue(new Response(JSON.stringify({error:'session_required'}),{status:401}));
    await expect(api.me()).rejects.toThrow('尚未建立');
  });
  it('reports stale revisions and expired sessions explicitly', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'revision_conflict' }), {
          status: 409,
        })
      );
    const api = createMusicApi(fetcher);
    await expect(
      api.saveQueue('device-1234', {
        revision: 1,
        trackIDs: [],
        currentIndex: 0,
        positionMs: 0,
      })
    ).rejects.toMatchObject({ status: 409 });
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: 'session_expired' }), {
        status: 401,
      })
    );
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
  });
  it('retains semantic descriptor query parameters while ignoring URL signatures', async () => {
    const a = await descriptorIdentity(
      'https://objects.test/descriptor?id=A&X-Amz-Signature=old&X-Amz-Expires=30'
    );
    const same = await descriptorIdentity(
      'https://objects.test/descriptor?X-Amz-Signature=new&id=A&X-Amz-Expires=60'
    );
    const different = await descriptorIdentity(
      'https://objects.test/descriptor?id=B&X-Amz-Signature=new'
    );
    expect(a).toBe(same);
    expect(a).not.toBe(different);
    expect(a).toMatch(/^legacy:[a-f0-9]{64}$/);
  });
  it('does not fall back from explicit restrictions to a legacy signed source', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === 'https://legacy.test/info/11.json')
        return new Response(
          JSON.stringify({
            Title: 'Legacy',
            MusicURL: 'https://old-audio.test/clip',
            Duration: 10000,
          })
        );
      if (path.endsWith('/tracks/register'))
        return new Response(
          JSON.stringify({
            id: 'netease:11',
            source: 'netease',
            externalID: '11',
            title: 'Legacy',
            artist: '',
            album: '',
            picture: '',
            durationMs: 10000,
          })
        );
      return new Response(
        JSON.stringify({
          trackID: 'netease:11',
          status: 'unavailable',
          reason: 'provider_access_denied',
        })
      );
    });
    const api = createMusicApi(fetcher);
    await api.legacyDescriptor('https://legacy.test/info/11.json');
    expect(await api.resolve('netease:11')).toMatchObject({
      status: 'unavailable',
      reason: 'provider_access_denied',
    });
  });
});
