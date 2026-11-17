/** Local traversal of queue occurrences. Recording IDs never identify entries. */
export class PlaybackOrder {
 private keys:number[]=[]
 private current:number|null=null
 private remaining:number[]=[]
 private history:number[]=[]
 private cursor=-1
 private serial=0
 enabled=false
 constructor(private random:()=>number=Math.random){}
 private shuffled(values:number[]){
  const result=values.slice()
  for(let i=result.length-1;i>0;i--){const j=Math.min(i,Math.max(0,Math.floor(this.random()*(i+1))));[result[i],result[j]]=[result[j]!,result[i]!]}
  return result
 }
 reset(length:number,currentIndex:number){
  this.serial=length;this.keys=Array.from({length},(_,i)=>i+1);this.current=this.keys[currentIndex]??null
  this.history=[];this.cursor=-1;this.remaining=this.enabled?this.shuffled(this.keys.filter(k=>k!==this.current)):[]
 }
 setEnabled(value:boolean){
  if(value===this.enabled)return
  this.enabled=value;this.remaining=value?this.shuffled(this.keys.filter(k=>k!==this.current)):[]
 }
 selected(index:number){
  const key=this.keys[index];if(key===undefined)return
  this.current=key;this.remaining=this.remaining.filter(k=>k!==key)
  this.history=this.history.slice(0,this.cursor+1)
 }
 played(index:number){
  const key=this.keys[index];if(key===undefined)return
  if(this.current!==key)this.selected(index)
  this.remaining=this.remaining.filter(k=>k!==key)
  if(this.history[this.cursor]===key)return
  this.history=this.history.slice(0,this.cursor+1);this.history.push(key);this.cursor=this.history.length-1
  if(this.history.length>2000){this.history.shift();this.cursor--}
 }
 next(repeatAll:boolean):number|null{
  if(!this.keys.length)return null
  if(this.cursor+1<this.history.length){this.current=this.history[++this.cursor]!;this.remaining=this.remaining.filter(k=>k!==this.current);return this.keys.indexOf(this.current)}
  if(!this.remaining.length){
   if(!repeatAll)return null
   this.remaining=this.shuffled(this.keys)
   if(this.remaining.length>1&&this.remaining[0]===this.current)[this.remaining[0],this.remaining[1]]=[this.remaining[1]!,this.remaining[0]!]
  }
  this.current=this.remaining.shift()!
  return this.keys.indexOf(this.current)
 }
 previous():number|null{
  if(this.cursor<0)return null
  if(this.current===this.history[this.cursor]){if(this.cursor===0)return null;this.cursor--}
  this.current=this.history[this.cursor]!;this.remaining=this.remaining.filter(k=>k!==this.current)
  return this.keys.indexOf(this.current)
 }
 append(count:number){
  const added=Array.from({length:count},()=>++this.serial);this.keys.push(...added)
  if(this.current===null)this.current=this.keys[0]??null
  if(this.enabled)this.remaining=this.shuffled([...this.remaining,...added.filter(k=>k!==this.current)])
 }
 remove(index:number){
  const [key]=this.keys.splice(index,1);if(key===undefined)return
  this.remaining=this.remaining.filter(k=>k!==key)
  const before=this.history.slice(0,this.cursor+1).filter(k=>k!==key),after=this.history.slice(this.cursor+1).filter(k=>k!==key)
  this.history=[...before,...after];this.cursor=before.length-1
  if(this.current===key)this.current=null
 }
 move(from:number,to:number){const [key]=this.keys.splice(from,1);if(key!==undefined)this.keys.splice(to,0,key)}
 upcoming(){
  const future=this.history.slice(this.cursor+1),replayed=new Set(future)
  return [...future,...this.remaining.filter(k=>!replayed.has(k))].map(k=>this.keys.indexOf(k)).filter(i=>i>=0)
 }
 snapshot(){return {version:1,keys:this.keys.slice(),current:this.current,remaining:this.remaining.slice(),history:this.history.slice(),cursor:this.cursor,serial:this.serial,enabled:this.enabled}}
 restore(raw:unknown,length:number,currentIndex:number):boolean{
  if(!raw||typeof raw!=='object')return false
  const s=raw as ReturnType<PlaybackOrder['snapshot']>,numbers=(v:unknown,max:number):v is number[]=>Array.isArray(v)&&v.length<=max&&v.every(n=>Number.isSafeInteger(n)&&n>0)
  if(s.version!==1||typeof s.enabled!=='boolean'||!numbers(s.keys,1000)||s.keys.length!==length||new Set(s.keys).size!==length||!numbers(s.remaining,1000)||new Set(s.remaining).size!==s.remaining.length||!numbers(s.history,2000)||!Number.isSafeInteger(s.cursor)||s.cursor< -1||s.cursor>=s.history.length||!Number.isSafeInteger(s.serial)||s.serial<Math.max(0,...s.keys)||s.current!==(s.keys[currentIndex]??null))return false
  const keys=new Set(s.keys)
  if(![...s.remaining,...s.history].every(k=>keys.has(k))||s.remaining.includes(s.current!))return false
  this.keys=s.keys.slice();this.current=s.current;this.remaining=s.remaining.slice();this.history=s.history.slice();this.cursor=s.cursor;this.serial=s.serial;this.enabled=s.enabled
  return true
 }
}
