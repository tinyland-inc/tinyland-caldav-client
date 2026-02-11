/**
 * XML Utilities
 *
 * Parsing helpers for CalDAV/WebDAV XML responses:
 * - PROPFIND multistatus
 * - Calendar-query REPORT
 * - Sync-collection REPORT
 */

import { XMLParser } from 'fast-xml-parser';
import type { CalendarEvent, Change } from '@tinyland-inc/tinyland-calendar';
import type { CalDAVSyncResultInternal } from './calendar-client.js';
import { parseICalData } from './ical-utils.js';

// XML parser configured for WebDAV/CalDAV responses
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => {
    return ['response', 'propstat', 'prop'].includes(name);
  },
});

/**
 * Extract .ics hrefs from a PROPFIND multistatus response
 */
export function extractHrefsFromPropfind(xmlText: string): string[] {
  try {
    const parsed = xmlParser.parse(xmlText);
    const hrefs: string[] = [];

    const multistatus = parsed.multistatus || parsed['multistatus'];
    if (!multistatus) return hrefs;

    let responses = multistatus.response || multistatus['response'] || [];
    if (!Array.isArray(responses)) {
      responses = [responses];
    }

    for (const resp of responses) {
      const href = resp.href || resp['href'];
      if (href && typeof href === 'string' && href.endsWith('.ics')) {
        hrefs.push(href);
      }
    }

    return hrefs;
  } catch (error) {
    // Fallback to regex if XML parsing fails
    const hrefMatches = xmlText.match(/<(?:D:)?href>([^<]+\.ics)<\/(?:D:)?href>/g);
    if (!hrefMatches) return [];
    return hrefMatches.map((match) => match.replace(/<\/?(?:D:)?href>/g, ''));
  }
}

/**
 * Parse a calendar-query REPORT response containing embedded calendar-data
 */
export function parseCalendarQueryResponse(
  xmlText: string,
  baseUrl: string
): CalendarEvent[] {
  try {
    const parsed = xmlParser.parse(xmlText);
    const events: CalendarEvent[] = [];

    const multistatus = parsed.multistatus || parsed['multistatus'];
    if (!multistatus) return events;

    let responses = multistatus.response || multistatus['response'] || [];
    if (!Array.isArray(responses)) {
      responses = [responses];
    }

    for (const resp of responses) {
      let propstats = resp.propstat || resp['propstat'] || [];
      if (!Array.isArray(propstats)) {
        propstats = [propstats];
      }

      for (const propstat of propstats) {
        const status = propstat.status || propstat['status'] || '';
        if (!status.includes('200')) continue;

        let props = propstat.prop || propstat['prop'] || [];
        if (!Array.isArray(props)) {
          props = [props];
        }

        for (const prop of props) {
          const calendarData = prop['calendar-data'] || prop.calendarData;
          if (calendarData && typeof calendarData === 'string') {
            const event = parseICalData(calendarData);

            const etag = prop.getetag || prop['getetag'];
            if (etag) {
              event.caldavEtag = etag;
            }

            const href = resp.href || resp['href'];
            if (href) {
              event.caldavUrl = `${baseUrl}${href}`;
            }

            events.push(event);
          }
        }
      }
    }

    return events;
  } catch (error) {
    return [];
  }
}

/**
 * Build calendar-query REPORT XML body
 */
export function buildCalendarQueryXml(
  filters: { from?: string; to?: string } | undefined,
  formatDateTime: (date: Date) => string
): string {
  let timeRangeFilter = '';

  if (filters?.from || filters?.to) {
    const start = filters.from
      ? formatDateTime(new Date(filters.from))
      : '19700101T000000Z';
    const end = filters.to
      ? formatDateTime(new Date(filters.to))
      : '20991231T235959Z';

    timeRangeFilter = `<C:time-range start="${start}" end="${end}"/>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <C:calendar-data/>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
              ${timeRangeFilter}
            </C:comp-filter>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;
}

/**
 * Build sync-collection REPORT XML body
 */
export function buildSyncCollectionXml(syncToken?: string): string {
  const tokenElement = syncToken
    ? `<D:sync-token>${syncToken}</D:sync-token>`
    : '<D:sync-token/>';

  return `<?xml version="1.0" encoding="utf-8"?>
      <D:sync-collection xmlns:D="DAV:">
        ${tokenElement}
        <D:sync-level>1</D:sync-level>
        <D:prop>
          <D:getetag/>
        </D:prop>
      </D:sync-collection>`;
}

/**
 * Parse sync-collection REPORT response
 */
export function parseSyncCollectionResponse(xmlText: string): CalDAVSyncResultInternal {
  try {
    const parsed = xmlParser.parse(xmlText);
    const multistatus = parsed.multistatus || parsed['multistatus'];

    if (!multistatus) {
      return { success: false, error: 'Invalid sync response' };
    }

    const newSyncToken = multistatus['sync-token'] || multistatus.syncToken;

    const changes: Change[] = [];
    let responses = multistatus.response || [];
    if (!Array.isArray(responses)) responses = [responses];

    for (const resp of responses) {
      const href = resp.href || resp['href'];
      if (!href || typeof href !== 'string') continue;

      let status: 'added' | 'modified' | 'deleted' = 'modified';
      let etag: string | undefined;

      let propstats = resp.propstat || [];
      if (!Array.isArray(propstats)) propstats = [propstats];

      for (const propstat of propstats) {
        const statusStr = propstat.status || propstat['status'] || '';

        if (statusStr.includes('404')) {
          status = 'deleted';
        } else if (statusStr.includes('200')) {
          let props = propstat.prop || [];
          if (!Array.isArray(props)) props = [props];

          for (const prop of props) {
            etag = prop.getetag || prop['getetag'];
          }
        }
      }

      if (href.endsWith('.ics')) {
        changes.push({ href, etag, status });
      }
    }

    return {
      success: true,
      syncToken: newSyncToken,
      changes,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to parse sync response',
    };
  }
}
