#!/usr/bin/env node
import { prepareActivation } from './control/activation.js'

const command = process.argv[2]
if (command !== 'prepare') {
  console.error('usage: hephi prepare')
  process.exitCode = 2
} else {
  try {
    const result = await prepareActivation()
    if (result.enabled) console.log(`HEPHI activation written to ${result.filePath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
