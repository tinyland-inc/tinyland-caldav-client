import type { CalendarEvent, CalDAVSyncResult, Change, EventFilters } from '@tummycrypt/tinyland-calendar';
export interface CalDAVSyncResultInternal {
    success: boolean;
    etag?: string;
    syncToken?: string;
    changes?: Change[];
    error?: string;
    skipped?: boolean;
}
export declare class CalendarClient {
    private baseUrl;
    private calendarPath;
    private listTimeout;
    private queryTimeout;
    private syncTimeout;
    constructor(baseUrl?: string);
    createEvent(event: Partial<CalendarEvent>): Promise<string>;
    createEventWithETag(event: Partial<CalendarEvent>): Promise<{
        uid: string;
        etag?: string;
    }>;
    updateEvent(uid: string, event: Partial<CalendarEvent>): Promise<string | undefined>;
    deleteEvent(uid: string): Promise<void>;
    getEvent(uid: string): Promise<CalendarEvent | null>;
    listEvents(): Promise<CalendarEvent[]>;
    queryEvents(filters?: EventFilters): Promise<CalendarEvent[]>;
    getSyncToken(): Promise<string | null>;
    syncCollection(syncToken?: string): Promise<CalDAVSyncResult>;
    getETag(uid: string): Promise<string | null>;
}
export declare const calendarClient: CalendarClient;
export declare const xandikosClient: CalendarClient;
//# sourceMappingURL=calendar-client.d.ts.map