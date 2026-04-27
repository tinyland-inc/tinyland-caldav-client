export class CalDAVConflictError extends Error {
    localEtag;
    remoteEtag;
    constructor(message, localEtag, remoteEtag) {
        super(message);
        this.localEtag = localEtag;
        this.remoteEtag = remoteEtag;
        this.name = 'CalDAVConflictError';
    }
}
