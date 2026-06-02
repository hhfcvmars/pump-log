import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { isTextLikePath, type RawArchiveEntry } from './logBundle'
import { isXLogByExtension, isXLogByMagic, parseXLog } from './xlogParser'

const maxPreviewBytes = 100 * 1024 * 1024

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
  // Allow empty password for unencrypted zips (e.g. vcs/cgms archives).
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
            const slice = entryBlob.slice(0, maxPreviewBytes)
            text = await tryParseXLog(path, slice)
          } else {
            text = await tryParseXLog(path, entryBlob)
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

/**
 * Attempt to parse a blob as xlog.  Falls back to reading as plain text when
 * the blob is not a recognised xlog file.
 */
async function tryParseXLog(path: string, blob: Blob): Promise<string> {
  const suspect = isXLogByExtension(path)

  if (!suspect) {
    // No xlog extension – skip the magic check unless the file is small.
    if (blob.size > 256 * 1024) {
      return blob.text()
    }
  }

  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)

  if (!isXLogByMagic(bytes)) {
    return blob.text()
  }

  try {
    return await parseXLog(bytes)
  } catch (xlogError) {
    const reason = xlogError instanceof Error ? xlogError.message : String(xlogError)
    const raw = await blob.text()
    return `[⚠ xlog 解析失败] ${reason}\n\n--- 以下为文件原始内容（可能为二进制乱码）---\n\n${raw}`
  }
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
    if (parsed.hostname === 'static.pancares.com') {
      return `/api/pancares-download${parsed.pathname}${parsed.search}`
    }
  } catch {
    // not a valid URL, return as-is
  }

  return url
}
