export type RawArchiveEntry = {
  path: string
  size: number
  lastModified?: Date
  text?: string
  truncated?: boolean
  data?: Blob
}

export type CreateLogBundleInput = {
  sourceName: string
  password: string
  serialNumber?: string
  version?: string
  entries: RawArchiveEntry[]
}

export type LogEntry = {
  id: string
  path: string
  name: string
  extension: string
  size: number
  displaySize: string
  lastModified?: Date
  typeLabel: string
  canPreview: boolean
  text?: string
  truncated: boolean
  data?: Blob
}

export type LogBundle = {
  id: string
  sourceName: string
  password: string
  serialNumber?: string
  version?: string
  importedAt: Date
  entries: LogEntry[]
}

export type TextStats = {
  lineCount: number
  characterCount: number
}

const textExtensions = new Set([
  'cfg',
  'conf',
  'csv',
  'json',
  'log',
  'md',
  'properties',
  'text',
  'txt',
  'xml',
])

const binaryExtensions = new Set([
  '7z',
  'bin',
  'db',
  'gif',
  'gz',
  'jpg',
  'jpeg',
  'pdf',
  'png',
  'sqlite',
  'tar',
  'webp',
  'zip',
])

export function createLogBundle(input: CreateLogBundleInput): LogBundle {
  const entries = input.entries
    .map((entry) => normalizeEntry(entry))
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))

  return {
    id: `${input.sourceName}-${Date.now()}`,
    sourceName: input.sourceName,
    password: input.password,
    serialNumber: input.serialNumber,
    version: input.version,
    importedAt: new Date(),
    entries,
  }
}

export function isTextLikePath(path: string): boolean {
  const extension = getExtension(path)

  if (!extension) {
    return true
  }

  if (binaryExtensions.has(extension)) {
    return false
  }

  return textExtensions.has(extension)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024)} KB`
  }

  return `${formatNumber(bytes / 1024 / 1024)} MB`
}

export function filterEntries(entries: LogEntry[], query: string): LogEntry[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return entries
  }

  return entries.filter((entry) =>
    `${entry.path} ${entry.name}`.toLowerCase().includes(normalizedQuery),
  )
}

export function getTextStats(text?: string): TextStats {
  if (!text) {
    return {
      lineCount: 0,
      characterCount: 0,
    }
  }

  return {
    lineCount: text.split(/\r\n|\r|\n/).length,
    characterCount: text.length,
  }
}

function normalizeEntry(entry: RawArchiveEntry): LogEntry {
  const path = entry.path.replace(/^\/+/, '')
  const name = path.split('/').filter(Boolean).at(-1) ?? path
  const extension = getExtension(name)
  const canPreview = typeof entry.text === 'string' || isTextLikePath(path)

  return {
    id: path,
    path,
    name,
    extension,
    size: entry.size,
    displaySize: formatFileSize(entry.size),
    lastModified: entry.lastModified,
    typeLabel: getTypeLabel(extension, canPreview),
    canPreview,
    text: entry.text,
    truncated: Boolean(entry.truncated),
    data: entry.data,
  }
}

function getExtension(path: string): string {
  const fileName = path.split('/').filter(Boolean).at(-1) ?? path
  const dotIndex = fileName.lastIndexOf('.')

  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return ''
  }

  return fileName.slice(dotIndex + 1).toLowerCase()
}

function getTypeLabel(extension: string, canPreview: boolean): string {
  if (!canPreview) {
    return '二进制/未知'
  }

  if (extension === 'log') {
    return '日志'
  }

  if (extension === 'json') {
    return 'JSON'
  }

  if (extension === 'xml') {
    return 'XML'
  }

  return '文本'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
