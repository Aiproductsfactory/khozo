module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must stay last: Reanimated 4 compiles worklets through react-native-worklets.
    plugins: ['react-native-worklets/plugin'],
  };
};
