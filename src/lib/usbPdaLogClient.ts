export type UsbPdaLogArchive = {
  blob: Blob
  sourceName: string
  password?: string
}

const usbPdaLogEndpoint = '/api/usb/pda-log'
const fallbackSourceName = 'EXPORT_MTM_USB_PDA_LOG.zip'

export async function downloadUsbPdaLogArchive(): Promise<UsbPdaLogArchive> {
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
