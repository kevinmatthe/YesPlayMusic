import { nextTick, onBeforeUnmount, watch } from 'vue'
import type { Ref } from 'vue'

export interface DialogFocusOptions {
 onClose:()=>void
 initialFocus?:HTMLElement
 returnFocus?:HTMLElement|null
}

interface Entry {
 dialog:HTMLElement
 options:DialogFocusOptions
 invoker:HTMLElement|null
 tabindex:string|null
}
interface Manager {
 entries:Entry[]
 inertBefore:Map<HTMLElement,string|null>
 keydown:(event:KeyboardEvent)=>void
 focusin:(event:FocusEvent)=>void
}
const managers=new WeakMap<Document,Manager>()
const selector='a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
function available(element:HTMLElement):boolean {
 return element.isConnected&&!element.matches(':disabled')&&
  !element.closest('[hidden],[inert],[aria-hidden="true"]')&&element.getClientRects().length>0
}
function controls(entry:Entry):HTMLElement[] {
 return [...entry.dialog.querySelectorAll<HTMLElement>(selector)].filter(el=>
  el.getAttribute('tabindex')!=='-1'&&available(el))
}
function focusEntry(entry:Entry) {
 const initial=entry.options.initialFocus
 const target=initial&&entry.dialog.contains(initial)&&available(initial)?initial:controls(entry)[0]??entry.dialog
 target.focus({preventScroll:true})
}
function restoreInert(manager:Manager) {
 for(const [element,value] of manager.inertBefore){
  if(value===null)element.removeAttribute('inert');else element.setAttribute('inert',value)
 }
 manager.inertBefore.clear()
}
function isolate(doc:Document,manager:Manager) {
 restoreInert(manager)
 const top=manager.entries.at(-1)
 if(!top)return
 for(const child of doc.body.children){
  const element=child as HTMLElement
  // The global audio element stays mounted and untouched. Inert concerns
  // interactive page content, not playback or script/style resources.
  if(element.contains(top.dialog)||['AUDIO','SCRIPT','STYLE','LINK'].includes(element.tagName))continue
  manager.inertBefore.set(element,element.getAttribute('inert'))
  element.setAttribute('inert','')
 }
}

export function activateDialog(dialog:HTMLElement,options:DialogFocusOptions):()=>void {
 const doc=dialog.ownerDocument
 let manager=managers.get(doc)
 if(!manager){
  manager={entries:[],inertBefore:new Map(),keydown:()=>{},focusin:()=>{}}
  const current=manager
  current.keydown=event=>{
   const top=current.entries.at(-1)
   if(!top)return
   if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();top.options.onClose();return
   }
   if(event.key!=='Tab')return
   const items=controls(top),index=items.indexOf(doc.activeElement as HTMLElement)
   if(!items.length){event.preventDefault();top.dialog.focus({preventScroll:true});return}
   if(index<0||(!event.shiftKey&&index===items.length-1)||(event.shiftKey&&index===0)){
    event.preventDefault();items[event.shiftKey?items.length-1:0]!.focus({preventScroll:true})
   }
  }
  current.focusin=event=>{
   const top=current.entries.at(-1)
   if(top&&!top.dialog.contains(event.target as Node))focusEntry(top)
  }
  doc.addEventListener('keydown',current.keydown,true)
  doc.addEventListener('focusin',current.focusin,true)
  managers.set(doc,current)
 }
 const current=manager
 const active=doc.activeElement as HTMLElement|null
 const entry:Entry={dialog,options,invoker:options.returnFocus===undefined?active:options.returnFocus,tabindex:dialog.getAttribute('tabindex')}
 if(entry.tabindex===null)dialog.setAttribute('tabindex','-1')
 current.entries.push(entry);isolate(doc,current);focusEntry(entry)
 let disposed=false
 return ()=>{
  if(disposed)return
  disposed=true
  const wasTop=current.entries.at(-1)===entry
  current.entries.splice(current.entries.indexOf(entry),1)
  if(entry.tabindex===null)dialog.removeAttribute('tabindex');else dialog.setAttribute('tabindex',entry.tabindex)
  isolate(doc,current)
  if(!current.entries.length){
   doc.removeEventListener('keydown',current.keydown,true)
   doc.removeEventListener('focusin',current.focusin,true)
   managers.delete(doc)
  }
  if(!wasTop)return
  const next=current.entries.at(-1),invoker=entry.invoker
  if(invoker&&available(invoker)&&(!next||next.dialog.contains(invoker)))invoker.focus({preventScroll:true})
  else if(next)focusEntry(next)
  else{
   // A responsive breakpoint can hide the opener while the dialog is open.
   // Restore a useful reading position instead of leaving focus on removed UI.
   const main=doc.querySelector<HTMLElement>('main[tabindex], [role="main"][tabindex]')
   if(main&&available(main))main.focus({preventScroll:true})
  }
 }
}

/** Watch the actual overlay key so switching dialog kinds resets its focus. */
export function useDialogFocus(
 element:Ref<HTMLElement|undefined>,open:()=>unknown,onClose:()=>void,initialFocus?:()=>HTMLElement|undefined,
) {
 const stop=watch(open,(value,_previous,onCleanup)=>{
  if(!value||typeof document==='undefined')return
  const invoker=document.activeElement as HTMLElement|null
  let cancelled=false,release:(()=>void)|undefined
  onCleanup(()=>{cancelled=true;release?.()})
  void nextTick().then(()=>{
   if(!cancelled&&element.value)release=activateDialog(element.value,{onClose,returnFocus:invoker,initialFocus:initialFocus?.()})
  })
 },{immediate:true})
 onBeforeUnmount(stop)
}
