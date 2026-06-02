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
const serialPattern = /(?:^|[_\s-])(D\d{3,}[A-Z]?\d*)(?:[_\s.-]|$)/i
const versionPattern = /(?:version|_)(\d+(?:\.\d+)+)(?=[_.-]|$)/i

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
    ...inferArchiveMetadata(fileName, urlPath),
    uploadedAt,
    urlPath,
  }
}

export function inferArchiveMetadata(fileName: string, sourcePath = fileName): ArchiveMetadata {
  const normalizedFileName = normalizeArchiveFileName(fileName)
  const normalizedSourcePath = normalizeArchiveFileName(sourcePath)
  const serialNumber = normalizedFileName.match(serialPattern)?.[1]?.toUpperCase()
  const version = normalizedFileName.match(versionPattern)?.[1]
  const needsPassword = /(PDA_MTM|EXPORT_MTM)/i.test(`${normalizedFileName} ${normalizedSourcePath}`)

  return {
    fileName: normalizedFileName,
    serialNumber,
    version,
    password: needsPassword ? buildPassword(serialNumber) : '',
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
