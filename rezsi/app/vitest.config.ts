import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts'],
    environment: 'node',
    // Reminder and calendar logic is written against Europe/Budapest explicitly;
    // run tests in UTC to catch accidental reliance on the host time zone.
    env: { TZ: 'UTC' },
  },
});
