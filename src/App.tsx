import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  downloadArchive,
  readArchive,
  type ProgressCallback,
} from './lib/archiveReader'
import { getXLogTextDownloadName } from './lib/downloadName'
import { isXLogByMagic, parseXLog } from './lib/xlogParser'
import {
  createLogBundle,
  filterEntries,
  type LogBundle,
  type LogEntry,
  type RawArchiveEntry,
} from './lib/logBundle'
import { inferArchiveMetadata, parseUploadNotification } from './lib/notificationParser'
import { downloadUsbPdaLogArchive, isUsbPdaLogImportAvailable } from './lib/usbPdaLogClient'
import { calculateVirtualWindow } from './lib/virtualLog'

type ImportState = 'idle' | 'loading' | 'ready' | 'error'

type Progress = {
  phase: 'download' | 'extract'
  percent: number
  label: string
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [notificationText, setNotificationText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [bundle, setBundle] = useState<LogBundle | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const [fileQuery, setFileQuery] = useState('')
  const [contentQuery, setContentQuery] = useState('')
  const [status, setStatus] = useState<ImportState>('idle')
  const [message, setMessage] = useState('等待导入日志')
  const [progress, setProgress] = useState<Progress | null>(null)
  const usbImportAvailable = isUsbPdaLogImportAvailable()

  const visibleEntries = useMemo(
    () => filterEntries(bundle?.entries ?? [], fileQuery),
    [bundle, fileQuery],
  )

  const selectedEntry = useMemo(() => {
    if (!bundle || selectedEntryId == null) {
      return undefined
    }

    return bundle.entries.find((entry) => entry.id === selectedEntryId)
  }, [bundle, selectedEntryId])

  const contentLines = useMemo(() => {
    if (!selectedEntry?.text) {
      return []
    }

    return selectedEntry.text.split(/\r\n|\r|\n/)
  }, [selectedEntry])

  const handleProgress: ProgressCallback = ({ phase, current, total, fileName }) => {
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

    if (phase === 'download') {
      const currentMb = (current / 1024 / 1024).toFixed(1)
      const totalMb = (total / 1024 / 1024).toFixed(1)
      setProgress({ phase, percent, label: `${currentMb} / ${totalMb} MB` })
      return
    }

    const name = fileName?.split('/').pop() ?? ''
    setProgress({ phase, percent, label: `${current}/${total} ${name}` })
  }

  async function importFromNotification() {
    const parsed = parseUploadNotification(notificationText)

    if ('error' in parsed) {
      setStatus('error')
      setMessage(parsed.error ?? '通知格式不完整')
      return
    }

    const nextPassword = parsed.password
    setStatus('loading')
    setProgress({ phase: 'download', percent: 0, label: '连接中...' })
    setMessage(`正在下载 ${parsed.fileName}`)

    try {
      const blob = await downloadArchive(parsed.urlPath, handleProgress)
      setProgress({ phase: 'extract', percent: 0, label: '准备解压...' })
      await buildBundle(blob, {
        sourceName: parsed.fileName,
        password: nextPassword,
        serialNumber: parsed.serialNumber,
        version: parsed.version,
      })
    } catch (error) {
      setStatus('error')
      setProgress(null)
      setMessage(getErrorMessage(error))
    }
  }

  async function importLocalFile(file = selectedFile) {
    if (!file) {
      setStatus('error')
      setMessage('请选择本地 zip 文件')
      return
    }

    const metadata = inferArchiveMetadata(file.name)
    const nextPassword = metadata.password
    setStatus('loading')
    setProgress({ phase: 'extract', percent: 0, label: '准备解压...' })
    setMessage(`正在解析 ${file.name}`)

    try {
      await buildBundle(file, {
        sourceName: metadata.fileName,
        password: nextPassword,
        serialNumber: metadata.serialNumber,
        version: metadata.version,
      })
    } catch (error) {
      setStatus('error')
      setProgress(null)
      setMessage(getErrorMessage(error))
    }
  }

  async function importFromUsb() {
    setStatus('loading')
    setProgress({ phase: 'download', percent: 0, label: '正在通过 USB 导出...' })
    setMessage('正在连接 PDA 并导出日志')

    try {
      const archive = await downloadUsbPdaLogArchive()
      const metadata = inferArchiveMetadata(archive.sourceName)
      setProgress({ phase: 'extract', percent: 0, label: '准备解析 USB 日志...' })
      await buildBundle(archive.blob, {
        sourceName: metadata.fileName,
        password: archive.password ?? metadata.password,
        serialNumber: metadata.serialNumber,
        version: metadata.version,
      })
    } catch (error) {
      setStatus('error')
      setProgress(null)
      setMessage(getErrorMessage(error))
    }
  }

  async function buildBundle(
    blob: Blob,
    metadata: {
      sourceName: string
      password: string
      serialNumber?: string
      version?: string
    },
  ) {
    const entries = await readArchive(blob, { password: metadata.password }, handleProgress)
    const nextBundle = createLogBundle({
      ...metadata,
      entries,
    })
    setBundle(nextBundle)
    setSelectedEntryId(undefined)
    setFileQuery('')
    setContentQuery('')
    setStatus('ready')
    setProgress(null)
    setMessage('')
  }

  function handleLocalFile(file: File) {
    if (/\.(txt|xlog|json)$/i.test(file.name)) {
      void importTextFile(file)
      return
    }

    setSelectedFile(file)

    void importLocalFile(file)
  }

  async function importTextFile(file: File) {
    setStatus('loading')
    setProgress(null)
    setMessage(`正在读取 ${file.name}`)

    try {
      let text: string

      if (/\.xlog$/i.test(file.name)) {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        if (isXLogByMagic(bytes)) {
          text = await parseXLog(bytes)
        } else {
          text = await file.text()
        }
      } else {
        text = await file.text()
      }

      const entry: RawArchiveEntry = {
        path: file.name,
        size: file.size,
        lastModified: new Date(file.lastModified),
        text,
        data: file,
      }
      const nextBundle = createLogBundle({
        sourceName: file.name,
        password: '',
        entries: [entry],
      })
      setBundle(nextBundle)
      setSelectedEntryId(undefined)
      setFileQuery('')
      setContentQuery('')
      setStatus('ready')
      setProgress(null)
      setMessage('')
    } catch (error) {
      setStatus('error')
      setProgress(null)
      setMessage(getErrorMessage(error))
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files.item(0)

    if (file) {
      handleLocalFile(file)
    }
  }

  return (
    <main className="shell">
      <section
        className="import-band"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="import-left">
          <span className="mark">PL</span>
          <div className="brand-text">
            <h1>Pump Log</h1>
            <p>设备日志分析工作台</p>
          </div>
        </div>

        <div className="import-right">
          <div className="import-row">
            <textarea
              className="import-textarea"
              value={notificationText}
              onChange={(event) => setNotificationText(event.target.value)}
              spellCheck={false}
              aria-label="上传通知内容"
              placeholder="粘贴上传通知内容..."
            />
            <button
              type="button"
              className="primary import-btn"
              onClick={importFromNotification}
              disabled={status === 'loading'}
            >
              下载解析
            </button>
          </div>
          {progress || status === 'error' ? (
            <div className="import-status-row">
              {progress ? (
                <div className="progress inline-progress">
                  <div style={{ width: `${progress.percent}%` }} />
                  <small>{progress.label}</small>
                </div>
              ) : null}
              {status === 'error' ? <span className="inline-error">{message}</span> : null}
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".zip,.txt,.xlog,.json,application/zip,text/plain,application/json"
          onChange={(event) => {
            const file = event.target.files?.item(0)

            if (file) {
              handleLocalFile(file)
            }
          }}
        />
      </section>

      <section className="workspace">
        <aside className="file-pane">
          <div className="pane-head">
            <div>
              <h2>文件列表</h2>
              <p>{bundle ? `${visibleEntries.length}/${bundle.entries.length} 个文件` : '尚未导入'}</p>
            </div>
            <div className="pane-actions">
              <button
                type="button"
                className="pane-import usb-import"
                title={usbImportAvailable ? '通过 USB 从 PDA 导入日志' : '请使用支持 WebUSB 的 Chrome/Edge，或在本机 npm run dev 使用 ADB 导入'}
                onClick={importFromUsb}
                disabled={status === 'loading'}
              >
                USB
              </button>
              <button
                type="button"
                className="pane-import"
                title="导入日志文件"
                onClick={() => fileInputRef.current?.click()}
                disabled={status === 'loading'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                导入
              </button>
            </div>
            <input
              className="compact-input file-filter"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder="筛选文件"
              aria-label="筛选文件"
              disabled={!bundle}
            />
          </div>

          <div className="file-table" role="listbox" aria-label="日志文件列表">
            {visibleEntries.map((entry) => (
              <div
                key={entry.id}
                className={entry.id === selectedEntry?.id ? 'file-row selected' : 'file-row'}
                role="option"
                aria-selected={entry.id === selectedEntry?.id}
              >
                <button
                  type="button"
                  className="file-select"
                  onClick={() => setSelectedEntryId(entry.id)}
                >
                  <span className="file-name">{entry.path}</span>
                  <span>{entry.displaySize}</span>
                </button>
                <button
                  type="button"
                  className="file-download"
                  title="下载文件"
                  onClick={() => downloadEntry(entry)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            ))}

            {bundle && visibleEntries.length === 0 ? <div className="empty">没有匹配的文件</div> : null}
            {!bundle ? (
              <div className="empty file-empty">
                <strong>还没有日志包</strong>
                <span>粘贴上传通知、导入本地文件，或把文件拖到顶部区域。</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="detail-pane">
          {selectedEntry ? (
            <FileDetail
              entry={selectedEntry}
              lineCount={contentLines.length}
              contentQuery={contentQuery}
              onContentQueryChange={setContentQuery}
              lines={contentLines}
            />
          ) : (
            <div className="detail-empty">
              <span className="detail-empty-kicker">Ready for inspection</span>
              <h2>{bundle ? '选择一个日志文件' : '导入日志开始分析'}</h2>
              <p>
                {bundle
                  ? '左侧选择文件后，会在这里显示文本、表格化历史记录和网络请求。'
                  : '支持上传通知、本地 zip/txt/xlog/json 文件，以及可用环境下的 USB PDA 日志导入。'}
              </p>
              {!bundle ? (
                <div className="empty-actions">
                  <button
                    type="button"
                    className="primary import-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status === 'loading'}
                  >
                    导入本地文件
                  </button>
                  <button
                    type="button"
                    className="pane-import usb-import"
                    title={usbImportAvailable ? '通过 USB 从 PDA 导入日志' : '请使用支持 WebUSB 的 Chrome/Edge，或在本机 npm run dev 使用 ADB 导入'}
                    onClick={importFromUsb}
                    disabled={status === 'loading'}
                  >
                    USB 导入
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

const LOG_ROW_HEIGHT = 22
const LOG_OVERSCAN_ROWS = 40

function FileDetail({
  entry,
  lineCount,
  contentQuery,
  onContentQueryChange,
  lines,
}: {
  entry: LogEntry
  lineCount: number
  contentQuery: string
  onContentQueryChange: (value: string) => void
  lines: string[]
}) {
  const [bleFilter, setBleFilter] = useState(false)
  const [pumpAdFilter, setPumpAdFilter] = useState(false)
  const [pumpHistoryFilter, setPumpHistoryFilter] = useState(false)
  const [networkFilter, setNetworkFilter] = useState(false)
  const [deviceInfoFilter, setDeviceInfoFilter] = useState(false)
  const [cgmHistoryFilter, setCgmHistoryFilter] = useState(false)
  const [networkSubFilter, setNetworkSubFilter] = useState('')
  const logViewportRef = useRef<HTMLDivElement>(null)
  const [logScrollTop, setLogScrollTop] = useState(0)
  const [logViewportHeight, setLogViewportHeight] = useState(600)
  const normalizedQuery = contentQuery.trim().toLowerCase()

  const timeFilteredLines = useMemo(() => {
    const hasFilter = bleFilter || pumpAdFilter || pumpHistoryFilter || networkFilter || deviceInfoFilter || cgmHistoryFilter

    const result: { line: string; originalIndex: number }[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (hasFilter) {
        if (bleFilter && !isBluetoothLine(line)) continue
        if (pumpAdFilter && !isPumpAdLine(line)) continue
        if (pumpHistoryFilter && !isPumpHistoryLine(line)) continue
        if (networkFilter && !isNetworkRequestLine(line)) continue
        if (deviceInfoFilter && !isDeviceInfoLine(line)) continue
        if (cgmHistoryFilter && !isCgmHistoryLine(line)) continue
      }

      result.push({ line, originalIndex: i })
    }
    return result
  }, [lines, bleFilter, pumpAdFilter, pumpHistoryFilter, networkFilter, deviceInfoFilter, cgmHistoryFilter])

  useEffect(() => {
    const node = logViewportRef.current
    if (!node) return

    function updateViewportHeight() {
      setLogViewportHeight(node?.clientHeight || 600)
    }

    updateViewportHeight()
    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [entry.id, networkFilter, cgmHistoryFilter, pumpHistoryFilter, pumpAdFilter])

  useEffect(() => {
    const node = logViewportRef.current
    if (!node) return
    node.scrollTop = 0
    setLogScrollTop(0)
  }, [entry.id, bleFilter, pumpAdFilter, pumpHistoryFilter, networkFilter, deviceInfoFilter, cgmHistoryFilter])

  useEffect(() => {
    if (networkFilter) return
    const rafId = requestAnimationFrame(() => setNetworkSubFilter(''))
    return () => cancelAnimationFrame(rafId)
  }, [networkFilter])

  const firstMatchedLineIndex = useMemo(() => {
    if (!normalizedQuery) return -1
    return timeFilteredLines.findIndex(({ line }) =>
      line.toLowerCase().includes(normalizedQuery),
    )
  }, [timeFilteredLines, normalizedQuery])

  useEffect(() => {
    if (!normalizedQuery || firstMatchedLineIndex < 0) return
    const node = logViewportRef.current
    if (!node) return
    const nextScrollTop = Math.max(0, (firstMatchedLineIndex - 4) * LOG_ROW_HEIGHT)
    node.scrollTop = nextScrollTop
    setLogScrollTop(nextScrollTop)
  }, [normalizedQuery, firstMatchedLineIndex, entry.id])

  const visibleLines = timeFilteredLines
  const virtualWindow = calculateVirtualWindow(
    timeFilteredLines.length,
    logScrollTop,
    logViewportHeight,
    LOG_ROW_HEIGHT,
    LOG_OVERSCAN_ROWS,
  )
  const virtualLines = timeFilteredLines.slice(virtualWindow.start, virtualWindow.end)

  const jsonTable = useMemo(() => {
    if (entry.extension !== 'json') return null
    const raw = entry.text
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length === 0) return null
      if (!parsed.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) return null

      const columns = Array.from(
        new Set(parsed.flatMap((item: Record<string, unknown>) => Object.keys(item))),
      )
      const prioCols = ['id', 'hasUpload']
      const ordered = [
        ...prioCols.filter((col) => columns.includes(col)),
        ...columns.filter((col) => !prioCols.includes(col)),
      ]
      return { columns: ordered, rows: parsed as Record<string, unknown>[] }
    } catch {
      return null
    }
  }, [entry])

  const historyRecords = useMemo(() => {
    if (!pumpHistoryFilter) return []
    return visibleLines
      .map(({ line, originalIndex }) => {
        const rec = parsePumpHistoryRecord(line)
        return rec ? { ...rec, key: originalIndex, rawLine: line } : null
      })
      .filter(Boolean)
  }, [visibleLines, pumpHistoryFilter])

  const pumpAdRecords = useMemo(() => {
    if (!pumpAdFilter) return [] as PumpAdRecord[]
    return visibleLines
      .map(({ line, originalIndex }) => {
        const rec = parsePumpAdRecord(line)
        return rec ? { ...rec, key: originalIndex } : null
      })
      .filter(Boolean) as PumpAdRecord[]
  }, [visibleLines, pumpAdFilter])

  const cgmHistoryRecords = useMemo(() => {
    if (!cgmHistoryFilter) return [] as CgmHistoryRecord[]
    return visibleLines
      .map(({ line, originalIndex }) => {
        const rec = parseCgmHistoryRecord(line)
        return rec ? { ...rec, key: originalIndex } : null
      })
      .filter(Boolean) as CgmHistoryRecord[]
  }, [visibleLines, cgmHistoryFilter])

  const networkRequests = useMemo(() => {
    if (!networkFilter) return [] as NetworkRequest[]
    const requests: NetworkRequest[] = []
    let current: Partial<NetworkRequest> | null = null
    for (const { line, originalIndex } of timeFilteredLines) {
      if (line.includes('----------Start')) {
        current = { key: originalIndex, timestamp: extractTimestamp(line) }
      } else if (current && line.includes('| Request{')) {
        const parsed = parseRequestLine(line)
        if (parsed) { current.method = parsed.method; current.url = parsed.url }
        // New format (PDA_API): extract tags={...} from the Request line as params
        const tagsIdx = line.indexOf('tags=')
        if (tagsIdx !== -1) {
          current.params = line.slice(tagsIdx + 5).trim()
        }
      } else if (current && line.includes('| RequestParams:{')) {
        // Old format: explicit RequestParams line overrides any tags extraction
        current.params = extractValue(line, 'RequestParams:')
      } else if (current && line.includes('| Response:')) {
        current.response = extractValue(line, 'Response:')
        try {
          const parsed = JSON.parse(current.response)
          current.code = typeof parsed.code === 'number' ? parsed.code : null
        } catch {
          current.code = null
        }
      } else if (current && line.includes('----------End:')) {
        current.duration = extractValue(line, 'End:')?.replace(/毫秒-+$/, '') + 'ms'
        const url = current.url ?? ''
        requests.push({
          key: current.key!,
          timestamp: current.timestamp ?? '',
          method: current.method ?? '',
          url,
          params: current.params ?? '',
          response: current.response ?? '',
          duration: current.duration ?? '',
          code: current.code ?? null,
          category: classifyNetworkRequest(url),
        })
        current = null
      } else if (current && !current.response) {
        // Continuation line between Request and Response — long content split by logger
        current.params = (current.params ?? '') + extractLogMessage(line)
      }
    }
    return requests
  }, [timeFilteredLines, networkFilter])

  const FAILED_KEY = '__failed__'

  const categoryCounts = useMemo(() => {
    if (!networkFilter) return new Map<string, number>()
    const counts = new Map<string, number>()
    let failedCount = 0
    for (const req of networkRequests) {
      counts.set(req.category, (counts.get(req.category) ?? 0) + 1)
      if (req.code != null && req.code !== 200 && req.code !== 1) failedCount++
    }
    if (failedCount > 0) counts.set(FAILED_KEY, failedCount)
    return counts
  }, [networkFilter, networkRequests])

  const filteredNetworkRequests = useMemo(() => {
    if (!networkFilter) return [] as NetworkRequest[]
    if (!networkSubFilter) return networkRequests
    if (networkSubFilter === FAILED_KEY) {
      return networkRequests.filter((req) => req.code != null && req.code !== 200 && req.code !== 1)
    }
    return networkRequests.filter((req) => req.category === networkSubFilter)
  }, [networkFilter, networkRequests, networkSubFilter])

  return (
    <>
      <div className="detail-toolbar">
        <input
          className="compact-input"
          value={contentQuery}
          onChange={(event) => onContentQueryChange(event.target.value)}
          placeholder="搜索内容"
        />
        <div className="filter-chips">
          <button
            type="button"
            className={bleFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (bleFilter) { setBleFilter(false); return }
              setBleFilter(true); setPumpAdFilter(false); setPumpHistoryFilter(false); setNetworkFilter(false); setDeviceInfoFilter(false); setCgmHistoryFilter(false)
            }}
          >
            蓝牙日志
            {bleFilter ? <span className="chip-count">{timeFilteredLines.length}</span> : null}
          </button>
          <button
            type="button"
            className={pumpAdFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (pumpAdFilter) { setPumpAdFilter(false); return }
              setBleFilter(false); setPumpAdFilter(true); setPumpHistoryFilter(false); setNetworkFilter(false); setDeviceInfoFilter(false); setCgmHistoryFilter(false)
            }}
          >
            泵体蓝牙广播
            {pumpAdFilter ? <span className="chip-count">{timeFilteredLines.length}</span> : null}
          </button>
          <button
            type="button"
            className={pumpHistoryFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (pumpHistoryFilter) { setPumpHistoryFilter(false); return }
              setBleFilter(false); setPumpAdFilter(false); setPumpHistoryFilter(true); setNetworkFilter(false); setDeviceInfoFilter(false); setCgmHistoryFilter(false)
            }}
          >
            泵体历史
            {pumpHistoryFilter ? <span className="chip-count">{timeFilteredLines.length}</span> : null}
          </button>
          <button
            type="button"
            className={networkFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (networkFilter) { setNetworkFilter(false); return }
              setBleFilter(false); setPumpAdFilter(false); setPumpHistoryFilter(false); setNetworkFilter(true); setDeviceInfoFilter(false); setCgmHistoryFilter(false)
            }}
          >
            网络请求
            {networkFilter ? <span className="chip-count">{networkRequests.length}</span> : null}
          </button>
          <button
            type="button"
            className={deviceInfoFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (deviceInfoFilter) { setDeviceInfoFilter(false); return }
              setBleFilter(false); setPumpAdFilter(false); setPumpHistoryFilter(false); setNetworkFilter(false); setDeviceInfoFilter(true); setCgmHistoryFilter(false)
            }}
          >
            设备信息
            {deviceInfoFilter ? <span className="chip-count">{timeFilteredLines.length}</span> : null}
          </button>
          <button
            type="button"
            className={cgmHistoryFilter ? 'chip active' : 'chip'}
            onClick={() => {
              if (cgmHistoryFilter) { setCgmHistoryFilter(false); return }
              setBleFilter(false); setPumpAdFilter(false); setPumpHistoryFilter(false); setNetworkFilter(false); setDeviceInfoFilter(false); setCgmHistoryFilter(true)
            }}
          >
            CGM历史
            {cgmHistoryFilter ? <span className="chip-count">{cgmHistoryRecords.length}</span> : null}
          </button>
        </div>
        <span className="line-pill">{lineCount} 行</span>
        {(cgmHistoryFilter || pumpHistoryFilter || pumpAdFilter) ? (
          <button type="button" className="export-btn" onClick={() => {
            if (cgmHistoryFilter) {
              downloadCsv(
                ['日志时间', 'timeOffset', 'currentTime', 'glucose', 'deviceSn', 'sensorStartTime', 'quality', 'status'],
                cgmHistoryRecords.map(r => [r.timestamp, r.timeOffset, r.currentTime, r.glucose, r.deviceSn, r.sensorStartTime, r.quality, r.status]),
                'cgm_history.csv'
              )
            } else if (pumpAdFilter) {
              downloadCsv(
                ['日志时间', 'Pump时间', 'RSSI', 'deviceSn', 'autoMode', 'eventIndex', '剩余电量', '剩余胰岛素', 'eventPort', 'eventType', 'eventLevel', 'eventValue', 'glucose', '基础率', '大剂量'],
                pumpAdRecords.map(r => [r.timestamp, r.datetime, r.rssi, r.deviceSn, r.autoMode, r.eventIndex, r.remainingCapacity, r.remainingInsulin, r.eventPort, r.eventType, r.eventLevel, r.eventValue, r.glucose, r.basalUnitPerHour, r.bolusUnitPerHour]),
                'pump_ad.csv'
              )
            } else {
              downloadCsv(
                ['日志时间', 'autoMode', 'eventIndex', '剩余电量', '剩余胰岛素', 'datetime', 'eventPort', 'eventType', 'eventLevel', 'eventValue', '基础率', '大剂量', '内容'],
                historyRecords.map(r => [r!.timestamp, r!.autoMode, r!.eventIndex, r!.remainingCapacity, r!.remainingInsulin, r!.datetime, r!.eventPort, r!.eventType, r!.eventLevel, r!.eventValue, r!.basalUnitPerHour, r!.bolusUnitPerHour, getEventDescription(r!.eventPort, r!.eventType, r!.eventLevel, r!.eventValue)]),
                'pump_history.csv'
              )
            }
          }}>
            导出 CSV
          </button>
        ) : null}
        {jsonTable ? (
          <button type="button" className="export-btn" onClick={() => {
            downloadCsv(
              jsonTable.columns,
              jsonTable.rows.map((row) => jsonTable.columns.map((col) => formatJsonCell(row[col]))),
              entry.name.replace(/\.json$/i, '') + '.csv',
            )
          }}>
            导出 CSV
          </button>
        ) : null}
        {entry.truncated ? <span className="warn">文件过大，仅显示前 100 MB</span> : null}
      </div>

      {entry.text ? (
        <div className="log-container">
          {networkFilter ? (
            <>
              <div className="sub-chips">
                <button
                  type="button"
                  className={!networkSubFilter ? 'chip active' : 'chip'}
                  onClick={() => setNetworkSubFilter('')}
                >
                  全部<span className="chip-count">{networkRequests.length}</span>
                </button>
                {(categoryCounts.get(FAILED_KEY) ?? 0) > 0 ? (
                  <button
                    type="button"
                    className={networkSubFilter === FAILED_KEY ? 'chip active chip-failed' : 'chip chip-failed'}
                    onClick={() => setNetworkSubFilter(FAILED_KEY)}
                  >
                    失败<span className="chip-count">{categoryCounts.get(FAILED_KEY)}</span>
                  </button>
                ) : null}
                {NETWORK_CATEGORIES.filter((cat) => (categoryCounts.get(cat.key) ?? 0) > 0).map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className={networkSubFilter === cat.key ? 'chip active' : 'chip'}
                    onClick={() => setNetworkSubFilter(cat.key)}
                  >
                    {cat.label}<span className="chip-count">{categoryCounts.get(cat.key)}</span>
                  </button>
                ))}
              </div>
              <div className="network-list">
                {filteredNetworkRequests.map((req) => (
                  <NetworkCard key={req.key} request={req} />
                ))}
                {filteredNetworkRequests.length === 0 ? (
                  <div className="detail-empty"><p>没有匹配的网络请求</p></div>
                ) : null}
              </div>
            </>
          ) : cgmHistoryFilter ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>日志时间</th>
                    <th>timeOffset</th>
                    <th>currentTime</th>
                    <th>glucose</th>
                    <th>deviceSn</th>
                    <th>sensorStartTime</th>
                    <th>quality</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {cgmHistoryRecords.map((rec) => (
                    <tr key={rec.key}>
                      <td>{rec.timestamp}</td>
                      <td>{rec.timeOffset}</td>
                      <td>{rec.currentTime}</td>
                      <td>{rec.glucose}</td>
                      <td>{rec.deviceSn}</td>
                      <td>{rec.sensorStartTime}</td>
                      <td>{rec.quality}</td>
                      <td>{rec.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : pumpHistoryFilter ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>日志时间</th>
                    <th>autoMode</th>
                    <th>eventIndex</th>
                    <th>剩余电量</th>
                    <th>剩余胰岛素</th>
                    <th>datetime</th>
                    <th>eventPort</th>
                    <th>eventType</th>
                    <th>eventLevel</th>
                    <th>eventValue</th>
                    <th>基础率</th>
                    <th>大剂量</th>
                    <th>内容</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map((rec) => {
                    const level = parseInt(rec!.eventLevel, 10)
                    const rowClass = level === 2 ? 'row-alarm-high' : level === 1 ? 'row-alarm-low' : undefined
                    return (
                    <tr key={rec!.key} className={rowClass}>
                      <td>{rec!.timestamp}</td>
                      <td>{rec!.autoMode}</td>
                      <td>{rec!.eventIndex}</td>
                      <td>{rec!.remainingCapacity}</td>
                      <td>{rec!.remainingInsulin}</td>
                      <td>{rec!.datetime}</td>
                      <td>{rec!.eventPort}</td>
                      <td>{rec!.eventType}</td>
                      <td>{rec!.eventLevel}</td>
                      <td>{rec!.eventValue}</td>
                      <td>{rec!.basalUnitPerHour}</td>
                      <td>{rec!.bolusUnitPerHour}</td>
                      <td>{getEventDescription(rec!.eventPort, rec!.eventType, rec!.eventLevel, rec!.eventValue)}</td>
                      <td>
                        <button
                          type="button"
                          className="copy-btn"
                          title="复制原始日志"
                          onClick={async () => {
                            await navigator.clipboard.writeText(rec!.rawLine)
                            const btn = document.activeElement as HTMLElement
                            if (btn) {
                              btn.style.color = '#56d364'
                              setTimeout(() => { btn.style.color = '' }, 1200)
                            }
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          ) : pumpAdFilter ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>日志时间</th>
                    <th>Pump时间</th>
                    <th>RSSI</th>
                    <th>deviceSn</th>
                    <th>autoMode</th>
                    <th>eventIndex</th>
                    <th>剩余电量</th>
                    <th>剩余胰岛素</th>
                    <th>eventPort</th>
                    <th>eventType</th>
                    <th>eventLevel</th>
                    <th>eventValue</th>
                    <th>glucose</th>
                    <th>基础率</th>
                    <th>大剂量</th>
                  </tr>
                </thead>
                <tbody>
                  {pumpAdRecords.map((rec) => {
                    const level = parseInt(rec.eventLevel, 10)
                    const rowClass = level === 2 ? 'row-alarm-high' : level === 1 ? 'row-alarm-low' : undefined
                    return (
                    <tr key={rec.key} className={rowClass}>
                      <td>{rec.timestamp}</td>
                      <td>{rec.datetime}</td>
                      <td>{rec.rssi}</td>
                      <td>{rec.deviceSn}</td>
                      <td>{rec.autoMode}</td>
                      <td>{rec.eventIndex}</td>
                      <td>{rec.remainingCapacity}</td>
                      <td>{rec.remainingInsulin}</td>
                      <td>{rec.eventPort}</td>
                      <td>{rec.eventType}</td>
                      <td>{rec.eventLevel}</td>
                      <td>{rec.eventValue}</td>
                      <td>{rec.glucose === 'null' ? '-' : rec.glucose}</td>
                      <td>{rec.basalUnitPerHour}</td>
                      <td>{rec.bolusUnitPerHour}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          ) : jsonTable ? (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    {jsonTable.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jsonTable.rows.map((row, i) => {
                      const notUploaded = row.hasUpload === 0 || row.hasUpload === '0' || row.hasUpload === false
                      return (
                    <tr key={i} className={notUploaded ? 'row-not-uploaded' : undefined}>
                      {jsonTable.columns.map((col) => (
                        <td key={col}>{formatJsonCell(row[col])}</td>
                      ))}
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              ref={logViewportRef}
              className="log-viewer"
              role="log"
              aria-label={`${entry.name} 日志内容`}
              onScroll={(event) => setLogScrollTop(event.currentTarget.scrollTop)}
            >
              <div
                className="log-virtual-spacer"
                style={{ height: `${virtualWindow.totalHeight}px` }}
              >
                <div
                  className="log-virtual-window"
                  style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}
                >
                  {virtualLines.map(({ line, originalIndex }) => {
                    const matched = normalizedQuery && line.toLowerCase().includes(normalizedQuery)
                    return (
                      <code key={`${entry.id}-${originalIndex}`} className={matched ? 'hit' : undefined}>
                        <span>{originalIndex + 1}</span>
                        {line || ' '}
                      </code>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="detail-empty">
          <h2>无法预览文本</h2>
          <p>这个文件可能是二进制或未知格式。</p>
        </div>
      )}
    </>
  )
}

const bleKeywords = [
  'ble',
  '蓝牙',
  'onconnectionstatechange',
  'onservicesdiscovered',
  'ondescriptorwrite',
  'executeconnect',
  'setnotify',
  '收到蓝牙数据包',
  '发送：',
  'gatt',
  'characteristic',
  'descriptor',
]

function isBluetoothLine(line: string): boolean {
  if (line.includes('泵 op:')) return true
  if (line.includes('X operation :')) return true
  if (line.includes('isPumpUpdateEnabled')) return false
  if (line.includes('editable')) return false
  const lower = line.toLowerCase()
  return bleKeywords.some((kw) => lower.includes(kw))
}

function isPumpAdLine(line: string): boolean {
  return line.includes('Pump AD')
}

function isPumpHistoryLine(line: string): boolean {
  return line.includes('PumpModel 保存历史记录 PumpEntity')
}

interface PumpHistoryRecord {
  key: number
  timestamp: string
  autoMode: string
  eventIndex: string
  remainingCapacity: string
  remainingInsulin: string
  eventPort: string
  datetime: string
  eventType: string
  eventLevel: string
  eventValue: string
  basalUnitPerHour: string
  bolusUnitPerHour: string
  rawLine: string
}

function parsePumpHistoryRecord(line: string): Omit<PumpHistoryRecord, 'key'> | null {
  const ts = extractTimestamp(line)
  if (!ts) return null
  return {
    timestamp: ts,
    autoMode: extractField(line, /autoMode\s*=\s*(true|false)/),
    eventIndex: extractField(line, /eventIndex\s*=\s*(\d+)/),
    remainingCapacity: extractField(line, /remainingCapacity\s*=\s*(\d+)/),
    remainingInsulin: extractField(line, /remainingInsulin\s*=\s*(\d+)/),
    eventPort: extractField(line, /eventPort\s*=\s*(\d+)/),
    datetime: extractField(line, /datetime\s*=\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/),
    eventType: extractField(line, /eventType\s*=\s*(\d+)/),
    eventLevel: extractField(line, /eventLevel\s*=\s*(\d+)/),
    eventValue: extractField(line, /eventValue\s*=\s*(\d+)/),
    basalUnitPerHour: extractField(line, /basalUnitPerHour\s*=\s*([\d.]+)/),
    bolusUnitPerHour: extractField(line, /bolusUnitPerHour\s*=\s*([\d.]+)/),
    rawLine: line,
  }
}

const EVENT_MAP: Record<string, { label: string; values?: Record<string, string> }> = {
  '3-0-0':  { label: '自动模式状态', values: { '0': '关闭', '1': '开启' } },
  '3-1-0':  { label: '基础率已达自动模式上限' },
  '3-2-0':  { label: '自动模式基础率为0' },
  '3-3-0':  { label: '自动基础率为0达4小时' },
  '3-5-0':  { label: '自动模式目标血糖改变' },
  '3-7-0':  { label: '自动模式状态改变', values: { '0': '普通', '1': '睡眠', '2': '运动' } },
  '3-8-0':  { label: '传感器故障，自动模式退出' },
  '3-9-0':  { label: '传感器到期，自动模式退出' },
  '3-10-0': { label: '检测到新传感器，自动模式退出' },
  '3-11-0': { label: 'CGMS无信号，自动模式即将退出' },
  '3-12-0': { label: '自动暂停', values: { '0': '关闭', '1': '开启' } },
  '3-13-0': { label: '自动模式低血糖' },
  '3-1-1':  { label: '短期达最大输注量，自动模式退出' },
  '3-2-1':  { label: '自动基础率为0过长，自动模式退出' },
  '3-4-1':  { label: '过长时间未收到CGMS数据，自动模式退出' },
  '4-0-0':  { label: '输注速率改变' },
  '4-5-0':  { label: '输注已暂停' },
  '4-6-0':  { label: '泵体即将自动停止输注' },
  '4-7-0':  { label: '推杆定位' },
  '4-8-0':  { label: '推杆回退' },
  '4-12-0': { label: '输注暂停' },
  '4-1-1':  { label: '药量低' },
  '4-6-1':  { label: '泵体即将自动停止输注' },
  '4-1-2':  { label: '药液耗尽，输注停止' },
  '4-2-2':  { label: '检测到阻塞，输注停止' },
  '4-3-2':  { label: '电机故障' },
  '4-6-2':  { label: '长时间未操作，输注停止' },
  '5-1-0':  { label: '泵体重新上电' },
  '5-3-0':  { label: '进入强磁场，泵体可能失效' },
  '5-4-0':  { label: '泵体充电状态', values: { '0': '充电结束', '1': '充电中', '2': '已充满', '3': '充电失败' } },
  '5-0-1':  { label: '泵电量低' },
  '5-0-2':  { label: '泵体电量耗尽，输注停止' },
  '5-1-2':  { label: '非正常输注停止' },
  '5-2-2':  { label: '泵按键故障' },
}

function getEventDescription(port: string, type: string, level: string, value: string): string {
  const key = `${parseInt(port, 10)}-${parseInt(type, 10)}-${parseInt(level, 10)}`
  const entry = EVENT_MAP[key]
  if (!entry) return `eventPort=${port}, eventType=${type}, eventLevel=${level}, eventValue=${value}`
  let desc = entry.label
  if (entry.values && value in entry.values) {
    desc += `（${entry.values[value]}）`
  } else if (entry.values) {
    desc += `（未知值: ${value}）`
  }
  return desc
}

interface PumpAdRecord {
  key: number
  timestamp: string
  datetime: string
  rssi: string
  deviceSn: string
  autoMode: string
  eventIndex: string
  remainingCapacity: string
  remainingInsulin: string
  eventPort: string
  eventType: string
  eventLevel: string
  eventValue: string
  glucose: string
  basalUnitPerHour: string
  bolusUnitPerHour: string
}

function parsePumpAdRecord(line: string): Omit<PumpAdRecord, 'key'> | null {
  const ts = extractTimestamp(line)
  if (!ts) return null
  return {
    timestamp: ts,
    datetime: extractField(line, /datetime\s*=\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/),
    rssi: extractField(line, /rssi\s*=\s*(-?\d+)/),
    deviceSn: extractField(line, /deviceSn\s*=\s*'(\w+)'/),
    autoMode: extractField(line, /autoMode\s*=\s*(true|false)/),
    eventIndex: extractField(line, /eventIndex\s*=\s*(\d+)/),
    remainingCapacity: extractField(line, /remainingCapacity\s*=\s*(\d+)/),
    remainingInsulin: extractField(line, /remainingInsulin\s*=\s*(\d+)/),
    eventPort: extractField(line, /eventPort\s*=\s*(\d+)/),
    eventType: extractField(line, /eventType\s*=\s*(\d+)/),
    eventLevel: extractField(line, /eventLevel\s*=\s*(\d+)/),
    eventValue: extractField(line, /eventValue\s*=\s*(\d+)/),
    glucose: extractField(line, /glucose\s*=\s*(-?\w+)/),
    basalUnitPerHour: extractField(line, /basalUnitPerHour\s*=\s*([\d.]+)/),
    bolusUnitPerHour: extractField(line, /bolusUnitPerHour\s*=\s*([\d.]+)/),
  }
}

function extractField(line: string, regex: RegExp): string {
  const match = line.match(regex)
  return match?.[1] ?? '-'
}

function isDeviceInfoLine(line: string): boolean {
  return line.includes('设备信息')
}

function isCgmHistoryLine(line: string): boolean {
  return line.includes('AidexXHistory')
}

interface CgmHistoryRecord {
  key: number
  timestamp: string
  timeOffset: string
  currentTime: string
  glucose: string
  deviceSn: string
  sensorStartTime: string
  quality: string
  status: string
}

function parseCgmHistoryRecord(line: string): Omit<CgmHistoryRecord, 'key'> | null {
  const ts = extractTimestamp(line)
  if (!ts) return null
  return {
    timestamp: ts,
    timeOffset: extractField(line, /timeOffset\s*=\s*(\d+)/),
    currentTime: extractField(line, /currentTime\s*=\s*(.+?),/),
    glucose: extractField(line, /glucose\s*=\s*(\d+)/),
    deviceSn: extractField(line, /deviceSn\s*=\s*(\w+)/),
    sensorStartTime: extractField(line, /sensorStartTime\s*=\s*(\d+)/),
    quality: extractField(line, /quality\s*=\s*(\d+)/),
    status: extractField(line, /status\s*=\s*(\d+)/),
  }
}

function isNetworkRequestLine(line: string): boolean {
  return line.includes('----------Start') ||
    line.includes('| Request{') ||
    line.includes('| RequestParams:{') ||
    line.includes('| Response:') ||
    line.includes('----------End:')
}

const NETWORK_CATEGORIES = [
  { key: 'userTrend', label: 'CGM广播', pattern: 'userTrend/saveOrUpdateUserTrend' },
  { key: 'pumpStatusRecord', label: '泵体广播', pattern: 'pumpStatusRecord/savePumpStatusRecord' },
  { key: 'pumpDeviceRegister', label: '泵体配对', pattern: 'pumpDevice/register' },
  { key: 'pumpDeviceUnRegister', label: '泵体解配', pattern: 'pumpDevice/unRegister' },
  { key: 'pumpData', label: '泵体历史', pattern: 'pumpData/savePumpData' },
  { key: 'pumpSetting', label: '泵体参数', pattern: 'pumpSetting/savePumpSetting' },
  { key: 'userSetting', label: '用户参数', pattern: 'userSetting/updateUserSetting' },
  { key: 'pumpBasalRate', label: '基础率', pattern: 'pumpBasalRatePrepareSetting/saveBasalRatePrepareSetting' },
  { key: 'pumpBolusRate', label: '大剂量预设', pattern: 'pumpBolusRatePrepareSetting/saveOrUpdate' },
  { key: 'event', label: '事件', pattern: 'event/save' },
  { key: 'cgmDeviceRegister', label: 'CGM配对', pattern: 'cgmDevice/userDeviceRegister' },
  { key: 'cgmDeviceUnRegister', label: 'CGM解配', pattern: 'cgmDevice/deviceUnRegister' },
  { key: 'cgmDeviceVerify', label: 'SN校验', pattern: 'cgmDevice/v2/verifySensorSn' },
  { key: 'cgmRecordSave', label: 'CGM历史', pattern: 'cgmRecord/saveCgmRecord' },
  { key: 'cgmRecordUpdate', label: 'CGM原始', pattern: 'cgmRecord/updateCgmRecord' },
  { key: 'cgmCalibration', label: 'CGM校准', pattern: 'cgmCalibration/saveCalibration' },
  { key: 'prescriptionUnreadNum', label: '未读医嘱数目', pattern: 'prescription/queryUnreadPrescriptionNum' },
  { key: 'prescriptionOverview', label: '医嘱列表', pattern: 'prescription/queryPrescriptionOverviewList' },
  { key: 'prescriptionDetail', label: '医嘱详情', pattern: 'prescription/queryPrescriptionDetail' },
  { key: 'prescriptionStatus', label: '医嘱状态更新', pattern: 'prescription/modifyPrescriptionStatus' },
  { key: 'patientInfo', label: '患者信息', pattern: 'prescription/queryPatientInfoByPatientId' },
  { key: 'authLogin', label: '登录', pattern: 'pda/auth/login' },
  { key: 'authChallenge', label: '登录挑战', pattern: 'pda/auth/challenge' },
  { key: 'systemTimestamp', label: '系统时间', pattern: 'pda/device/currentTimestamp' },
  { key: 'dataShareList', label: '分享列表', pattern: 'pump/data-share/list' },
]

function classifyNetworkRequest(url: string): string {
  for (const cat of NETWORK_CATEGORIES) {
    if (url.includes(cat.pattern)) return cat.key
  }
  return ''
}

interface NetworkRequest {
  key: number
  timestamp: string
  method: string
  url: string
  params: string
  response: string
  duration: string
  code: number | null
  category: string
}

function extractTimestamp(line: string): string {
  // Format 1 — mars xlog (parsed .xlog): YYYY-MM-DD HH:MM:SS.ms at line start
  let m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)
  if (m) return m[1]

  // Format 2 — Android logcat (.log / adb output):
  //   [L][YYYY-MM-DD TZ HH:MM:SS.ms]  e.g. [D][2026-05-20 +80 10:38:21.574]
  m = line.match(/\[.\]\[(\d{4}-\d{2}-\d{2})\s*[+-]\d+\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]/)
  if (m) return `${m[1]} ${m[2]}`

  return ''
}

function parseRequestLine(line: string): { method: string; url: string } | null {
  const m = line.match(/\| Request\{method=(\w+), url=([^,}]+)/)
  if (!m) return null
  return { method: m[1], url: m[2] }
}

function extractValue(line: string, prefix: string): string {
  const idx = line.indexOf(prefix)
  if (idx === -1) return ''
  return line.slice(idx + prefix.length).trim()
}

/**
 * Strip logcat / mars-xlog envelope to get raw message content.
 * Used for continuation lines where the logger split a long message
 * across multiple log entries.
 *
 * Logcat:  [L][timestamp][pid,tid][TAG][, , 0][message
 * Mars:    timestamp L|pid,tid|TAG|message
 */
function extractLogMessage(line: string): string {
  // Logcat: find message after the 5th bracket pair, e.g. ][, , 0][
  const logcatMatch = line.match(/\]\[, , \d\]\[(.+)/)
  if (logcatMatch) return logcatMatch[1]

  // Mars xlog: find message after the 3rd `|`
  const firstPipe = line.indexOf('|')
  if (firstPipe !== -1) {
    const secondPipe = line.indexOf('|', firstPipe + 1)
    if (secondPipe !== -1) {
      const thirdPipe = line.indexOf('|', secondPipe + 1)
      if (thirdPipe !== -1) {
        return line.slice(thirdPipe + 1)
      }
    }
  }

  return line
}

function NetworkCard({ request }: { request: NetworkRequest }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [paramsJson, setParamsJson] = useState(true)
  const [responseJson, setResponseJson] = useState(true)
  const methodColor = request.method === 'POST' ? '#e8a838' : request.method === 'GET' ? '#5b9bd5' : '#7aa2c4'
  const isError = request.code != null && request.code !== 200

  function buildFullLog(): string {
    const parts: string[] = []
    parts.push(`[${request.timestamp}] ${request.method} ${request.url}`)
    if (request.duration) parts.push(`耗时: ${request.duration}`)
    if (request.code != null) parts.push(`状态码: ${request.code}`)
    if (request.params) parts.push(`\n--- 请求参数 ---\n${request.params}`)
    if (request.response) parts.push(`\n--- 响应 ---\n${request.response}`)
    return parts.join('\n')
  }

  function handleCopy(event: React.MouseEvent) {
    event.stopPropagation()
    navigator.clipboard.writeText(buildFullLog())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function formatJson(raw: string): string {
    let s = raw
    while (s.startsWith('{') && s.endsWith('}')) {
      try {
        return JSON.stringify(JSON.parse(s), null, 2)
      } catch {
        s = s.slice(1, -1)
      }
    }
    return raw
  }

  return (
    <div className={isError ? 'net-card net-card-error' : 'net-card'}>
      <div className="net-card-head" onClick={() => setExpanded(!expanded)}>
        <span className="net-time">{request.timestamp.slice(11, 19)}</span>
        <span className="net-method" style={{ color: methodColor }}>{request.method}</span>
        <span className="net-url">{truncateUrl(request.url)}</span>
        <button
          type="button"
          className="net-copy"
          title={copied ? '已复制' : '复制完整请求日志'}
          onClick={handleCopy}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        <span className="net-duration">{request.duration}</span>
        {request.code != null ? <span className="net-code" style={isError ? { color: '#e74c3c', fontWeight: 'bold' } : { color: '#27ae60' }}>{request.code}</span> : null}
        <span className="net-expand">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded ? (
        <div className="net-card-body">
          {request.params ? (
            <div className="net-section">
              <div className="net-section-head">
                <div className="net-label">请求参数</div>
                <button type="button" className="net-json-toggle" onClick={() => setParamsJson(!paramsJson)}>
                  {paramsJson ? '原文' : 'JSON'}
                </button>
              </div>
              <pre className="net-value">{truncateLines(paramsJson ? formatJson(request.params) : request.params, 200)}</pre>
            </div>
          ) : null}
          {request.response ? (
            <div className="net-section">
              <div className="net-section-head">
                <div className="net-label">响应</div>
                <button type="button" className="net-json-toggle" onClick={() => setResponseJson(!responseJson)}>
                  {responseJson ? '原文' : 'JSON'}
                </button>
              </div>
              <pre className="net-value net-response">{truncateLines(responseJson ? formatJson(request.response) : request.response, 200)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatJsonCell(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  const str = String(value)
  const dateStr = formatTimestamp(str)
  if (dateStr) return dateStr
  return str
}

function formatTimestamp(value: string): string | null {
  if (!/^\d{10,13}$/.test(value)) return null
  const n = parseInt(value, 10)
  const ms = n > 9999999999 ? n : n * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  const year = d.getFullYear()
  if (year < 2020 || year > 2100) return null
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function truncateUrl(url: string): string {
  if (url.length <= 80) return url
  return url.slice(0, 77) + '…'
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(0, maxLines).join('\n') + '\n…(截断)'
}

function downloadEntry(entry: LogEntry) {
  const downloadBlob =
    entry.extension === 'xlog' && entry.text
      ? new Blob([entry.text], { type: 'text/plain;charset=utf-8' })
      : entry.data

  if (!downloadBlob) return

  const url = URL.createObjectURL(downloadBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = entry.extension === 'xlog'
    ? getXLogTextDownloadName(entry.name)
    : entry.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const escape = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
  const csv = [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n')
  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default App
