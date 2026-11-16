import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { musicApi } from '../core'
import type { Track } from '../core'
import { useMusic } from './music'
export const useOverlay=defineStore('overlay',()=>{
 const kind=ref<''|'create'|'add'|'share'|'transfer'>(''),track=shallowRef<Track|null>(null),shareURL=ref(''),lyrics=ref(false)
 function close(){kind.value='';track.value=null;shareURL.value=''}
 function create(){kind.value='create'}
 function add(t:Track){track.value=t;kind.value='add'}
 async function share(type:'track'|'playlist',id:string){const music=useMusic();await music.run(async()=>{const result=await musicApi.createShare(type,id);shareURL.value=location.origin+'/share/'+result.token;kind.value='share'})}
 return {kind,track,shareURL,lyrics,close,create,add,share}
})
