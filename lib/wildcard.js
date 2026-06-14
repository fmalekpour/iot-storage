'use strict';

/**
 * Convert an MQTT-style wildcard path to a regex for matching record paths.
 *
 * Rules:
 *   +     — matches exactly one path level (no slash)
 *   #     — matches any number of levels (only valid at end of path)
 *   /     — literal path separator
 *
 * Examples:
 *   "/sensors/+"      → matches "/sensors/temp", "/sensors/humidity"
 *   "/sensors/#"      → matches "/sensors/temp", "/sensors/room/light"
 *   "/sensors/temp"   → matches only "/sensors/temp" (exact)
 */

function wildcardToRegex(wildcardPath) {
  // If the path has no wildcards, return null to signal exact match
  if (!wildcardPath.includes('+') && !wildcardPath.includes('#')) {
    return null;
  }

  const segments = wildcardPath.split('/').filter(s => s !== '');

  // Build regex from segments
  let pattern = '^';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg === '#') {
      // # can only appear at the end
      if (i !== segments.length - 1) {
        throw new Error('Wildcard "#" may only appear at the end of a path');
      }
      // Match zero or more path segments
      pattern += '(?:/.*)?$';
      return new RegExp(pattern);
    }

    if (seg === '+') {
      pattern += '/[^/]+';
    } else {
      // Escape special regex characters in literal segment
      pattern += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  pattern += '$';
  return new RegExp(pattern);
}

/**
 * Check if a given record path matches a query path (which may have wildcards).
 */
function matchesPath(queryPath, recordPath) {
  const regex = wildcardToRegex(queryPath);
  if (regex === null) {
    // Exact match
    return queryPath === recordPath;
  }
  return regex.test(recordPath);
}

/**
 * Check if a path is a parent of another path.
 * "/sensors" is a parent of "/sensors/temp"
 * "/sensors" is NOT a parent of "/sensorstemp" (it has to be a path boundary)
 */
function isParentOf(parentPath, childPath) {
  if (!childPath.startsWith(parentPath)) return false;
  if (parentPath === childPath) return false;
  return childPath.charAt(parentPath.length) === '/';
}

/**
 * Get immediate children of a parent path.
 * "/sensors" has children "/sensors/temp", "/sensors/humidity"
 * but NOT "/sensors/room/light" (that's a grandchild)
 */
function getChildPaths(parentPath, allPaths) {
  const results = [];
  for (const p of allPaths) {
    if (isParentOf(parentPath, p)) {
      // Check it's an immediate child, not a deeper descendant
      const remainder = p.slice(parentPath.length + 1); // skip the /
      if (!remainder.includes('/')) {
        results.push(p);
      }
    }
  }
  return results;
}

module.exports = { wildcardToRegex, matchesPath, isParentOf, getChildPaths };
