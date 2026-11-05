import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Stage tests spawn real Git repositories and foreground check processes.
    testTimeout: 20000,
    coverage: { reporter: ['text'] }
  }
})
