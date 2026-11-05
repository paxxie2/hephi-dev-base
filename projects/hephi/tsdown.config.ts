import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    tools: 'src/tools.ts',
    cli: 'src/cli.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
