import {afterEach,describe,it,expect,vi} from 'vitest'
import {PlaybackOrder} from '../../src/core/playback-order'
import {createPlayer,type MusicApi,type Queue,type Track} from '../../src/core'
const t=(n:number):Track=>({id:'netease:'+n,source:'netease',externalID:String(n),title:'Test '+n,artist:'Test',album:'',picture:'',durationMs:120000})
class AudioStub extends EventTarget{
 src='';currentTime=0;duration=120;paused=true;volume=1;preload='';load=vi.fn()
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
 async play(){this.paused=false;this.dispatchEvent(new Event('play'))}
 removeAttribute(){this.src=''}
 ready(){this.dispatchEvent(new Event('loadedmetadata'))}
 tick(n:number){this.currentTime=n;this.dispatchEvent(new Event('timeupdate'))}
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const cleanup:(()=>void)[]=[];afterEach(()=>{cleanup.splice(0).forEach(f=>f());vi.restoreAllMocks()})
function setup(owner='A',storageMap=new Map<string,string>(),stored:Queue={revision:0,trackIDs:[],currentIndex:0,positionMs:0}){
 const storage={getItem:(k:string)=>storageMap.get(k)??null,setItem:(k:string,v:string)=>{storageMap.set(k,v)},removeItem:(k:string)=>{storageMap.delete(k)}}
 const audio=new AudioStub(),api={ensureGuest:vi.fn(async()=>({user:{id:owner,kind:'guest'},expiresAt:'2030-01-01'})),queue:vi.fn(async()=>stored),details:vi.fn(async(ids:string[])=>ids.map(id=>t(Number(id.split(':')[1])))),resolve:vi.fn(async(id:string)=>({trackID:id,status:'available',url:'https://audio.example/'+id,expiresAt:'2030-01-01'})),lyrics:vi.fn(async(id:string)=>({trackID:id,lrc:'',translatedLrc:''})),recordHistory:vi.fn(async()=>{}),saveQueue:vi.fn(async(_d:string,q:Queue)=>{stored={...q,trackIDs:q.trackIDs.slice(),revision:q.revision+1};return stored})} as unknown as MusicApi
 const player=createPlayer({api,storage,audioFactory:()=>audio as unknown as HTMLAudioElement});cleanup.push(()=>player.dispose())
 const ready=async()=>{audio.ready();await flush()}
 return {player,audio,api,storageMap,storage,ready,queue:()=>stored}
}
describe('occurrence shuffle traversal',()=>{
 it('visits every occurrence once even if every recording has the same ID',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(5,0);o.setEnabled(true);o.played(0);const seen=[0]
  for(let i=0;i<4;i++){const n=o.next(false)!;seen.push(n);o.played(n)}
  expect(new Set(seen).size).toBe(5);expect(o.next(false)).toBeNull()
 })
 it('goes back through actual played history then forward without a new draw',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(4,0);o.setEnabled(true);o.played(0);const one=o.next(false)!;o.played(one);const two=o.next(false)!;o.played(two)
  expect(o.previous()).toBe(one);o.played(one);expect(o.next(false)).toBe(two);o.played(two);expect(o.next(false)).not.toBe(one)
 })
 it('does not add unresolved selections or retrying the same track to played history',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(4,0);o.setEnabled(true);o.played(0);o.next(false);expect(o.previous()).toBe(0);o.played(0);o.played(0);expect(o.previous()).toBeNull()
 })
 it('covers a new repeat-all round and avoids an immediate round-boundary repeat',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(3,0);o.setEnabled(true);o.played(0);let last=0
  for(let i=0;i<2;i++){last=o.next(true)!;o.played(last)}
  const first=o.next(true)!;expect(first).not.toBe(last);o.played(first);const round=[first]
  for(let i=0;i<2;i++){const n=o.next(true)!;round.push(n);o.played(n)}expect(new Set(round).size).toBe(3)
 })
 it('incorporates added entries, removes occurrences and preserves mapping on reorder',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(3,0);o.setEnabled(true);o.played(0);o.append(2);o.remove(1);o.move(0,3)
  const seen=[3];for(let i=0;i<3;i++){const n=o.next(false)!;seen.push(n);o.played(n)}expect([...seen].sort()).toEqual([0,1,2,3]);expect(o.next(false)).toBeNull()
 })
 it('handles empty and single occurrence queues without invalid indices',()=>{
  const o=new PlaybackOrder(()=>0);o.reset(0,0);o.setEnabled(true);expect(o.next(false)).toBeNull();expect(o.previous()).toBeNull();o.reset(1,0);o.played(0);expect(o.next(false)).toBeNull();expect(o.next(true)).toBe(0)
 })
})
describe('native player shuffle integration',()=>{
 it('toggles without loading media, resetting time or changing original queue order',async()=>{
  const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(1),t(2),t(3)]);await s.ready();s.audio.tick(17);const source=s.audio.src,loads=s.audio.load.mock.calls.length,resolves=vi.mocked(s.api.resolve).mock.calls.length
  s.player.setShuffle(true);s.player.setShuffle(false);s.player.setShuffle(true)
  expect(s.audio.currentTime).toBe(17);expect(s.audio.src).toBe(source);expect(s.audio.paused).toBe(false);expect(s.audio.load).toHaveBeenCalledTimes(loads);expect(s.api.resolve).toHaveBeenCalledTimes(resolves);expect(s.player.state.tracks.map(t=>t.id)).toEqual(['netease:1','netease:1','netease:2','netease:3'])
 })
 it('traverses duplicates once, uses actual history after more than three seconds and stops in off mode',async()=>{
  vi.spyOn(Math,'random').mockReturnValue(0);const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(1),t(2),t(3)]);await s.ready();s.player.setShuffle(true);const seen=[s.player.state.currentIndex]
  for(let i=0;i<3;i++){s.player.next();await flush();await s.ready();seen.push(s.player.state.currentIndex)}expect(new Set(seen).size).toBe(4)
  s.audio.tick(8);s.player.previous();await flush();await s.ready();expect(s.player.state.currentIndex).toBe(seen[2]);s.player.next();await flush();await s.ready();expect(s.player.state.currentIndex).toBe(seen[3]);s.player.next();await flush();expect(s.audio.paused).toBe(true)
 })
 it('preserves the remaining round through successful single and batch additions',async()=>{
  const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2)]);await s.ready();s.player.setShuffle(true);s.player.enqueue(t(1));expect((await s.player.enqueueMany([t(3),t(1)])).accepted).toHaveLength(2)
  const seen=[0];for(let i=0;i<4;i++){s.player.next();await flush();await s.ready();seen.push(s.player.state.currentIndex)}expect(new Set(seen).size).toBe(5)
 })
 it('restores owner-scoped mode and remaining order against the confirmed server queue',async()=>{
  const a=setup();await a.player.initialize();await a.player.playTracks([t(1),t(2),t(1),t(3)]);await a.ready();a.player.setShuffle(true);a.player.setRepeat('all');a.player.next();await flush();await a.ready();a.audio.tick(11);await a.player.saveQueue();const saved={...a.queue(),trackIDs:a.queue().trackIDs.slice()};a.player.dispose()
  const b=setup('A',new Map(a.storageMap),saved);await b.player.initialize();await b.ready();expect(b.player.state.shuffle).toBe(true);expect(b.player.state.repeat).toBe('all');expect(b.player.state.currentIndex).toBe(saved.currentIndex);expect(b.audio.currentTime).toBe(11);expect(b.audio.paused).toBe(true)
  b.player.next();await flush();const next=b.player.state.currentIndex
  const c=setup('A',new Map(a.storageMap),saved);await c.player.initialize();c.player.next();await flush();expect(c.player.state.currentIndex).toBe(next)
  const other=setup('B',a.storageMap,saved);await other.player.initialize();expect(other.player.state.shuffle).toBe(false);expect(other.player.state.repeat).toBe('off')
 })
 it('keeps repeat-one natural endings on the current occurrence and manual next advances',async()=>{
  const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2),t(3)]);await s.ready();s.player.setShuffle(true);s.player.setRepeat('one');s.audio.dispatchEvent(new Event('ended'));await flush();expect(s.player.state.currentIndex).toBe(0);s.player.next();await flush();expect(s.player.state.currentIndex).not.toBe(0)
 })
})

it('keeps original order after disabling shuffle and updates the actual upcoming preview',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(0);const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2),t(3),t(4)]);await s.ready();s.player.setShuffle(true)
 const next=s.player.state.upcomingIndices[0];s.player.next();await flush();await s.ready();expect(s.player.state.currentIndex).toBe(next);s.player.setShuffle(false);expect(s.player.state.upcomingIndices).toEqual(Array.from({length:3-next},(_,i)=>next+i+1))
 const time=s.audio.currentTime;s.player.setShuffle(true);s.player.setShuffle(false);expect(s.audio.currentTime).toBe(time);s.player.next();await flush();expect(s.player.state.currentIndex).toBe(next+1)
})
it('preserves playing occurrence and remaining set across removing and moving duplicate entries',async()=>{
 const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2),t(1),t(3)],2);await s.ready();s.audio.tick(9);s.player.setShuffle(true);s.player.move(0,3);s.player.removeAt(0)
 expect(s.player.currentTrack?.id).toBe('netease:1');expect(s.player.state.currentIndex).toBe(0);expect(s.audio.currentTime).toBe(9);const seen=[0];for(let i=0;i<2;i++){s.player.next();await flush();await s.ready();seen.push(s.player.state.currentIndex)}expect(new Set(seen).size).toBe(3)
})
it('discards corrupt or mismatched traversal snapshots without restoring removed server songs',async()=>{
 const a=setup();await a.player.initialize();await a.player.playTracks([t(1),t(2),t(3)]);await a.ready();a.player.setShuffle(true);await a.player.saveQueue();a.player.dispose()
 const key=[...a.storageMap.keys()].find(k=>k.startsWith('music-order:'))!;const valid=a.storageMap.get(key)!
 const b=setup('A',a.storageMap,{revision:9,trackIDs:['netease:8','netease:9'],currentIndex:0,positionMs:0});await b.player.initialize();expect(b.player.state.tracks.map(t=>t.id)).toEqual(['netease:8','netease:9']);expect(b.player.state.upcomingIndices).toEqual([1])
 a.storageMap.set(key,'{broken');const c=setup('A',a.storageMap,a.queue());await c.player.initialize();expect(c.player.state.shuffle).toBe(false);expect(c.player.state.tracks).toHaveLength(3)
 a.storageMap.set(key,valid)
})
it('leaves shuffle traversal unchanged when a batch write fails',async()=>{
 const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2),t(3)]);await s.ready();s.player.setShuffle(true);const before=s.player.state.upcomingIndices.slice();vi.mocked(s.api.saveQueue).mockRejectedValueOnce(new Error('offline'))
 expect((await s.player.enqueueMany([t(4)])).failed).toHaveLength(1);expect(s.player.state.tracks).toHaveLength(3);expect(s.player.state.upcomingIndices).toEqual(before)
})
it('continues playback when local shuffle snapshot storage refuses writes',async()=>{
 const s=setup();await s.player.initialize();await s.player.playTracks([t(1),t(2)]);await s.ready();const original=s.storage.setItem;s.storage.setItem=(key,value)=>{if(key.startsWith('music-order:'))throw new Error('storage full');original(key,value)}
 expect(()=>s.player.setShuffle(true)).not.toThrow();s.player.next();await flush();await s.ready();expect(s.audio.paused).toBe(false)
})

it('does not restart after the round is stopped while the final item is still resolving',async()=>{
 const s=setup();let finish!:(v:Awaited<ReturnType<MusicApi['resolve']>>)=>void;await s.player.initialize();await s.player.playTracks([t(1),t(2)]);await s.ready();s.player.setShuffle(true)
 vi.mocked(s.api.resolve).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));s.player.next();await flush();s.player.next();expect(s.audio.paused).toBe(true)
 finish({trackID:t(2).id,status:'available',url:'https://audio.example/2',expiresAt:'2030-01-01'});await flush();await s.ready();expect(s.audio.paused).toBe(true);expect(s.player.state.playing).toBe(false)
})
it('keeps an explicitly paused recovery paused when its late source arrives',async()=>{
 const s=setup();let finish!:(v:Awaited<ReturnType<MusicApi['resolve']>>)=>void;await s.player.initialize();await s.player.playTracks([t(1),t(2)]);await s.ready();s.audio.tick(9)
 vi.mocked(s.api.resolve).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));s.audio.dispatchEvent(new Event('error'));await flush();s.player.pause()
 finish({trackID:t(1).id,status:'available',url:'https://audio.example/1',expiresAt:'2030-01-01'});await flush();await s.ready();expect(s.audio.paused).toBe(true);expect(s.audio.currentTime).toBe(9)
})
