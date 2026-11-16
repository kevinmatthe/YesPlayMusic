import type { Session } from './core'

export function profileName(user?:Session['user']):string {
  return user?.kind==='feishu'?(user.displayName?.trim().slice(0,160)||'飞书朋友'):'访客'
}
export function profileInitial(name:string):string {return Array.from(name.trim())[0]||'♪'}
export function profileAvatarURL(value?:string|null):string {
  const raw=value?.trim()
  if(!raw||/[\\\u0000-\u0020\u007f]/.test(raw))return ''
  try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}
}
