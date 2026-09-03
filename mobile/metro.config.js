// Metro bundler configuration.
//
// The app imports reference data from `shared/` at the repository root — the
// same module the API uses to decide which officers a sighting reaches — so
// that directory has to be watched and its resolution rooted here. Without
// this, Metro refuses to resolve anything above `mobile/` and the build fails
// only at bundle time, not in the editor.

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.join(repoRoot, 'shared')];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];

module.exports = config;
