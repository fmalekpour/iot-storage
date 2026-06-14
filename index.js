'use strict';

module.exports = {
  Config: require('./lib/config'),
  server: require('./lib/server'),
  QueryEngine: require('./lib/query-engine'),
  backends: {
    Base: require('./lib/backends/base'),
    Json: require('./lib/backends/json'),
  },
  wildcard: require('./lib/wildcard'),
};
