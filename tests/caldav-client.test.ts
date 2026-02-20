/**
 * Comprehensive tests for @tinyland-inc/tinyland-caldav-client
 *
 * Tests all exported functionality:
 * - Config DI
 * - CalDAVConflictError
 * - iCal generation and parsing
 * - Date formatting/parsing
 * - CRUD operations (createEvent, updateEvent, deleteEvent, getEvent)
 * - listEvents (PROPFIND)
 * - queryEvents (REPORT)
 * - Sync operations (getSyncToken, syncCollection)
 * - XML parsing helpers
 * - Singletons
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configure,
  getConfig,
  resetConfig,
  CalDAVConflictError,
  CalendarClient,
  calendarClient,
  xandikosClient,
  escapeText,
  unescapeText,
  formatDateTime,
  parseDateTime,
  generateICalData,
  parseICalData,
  extractHrefsFromPropfind,
  parseCalendarQueryResponse,
  buildCalendarQueryXml,
  buildSyncCollectionXml,
  parseSyncCollectionResponse,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(
  overrides: Partial<{
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: string;
    json: unknown;
  }> = {}
) {
  const headers = new Map(Object.entries(overrides.headers ?? {}));
  const response = {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    headers: {
      get: (name: string) => headers.get(name) ?? null,
    },
    text: async () => overrides.text ?? '',
    json: async () => overrides.json ?? {},
  };
  return vi.fn().mockResolvedValue(response);
}

function mockFetchSequence(responses: Array<Parameters<typeof mockFetch>[0]>) {
  const fn = vi.fn();
  for (const [i, resp] of responses.entries()) {
    const headers = new Map(Object.entries(resp?.headers ?? {}));
    fn.mockResolvedValueOnce({
      ok: resp?.ok ?? true,
      status: resp?.status ?? 200,
      statusText: resp?.statusText ?? 'OK',
      headers: {
        get: (name: string) => headers.get(name) ?? null,
      },
      text: async () => resp?.text ?? '',
      json: async () => resp?.json ?? {},
    });
  }
  return fn;
}

const SAMPLE_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//Test//EN',
  'BEGIN:VEVENT',
  'UID:test-uid-123',
  'SUMMARY:Test Event',
  'DESCRIPTION:A test description',
  'LOCATION:Test Location',
  'DTSTART:20250615T180000Z',
  'DTEND:20250615T200000Z',
  'CREATED:20250601T120000Z',
  'LAST-MODIFIED:20250610T150000Z',
  'ORGANIZER:Test Org',
  'CATEGORIES:music,community',
  'URL:https://example.com/register',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const MULTISTATUS_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/stonewall/calendars/calendar/</D:href>
    <D:propstat>
      <D:prop><D:displayname>Calendar</D:displayname></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/stonewall/calendars/calendar/event1.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"abc123"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/stonewall/calendars/calendar/event2.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"def456"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const MULTISTATUS_CALENDAR_QUERY = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/stonewall/calendars/calendar/event1.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-1"</D:getetag>
        <C:calendar-data>BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:uid-1\r\nSUMMARY:Event One\r\nDTSTART:20250701T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const MULTISTATUS_SYNC = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:sync-token>http://example.com/sync/token-2</D:sync-token>
  <D:response>
    <D:href>/stonewall/calendars/calendar/added.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"new-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/stonewall/calendars/calendar/deleted.ics</D:href>
    <D:propstat>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const SYNC_TOKEN_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/stonewall/calendars/calendar/</D:href>
    <D:propstat>
      <D:prop>
        <D:sync-token>http://example.com/sync/token-1</D:sync-token>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

// ===========================================================================
// 1. Config DI
// ===========================================================================

describe('Config DI', () => {
  beforeEach(() => resetConfig());

  it('should return empty config by default', () => {
    const config = getConfig();
    expect(config.baseUrl).toBeUndefined();
    expect(config.calendarPath).toBeUndefined();
    expect(config.listTimeout).toBeUndefined();
    expect(config.queryTimeout).toBeUndefined();
    expect(config.syncTimeout).toBeUndefined();
  });

  it('should configure baseUrl', () => {
    configure({ baseUrl: 'http://localhost:9999' });
    expect(getConfig().baseUrl).toBe('http://localhost:9999');
  });

  it('should configure calendarPath', () => {
    configure({ calendarPath: '/my/calendar/' });
    expect(getConfig().calendarPath).toBe('/my/calendar/');
  });

  it('should configure listTimeout', () => {
    configure({ listTimeout: 10000 });
    expect(getConfig().listTimeout).toBe(10000);
  });

  it('should configure queryTimeout', () => {
    configure({ queryTimeout: 8000 });
    expect(getConfig().queryTimeout).toBe(8000);
  });

  it('should configure syncTimeout', () => {
    configure({ syncTimeout: 7000 });
    expect(getConfig().syncTimeout).toBe(7000);
  });

  it('should merge configs on successive calls', () => {
    configure({ baseUrl: 'http://a' });
    configure({ calendarPath: '/b/' });
    const config = getConfig();
    expect(config.baseUrl).toBe('http://a');
    expect(config.calendarPath).toBe('/b/');
  });

  it('should override existing keys', () => {
    configure({ baseUrl: 'http://first' });
    configure({ baseUrl: 'http://second' });
    expect(getConfig().baseUrl).toBe('http://second');
  });

  it('should reset config to empty', () => {
    configure({ baseUrl: 'http://test', listTimeout: 5000 });
    resetConfig();
    const config = getConfig();
    expect(config.baseUrl).toBeUndefined();
    expect(config.listTimeout).toBeUndefined();
  });

  it('should return a copy, not the internal reference', () => {
    configure({ baseUrl: 'http://original' });
    const config = getConfig();
    config.baseUrl = 'http://mutated';
    expect(getConfig().baseUrl).toBe('http://original');
  });

  it('should allow configuring all options at once', () => {
    configure({
      baseUrl: 'http://all',
      calendarPath: '/all/',
      listTimeout: 1000,
      queryTimeout: 2000,
      syncTimeout: 3000,
    });
    const config = getConfig();
    expect(config.baseUrl).toBe('http://all');
    expect(config.calendarPath).toBe('/all/');
    expect(config.listTimeout).toBe(1000);
    expect(config.queryTimeout).toBe(2000);
    expect(config.syncTimeout).toBe(3000);
  });
});

// ===========================================================================
// 2. CalDAVConflictError
// ===========================================================================

describe('CalDAVConflictError', () => {
  it('should set message', () => {
    const err = new CalDAVConflictError('conflict');
    expect(err.message).toBe('conflict');
  });

  it('should set name to CalDAVConflictError', () => {
    const err = new CalDAVConflictError('test');
    expect(err.name).toBe('CalDAVConflictError');
  });

  it('should store localEtag', () => {
    const err = new CalDAVConflictError('msg', '"local-1"');
    expect(err.localEtag).toBe('"local-1"');
  });

  it('should store remoteEtag', () => {
    const err = new CalDAVConflictError('msg', '"local"', '"remote"');
    expect(err.remoteEtag).toBe('"remote"');
  });

  it('should be instanceof Error', () => {
    const err = new CalDAVConflictError('msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have undefined etags when not provided', () => {
    const err = new CalDAVConflictError('msg');
    expect(err.localEtag).toBeUndefined();
    expect(err.remoteEtag).toBeUndefined();
  });
});

// ===========================================================================
// 3. iCal generation
// ===========================================================================

describe('iCal generation (generateICalData)', () => {
  it('should generate valid VCALENDAR wrapper', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('BEGIN:VCALENDAR');
    expect(data).toContain('END:VCALENDAR');
  });

  it('should include VERSION:2.0', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('VERSION:2.0');
  });

  it('should include PRODID', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('PRODID:-//Tinyland.dev//Event Calendar//EN');
  });

  it('should include CALSCALE and METHOD', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('CALSCALE:GREGORIAN');
    expect(data).toContain('METHOD:PUBLISH');
  });

  it('should include UID', () => {
    const data = generateICalData({ uid: 'my-uid-123' });
    expect(data).toContain('UID:my-uid-123');
  });

  it('should include DTSTAMP', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  it('should include CREATED from createdAt', () => {
    const data = generateICalData({ uid: 'test', createdAt: '2025-01-15T10:00:00Z' });
    expect(data).toContain('CREATED:20250115T100000Z');
  });

  it('should include LAST-MODIFIED from updatedAt', () => {
    const data = generateICalData({ uid: 'test', updatedAt: '2025-06-20T14:30:00Z' });
    expect(data).toContain('LAST-MODIFIED:20250620T143000Z');
  });

  it('should include SUMMARY with default when title is missing', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('SUMMARY:Untitled Event');
  });

  it('should include SUMMARY from title', () => {
    const data = generateICalData({ uid: 'test', title: 'My Event' });
    expect(data).toContain('SUMMARY:My Event');
  });

  it('should include DESCRIPTION when provided', () => {
    const data = generateICalData({ uid: 'test', description: 'Hello World' });
    expect(data).toContain('DESCRIPTION:Hello World');
  });

  it('should omit DESCRIPTION when not provided', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).not.toContain('DESCRIPTION:');
  });

  it('should include LOCATION when provided', () => {
    const data = generateICalData({ uid: 'test', location: 'NYC' });
    expect(data).toContain('LOCATION:NYC');
  });

  it('should include DTSTART', () => {
    const data = generateICalData({ uid: 'test', dtstart: '2025-07-01T18:00:00Z' });
    expect(data).toContain('DTSTART:20250701T180000Z');
  });

  it('should include DTEND', () => {
    const data = generateICalData({ uid: 'test', dtend: '2025-07-01T20:00:00Z' });
    expect(data).toContain('DTEND:20250701T200000Z');
  });

  it('should include ORGANIZER', () => {
    const data = generateICalData({ uid: 'test', organizer: 'Jane Doe' });
    expect(data).toContain('ORGANIZER:Jane Doe');
  });

  it('should include CATEGORIES for multiple categories', () => {
    const data = generateICalData({ uid: 'test', categories: ['music', 'art'] });
    expect(data).toContain('CATEGORIES:music,art');
  });

  it('should include URL from registrationUrl', () => {
    const data = generateICalData({ uid: 'test', registrationUrl: 'https://example.com' });
    expect(data).toContain('URL:https://example.com');
  });

  it('should include RRULE when provided', () => {
    const data = generateICalData({ uid: 'test', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(data).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('should include STATUS:CONFIRMED and TRANSP:OPAQUE', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('STATUS:CONFIRMED');
    expect(data).toContain('TRANSP:OPAQUE');
  });

  it('should join lines with CRLF', () => {
    const data = generateICalData({ uid: 'test' });
    expect(data).toContain('\r\n');
    expect(data).not.toMatch(/(?<!\r)\n/); // No bare LF
  });

  it('should escape special characters in SUMMARY', () => {
    const data = generateICalData({ uid: 'test', title: 'Hello; World, Again\\Here\nNewline' });
    expect(data).toContain('SUMMARY:Hello\\; World\\, Again\\\\Here\\n');
  });
});

// ===========================================================================
// 4. iCal parsing
// ===========================================================================

describe('iCal parsing (parseICalData)', () => {
  it('should parse UID', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.uid).toBe('test-uid-123');
  });

  it('should parse SUMMARY as title', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.title).toBe('Test Event');
  });

  it('should parse DESCRIPTION', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.description).toBe('A test description');
  });

  it('should parse LOCATION', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.location).toBe('Test Location');
  });

  it('should parse DTSTART as ISO date', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.dtstart).toBe('2025-06-15T18:00:00Z');
  });

  it('should parse DTEND as ISO date', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.dtend).toBe('2025-06-15T20:00:00Z');
  });

  it('should parse CREATED as createdAt', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.createdAt).toBe('2025-06-01T12:00:00Z');
  });

  it('should parse LAST-MODIFIED as updatedAt', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.updatedAt).toBe('2025-06-10T15:00:00Z');
  });

  it('should parse ORGANIZER', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.organizer).toBe('Test Org');
  });

  it('should parse CATEGORIES as array', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.categories).toEqual(['music', 'community']);
  });

  it('should parse URL as registrationUrl', () => {
    const event = parseICalData(SAMPLE_ICAL);
    expect(event.registrationUrl).toBe('https://example.com/register');
  });

  it('should parse DATE-only format (8 chars)', () => {
    const ical = 'DTSTART:20250715\r\n';
    const event = parseICalData(ical);
    expect(event.dtstart).toBe('2025-07-15');
  });

  it('should parse DATE-TIME format with T and Z', () => {
    const ical = 'DTSTART:20250715T143000Z\r\n';
    const event = parseICalData(ical);
    expect(event.dtstart).toBe('2025-07-15T14:30:00Z');
  });

  it('should unescape text with backslash-n', () => {
    const ical = 'DESCRIPTION:Line1\\nLine2\r\n';
    const event = parseICalData(ical);
    expect(event.description).toBe('Line1\nLine2');
  });

  it('should unescape commas and semicolons', () => {
    const ical = 'SUMMARY:Hello\\, World\\; Test\r\n';
    const event = parseICalData(ical);
    expect(event.title).toBe('Hello, World; Test');
  });

  it('should unescape backslashes', () => {
    const ical = 'SUMMARY:Path\\\\to\\\\file\r\n';
    const event = parseICalData(ical);
    expect(event.title).toBe('Path\\to\\file');
  });

  it('should handle missing optional fields gracefully', () => {
    const ical = 'UID:minimal\r\nSUMMARY:Minimal Event\r\n';
    const event = parseICalData(ical);
    expect(event.uid).toBe('minimal');
    expect(event.title).toBe('Minimal Event');
    expect(event.description).toBeUndefined();
    expect(event.location).toBeUndefined();
    expect(event.dtend).toBeUndefined();
  });

  it('should split categories by comma', () => {
    const ical = 'CATEGORIES:a, b ,c\r\n';
    const event = parseICalData(ical);
    expect(event.categories).toEqual(['a', 'b', 'c']);
  });

  it('should handle values containing colons', () => {
    const ical = 'URL:https://example.com:8080/path\r\n';
    const event = parseICalData(ical);
    expect(event.registrationUrl).toBe('https://example.com:8080/path');
  });

  it('should parse RRULE', () => {
    const ical = 'RRULE:FREQ=DAILY;COUNT=5\r\n';
    const event = parseICalData(ical);
    expect(event.rrule).toBe('FREQ=DAILY;COUNT=5');
  });
});

// ===========================================================================
// 5. Date formatting
// ===========================================================================

describe('Date formatting (formatDateTime)', () => {
  it('should format Date to iCal format', () => {
    const date = new Date('2025-07-15T14:30:00.000Z');
    expect(formatDateTime(date)).toBe('20250715T143000Z');
  });

  it('should remove dashes from date part', () => {
    const result = formatDateTime(new Date('2025-01-01T00:00:00.000Z'));
    expect(result).not.toContain('-');
  });

  it('should remove colons from time part', () => {
    const result = formatDateTime(new Date('2025-01-01T12:34:56.000Z'));
    expect(result).not.toContain(':');
  });

  it('should remove milliseconds', () => {
    const result = formatDateTime(new Date('2025-01-01T00:00:00.123Z'));
    expect(result).not.toContain('.123');
  });

  it('should end with Z', () => {
    const result = formatDateTime(new Date('2025-06-15T00:00:00Z'));
    expect(result).toMatch(/Z$/);
  });

  it('should format midnight correctly', () => {
    const result = formatDateTime(new Date('2025-12-31T00:00:00.000Z'));
    expect(result).toBe('20251231T000000Z');
  });

  it('should format end of day correctly', () => {
    const result = formatDateTime(new Date('2025-12-31T23:59:59.000Z'));
    expect(result).toBe('20251231T235959Z');
  });
});

describe('Date parsing (parseDateTime)', () => {
  it('should parse DATE format (8 chars)', () => {
    expect(parseDateTime('20250715')).toBe('2025-07-15');
  });

  it('should parse DATE-TIME format', () => {
    expect(parseDateTime('20250715T143000Z')).toBe('2025-07-15T14:30:00Z');
  });

  it('should parse start of year', () => {
    expect(parseDateTime('20250101T000000Z')).toBe('2025-01-01T00:00:00Z');
  });
});

// ===========================================================================
// 6. escapeText / unescapeText
// ===========================================================================

describe('escapeText', () => {
  it('should escape backslashes', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('should escape semicolons', () => {
    expect(escapeText('a;b')).toBe('a\\;b');
  });

  it('should escape commas', () => {
    expect(escapeText('a,b')).toBe('a\\,b');
  });

  it('should escape newlines', () => {
    expect(escapeText('a\nb')).toBe('a\\nb');
  });

  it('should handle null/undefined gracefully', () => {
    expect(escapeText(null)).toBe('');
    expect(escapeText(undefined)).toBe('');
  });

  it('should convert non-string to string', () => {
    expect(escapeText(42)).toBe('42');
  });

  it('should handle empty string', () => {
    expect(escapeText('')).toBe('');
  });
});

describe('unescapeText', () => {
  it('should unescape \\n to newline', () => {
    expect(unescapeText('a\\nb')).toBe('a\nb');
  });

  it('should unescape \\, to comma', () => {
    expect(unescapeText('a\\,b')).toBe('a,b');
  });

  it('should unescape \\; to semicolon', () => {
    expect(unescapeText('a\\;b')).toBe('a;b');
  });

  it('should unescape \\\\ to backslash', () => {
    expect(unescapeText('a\\\\b')).toBe('a\\b');
  });

  it('should handle empty string', () => {
    expect(unescapeText('')).toBe('');
  });
});

// ===========================================================================
// 7. CRUD operations
// ===========================================================================

describe('CalendarClient CRUD', () => {
  let client: CalendarClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
    fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // createEvent
  describe('createEvent', () => {
    it('should PUT to correct URL with given uid', async () => {
      const uid = await client.createEvent({ uid: 'ev-1', title: 'Test' });
      expect(uid).toBe('ev-1');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:8000/stonewall/calendars/calendar/ev-1.ics',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should generate uid when not provided', async () => {
      const uid = await client.createEvent({ title: 'No UID' });
      expect(uid).toContain('@stonewallunderground.com');
    });

    it('should send If-None-Match: * header', async () => {
      await client.createEvent({ uid: 'ev-1' });
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers['If-None-Match']).toBe('*');
    });

    it('should send text/calendar content type', async () => {
      await client.createEvent({ uid: 'ev-1' });
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers['Content-Type']).toBe('text/calendar');
    });

    it('should throw on 412 (event exists)', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 412, statusText: 'Precondition Failed' }));
      await expect(client.createEvent({ uid: 'ev-1' })).rejects.toThrow('already exists');
    });

    it('should throw on non-ok response', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Server Error' }));
      await expect(client.createEvent({ uid: 'ev-1' })).rejects.toThrow('Failed to create');
    });

    it('should include iCal body with VCALENDAR', async () => {
      await client.createEvent({ uid: 'ev-1', title: 'Body Test' });
      const body = fetchMock.mock.calls[0][1].body;
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body).toContain('SUMMARY:Body Test');
    });
  });

  // createEventWithETag
  describe('createEventWithETag', () => {
    it('should return uid and etag', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({ headers: { ETag: '"etag-new"' } })
      );
      const result = await client.createEventWithETag({ uid: 'ev-2', title: 'With ETag' });
      expect(result.uid).toBe('ev-2');
      expect(result.etag).toBe('"etag-new"');
    });

    it('should return undefined etag when not in response', async () => {
      const result = await client.createEventWithETag({ uid: 'ev-3' });
      expect(result.etag).toBeUndefined();
    });

    it('should throw on 412', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 412, statusText: 'Precondition Failed' }));
      await expect(client.createEventWithETag({ uid: 'ev-2' })).rejects.toThrow('already exists');
    });
  });

  // updateEvent
  describe('updateEvent', () => {
    it('should PUT to correct URL', async () => {
      await client.updateEvent('uid-1', { title: 'Updated' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:8000/stonewall/calendars/calendar/uid-1.ics',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should return new etag', async () => {
      vi.stubGlobal('fetch', mockFetch({ headers: { ETag: '"new-etag"' } }));
      const etag = await client.updateEvent('uid-1', { title: 'Updated' });
      expect(etag).toBe('"new-etag"');
    });

    it('should send If-Match header when caldavEtag provided', async () => {
      await client.updateEvent('uid-1', { title: 'Updated', caldavEtag: '"old-etag"' });
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers['If-Match']).toBe('"old-etag"');
    });

    it('should not send If-Match header when caldavEtag not provided', async () => {
      await client.updateEvent('uid-1', { title: 'Updated' });
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers['If-Match']).toBeUndefined();
    });

    it('should throw CalDAVConflictError on 412', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({ ok: false, status: 412, statusText: 'Precondition Failed', headers: { ETag: '"remote"' } })
      );
      try {
        await client.updateEvent('uid-1', { title: 'Updated', caldavEtag: '"local"' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CalDAVConflictError);
        const conflict = err as CalDAVConflictError;
        expect(conflict.localEtag).toBe('"local"');
        expect(conflict.remoteEtag).toBe('"remote"');
      }
    });

    it('should throw generic error on non-ok, non-412', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Internal' }));
      await expect(client.updateEvent('uid-1', {})).rejects.toThrow('Failed to update');
    });

    it('should return undefined when no etag in response', async () => {
      const etag = await client.updateEvent('uid-1', { title: 'Updated' });
      expect(etag).toBeUndefined();
    });
  });

  // deleteEvent
  describe('deleteEvent', () => {
    it('should DELETE correct URL', async () => {
      await client.deleteEvent('uid-1');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:8000/stonewall/calendars/calendar/uid-1.ics',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should not throw on 404', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 404, statusText: 'Not Found' }));
      await expect(client.deleteEvent('uid-1')).resolves.toBeUndefined();
    });

    it('should throw on other errors', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Server Error' }));
      await expect(client.deleteEvent('uid-1')).rejects.toThrow('Failed to delete');
    });
  });

  // getEvent
  describe('getEvent', () => {
    it('should GET correct URL', async () => {
      const getMock = mockFetch({ text: SAMPLE_ICAL, headers: { ETag: '"e1"' } });
      vi.stubGlobal('fetch', getMock);
      await client.getEvent('test-uid-123');
      expect(getMock).toHaveBeenCalledWith(
        'http://test:8000/stonewall/calendars/calendar/test-uid-123.ics'
      );
    });

    it('should return null on 404', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 404, statusText: 'Not Found' }));
      const result = await client.getEvent('nonexistent');
      expect(result).toBeNull();
    });

    it('should parse iCal data', async () => {
      vi.stubGlobal('fetch', mockFetch({ text: SAMPLE_ICAL }));
      const event = await client.getEvent('test-uid-123');
      expect(event).not.toBeNull();
      expect(event!.uid).toBe('test-uid-123');
      expect(event!.title).toBe('Test Event');
    });

    it('should store etag from response', async () => {
      vi.stubGlobal('fetch', mockFetch({ text: SAMPLE_ICAL, headers: { ETag: '"ev-etag"' } }));
      const event = await client.getEvent('test-uid-123');
      expect(event!.caldavEtag).toBe('"ev-etag"');
    });

    it('should set caldavUrl', async () => {
      vi.stubGlobal('fetch', mockFetch({ text: SAMPLE_ICAL }));
      const event = await client.getEvent('test-uid-123');
      expect(event!.caldavUrl).toBe('http://test:8000/stonewall/calendars/calendar/test-uid-123.ics');
    });

    it('should throw on non-404 error', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Error' }));
      await expect(client.getEvent('uid')).rejects.toThrow('Failed to get');
    });
  });
});

// ===========================================================================
// 8. listEvents
// ===========================================================================

describe('CalendarClient listEvents', () => {
  let client: CalendarClient;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send PROPFIND request', async () => {
    const fn = mockFetchSequence([
      { text: MULTISTATUS_PROPFIND },
      { text: SAMPLE_ICAL, headers: { ETag: '"e1"' } },
      { text: SAMPLE_ICAL, headers: { ETag: '"e2"' } },
    ]);
    vi.stubGlobal('fetch', fn);
    await client.listEvents();
    expect(fn.mock.calls[0][1].method).toBe('PROPFIND');
  });

  it('should parse XML response and fetch each event', async () => {
    const fn = mockFetchSequence([
      { text: MULTISTATUS_PROPFIND },
      { text: SAMPLE_ICAL, headers: { ETag: '"e1"' } },
      { text: SAMPLE_ICAL, headers: { ETag: '"e2"' } },
    ]);
    vi.stubGlobal('fetch', fn);
    const events = await client.listEvents();
    expect(events).toHaveLength(2);
  });

  it('should send Depth: 1 header', async () => {
    const fn = mockFetchSequence([{ text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' }]);
    vi.stubGlobal('fetch', fn);
    await client.listEvents();
    expect(fn.mock.calls[0][1].headers.Depth).toBe('1');
  });

  it('should return empty array on timeout (AbortError)', async () => {
    const abortFn = vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    vi.stubGlobal('fetch', abortFn);
    const events = await client.listEvents();
    expect(events).toEqual([]);
  });

  it('should return empty array for empty multistatus', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' }));
    const events = await client.listEvents();
    expect(events).toEqual([]);
  });

  it('should throw on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Error' }));
    await expect(client.listEvents()).rejects.toThrow('Failed to list');
  });

  it('should skip events that fail to fetch individually', async () => {
    const fn = mockFetchSequence([
      { text: MULTISTATUS_PROPFIND },
      { ok: false, status: 500, statusText: 'Error' },
      { text: SAMPLE_ICAL },
    ]);
    vi.stubGlobal('fetch', fn);
    const events = await client.listEvents();
    expect(events).toHaveLength(1);
  });

  it('should use configurable timeout', async () => {
    configure({ listTimeout: 100 });
    const newClient = new CalendarClient();
    // The timeout is set inside the method; we verify it does not throw for a fast response
    vi.stubGlobal('fetch', mockFetch({ text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' }));
    const events = await newClient.listEvents();
    expect(events).toEqual([]);
  });

  it('should include application/xml content type', async () => {
    const fn = mockFetch({ text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' });
    vi.stubGlobal('fetch', fn);
    await client.listEvents();
    expect(fn.mock.calls[0][1].headers['Content-Type']).toBe('application/xml');
  });

  it('should rethrow non-abort errors', async () => {
    const networkError = new Error('Network failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    await expect(client.listEvents()).rejects.toThrow('Network failure');
  });
});

// ===========================================================================
// 9. queryEvents
// ===========================================================================

describe('CalendarClient queryEvents', () => {
  let client: CalendarClient;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send REPORT request', async () => {
    const fn = mockFetch({ text: MULTISTATUS_CALENDAR_QUERY });
    vi.stubGlobal('fetch', fn);
    await client.queryEvents();
    expect(fn.mock.calls[0][1].method).toBe('REPORT');
  });

  it('should send Depth: 1 header', async () => {
    const fn = mockFetch({ text: MULTISTATUS_CALENDAR_QUERY });
    vi.stubGlobal('fetch', fn);
    await client.queryEvents();
    expect(fn.mock.calls[0][1].headers.Depth).toBe('1');
  });

  it('should include date range filter in XML body', async () => {
    const fn = mockFetch({ text: MULTISTATUS_CALENDAR_QUERY });
    vi.stubGlobal('fetch', fn);
    await client.queryEvents({ from: '2025-01-01', to: '2025-12-31' });
    const body = fn.mock.calls[0][1].body;
    expect(body).toContain('time-range');
    expect(body).toContain('20250101T');
    expect(body).toContain('20251231T');
  });

  it('should parse calendar-data from response', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_CALENDAR_QUERY }));
    const events = await client.queryEvents();
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('uid-1');
    expect(events[0].title).toBe('Event One');
  });

  it('should fall back to listEvents on 501', async () => {
    const fn = mockFetchSequence([
      { ok: false, status: 501, statusText: 'Not Implemented' },
      { text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' },
    ]);
    vi.stubGlobal('fetch', fn);
    const events = await client.queryEvents();
    // Second call should be PROPFIND (listEvents fallback)
    expect(fn.mock.calls[1][1].method).toBe('PROPFIND');
    expect(events).toEqual([]);
  });

  it('should fall back to listEvents on 405', async () => {
    const fn = mockFetchSequence([
      { ok: false, status: 405, statusText: 'Method Not Allowed' },
      { text: '<D:multistatus xmlns:D="DAV:"></D:multistatus>' },
    ]);
    vi.stubGlobal('fetch', fn);
    await client.queryEvents();
    expect(fn.mock.calls[1][1].method).toBe('PROPFIND');
  });

  it('should return empty array on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    const events = await client.queryEvents();
    expect(events).toEqual([]);
  });

  it('should throw on other error statuses', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error' }));
    await expect(client.queryEvents()).rejects.toThrow('CalDAV REPORT failed');
  });

  it('should work without filters', async () => {
    const fn = mockFetch({ text: MULTISTATUS_CALENDAR_QUERY });
    vi.stubGlobal('fetch', fn);
    await client.queryEvents();
    const body = fn.mock.calls[0][1].body;
    expect(body).not.toContain('time-range');
  });

  it('should work with only from filter', async () => {
    const fn = mockFetch({ text: MULTISTATUS_CALENDAR_QUERY });
    vi.stubGlobal('fetch', fn);
    await client.queryEvents({ from: '2025-06-01' });
    const body = fn.mock.calls[0][1].body;
    expect(body).toContain('time-range');
    expect(body).toContain('20250601T');
    expect(body).toContain('20991231T'); // default end
  });

  it('should use configurable timeout', async () => {
    configure({ queryTimeout: 100 });
    const newClient = new CalendarClient();
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_CALENDAR_QUERY }));
    const events = await newClient.queryEvents();
    expect(events).toHaveLength(1);
  });
});

// ===========================================================================
// 10. Sync operations
// ===========================================================================

describe('CalendarClient getSyncToken', () => {
  let client: CalendarClient;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send PROPFIND with Depth 0', async () => {
    const fn = mockFetch({ text: SYNC_TOKEN_RESPONSE });
    vi.stubGlobal('fetch', fn);
    await client.getSyncToken();
    expect(fn.mock.calls[0][1].method).toBe('PROPFIND');
    expect(fn.mock.calls[0][1].headers.Depth).toBe('0');
  });

  it('should return sync token from response', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: SYNC_TOKEN_RESPONSE }));
    const token = await client.getSyncToken();
    expect(token).toBe('http://example.com/sync/token-1');
  });

  it('should return null on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 404, statusText: 'Not Found' }));
    const token = await client.getSyncToken();
    expect(token).toBeNull();
  });

  it('should return null when no sync-token in response', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: '<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>' }));
    const token = await client.getSyncToken();
    expect(token).toBeNull();
  });

  it('should return null on invalid XML', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: 'not xml at all' }));
    const token = await client.getSyncToken();
    expect(token).toBeNull();
  });
});

describe('CalendarClient syncCollection', () => {
  let client: CalendarClient;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send REPORT request with Depth 0', async () => {
    const fn = mockFetch({ text: MULTISTATUS_SYNC });
    vi.stubGlobal('fetch', fn);
    await client.syncCollection('token-1');
    expect(fn.mock.calls[0][1].method).toBe('REPORT');
    expect(fn.mock.calls[0][1].headers.Depth).toBe('0');
  });

  it('should include sync token in request body', async () => {
    const fn = mockFetch({ text: MULTISTATUS_SYNC });
    vi.stubGlobal('fetch', fn);
    await client.syncCollection('http://example.com/sync/token-1');
    const body = fn.mock.calls[0][1].body;
    expect(body).toContain('<D:sync-token>http://example.com/sync/token-1</D:sync-token>');
  });

  it('should send empty sync-token element when no token provided', async () => {
    const fn = mockFetch({ text: MULTISTATUS_SYNC });
    vi.stubGlobal('fetch', fn);
    await client.syncCollection();
    const body = fn.mock.calls[0][1].body;
    expect(body).toContain('<D:sync-token/>');
  });

  it('should return success with sync token and changes', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_SYNC }));
    const result = await client.syncCollection('token-1');
    expect(result.success).toBe(true);
    expect(result.syncToken).toBe('http://example.com/sync/token-2');
    expect(result.changes).toHaveLength(2);
  });

  it('should identify added/modified changes', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_SYNC }));
    const result = await client.syncCollection('token-1');
    const added = result.changes!.find((c) => c.href.includes('added'));
    expect(added).toBeDefined();
    expect(added!.status).toBe('modified'); // 200 status = modified (default)
    expect(added!.etag).toBe('"new-etag"');
  });

  it('should identify deleted changes', async () => {
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_SYNC }));
    const result = await client.syncCollection('token-1');
    const deleted = result.changes!.find((c) => c.href.includes('deleted'));
    expect(deleted).toBeDefined();
    expect(deleted!.status).toBe('deleted');
  });

  it('should return skipped on 501', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 501, statusText: 'Not Implemented' }));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('should return skipped on 405', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 405, statusText: 'Method Not Allowed' }));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('should return skipped on 403', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 403, statusText: 'Forbidden' }));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('should return error on other non-ok statuses', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error' }));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Sync failed');
  });

  it('should return timeout error on AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Sync timeout');
  });

  it('should return error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    const result = await client.syncCollection('token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network down');
  });

  it('should use configurable timeout', async () => {
    configure({ syncTimeout: 100 });
    const newClient = new CalendarClient();
    vi.stubGlobal('fetch', mockFetch({ text: MULTISTATUS_SYNC }));
    const result = await newClient.syncCollection('token');
    expect(result.success).toBe(true);
  });

  it('should only include .ics files in changes', async () => {
    const xmlWithNonIcs = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:sync-token>token-3</D:sync-token>
  <D:response>
    <D:href>/stonewall/calendars/calendar/</D:href>
    <D:propstat>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/stonewall/calendars/calendar/event.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"e1"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    vi.stubGlobal('fetch', mockFetch({ text: xmlWithNonIcs }));
    const result = await client.syncCollection();
    expect(result.changes).toHaveLength(1);
    expect(result.changes![0].href).toContain('.ics');
  });
});

// ===========================================================================
// 11. XML parsing helpers
// ===========================================================================

describe('XML parsing utilities', () => {
  describe('extractHrefsFromPropfind', () => {
    it('should extract .ics hrefs', () => {
      const hrefs = extractHrefsFromPropfind(MULTISTATUS_PROPFIND);
      expect(hrefs).toHaveLength(2);
      expect(hrefs[0]).toContain('event1.ics');
      expect(hrefs[1]).toContain('event2.ics');
    });

    it('should exclude non-.ics hrefs', () => {
      const hrefs = extractHrefsFromPropfind(MULTISTATUS_PROPFIND);
      const nonIcs = hrefs.filter((h) => !h.endsWith('.ics'));
      expect(nonIcs).toHaveLength(0);
    });

    it('should return empty array for empty multistatus', () => {
      const hrefs = extractHrefsFromPropfind('<D:multistatus xmlns:D="DAV:"></D:multistatus>');
      expect(hrefs).toEqual([]);
    });

    it('should handle single response (not array)', () => {
      const xml = `<multistatus xmlns="DAV:">
        <response><href>/cal/ev.ics</href></response>
      </multistatus>`;
      const hrefs = extractHrefsFromPropfind(xml);
      expect(hrefs).toHaveLength(1);
    });

    it('should return empty for XML without proper response elements', () => {
      const brokenXml = '<D:multistatus><D:href>/cal/ev.ics</D:href>';
      const hrefs = extractHrefsFromPropfind(brokenXml);
      expect(hrefs).toEqual([]);
    });

    it('should return empty array for completely invalid input', () => {
      const hrefs = extractHrefsFromPropfind('not xml');
      expect(hrefs).toEqual([]);
    });
  });

  describe('parseCalendarQueryResponse', () => {
    it('should parse events from calendar-data', () => {
      const events = parseCalendarQueryResponse(MULTISTATUS_CALENDAR_QUERY, 'http://test:8000');
      expect(events).toHaveLength(1);
      expect(events[0].uid).toBe('uid-1');
    });

    it('should set caldavEtag from getetag', () => {
      const events = parseCalendarQueryResponse(MULTISTATUS_CALENDAR_QUERY, 'http://test:8000');
      expect(events[0].caldavEtag).toBe('"etag-1"');
    });

    it('should set caldavUrl from href', () => {
      const events = parseCalendarQueryResponse(MULTISTATUS_CALENDAR_QUERY, 'http://test:8000');
      expect(events[0].caldavUrl).toBe('http://test:8000/stonewall/calendars/calendar/event1.ics');
    });

    it('should return empty array for empty multistatus', () => {
      const events = parseCalendarQueryResponse(
        '<D:multistatus xmlns:D="DAV:"></D:multistatus>',
        'http://test'
      );
      expect(events).toEqual([]);
    });

    it('should return empty array for invalid XML', () => {
      const events = parseCalendarQueryResponse('garbage', 'http://test');
      expect(events).toEqual([]);
    });
  });

  describe('buildCalendarQueryXml', () => {
    it('should build XML without time-range when no filters', () => {
      const xml = buildCalendarQueryXml(undefined, formatDateTime);
      expect(xml).toContain('calendar-query');
      expect(xml).not.toContain('time-range');
    });

    it('should include time-range with from and to', () => {
      const xml = buildCalendarQueryXml({ from: '2025-01-01', to: '2025-12-31' }, formatDateTime);
      expect(xml).toContain('time-range');
      expect(xml).toContain('start="20250101T');
      expect(xml).toContain('end="20251231T');
    });

    it('should use default start when only to is provided', () => {
      const xml = buildCalendarQueryXml({ to: '2025-12-31' }, formatDateTime);
      expect(xml).toContain('start="19700101T000000Z"');
    });

    it('should use default end when only from is provided', () => {
      const xml = buildCalendarQueryXml({ from: '2025-01-01' }, formatDateTime);
      expect(xml).toContain('end="20991231T235959Z"');
    });
  });

  describe('buildSyncCollectionXml', () => {
    it('should include provided sync token', () => {
      const xml = buildSyncCollectionXml('http://example.com/token');
      expect(xml).toContain('<D:sync-token>http://example.com/token</D:sync-token>');
    });

    it('should use empty sync-token element when no token', () => {
      const xml = buildSyncCollectionXml();
      expect(xml).toContain('<D:sync-token/>');
    });

    it('should include sync-level 1', () => {
      const xml = buildSyncCollectionXml();
      expect(xml).toContain('<D:sync-level>1</D:sync-level>');
    });

    it('should request getetag property', () => {
      const xml = buildSyncCollectionXml();
      expect(xml).toContain('<D:getetag/>');
    });
  });

  describe('parseSyncCollectionResponse', () => {
    it('should parse sync token', () => {
      const result = parseSyncCollectionResponse(MULTISTATUS_SYNC);
      expect(result.syncToken).toBe('http://example.com/sync/token-2');
    });

    it('should parse changes', () => {
      const result = parseSyncCollectionResponse(MULTISTATUS_SYNC);
      expect(result.changes).toHaveLength(2);
    });

    it('should identify deleted items (404 status)', () => {
      const result = parseSyncCollectionResponse(MULTISTATUS_SYNC);
      const deleted = result.changes!.find((c) => c.status === 'deleted');
      expect(deleted).toBeDefined();
      expect(deleted!.href).toContain('deleted.ics');
    });

    it('should return error for missing multistatus', () => {
      const result = parseSyncCollectionResponse('<root></root>');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid sync response');
    });

    it('should return error for invalid XML', () => {
      const result = parseSyncCollectionResponse('not xml {{{{');
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// 12. Singletons and getETag
// ===========================================================================

describe('Singletons', () => {
  it('should export calendarClient as CalendarClient instance', () => {
    expect(calendarClient).toBeInstanceOf(CalendarClient);
  });

  it('should export xandikosClient as alias for calendarClient', () => {
    expect(xandikosClient).toBe(calendarClient);
  });

  it('should be the same instance', () => {
    expect(calendarClient === xandikosClient).toBe(true);
  });
});

describe('CalendarClient getETag', () => {
  let client: CalendarClient;

  beforeEach(() => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    client = new CalendarClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send HEAD request', async () => {
    const fn = mockFetch({ headers: { ETag: '"e-123"' } });
    vi.stubGlobal('fetch', fn);
    await client.getETag('uid-1');
    expect(fn.mock.calls[0][1].method).toBe('HEAD');
  });

  it('should return ETag from response', async () => {
    vi.stubGlobal('fetch', mockFetch({ headers: { ETag: '"e-123"' } }));
    const etag = await client.getETag('uid-1');
    expect(etag).toBe('"e-123"');
  });

  it('should return null on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 404, statusText: 'Not Found' }));
    const etag = await client.getETag('uid-1');
    expect(etag).toBeNull();
  });

  it('should return null when no ETag header', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const etag = await client.getETag('uid-1');
    expect(etag).toBeNull();
  });
});

// ===========================================================================
// 13. Constructor DI integration
// ===========================================================================

describe('CalendarClient constructor integration', () => {
  afterEach(() => {
    resetConfig();
    vi.unstubAllGlobals();
  });

  it('should use default baseUrl when nothing configured', () => {
    resetConfig();
    const client = new CalendarClient();
    const fn = mockFetch({ headers: { ETag: '"e"' } });
    vi.stubGlobal('fetch', fn);
    client.getETag('uid');
    // Default is http://xandikos:8000
    expect(fn.mock.calls[0][0]).toContain('http://xandikos:8000');
  });

  it('should use config baseUrl', () => {
    resetConfig();
    configure({ baseUrl: 'http://configured:9000' });
    const client = new CalendarClient();
    const fn = mockFetch({ headers: { ETag: '"e"' } });
    vi.stubGlobal('fetch', fn);
    client.getETag('uid');
    expect(fn.mock.calls[0][0]).toContain('http://configured:9000');
  });

  it('should prefer constructor argument over config', () => {
    resetConfig();
    configure({ baseUrl: 'http://configured:9000' });
    const client = new CalendarClient('http://override:7000');
    const fn = mockFetch({ headers: { ETag: '"e"' } });
    vi.stubGlobal('fetch', fn);
    client.getETag('uid');
    expect(fn.mock.calls[0][0]).toContain('http://override:7000');
  });

  it('should use config calendarPath', async () => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000', calendarPath: '/custom/path/' });
    const client = new CalendarClient();
    const fn = mockFetch({ headers: { ETag: '"e"' } });
    vi.stubGlobal('fetch', fn);
    await client.getETag('uid');
    expect(fn.mock.calls[0][0]).toBe('http://test:8000/custom/path/uid.ics');
  });

  it('should use default calendarPath when not configured', async () => {
    resetConfig();
    configure({ baseUrl: 'http://test:8000' });
    const client = new CalendarClient();
    const fn = mockFetch({ headers: { ETag: '"e"' } });
    vi.stubGlobal('fetch', fn);
    await client.getETag('uid');
    expect(fn.mock.calls[0][0]).toBe('http://test:8000/stonewall/calendars/calendar/uid.ics');
  });
});
