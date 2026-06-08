import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import AdbWebCredentialStore from '@yume-chan/adb-credential-web'
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'
import type { UsbPdaLogArchive } from './usbPdaLogClient'

const remotePdaLogDir = '/sdcard/Android/data/com.microtechmd.pda/cache/pdaLog'
const remotePdaCacheDir = '/sdcard/Android/data/com.microtechmd.pda/cache'
const maxUsbLogBytes = 100 * 1024 * 1024
const recentLogDays = 5

export type WebUsbPdaLogEntry = {
  name: string
  size: number | bigint
}

type WebUsbPdaLogFile = {
  name: string
  blob: Blob
}

type ByteStream = {
  getReader(): {
    read(): Promise<{ done?: boolean; value?: Uint8Array }>
    releaseLock?: () => void
  }
}

export function isWebUsbPdaLogImportAvailable(): boolean {
  return Boolean(AdbDaemonWebUsbDeviceManager.BROWSER)
}

export async function downloadWebUsbPdaLogArchive(): Promise<UsbPdaLogArchive> {
  try {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!manager) {
      throw new Error('当前浏览器不支持 WebUSB，请使用 Chrome/Edge，并确认页面是 HTTPS 或 localhost')
    }

    const device = await manager.requestDevice()
    if (!device) {
      throw new Error('未选择 USB 设备')
    }

    const connection = await device.connect()
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore('Pump Log'),
    })
    const adb = new Adb(transport)

    try {
      const files = await readRecentPdaLogFiles(adb)
      if (files.length === 0) {
        throw new Error('未找到符合条件的 PDA 日志文件（日期日志或 JSON 文件）')
      }

      return {
        blob: await zipWebUsbFiles(files),
        sourceName: createWebUsbExportName(adb.serial),
      }
    } finally {
      await adb.close()
    }
  } catch (error) {
    throw new Error(createWebUsbPdaLogErrorMessage(error), { cause: error })
  }
}

export function selectWebUsbPdaLogEntries(entries: WebUsbPdaLogEntry[], now = new Date()): WebUsbPdaLogEntry[] {
  const allowedNames = new Set(
    Array.from({ length: recentLogDays }, (_, index) => formatLocalDate(addLocalDays(now, -index))),
  )

  return entries
    .filter((entry) => allowedNames.has(entry.name) && Number(entry.size) <= maxUsbLogBytes)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function selectWebUsbJsonEntries(entries: WebUsbPdaLogEntry[]): WebUsbPdaLogEntry[] {
  return entries
    .filter((entry) => /\.json$/i.test(entry.name) && Number(entry.size) <= maxUsbLogBytes)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function createWebUsbExportName(serial: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  return `WEBUSB_MTM_${serial}_${stamp}.zip`
}

export function createWebUsbPdaLogErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/already in use|already in used|devicebusy/i.test(message)) {
    return '设备已被其他程序占用。请关闭 Android Studio、设备管理工具等可能占用 ADB 的程序，并在终端执行 adb kill-server 后重新点击 USB。'
  }

  return message
}

export async function streamToBlob(stream: ByteStream, type = 'application/octet-stream'): Promise<Blob> {
  const reader = stream.getReader()
  const chunks: ArrayBuffer[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const buffer = new ArrayBuffer(value.byteLength)
      new Uint8Array(buffer).set(value)
      chunks.push(buffer)
    }
  } finally {
    reader.releaseLock?.()
  }

  return new Blob(chunks, { type })
}

async function readRecentPdaLogFiles(adb: Adb): Promise<WebUsbPdaLogFile[]> {
  const sync = await adb.sync()

  try {
    const logEntries = selectWebUsbPdaLogEntries(await sync.readdir(remotePdaLogDir))
    const jsonEntries = selectWebUsbJsonEntries(await sync.readdir(remotePdaCacheDir))
    const files: WebUsbPdaLogFile[] = []

    for (const entry of logEntries) {
      files.push({
        name: entry.name,
        blob: await streamToBlob(sync.read(`${remotePdaLogDir}/${entry.name}`), 'text/plain'),
      })
    }

    for (const entry of jsonEntries) {
      files.push({
        name: entry.name,
        blob: await streamToBlob(sync.read(`${remotePdaCacheDir}/${entry.name}`), 'text/plain'),
      })
    }

    return files
  } finally {
    await sync.dispose()
  }
}

async function zipWebUsbFiles(files: WebUsbPdaLogFile[]): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))

  for (const file of files) {
    await writer.add(file.name, new BlobReader(file.blob))
  }

  return await writer.close()
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
