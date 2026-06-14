'use strict';

const { wildcardToRegex, matchesPath, isParentOf, getChildPaths } = require('../lib/wildcard');

describe('Wildcard Module', () => {
  describe('wildcardToRegex', () => {
    it('returns null for exact paths (no wildcards)', () => {
      expect(wildcardToRegex('/sensors/temp')).toBeNull();
      expect(wildcardToRegex('/a/b/c')).toBeNull();
    });

    it('converts + to match single path level', () => {
      const regex = wildcardToRegex('/sensors/+');
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('/sensors/temp')).toBe(true);
      expect(regex.test('/sensors/humidity')).toBe(true);
      expect(regex.test('/sensors/room/light')).toBe(false);
      expect(regex.test('/other/temp')).toBe(false);
    });

    it('converts # at end to match multiple levels', () => {
      const regex = wildcardToRegex('/sensors/#');
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('/sensors/temp')).toBe(true);
      expect(regex.test('/sensors/room/light')).toBe(true);
      expect(regex.test('/sensors/a/b/c')).toBe(true);
      expect(regex.test('/other/temp')).toBe(false);
    });

    it('throws if # is not at the end', () => {
      expect(() => wildcardToRegex('/sensors/#/extra')).toThrow();
    });

    it('handles multiple + wildcards', () => {
      const regex = wildcardToRegex('/+/+');
      expect(regex.test('/sensors/temp')).toBe(true);
      expect(regex.test('/a/b')).toBe(true);
      expect(regex.test('/a/b/c')).toBe(false);
    });
  });

  describe('matchesPath', () => {
    it('matches exact paths', () => {
      expect(matchesPath('/sensors/temp', '/sensors/temp')).toBe(true);
      expect(matchesPath('/sensors/temp', '/sensors/humidity')).toBe(false);
    });

    it('matches + wildcard', () => {
      expect(matchesPath('/sensors/+', '/sensors/temp')).toBe(true);
      expect(matchesPath('/sensors/+', '/sensors/humidity')).toBe(true);
      expect(matchesPath('/sensors/+', '/sensors/room/light')).toBe(false);
    });

    it('matches # wildcard', () => {
      expect(matchesPath('/sensors/#', '/sensors/temp')).toBe(true);
      expect(matchesPath('/sensors/#', '/sensors/room/light')).toBe(true);
      expect(matchesPath('/sensors/#', '/other/temp')).toBe(false);
    });
  });

  describe('isParentOf', () => {
    it('detects direct parent', () => {
      expect(isParentOf('/sensors', '/sensors/temp')).toBe(true);
    });

    it('detects grandparent', () => {
      expect(isParentOf('/sensors', '/sensors/room/light')).toBe(true);
    });

    it('rejects identical paths', () => {
      expect(isParentOf('/sensors', '/sensors')).toBe(false);
    });

    it('rejects false prefix matches', () => {
      expect(isParentOf('/sensors', '/sensorstemp')).toBe(false);
    });
  });

  describe('getChildPaths', () => {
    it('returns immediate children', () => {
      const all = ['/sensors/temp', '/sensors/humidity', '/sensors/room/light', '/other/val'];
      const children = getChildPaths('/sensors', all);
      expect(children).toEqual(['/sensors/temp', '/sensors/humidity']);
    });

    it('returns empty for no children', () => {
      expect(getChildPaths('/empty', ['/a/b'])).toEqual([]);
    });
  });
});
