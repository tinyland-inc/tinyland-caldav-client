/**
 * CalDAV Conflict Error
 *
 * Thrown when an ETag mismatch occurs during optimistic locking (HTTP 412).
 */
export class CalDAVConflictError extends Error {
  constructor(
    message: string,
    public localEtag?: string,
    public remoteEtag?: string
  ) {
    super(message);
    this.name = 'CalDAVConflictError';
  }
}
