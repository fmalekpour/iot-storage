module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: ['lib/**/*.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
};
