import type { CalendarEvent } from '@tummycrypt/tinyland-calendar';
import type { CalDAVSyncResultInternal } from './calendar-client.js';
export declare function extractHrefsFromPropfind(xmlText: string): string[];
export declare function parseCalendarQueryResponse(xmlText: string, baseUrl: string): CalendarEvent[];
export declare function buildCalendarQueryXml(filters: {
    from?: string;
    to?: string;
} | undefined, formatDateTime: (date: Date) => string): string;
export declare function buildSyncCollectionXml(syncToken?: string): string;
export declare function parseSyncCollectionResponse(xmlText: string): CalDAVSyncResultInternal;
//# sourceMappingURL=xml-utils.d.ts.map