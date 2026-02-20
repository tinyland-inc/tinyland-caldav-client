/**
 * @tummycrypt/tinyland-caldav-client
 *
 * Framework-agnostic CalDAV client for Xandikos calendar server
 * with sync-token support (RFC 6578).
 *
 * @example
 * ```ts
 * import { configure, CalendarClient } from '@tummycrypt/tinyland-caldav-client';
 *
 * configure({ baseUrl: 'http://localhost:8081' });
 *
 * const client = new CalendarClient();
 * const events = await client.listEvents();
 * ```
 */

// Configuration (DI)
export { configure, getConfig, resetConfig } from './config.js';
export type { CalDAVClientConfig } from './config.js';

// Error types
export { CalDAVConflictError } from './errors.js';

// iCal utilities
export {
  escapeText,
  unescapeText,
  formatDateTime,
  parseDateTime,
  generateICalData,
  parseICalData,
} from './ical-utils.js';

// XML utilities
export {
  extractHrefsFromPropfind,
  parseCalendarQueryResponse,
  buildCalendarQueryXml,
  buildSyncCollectionXml,
  parseSyncCollectionResponse,
} from './xml-utils.js';

// CalendarClient
export { CalendarClient, calendarClient, xandikosClient } from './calendar-client.js';
