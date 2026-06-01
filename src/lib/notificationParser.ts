export type ArchiveMetadata = {
  fileName: string
  serialNumber?: string
  version?: string
  password: string
}

export type ParsedNotification =
  | (ArchiveMetadata & {
      uploadedAt?: string
      urlPath: string
      error?: never
    })
  | {
      error: string
      uploadedAt?: string
      fileName?: string
      urlPath?: string
      serialNumber?: string
      version?: string
      password?: string
    }

const fileNamePattern = /fileName:\s*(.+?)(?:,\s*urlPath:|$)/i
const urlPattern = /urlPath:\s*(\S+)/i
const uploadTimePattern = /\[vcs\](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i
const serialPattern = /(?:^|[_\s-])(D\d{4,})(?:[_\s.-]|$)/i
const versionPattern = /version(\d+(?:\.\d+)+)/i

export function parseUploadNotification(text: string): ParsedNotification {
  const uploadedAt = text.match(uploadTimePattern)?.[1]
  const fileName = text.match(fileNamePattern)?.[1]?.trim()
  const urlPath = text.match(urlPattern)?.[1]?.trim()

  if (!fileName) {
    return { error: '未找到 fileName 字段', uploadedAt, urlPath }
  }

  if (!urlPath) {
    return { error: '未找到 urlPath 字段', uploadedAt, fileName }
  }

  return {
    ...inferArchiveMetadata(fileName),
    uploadedAt,
    urlPath,
  }
}

export function inferArchiveMetadata(fileName: string): ArchiveMetadata {
  const normalizedFileName = normalizeArchiveFileName(fileName)
  const serialNumber = normalizedFileName.match(serialPattern)?.[1]?.toUpperCase()
  const version = normalizedFileName.match(versionPattern)?.[1]

  return {
    fileName: normalizedFileName,
    serialNumber,
    version,
    password: buildPassword(serialNumber),
  }
}

export function buildPassword(serialNumber?: string): string {
  return serialNumber ? `PDA_${serialNumber}` : ''
}

function normalizeArchiveFileName(fileName: string): string {
  try {
    return decodeURIComponent(fileName.replace(/\+/g, ' ')).trim()
  } catch {
    return fileName.replace(/\+/g, ' ').trim()
  }
}
