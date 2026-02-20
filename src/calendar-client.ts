/**
 * CalendarClient
 *
 * CalDAV client for Xandikos calendar server with full CRUD,
 * calendar-query REPORT, and sync-collection REPORT support.
 */

import type { CalendarEvent, CalDAVSyncResult, Change, EventFilters } from '@tummycrypt/tinyland-calendar';
import { getConfig } from './config.js';
import { CalDAVConflictError } from './errors.js';
import { generateICalData, parseICalData, formatDateTime } from './ical-utils.js';
import {
  extractHrefsFromPropfind,
  buildCalendarQueryXml,
  parseCalendarQueryResponse,
  buildSyncCollectionXml,
  parseSyncCollectionResponse,
} from './xml-utils.js';

/**
 * Internal sync result type matching CalDAVSyncResult from tinyland-calendar.
 * Re-exported for use by xml-utils.
 */
export interface CalDAVSyncResultInternal {
  success: boolean;
  etag?: string;
  syncToken?: string;
  changes?: Change[];
  error?: string;
  skipped?: boolean;
}

const DEFAULT_BASE_URL = 'http://xandikos:8000';
const DEFAULT_CALENDAR_PATH = '/stonewall/calendars/calendar/';
const DEFAULT_LIST_TIMEOUT = 3000;
const DEFAULT_QUERY_TIMEOUT = 5000;
const DEFAULT_SYNC_TIMEOUT = 5000;

export class CalendarClient {
  private baseUrl: string;
  private calendarPath: string;
  private listTimeout: number;
  private queryTimeout: number;
  private syncTimeout: number;

  constructor(baseUrl?: string) {
    const config = getConfig();
    this.baseUrl = baseUrl ?? config.baseUrl ?? DEFAULT_BASE_URL;
    this.calendarPath = config.calendarPath ?? DEFAULT_CALENDAR_PATH;
    this.listTimeout = config.listTimeout ?? DEFAULT_LIST_TIMEOUT;
    this.queryTimeout = config.queryTimeout ?? DEFAULT_QUERY_TIMEOUT;
    this.syncTimeout = config.syncTimeout ?? DEFAULT_SYNC_TIMEOUT;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new calendar event.
   * @returns The event UID
   */
  async createEvent(event: Partial<CalendarEvent>): Promise<string> {
    const uid =
      event.uid || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@stonewallunderground.com`;
    const icalData = generateICalData({ ...event, uid });

    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: icalData,
    });

    if (response.status === 412) {
      throw new Error(`Calendar event with UID ${uid} already exists`);
    }

    if (!response.ok) {
      throw new Error(`Failed to create calendar event: ${response.statusText}`);
    }

    return uid;
  }

  /**
   * Create event and return full result with ETag.
   */
  async createEventWithETag(
    event: Partial<CalendarEvent>
  ): Promise<{ uid: string; etag?: string }> {
    const uid =
      event.uid || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@stonewallunderground.com`;
    const icalData = generateICalData({ ...event, uid });

    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: icalData,
    });

    if (response.status === 412) {
      throw new Error(`Calendar event with UID ${uid} already exists`);
    }

    if (!response.ok) {
      throw new Error(`Failed to create calendar event: ${response.statusText}`);
    }

    const etag = response.headers.get('ETag') || undefined;
    return { uid, etag };
  }

  /**
   * Update an existing calendar event with ETag conflict detection.
   *
   * If event.caldavEtag is provided, uses If-Match header for optimistic locking.
   * Throws CalDAVConflictError on 412 Precondition Failed (ETag mismatch).
   *
   * @returns The new ETag, or undefined
   */
  async updateEvent(uid: string, event: Partial<CalendarEvent>): Promise<string | undefined> {
    const icalData = generateICalData({ ...event, uid });

    const headers: Record<string, string> = {
      'Content-Type': 'text/calendar',
    };

    if (event.caldavEtag) {
      headers['If-Match'] = event.caldavEtag;
    }

    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`, {
      method: 'PUT',
      headers,
      body: icalData,
    });

    if (response.status === 412) {
      const currentEtag = response.headers.get('ETag') || undefined;
      throw new CalDAVConflictError(
        'Event was modified by another process. Refresh and try again.',
        event.caldavEtag,
        currentEtag
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to update calendar event: ${response.statusText}`);
    }

    return response.headers.get('ETag') || undefined;
  }

  /**
   * Delete a calendar event. Does not throw on 404.
   */
  async deleteEvent(uid: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete calendar event: ${response.statusText}`);
    }
  }

  /**
   * Get a calendar event with ETag for conflict detection.
   * Returns null if not found (404).
   */
  async getEvent(uid: string): Promise<CalendarEvent | null> {
    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get calendar event: ${response.statusText}`);
    }

    const icalData = await response.text();
    const event = parseICalData(icalData);

    const etag = response.headers.get('ETag');
    if (etag) {
      event.caldavEtag = etag;
    }

    event.caldavUrl = `${this.baseUrl}${this.calendarPath}${uid}.ics`;

    return event;
  }

  // ==========================================================================
  // List / Query
  // ==========================================================================

  /**
   * List all calendar events via PROPFIND.
   */
  async listEvents(): Promise<CalendarEvent[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.listTimeout);

    try {
      const response = await fetch(`${this.baseUrl}${this.calendarPath}`, {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <propfind xmlns="DAV:">
            <prop>
              <getcontenttype/>
              <getetag/>
              <displayname/>
            </prop>
          </propfind>`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to list calendar events: ${response.statusText}`);
      }

      const xmlText = await response.text();
      const events: CalendarEvent[] = [];

      const hrefs = extractHrefsFromPropfind(xmlText);

      for (const href of hrefs) {
        const uid = href.split('/').pop()?.replace('.ics', '');
        if (uid) {
          try {
            const event = await this.getEvent(uid);
            if (event) {
              events.push(event);
            }
          } catch (_error) {
            // Skip events that fail to fetch
          }
        }
      }

      return events;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Query events with optional date range filter using CalDAV REPORT.
   * Falls back to listEvents() if REPORT not supported (501).
   */
  async queryEvents(filters?: EventFilters): Promise<CalendarEvent[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.queryTimeout);

    try {
      const reportXml = buildCalendarQueryXml(filters, formatDateTime);

      const response = await fetch(`${this.baseUrl}${this.calendarPath}`, {
        method: 'REPORT',
        headers: {
          'Content-Type': 'application/xml',
          Depth: '1',
        },
        body: reportXml,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 501 || response.status === 405) {
          return this.listEvents();
        }
        throw new Error(`CalDAV REPORT failed: ${response.statusText}`);
      }

      const xmlText = await response.text();
      return parseCalendarQueryResponse(xmlText, this.baseUrl);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return [];
      }
      throw error;
    }
  }

  // ==========================================================================
  // Sync (RFC 6578)
  // ==========================================================================

  /**
   * Get current sync token for the calendar collection.
   */
  async getSyncToken(): Promise<string | null> {
    const response = await fetch(`${this.baseUrl}${this.calendarPath}`, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:">
          <D:prop>
            <D:sync-token/>
          </D:prop>
        </D:propfind>`,
    });

    if (!response.ok) {
      return null;
    }

    const xmlText = await response.text();

    try {
      const { XMLParser: XP } = await import('fast-xml-parser');
      const parser = new XP({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true,
        isArray: (name) => ['response', 'propstat', 'prop'].includes(name),
      });
      const parsed = parser.parse(xmlText);
      const multistatus = parsed.multistatus || parsed['multistatus'];
      if (!multistatus) return null;

      let responses = multistatus.response || [];
      if (!Array.isArray(responses)) responses = [responses];

      for (const resp of responses) {
        let propstats = resp.propstat || [];
        if (!Array.isArray(propstats)) propstats = [propstats];

        for (const propstat of propstats) {
          let props = propstat.prop || [];
          if (!Array.isArray(props)) props = [props];

          for (const prop of props) {
            const syncToken = prop['sync-token'] || prop.syncToken;
            if (syncToken) return syncToken;
          }
        }
      }
    } catch (_error) {
      // XML parsing failed
    }

    return null;
  }

  /**
   * Sync collection using sync-token for incremental updates.
   * Returns changed events since the provided sync token.
   */
  async syncCollection(syncToken?: string): Promise<CalDAVSyncResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.syncTimeout);

    try {
      const reportXml = buildSyncCollectionXml(syncToken);

      const response = await fetch(`${this.baseUrl}${this.calendarPath}`, {
        method: 'REPORT',
        headers: {
          'Content-Type': 'application/xml',
          Depth: '0',
        },
        body: reportXml,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (
          response.status === 501 ||
          response.status === 405 ||
          response.status === 403
        ) {
          return {
            success: false,
            skipped: true,
            error: 'sync-collection not supported by server',
          };
        }
        return {
          success: false,
          error: `Sync failed: ${response.statusText}`,
        };
      }

      const xmlText = await response.text();
      return parseSyncCollectionResponse(xmlText);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'Sync timeout',
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // ETag
  // ==========================================================================

  /**
   * Get ETag for a specific event without fetching full content.
   */
  async getETag(uid: string): Promise<string | null> {
    const response = await fetch(`${this.baseUrl}${this.calendarPath}${uid}.ics`, {
      method: 'HEAD',
    });

    if (!response.ok) {
      return null;
    }

    return response.headers.get('ETag');
  }
}

// Singleton instances
export const calendarClient = new CalendarClient();
export const xandikosClient = calendarClient;
