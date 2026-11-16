// Browser-only entry for the existing Vue CLI 4 project. Electron remains a separate target.
const Service = require('@vue/cli-service/lib/Service');
const webpack = require('webpack');
const ids = ['@vue/cli-plugin-babel', '@vue/cli-plugin-eslint', '@vue/cli-plugin-pwa', '@vue/cli-plugin-vuex'];
const plugins = ids.map(id => ({ id, apply: require(id) }));
plugins.push({ id: 'music-browser', apply: api => api.configureWebpack({ plugins: [new webpack.DefinePlugin({ 'process.env.IS_ELECTRON': 'false' })] }) });
const command = process.argv[2] || 'build';
if (!['build', 'serve'].includes(command)) throw new Error('Expected build or serve');
new Service(process.cwd(), { plugins }).run(command).catch(error => { console.error(error); process.exitCode = 1; });
