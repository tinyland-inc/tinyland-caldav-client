import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tinyland-caldav-client',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
