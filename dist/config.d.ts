export interface CalDAVClientConfig {
    baseUrl?: string;
    calendarPath?: string;
    listTimeout?: number;
    queryTimeout?: number;
    syncTimeout?: number;
}
export declare function configure(config: Partial<CalDAVClientConfig>): void;
export declare function getConfig(): CalDAVClientConfig;
export declare function resetConfig(): void;
//# sourceMappingURL=config.d.ts.map