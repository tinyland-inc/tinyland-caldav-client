




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
