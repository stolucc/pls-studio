// The test helpers reset the schema of the database they are given: only a database named *_test.

import { describe, expect, it } from 'vitest';
import { assertTestDatabase, databaseName } from './helpers.ts';

describe('the test database guard', () => {
  it('reads the database name as libpq would', () => {
    expect(databaseName('postgres:///pls_studio_test')).toBe('pls_studio_test');
    expect(databaseName('postgres://pls:pls@localhost:5432/pls_studio_test')).toBe(
      'pls_studio_test',
    );
    expect(databaseName('postgresql://localhost/app?dbname=other_test')).toBe('other_test');
    expect(databaseName('postgres://localhost', { PGDATABASE: 'from_env_test' })).toBe(
      'from_env_test',
    );
    expect(databaseName('postgres://alan@localhost', {})).toBe('alan');
  });

  it('accepts only a database whose name ends in _test', () => {
    expect(() => assertTestDatabase('postgres:///pls_studio_test')).not.toThrow();
    for (const url of [
      'postgres:///pls_studio',
      'postgres://pls:pls@db.example.org:5432/pls_studio',
      'postgres:///pls_test_backup',
      'postgres://localhost/pls_studio_test?dbname=pls_studio',
    ])
      expect(() => assertTestDatabase(url, {}), url).toThrow(/Refusing to reset database/);
    expect(() => assertTestDatabase('postgres://localhost', { PGDATABASE: 'prod' })).toThrow(
      /"prod"/,
    );
  });
});
