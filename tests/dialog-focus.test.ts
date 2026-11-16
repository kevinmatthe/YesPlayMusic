import { describe, expect, it } from 'vitest'
import { activateDialog } from '../src/ui/dialog-focus'

// EventTarget-based DOM host for the actual focus/inert controller. Browser
// acceptance separately checks native tab order, Teleport, CSS and layout.
class ElementHost extends EventTarget {
 readonly attributes=new Map<string,string>()
 children:ElementHost[]=[]
 parentElement:ElementHost|null=null
 visible=true
 constructor(readonly tagName:string,readonly ownerDocument:DocumentHost){super()}
 get isConnected():boolean{return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected)}
 get inert(){return this.hasAttribute('inert')}
 set inert(value:boolean){if(value)this.setAttribute('inert','');else this.removeAttribute('inert')}
 append(...els:ElementHost[]){for(const el of els){el.parentElement=this;this.children.push(el)}}
 hasAttribute(key:string){return this.attributes.has(key)}
 getAttribute(key:string){return this.attributes.get(key)??null}
 setAttribute(key:string,value:string){this.attributes.set(key,value)}
 removeAttribute(key:string){this.attributes.delete(key)}
 contains(el:unknown):boolean{return this===el||this.children.some(child=>child.contains(el))}
 closest(_selector:string):ElementHost|null {return this.hasAttribute('hidden')||this.inert||this.getAttribute('aria-hidden')==='true'?this:this.parentElement?.closest(_selector)??null}
 matches(selector:string){return selector===':disabled'&&this.hasAttribute('disabled')}
 getClientRects(){return this.visible?[{}]:[]}
 querySelectorAll(_selector:string):ElementHost[]{return this.children.flatMap(child=>[...(['BUTTON','INPUT','SELECT','A'].includes(child.tagName)||child.hasAttribute('tabindex')?[child]:[]),...child.querySelectorAll(_selector)])}
 focus(){this.ownerDocument.activeElement=this;const event=new Event('focusin');Object.defineProperty(event,'target',{value:this});this.ownerDocument.dispatchEvent(event)}
}
class DocumentHost extends EventTarget {
 readonly body=new ElementHost('BODY',this)
 activeElement:ElementHost=this.body
 element(tag:string){return new ElementHost(tag.toUpperCase(),this)}
 querySelector(_selector:string){return this.body.querySelectorAll(_selector).find(el=>el.tagName==='MAIN'&&el.hasAttribute('tabindex'))??null}
 key(key:string,shiftKey=false){const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:key},shiftKey:{value:shiftKey}});this.dispatchEvent(event);return event}
}
function world(){
 const doc=new DocumentHost(),app=doc.element('div'),opener=doc.element('button'),audio=doc.element('audio'),shade=doc.element('div'),dialog=doc.element('section'),first=doc.element('button'),input=doc.element('input'),last=doc.element('button')
 app.append(opener);dialog.append(first,input,last);shade.append(dialog);doc.body.append(app,audio,shade);opener.focus()
 return {doc,app,opener,audio,shade,dialog,first,input,last}
}
const dom=(el:ElementHost)=>el as unknown as HTMLElement

describe('modal focus ownership',()=>{
 it('focuses the requested input, isolates background without touching audio, and restores the opener and original inert attribute',()=>{
  const w=world(),prior=w.doc.element('aside');prior.setAttribute('inert','preexisting');w.doc.body.append(prior)
  const close=activateDialog(dom(w.dialog),{onClose:()=>{},initialFocus:dom(w.input)})
  expect(w.doc.activeElement).toBe(w.input);expect(w.app.inert).toBe(true);expect(w.audio.inert).toBe(false)
  close();expect(w.doc.activeElement).toBe(w.opener);expect(w.app.inert).toBe(false);expect(prior.getAttribute('inert')).toBe('preexisting');expect(w.dialog.hasAttribute('tabindex')).toBe(false)
 })
 it('wraps Tab/ShiftTab, skips disabled or hidden controls, and redirects escaped focus',()=>{
  const w=world();w.input.setAttribute('disabled','');w.last.visible=false
  const stop=activateDialog(dom(w.dialog),{onClose:()=>{}})
  expect(w.doc.activeElement).toBe(w.first);expect(w.doc.key('Tab').defaultPrevented).toBe(true);expect(w.doc.activeElement).toBe(w.first)
  expect(w.doc.key('Tab',true).defaultPrevented).toBe(true);expect(w.doc.activeElement).toBe(w.first)
  w.opener.focus();expect(w.doc.activeElement).toBe(w.first);stop()
 })
 it('contains focus in an empty dialog and restores its original tabindex',()=>{
  const w=world();w.dialog.children=[];w.dialog.setAttribute('tabindex','0')
  const stop=activateDialog(dom(w.dialog),{onClose:()=>{}})
  expect(w.doc.activeElement).toBe(w.dialog);expect(w.doc.key('Tab').defaultPrevented).toBe(true)
  stop();expect(w.dialog.getAttribute('tabindex')).toBe('0')
 })
 it('only lets the top overlay handle Escape, restores its parent, and cleans listeners after the last close',()=>{
  const w=world();let outerCloses=0,innerCloses=0
  const stopOuter=activateDialog(dom(w.dialog),{onClose:()=>outerCloses++})
  const shade=w.doc.element('div'),inner=w.doc.element('section'),button=w.doc.element('button');inner.append(button);shade.append(inner);w.doc.body.append(shade)
  w.last.focus();const stopInner=activateDialog(dom(inner),{onClose:()=>innerCloses++})
  expect(w.shade.inert).toBe(true);expect(w.doc.activeElement).toBe(button)
  expect(w.doc.key('Escape').defaultPrevented).toBe(true);expect(innerCloses).toBe(1);expect(outerCloses).toBe(0)
  stopInner();expect(w.shade.inert).toBe(false);expect(w.doc.activeElement).toBe(w.last)
  stopOuter();stopOuter();expect(w.app.inert).toBe(false);expect(w.doc.key('Escape').defaultPrevented).toBe(false);expect(outerCloses).toBe(0)
  w.opener.focus();expect(w.doc.activeElement).toBe(w.opener)
 })
 it('returns to the visible main content when a viewport change hides the opener',()=>{
  const w=world(),main=w.doc.element('main');main.setAttribute('tabindex','-1');w.app.append(main)
  const stop=activateDialog(dom(w.dialog),{onClose:()=>{}})
  w.opener.visible=false
  stop();expect(w.doc.activeElement).toBe(main);expect(w.app.inert).toBe(false)
 })
 it('does not steal focus when an underlying overlay unmounts or when its invoker is gone',()=>{
  const w=world();const stopOuter=activateDialog(dom(w.dialog),{onClose:()=>{}})
  const shade=w.doc.element('div'),inner=w.doc.element('section'),button=w.doc.element('button');inner.append(button);shade.append(inner);w.doc.body.append(shade)
  const stopInner=activateDialog(dom(inner),{onClose:()=>{}});stopOuter();expect(w.doc.activeElement).toBe(button)
  w.opener.parentElement=null;stopInner();expect(w.app.inert).toBe(false);expect(w.doc.activeElement).not.toBe(w.opener)
 })
})
