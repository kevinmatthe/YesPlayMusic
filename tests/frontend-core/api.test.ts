import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicApi, descriptorIdentity } from '../../src/core/api';

afterEach(() => vi.restoreAllMocks());
describe('typed same-origin API', () => {
  it('uses only own-session recommendation and explicit search-history endpoints without owner inputs',async()=>{
    const fetcher=vi.fn(async(input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify(String(input).includes('/recommendations')?{tracks:[],personalized:false}:String(input).includes('/search-history?')?{searches:[]}:{ok:true})))
    const api=createMusicApi(fetcher)
    await api.recommendations(12);await api.searchHistory(20);await api.recordSearch('模拟搜索','kuwo');await api.clearSearchHistory()
    expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(['/music-api/v1/recommendations?limit=12','/music-api/v1/search-history?limit=20','/music-api/v1/search-history','/music-api/v1/search-history'])
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({method:'POST',credentials:'same-origin',body:JSON.stringify({query:'模拟搜索',source:'kuwo'})})
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({method:'DELETE',body:'{}'})
  })
  it('updates the existing Feishu profile using the dedicated same-session endpoint',async()=>{
    const session={user:{id:'same-user',kind:'feishu',displayName:'模拟昵称'},expiresAt:'2030-01-01T00:00:00Z'}
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(session)))
    const api=createMusicApi(fetcher)
    expect(await api.refreshFeishuProfile('profile-only-code')).toEqual(session)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/music-api/v1/auth/feishu/profile',expect.objectContaining({method:'POST',credentials:'same-origin',body:JSON.stringify({code:'profile-only-code'})}))
  })
  it('reports a rejected Feishu code as an authorization failure without asking for a visitor recovery code', async () => {
    const api=createMusicApi(vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'feishu_code_rejected'}),{status:401})));
    await expect(api.exchangeFeishu('temporary-code')).rejects.toThrow('飞书临时授权未通过');
  });
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
      if (path.endsWith('/tracks/details'))
        return new Response(
          JSON.stringify({
            tracks:[{id:'netease:11',source:'netease',externalID:'11',title:'Legacy',artist:'',album:'',picture:'',durationMs:10000}],
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
          delivery: 'direct',
          status: 'unavailable',
          reason: 'provider_access_denied',
        })
      );
    });
    const api = createMusicApi(fetcher);
    await api.legacyDescriptor('https://legacy.test/info/11.json');
    expect(await api.resolve('netease:11')).toMatchObject({
      status: 'unavailable',
      diagnosticReason: 'provider_access_denied',
    });
  });
});
