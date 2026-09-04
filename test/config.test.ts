import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getConfigDir,
  getConfigPath,
  loadConfigFile,
  saveConfigFile,
  loadConfig,
  saveConfig,
} from '../src/config.js';

test('Path resolution defaults to /data when FATSECRET_CONFIG_DIR is unset', () => {
  const originalEnv = process.env.FATSECRET_CONFIG_DIR;
  delete process.env.FATSECRET_CONFIG_DIR;
  try {
    assert.equal(getConfigDir(), '/data');
    assert.equal(getConfigPath(), '/data/config.json');
  } finally {
    if (originalEnv !== undefined) {
      process.env.FATSECRET_CONFIG_DIR = originalEnv;
    }
  }
});

test('Path resolution respects FATSECRET_CONFIG_DIR environment variable', () => {
  const originalEnv = process.env.FATSECRET_CONFIG_DIR;
  process.env.FATSECRET_CONFIG_DIR = '/custom/config/dir';
  try {
    assert.equal(getConfigDir(), '/custom/config/dir');
    assert.equal(getConfigPath(), '/custom/config/dir/config.json');
  } finally {
    if (originalEnv !== undefined) {
      process.env.FATSECRET_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.FATSECRET_CONFIG_DIR;
    }
  }
});

test('loadConfigFile returns {} when file does not exist (ENOENT)', () => {
  const nonExistentPath = join(tmpdir(), `non-existent-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const config = loadConfigFile(nonExistentPath);
  assert.deepEqual(config, {});
});

test('loadConfigFile returns {} on syntax error without throwing', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const corruptedPath = join(tempDir, 'corrupted.json');
  writeFileSync(corruptedPath, '{ invalid json: [,,}', 'utf-8');

  try {
    const config = loadConfigFile(corruptedPath);
    assert.deepEqual(config, {});
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfigFile returns {} when JSON is not an object (e.g. array or primitive)', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const arrayPath = join(tempDir, 'array.json');
  writeFileSync(arrayPath, '[1, 2, 3]', 'utf-8');

  try {
    const config = loadConfigFile(arrayPath);
    assert.deepEqual(config, {});
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfigFile correctly loads valid config', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const validPath = join(tempDir, 'valid.json');
  const initial = {
    clientId: 'test-id',
    clientSecret: 'test-secret',
    accessToken: 'test-token',
  };
  writeFileSync(validPath, JSON.stringify(initial), 'utf-8');

  try {
    const loaded = loadConfigFile(validPath);
    assert.deepEqual(loaded, initial);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveConfigFile creates non-existent nested directories recursively', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const nestedPath = join(tempDir, 'nested', 'sub', 'dir', 'config.json');

  try {
    const saved = saveConfigFile({ clientId: 'nested-client' }, nestedPath);
    assert.equal(saved.clientId, 'nested-client');
    assert.ok(existsSync(nestedPath));

    const content = JSON.parse(readFileSync(nestedPath, 'utf-8'));
    assert.equal(content.clientId, 'nested-client');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveConfigFile merges updates and deletes keys set to undefined', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const configPath = join(tempDir, 'config.json');

  try {
    // Initial write
    saveConfigFile({
      clientId: 'id-1',
      clientSecret: 'sec-1',
      consumerSecret: 'cons-1',
      accessToken: 'tok-1',
    }, configPath);

    // Partial update with key deletion
    const updated = saveConfigFile({
      clientSecret: 'sec-2',
      accessToken: undefined,
    }, configPath);

    assert.equal(updated.clientId, 'id-1');
    assert.equal(updated.clientSecret, 'sec-2');
    assert.equal(updated.consumerSecret, 'cons-1');
    assert.equal(updated.accessToken, undefined);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.deepEqual(onDisk, {
      clientId: 'id-1',
      clientSecret: 'sec-2',
      consumerSecret: 'cons-1',
    });
    assert.equal('accessToken' in onDisk, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig and saveConfig aliases work identically', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-test-'));
  const configPath = join(tempDir, 'alias-test.json');

  try {
    saveConfig({ clientId: 'alias-client' }, configPath);
    const loaded = loadConfig(configPath);
    assert.equal(loaded.clientId, 'alias-client');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
