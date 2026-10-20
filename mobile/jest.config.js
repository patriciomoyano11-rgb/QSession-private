module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(react-native|@react-native\\+[^@]+|@react-native-community\\+[^@]+)@)',
    'node_modules/(?!.pnpm|react-native|@react-native|@react-native-community)',
  ],
};
