let _config = {};
export function configure(config) {
    _config = { ..._config, ...config };
}
export function getConfig() {
    return { ..._config };
}
export function resetConfig() {
    _config = {};
}
