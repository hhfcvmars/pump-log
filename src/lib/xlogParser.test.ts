import { describe, expect, it } from 'vitest'
import { isXLogByExtension, isXLogByMagic, parseXLog } from './xlogParser'

// ---------------------------------------------------------------------------
// Helpers – build synthetic xlog binary data for round-trip tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal xlog file buffer (magic 0x03, one compressed block).
 */
async function buildXLogFixture(logLines: string[]): Promise<Uint8Array> {
  const rawText = logLines.join('\0') + '\0'
  const rawBytes = new TextEncoder().encode(rawText)

  // zlib-compress the raw bytes.
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()

  const writePromise = writer.write(rawBytes).then(() => writer.close())

  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  await writePromise

  const compressed = concatUint8Arrays(chunks)

  // Assemble header: magic(0x03) + seq(0) + beginHour(0) + endHour(23)
  const header = new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x17])

  // Body: 2-byte length LE + compressed data
  const lenPrefix = new Uint8Array(2)
  lenPrefix[0] = compressed.length & 0xff
  lenPrefix[1] = (compressed.length >> 8) & 0xff

  return concatUint8Arrays([header, lenPrefix, compressed])
}

async function buildMarsNoCryptRecord(
  magic: number,
  payload: string,
  options: { compressed?: boolean } = {},
): Promise<Uint8Array> {
  const payloadBytes = new TextEncoder().encode(payload)
  const body = options.compressed ? await deflateRaw(payloadBytes) : payloadBytes
  const header = new Uint8Array(73)

  header[0] = magic
  header[1] = 0x01 // sequence, LE
  header[3] = 10 // begin hour
  header[4] = 10 // end hour
  header[5] = body.length & 0xff
  header[6] = (body.length >> 8) & 0xff
  header[7] = (body.length >> 16) & 0xff
  header[8] = (body.length >> 24) & 0xff

  const config = new TextEncoder().encode(
    'log_appenderOpen__Lcom_tencent_mars_xlog_Xlog_00024XLogConfig_2',
  )
  header.set(toArrayBufferBytes(config).slice(0, 64), 9)

  return concatUint8Arrays([header, body, new Uint8Array([0x00])])
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()
  const input = toArrayBufferBytes(data)

  const writePromise = writer.write(input).then(() => writer.close())
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  await writePromise

  return concatUint8Arrays(chunks)
}

function toArrayBufferBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(data.length))
  result.set(data)
  return result
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isXLogByMagic', () => {
  it('returns false for empty buffers', () => {
    expect(isXLogByMagic(new Uint8Array(0))).toBe(false)
  })

  it('detects known magic bytes', () => {
    expect(isXLogByMagic(new Uint8Array([0x03]))).toBe(true)
    expect(isXLogByMagic(new Uint8Array([0x04]))).toBe(true)
    expect(isXLogByMagic(new Uint8Array([0x07]))).toBe(true)
    expect(isXLogByMagic(new Uint8Array([0x09]))).toBe(true)
  })

  it('rejects unknown magic bytes', () => {
    expect(isXLogByMagic(new Uint8Array([0x00]))).toBe(false)
    expect(isXLogByMagic(new Uint8Array([0xff]))).toBe(false)
    expect(isXLogByMagic(new Uint8Array([0x01]))).toBe(false)
  })
})

describe('isXLogByExtension', () => {
  it('recognises .xlog files', () => {
    expect(isXLogByExtension('log_20260521.xlog')).toBe(true)
    expect(isXLogByExtension('path/to/file.XLOG')).toBe(true)
    expect(isXLogByExtension('data.mars')).toBe(true)
  })

  it('rejects other extensions', () => {
    expect(isXLogByExtension('main.log')).toBe(false)
    expect(isXLogByExtension('dump.txt')).toBe(false)
    expect(isXLogByExtension('noextension')).toBe(false)
  })
})

describe('parseXLog', () => {
  it('rejects files smaller than the xlog header', async () => {
    await expect(parseXLog(new Uint8Array([0x03]))).rejects.toThrow('不是有效的 xlog 格式')
  })

  it('rejects files with unknown magic', async () => {
    const buf = new Uint8Array(10)
    buf[0] = 0xff
    await expect(parseXLog(buf)).rejects.toThrow('未识别的 xlog magic')
  })

  it('rejects zstd-compressed xlog files', async () => {
    const buf = new Uint8Array(10)
    buf[0] = 0x05
    await expect(parseXLog(buf)).rejects.toThrow('Zstd 压缩')
  })

  it('round-trips a single log line', async () => {
    const fixture = await buildXLogFixture([
      '2026-05-21 11:46:00.123 V|12345,67890|App|设备初始化完成',
    ])

    const text = await parseXLog(fixture)

    expect(text).toContain('设备初始化完成')
    expect(text).toContain('2026-05-21')
  })

  it('round-trips multiple log lines', async () => {
    const lines = [
      '2026-05-21 11:46:00.123 V|1,2|TagA|line one',
      '2026-05-21 11:46:01.456 D|1,2|TagB|line two',
      '2026-05-21 11:46:02.789 I|1,2|TagC|line three',
    ]

    const fixture = await buildXLogFixture(lines)
    const text = await parseXLog(fixture)

    expect(text.split('\n').length).toBe(3)
    expect(text).toContain('line one')
    expect(text).toContain('line two')
    expect(text).toContain('line three')
  })

  it('handles multi-block fixtures', async () => {
    // Build two blocks and concatenate them in a single file.
    const block1 = await buildXLogFixture(['block one entry'])
    const block2 = await buildXLogFixture(['block two entry'])

    // Strip headers from block2; we only want its body (length + compressed).
    const headerSize = 5
    const block2Body = block2.slice(headerSize)

    const combined = concatUint8Arrays([block1, block2Body])
    const text = await parseXLog(combined)

    expect(text).toContain('block one entry')
    expect(text).toContain('block two entry')
  })

  it('parses Mars 1.2.5 no-crypt records with mmap markers', async () => {
    const compressed = await buildMarsNoCryptRecord(
      0x09,
      [
        '^^^^^^^^^^Oct 14 2020^^^14:55:33^^^^^^^^^^[19866,19866][2026-05-20 +0800 10:30:00]',
        'log appender mode:0, use mmap:1',
        '2026-05-20 10:30:01.123 I|19866,19866|Pump|mars xlog decoded',
      ].join('\n'),
      { compressed: true },
    )
    const mmapMarker = await buildMarsNoCryptRecord(0x08, '~~~~~ begin of mmap ~~~~~\n')
    const fixture = concatUint8Arrays([compressed, mmapMarker])

    const text = await parseXLog(fixture)

    expect(text).toContain('mars xlog decoded')
    expect(text).toContain('~~~~~ begin of mmap ~~~~~')
  })
})
