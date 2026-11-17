import {reactive} from 'vue'
import {RequestDeadline,withWriteDeadline} from './request-deadline'
import type {MusicApi,Track} from './core'

/** A successful setLike response confirms only that track, never an older list snapshot. */
export function createLikeActions(api:Pick<MusicApi,'setLike'>,read:()=>Track[],commit:(tracks:Track[])=>void){
 const state=reactive({pending:[] as string[],errors:{} as Record<string,string>,revision:0})
 let owner='',epoch=0
 const pending=new Map<string,Promise<void>>(),uncertain=new Map<string,boolean>()
 function setOwner(next:string){if(owner===next)return;owner=next;epoch++;pending.clear();uncertain.clear();state.pending=[];state.errors={};state.revision++}
 function toggle(track:Track):Promise<void>{
  if(!owner)return Promise.resolve()
  const previous=pending.get(track.id);if(previous)return previous
  const identity=epoch,want=uncertain.get(track.id)??!read().some(t=>t.id===track.id)
  state.revision++;state.pending.push(track.id);delete state.errors[track.id]
  const action=(async()=>{
   try{
    await withWriteDeadline(signal=>api.setLike(track.id,want,signal))
    if(identity!==epoch)return
    uncertain.delete(track.id)
    const remaining=read().filter(t=>t.id!==track.id)
    commit(want?[...remaining,track]:remaining)
   }catch(error){if(identity===epoch){if(error instanceof RequestDeadline)uncertain.set(track.id,want);state.errors[track.id]=error instanceof RequestDeadline?'喜欢保存结果未能确认，请重试。':'喜欢未能保存，请重试。'}}
   finally{if(identity===epoch){pending.delete(track.id);state.pending=state.pending.filter(id=>id!==track.id)}}
  })()
  pending.set(track.id,action)
  return action
 }
 return {state,setOwner,toggle}
}
