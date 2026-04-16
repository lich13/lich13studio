import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--')
  const optionArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv
  const commandArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : []

  let arch = os.arch() === 'arm64' ? 'arm64' : 'x64'
  let hostArch = arch

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i]
    if (arg === '--arch') {
      arch = optionArgs[i + 1]
      i += 1
      continue
    }
    if (arg === '--host-arch') {
      hostArch = optionArgs[i + 1]
      i += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (commandArgs.length === 0) {
    throw new Error(
      'Missing command. Usage: node scripts/run-in-vsdevcmd.mjs [--arch x64] [--host-arch x64] -- <command> [args...]'
    )
  }

  return { arch, commandArgs, hostArch }
}

function resolveVsWherePath() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
}

function findVsInstallationPath() {
  const envCandidates = [process.env.VSINSTALLDIR, process.env.VCINSTALLDIR]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))

  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  const vsWherePath = resolveVsWherePath()
  if (!fs.existsSync(vsWherePath)) {
    return null
  }

  const installationPath = execFileSync(
    vsWherePath,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath'
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }
  ).trim()

  return installationPath || null
}

function resolveDevCmdPath() {
  const installationPath = findVsInstallationPath()
  const directCandidates = [
    process.env.VSCMD_BAT,
    installationPath ? path.join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat') : null,
    installationPath ? path.join(installationPath, 'Common7', 'Tools', 'LaunchDevCmd.bat') : null,
    'C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat',
    'C:\\BuildTools\\Common7\\Tools\\LaunchDevCmd.bat'
  ].filter(Boolean)

  for (const candidate of directCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    'Unable to locate VsDevCmd.bat. Install Visual Studio Build Tools with the C++ workload, or set VSCMD_BAT to the batch file path.'
  )
}

function loadVsDevCmdEnvironment({ arch, hostArch }) {
  const devCmdPath = resolveDevCmdPath()
  const command = `call "${devCmdPath}" -no_logo -host_arch=${hostArch} -arch=${arch} >nul && set`
  const result = spawnSync('cmd.exe', ['/d', '/c', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VSCMD_SKIP_SENDTELEMETRY: '1'
    },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: true
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr || `Failed to load Visual Studio developer environment (exit code ${result.status ?? 'unknown'})`
    )
  }
  const output = result.stdout

  const env = { ...process.env }
  for (const line of output.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }
    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)
    env[key] = value
  }

  return env
}

function runCommand(commandArgs, env) {
  const [command, ...args] = commandArgs
  const child = spawn(command, args, {
    env,
    shell: false,
    stdio: 'inherit',
    windowsHide: false
  })

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}

const { arch, commandArgs, hostArch } = parseArgs(process.argv.slice(2))
const env = process.platform === 'win32' ? loadVsDevCmdEnvironment({ arch, hostArch }) : process.env
runCommand(commandArgs, env)
