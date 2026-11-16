import assert from 'node:assert/strict';
import fs from 'node:fs';
const p=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url)));
assert.match(p.dependencies.vue,/^\^?3\./,'new frontend must use Vue3');
for(const id of ['electron','vuex','NeteaseCloudMusicApi','@unblockneteasemusic/rust-napi']) assert.ok(!(id in p.dependencies),'legacy runtime dependency: '+id);
assert.equal(p.scripts.build,'vue-tsc --noEmit && vite build');
console.log('modern browser package checks passed');
