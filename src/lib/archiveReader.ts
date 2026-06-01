import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { isTextLikePath, type RawArchiveEntry } from './logBundle'

const maxPreviewBytes = 30 * 1024 * 1024

export type ReadArchiveOptions = {
  password: string
}

export type ProgressCallback = (progress: {
  phase: 'download' | 'extract'
  current: number
  total: number
  fileName?: string
}) => void

export async function downloadArchive(
  url: string,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const fetchUrl = rewriteForProxy(url)

  try {
    const response = await fetch(fetchUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0

    if (!total || !response.body) {
      return await response.blob()
    }

    const reader = response.body.getReader()
    const chunks: ArrayBuffer[] = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = new Uint8Array(value.byteLength)
      chunk.set(value)
      chunks.push(chunk.buffer)
      received += value.length
      onProgress?.({ phase: 'download', current: received, total })
    }

    return new Blob(chunks)
  } catch (error) {
    throw new Error(createDownloadErrorMessage(url, error), { cause: error })
  }
}

export async function readArchive(
  blob: Blob,
  options: ReadArchiveOptions,
  onProgress?: ProgressCallback,
): Promise<RawArchiveEntry[]> {
  if (!options.password) {
    throw new Error('请输入 zip 密码后再解析日志')
  }

  const reader = new ZipReader(new BlobReader(blob))

  try {
    const entries = await reader.getEntries()
    const files: RawArchiveEntry[] = []
    const total = entries.filter((e) => !e.directory).length

    for (const entry of entries) {
      if (entry.directory) {
        continue
      }

      const path = entry.filename
      const size = entry.uncompressedSize
      const shouldPreview = isTextLikePath(path)
      const truncated = shouldPreview && size > maxPreviewBytes
      let text: string | undefined

      onProgress?.({
        phase: 'extract',
        current: files.length + 1,
        total,
        fileName: path,
      })

      let data: Blob | undefined

      try {
        const entryBlob = await entry.getData(new BlobWriter(), {
          password: options.password,
        })
        data = entryBlob

        if (shouldPreview) {
          if (truncated) {
            text = await entryBlob.slice(0, maxPreviewBytes).text()
          } else {
            text = await entryBlob.text()
          }
        }
      } catch (error) {
        throw new Error(createArchiveErrorMessage(error, options.password), {
          cause: error,
        })
      }

      files.push({
        path,
        size,
        lastModified: entry.lastModDate,
        text,
        truncated,
        data,
      })
    }

    return files
  } finally {
    await reader.close()
  }
}

export function createDownloadErrorMessage(url: string, error?: unknown): string {
  const reason = error instanceof Error ? error.message : '浏览器无法完成下载'

  return `远程日志下载失败：${reason}。如果这是浏览器跨域限制，请先手动下载 zip 后用本地导入。URL：${url}`
}

function createArchiveErrorMessage(error: unknown, password: string): string {
  const reason = error instanceof Error ? error.message : String(error)

  return `解压失败：${reason}。请确认密码 ${password} 是否正确，或该 zip 加密格式是否受浏览器解析库支持。`
}

function rewriteForProxy(url: string): string {
  if (typeof window === 'undefined') return url
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  if (!isDev) return url

  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'd3ci4jgewizada.cloudfront.net') {
      return `/api/download${parsed.pathname}${parsed.search}`
    }
  } catch {
    // not a valid URL, return as-is
  }

  return url
}
