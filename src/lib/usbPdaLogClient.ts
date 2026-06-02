export type UsbPdaLogArchive = {
  blob: Blob
  sourceName: string
  password?: string
}

const usbPdaLogEndpoint = '/api/usb/pda-log'
const fallbackSourceName = 'EXPORT_MTM_USB_PDA_LOG.zip'
const localOnlyMessage = 'USB 导入仅支持在本机运行 npm run dev 时使用。Vercel 部署在云端，无法访问你电脑上的 USB/ADB 设备。'

export function isUsbPdaLogImportAvailable(hostname = globalThis.location?.hostname): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export async function downloadUsbPdaLogArchive(hostname?: string): Promise<UsbPdaLogArchive> {
  if (!isUsbPdaLogImportAvailable(hostname)) {
    throw new Error(localOnlyMessage)
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
