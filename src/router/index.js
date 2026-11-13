import Vue from 'vue';
import VueRouter from 'vue-router';
import MusicLibrary from '@/views/MusicLibrary.vue';
Vue.use(VueRouter);
export default new VueRouter({
  mode: 'history',
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', component: MusicLibrary },
    { path: '/search', component: MusicLibrary },
    { path: '/queue', component: MusicLibrary },
    { path: '/play', component: MusicLibrary },
    { path: '/share/:token', component: MusicLibrary },
    { path: '*', redirect: '/library' },
  ],
});
