import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Workspace from './Workspace.vue'
import './style.css'
const routes=['/library','/search','/queue','/play','/history','/likes','/shares','/share/:token'].map(path=>({path,component:Workspace}))
const router=createRouter({history:createWebHistory(),routes:[{path:'/',redirect:to=>({path:'/library',query:to.query})},...routes,{path:'/:pathMatch(.*)*',redirect:'/library'}]})
createApp(App).use(createPinia()).use(router).mount('#app')
