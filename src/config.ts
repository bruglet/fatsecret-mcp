import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface Config {
  clientId?: string;
  clientSecret?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  [key: string]: unknown;
}

/**
 * Returns the directory path where configuration is stored.
 * Evaluates FATSECRET_CONFIG_DIR, defaulting to '/data'.
 */
export function getConfigDir(): string {
  return process.env.FATSECRET_CONFIG_DIR || '/data';
}

/**
 * Returns the full path to the configuration JSON file.
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Loads configuration from disk.
 * Returns an empty object on missing file (ENOENT) or invalid JSON syntax without throwing.
 */
export function loadConfigFile(configPath: string = getConfigPath()): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      console.error(`No config file at ${configPath}`);
    } else {
      console.error(`Warning: Could not read config file at ${configPath}:`, err);
    }
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      console.error(`Loaded config from ${configPath}`);
      return parsed as Config;
    }
    console.error(`Warning: Config at ${configPath} is not a valid JSON object`);
    return {};
  } catch (err) {
    console.error(`Warning: Failed to parse config JSON at ${configPath}:`, err);
    return {};
  }
}

/**
 * Saves configuration updates to disk.
 * Creates parent directory recursively before writing.
 * Writes atomically via temporary file and rename.
 */
export function saveConfigFile(updates: Partial<Config>, configPath: string = getConfigPath()): Config {
  const dir = dirname(configPath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    console.error(`Failed to create config directory ${dir}:`, err);
    throw new Error(`Failed to create config directory ${dir}: ${(err as Error).message}`);
  }

  const existing = loadConfigFile(configPath);
  const merged: Config = { ...existing, ...updates };

  for (const key of Object.keys(merged) as (keyof Config)[]) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }

  const payload = JSON.stringify(merged, null, 2) + '\n';
  const tmpPath = join(dir, `.config.json.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`);

  try {
    writeFileSync(tmpPath, payload, 'utf-8');
    renameSync(tmpPath, configPath);
  } catch (writeErr) {
    // Fallback if atomic rename is not supported
    try {
      writeFileSync(configPath, payload, 'utf-8');
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch (directErr) {
      if (existsSync(tmpPath)) {
        try { unlinkSync(tmpPath); } catch {}
      }
      console.error(`Failed to write config file to ${configPath}:`, directErr);
      throw new Error(`Failed to write config file to ${configPath}: ${(directErr as Error).message}`);
    }
  }

  console.error(`Saved config to ${configPath}`);
  return merged;
}

export const loadConfig = loadConfigFile;
export const saveConfig = saveConfigFile;
