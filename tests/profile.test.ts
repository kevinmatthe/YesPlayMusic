import { describe, expect, it } from 'vitest'
import { profileAvatarURL, profileName, profileInitial } from '../src/profile'

describe('profile presentation fallbacks',()=>{
  it('uses guest and missing verified-name fallbacks without inventing a real identity',()=>{
    expect(profileName()).toBe('访客')
    expect(profileName({id:'g',kind:'guest',displayName:'unexpected guest data'})).toBe('访客')
    expect(profileName({id:'f',kind:'feishu',displayName:'  '})).toBe('飞书朋友')
    expect(profileName({id:'f',kind:'feishu',displayName:' 模拟昵称 '})).toBe('模拟昵称')
    expect(profileInitial('🎵模拟')).toBe('🎵')
  })
  it.each(['http://avatar.example/a.jpg','javascript:alert(1)','data:image/svg+xml,<svg/>','//avatar.example/a.jpg','https://user:password@avatar.example/a.jpg','https://avatar.example\\a.jpg'])('rejects an unsafe avatar URL %s',url=>{
    expect(profileAvatarURL(url)).toBe('')
  })
  it('allows a verified HTTPS avatar while keeping empty values as fallback',()=>{
    expect(profileAvatarURL('https://avatar.example/qa.jpg')).toBe('https://avatar.example/qa.jpg')
    expect(profileAvatarURL(null)).toBe('')
  })
})
