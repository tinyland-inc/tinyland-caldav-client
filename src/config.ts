






export interface CalDAVClientConfig {
  
  baseUrl?: string;
  
  calendarPath?: string;
  
  listTimeout?: number;
  
  queryTimeout?: number;
  
  syncTimeout?: number;
}

let _config: CalDAVClientConfig = {};





export function configure(config: Partial<CalDAVClientConfig>): void {
  _config = { ..._config, ...config };
}




export function getConfig(): CalDAVClientConfig {
  return { ..._config };
}




export function resetConfig(): void {
  _config = {};
}
