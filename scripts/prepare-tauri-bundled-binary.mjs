function parseArgs(argv) {
  let target = null

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--target') {
      target = argv[index + 1] ?? null
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${current}`)
  }

  if (!target) {
    throw new Error('Missing --target')
  }

  return { target }
}

async function main() {
  const { target } = parseArgs(process.argv.slice(2))
  console.log(`[prepare-tauri-bundled-binary] No extra bundled binary required for ${target}`)
}

main().catch((error) => {
  console.error(`[prepare-tauri-bundled-binary] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
