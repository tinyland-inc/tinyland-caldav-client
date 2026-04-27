export function escapeText(text) {
    const str = String(text || '');
    return str
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}
export function unescapeText(text) {
    return text
        .replace(/\\n/g, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}
export function formatDateTime(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
export function parseDateTime(value) {
    if (value.length === 8) {
        return `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
    }
    else {
        const year = value.substring(0, 4);
        const month = value.substring(4, 6);
        const day = value.substring(6, 8);
        const hour = value.substring(9, 2 + 9);
        const minute = value.substring(11, 2 + 11);
        const second = value.substring(13, 2 + 13);
        return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }
}
export function generateICalData(event) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Tinyland.dev//Event Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${event.uid}`,
        `DTSTAMP:${formatDateTime(new Date())}`,
        `CREATED:${formatDateTime(event.createdAt ? new Date(event.createdAt) : new Date())}`,
        `LAST-MODIFIED:${formatDateTime(event.updatedAt ? new Date(event.updatedAt) : new Date())}`,
        `SUMMARY:${escapeText(event.title || 'Untitled Event')}`,
    ];
    if (event.description) {
        lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
        lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.dtstart) {
        lines.push(`DTSTART:${formatDateTime(new Date(event.dtstart))}`);
    }
    if (event.dtend) {
        lines.push(`DTEND:${formatDateTime(new Date(event.dtend))}`);
    }
    if (event.organizer) {
        lines.push(`ORGANIZER:${escapeText(event.organizer)}`);
    }
    if (event.categories && event.categories.length > 0) {
        lines.push(`CATEGORIES:${event.categories.map((cat) => escapeText(cat)).join(',')}`);
    }
    if (event.registrationUrl) {
        lines.push(`URL:${event.registrationUrl}`);
    }
    if (event.rrule) {
        lines.push(`RRULE:${event.rrule}`);
    }
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}
export function parseICalData(icalData) {
    const lines = icalData.split(/\r?\n/);
    const event = {};
    for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':');
        switch (key) {
            case 'UID':
                event.uid = value;
                break;
            case 'SUMMARY':
                event.title = unescapeText(value);
                break;
            case 'DESCRIPTION':
                event.description = unescapeText(value);
                break;
            case 'LOCATION':
                event.location = unescapeText(value);
                break;
            case 'DTSTART':
                event.dtstart = parseDateTime(value);
                break;
            case 'DTEND':
                event.dtend = parseDateTime(value);
                break;
            case 'CREATED':
                event.createdAt = parseDateTime(value);
                break;
            case 'LAST-MODIFIED':
                event.updatedAt = parseDateTime(value);
                break;
            case 'ORGANIZER':
                event.organizer = unescapeText(value);
                break;
            case 'CATEGORIES':
                event.categories = value.split(',').map((cat) => unescapeText(cat.trim()));
                break;
            case 'URL':
                if (!event.registrationUrl)
                    event.registrationUrl = value;
                break;
            case 'RRULE':
                event.rrule = value;
                break;
        }
    }
    return event;
}
