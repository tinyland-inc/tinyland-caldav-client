import type { CalendarEvent } from '@tummycrypt/tinyland-calendar';
export declare function escapeText(text: string | unknown): string;
export declare function unescapeText(text: string): string;
export declare function formatDateTime(date: Date): string;
export declare function parseDateTime(value: string): string;
export declare function generateICalData(event: Partial<CalendarEvent>): string;
export declare function parseICalData(icalData: string): CalendarEvent;
//# sourceMappingURL=ical-utils.d.ts.map