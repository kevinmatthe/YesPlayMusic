import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
export default defineConfig({ plugins:[vue()], server:{port:37835,proxy:{'/music-api':{target:process.env.MUSIC_DEV_API || 'http://127.0.0.1:37831',changeOrigin:false}}}, build:{target:'es2022'},test:{environment:'node',include:['tests/**/*.test.ts'],testTimeout:10000} })
