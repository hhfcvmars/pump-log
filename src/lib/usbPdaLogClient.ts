import {
  downloadWebUsbPdaLogArchive,
  isWebUsbPdaLogImportAvailable,
} from './webUsbPdaLogClient'

export type UsbPdaLogArchive = {
  blob: Blob
  sourceName: string
  password?: string
}

const usbPdaLogEndpoint = '/api/usb/pda-log'
const fallbackSourceName = 'EXPORT_MTM_USB_PDA_LOG.zip'
const unavailableMessage = '当前浏览器不支持 WebUSB。请使用 Chrome/Edge，或在本机运行 npm run dev 使用本机 ADB 导入。'

export function isUsbPdaLogImportAvailable(hostname = globalThis.location?.hostname): boolean {
  return isWebUsbPdaLogImportAvailable() || isLocalhost(hostname)
}

export async function downloadUsbPdaLogArchive(hostname?: string): Promise<UsbPdaLogArchive> {
  const local = isLocalhost(hostname)

  if (isWebUsbPdaLogImportAvailable()) {
    try {
      return await downloadWebUsbPdaLogArchive()
    } catch (error) {
      if (!local) {
        throw error
      }
    }
  }

  if (!local) {
    throw new Error(unavailableMessage)
  }

  const response = await fetch(usbPdaLogEndpoint)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return {
    blob: await response.blob(),
    sourceName: getContentDispositionFileName(response.headers.get('content-disposition')) ?? fallbackSourceName,
    password: response.headers.get('x-pda-log-password') ?? undefined,
  }
}

function isLocalhost(hostname = globalThis.location?.hostname): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? `USB 导入失败：HTTP ${response.status}`
  } catch {
    return `USB 导入失败：HTTP ${response.status}`
  }
}

function getContentDispositionFileName(header: string | null): string | undefined {
  if (!header) return undefined

  const quoted = header.match(/filename="([^"]+)"/i)?.[1]
  if (quoted) return quoted

  const plain = header.match(/filename=([^;]+)/i)?.[1]?.trim()
  return plain || undefined
}
