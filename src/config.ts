/**
 * CalDAV Client Configuration (Dependency Injection)
 *
 * Provides a framework-agnostic configuration system.
 * No process.env references -- all configuration is explicit.
 */

export interface CalDAVClientConfig {
  /** CalDAV server base URL. Default: 'http://xandikos:8000' */
  baseUrl?: string;
  /** Calendar collection path. Default: '/stonewall/calendars/calendar/' */
  calendarPath?: string;
  /** Timeout for listEvents PROPFIND (ms). Default: 3000 */
  listTimeout?: number;
  /** Timeout for queryEvents REPORT (ms). Default: 5000 */
  queryTimeout?: number;
  /** Timeout for syncCollection REPORT (ms). Default: 5000 */
  syncTimeout?: number;
}

let _config: CalDAVClientConfig = {};

/**
 * Configure the CalDAV client globally.
 * Merges provided config with existing config.
 */
export function configure(config: Partial<CalDAVClientConfig>): void {
  _config = { ..._config, ...config };
}

/**
 * Get the current configuration (returns a copy).
 */
export function getConfig(): CalDAVClientConfig {
  return { ..._config };
}

/**
 * Reset configuration to empty defaults.
 */
export function resetConfig(): void {
  _config = {};
}
