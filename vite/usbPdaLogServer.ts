import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'
import type { Plugin, ViteDevServer } from 'vite'

const execFileAsync = promisify(execFile)

const remotePdaLogDir = '/sdcard/Android/data/com.microtechmd.pda/cache/pdaLog'
const remotePdaCacheDir = '/sdcard/Android/data/com.microtechmd.pda/cache'
const usbRoute = '/api/usb/pda-log'
const maxUsbLogBytes = 100 * 1024 * 1024
const recentLogDays = 5

type AdbDevice = {
  serial: string
  state: string
  product?: string
  model?: string
}

export type PasswordInfo = {
  archiveName?: string
  serialNumber?: string
  version?: string
  password?: string
}

type ExportResult = {
  fileName: string
  password?: string
  buffer: Buffer
}

export type RemoteDateLogEntry = {
  name: string
  size: number
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial = '', state = ''] = line.split(/\s+/, 3)
      return {
        serial,
        state,
        product: matchAdbField(line, 'product'),
        model: matchAdbField(line, 'model'),
      }
    })
    .filter((device) => device.serial)
}

export function createUsbExportName(serial: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  return `EXPORT_MTM_${serial}_${stamp}.zip`
}

export function parsePasswordInfo(text: string): PasswordInfo {
  return {
    archiveName: matchInfoLine(text, '压缩包文件'),
    serialNumber: matchInfoLine(text, 'PDA序列号'),
    version: matchInfoLine(text, '应用版本'),
    password: matchInfoLine(text, '压缩包密码'),
  }
}

export function parseRemoteZipList(output: string): string[] {
  if (/No such file|not found/i.test(output)) {
    return []
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.zip$/i.test(line))
}

export function parseRemoteDateLogEntries(output: string): RemoteDateLogEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^-[-\w]+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(\d{4}-\d{2}-\d{2})$/)
      if (!match) return undefined
      return {
        size: Number(match[1]),
        name: match[2],
      }
    })
    .filter((entry): entry is RemoteDateLogEntry => Boolean(entry))
}

export function selectRecentDateLogs(entries: RemoteDateLogEntry[], now = new Date()): RemoteDateLogEntry[] {
  const allowedNames = new Set(
    Array.from({ length: recentLogDays }, (_, index) => formatLocalDate(addLocalDays(now, -index))),
  )

  return entries
    .filter((entry) => allowedNames.has(entry.name) && entry.size <= maxUsbLogBytes)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function parseRemoteJsonEntries(output: string): RemoteDateLogEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^-[-\w]+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+\.json)$/i)
      if (!match) return undefined
      return {
        size: Number(match[1]),
        name: match[2],
      }
    })
    .filter((entry): entry is RemoteDateLogEntry => Boolean(entry))
}

export function selectRemoteLogJsons(entries: RemoteDateLogEntry[]): RemoteDateLogEntry[] {
  return entries
    .filter((entry) => entry.size <= maxUsbLogBytes)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function usbPdaLogPlugin(): Plugin {
  return {
    name: 'pump-log-usb-pda-log',
    configureServer(server) {
      registerUsbPdaLogRoute(server)
    },
  }
}

function registerUsbPdaLogRoute(server: ViteDevServer) {
  server.middlewares.use(usbRoute, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'USB 导入仅支持 GET 请求' })
      return
    }

    try {
      const result = await exportPdaLog()
      res.statusCode = 200
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-length', String(result.buffer.byteLength))
      res.setHeader('content-disposition', `attachment; filename="${result.fileName}"`)
      if (result.password) {
        res.setHeader('x-pda-log-password', result.password)
      }
      res.end(result.buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 503, { error: message })
    }
  })
}

async function exportPdaLog(): Promise<ExportResult> {
  const device = await getSingleAuthorizedDevice()
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pump-log-usb-'))
  const dateLogEntries = await listRecentRemoteDateLogs(device.serial)
  const jsonEntries = await listRemoteJsonLogs(device.serial)

  if (dateLogEntries.length === 0 && jsonEntries.length === 0) {
    throw new Error('未找到符合条件的 PDA 日志文件（日期日志或 JSON 文件）')
  }

  const localFiles: string[] = []

  for (const entry of dateLogEntries) {
    const localPath = path.join(tempRoot, entry.name)
    await runAdb(['-s', device.serial, 'pull', `${remotePdaLogDir}/${entry.name}`, localPath])
    localFiles.push(localPath)
  }

  for (const entry of jsonEntries) {
    const localPath = path.join(tempRoot, entry.name)
    await runAdb(['-s', device.serial, 'pull', `${remotePdaCacheDir}/${entry.name}`, localPath])
    localFiles.push(localPath)
  }

  return {
    fileName: createUsbExportName(device.serial),
    buffer: await zipFiles(tempRoot, localFiles),
  }
}

async function getSingleAuthorizedDevice(): Promise<AdbDevice> {
  const { stdout } = await runAdb(['devices', '-l'])
  const devices = parseAdbDevices(stdout)
  const authorized = devices.filter((device) => device.state === 'device')

  if (authorized.length === 1) {
    return authorized[0]
  }

  if (authorized.length > 1) {
    throw new Error(`检测到多个已授权 ADB 设备，请先只连接一台 PDA：${authorized.map((device) => device.serial).join(', ')}`)
  }

  if (devices.some((device) => device.state === 'unauthorized')) {
    throw new Error('检测到未授权的 ADB 设备，请在 PDA 上允许 USB 调试后重试')
  }

  throw new Error('未检测到已授权的 ADB 设备，请确认 PDA 已连接且 USB 调试已打开')
}

async function runAdb(args: string[]) {
  try {
    return await execFileAsync('adb', args, {
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ENOENT')) {
      throw new Error('未找到 adb，请确认 Android platform-tools 已安装并加入 PATH', { cause: error })
    }
    throw new Error(`ADB 执行失败：${message}`, { cause: error })
  }
}

async function listRecentRemoteDateLogs(serial: string): Promise<RemoteDateLogEntry[]> {
  try {
    const { stdout } = await runAdb(['-s', serial, 'shell', 'ls', '-la', remotePdaLogDir])
    return selectRecentDateLogs(parseRemoteDateLogEntries(stdout))
  } catch {
    return []
  }
}

async function listRemoteJsonLogs(serial: string): Promise<RemoteDateLogEntry[]> {
  try {
    const { stdout } = await runAdb(['-s', serial, 'shell', 'ls', '-la', remotePdaCacheDir])
    return selectRemoteLogJsons(parseRemoteJsonEntries(stdout))
  } catch {
    return []
  }
}

async function zipFiles(baseDir: string, filePaths: string[]): Promise<Buffer> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))

  for (const filePath of filePaths) {
    const entryName = path.relative(baseDir, filePath).split(path.sep).join('/')
    const data = await fs.readFile(filePath)
    await writer.add(entryName, new BlobReader(new Blob([data])))
  }

  const blob = await writer.close()
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

function matchAdbField(line: string, field: string): string | undefined {
  const match = line.match(new RegExp(`\\b${field}:(.*?)(?=\\s+\\w+:|$)`))
  return match?.[1]?.trim()
}

function matchInfoLine(text: string, label: string): string | undefined {
  return text.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'))?.[1]?.trim()
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sendJson(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
