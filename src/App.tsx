import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  downloadArchive,
  readArchive,
  type ProgressCallback,
} from './lib/archiveReader'
import {
  createLogBundle,
  filterEntries,
  type LogBundle,
  type LogEntry,
  type RawArchiveEntry,
} from './lib/logBundle'
import { inferArchiveMetadata, parseUploadNotification } from './lib/notificationParser'

type ImportState = 'idle' | 'loading' | 'ready' | 'error'

type Progress = {
  phase: 'download' | 'extract'
  percent: number
  label: string
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [notificationText, setNotificationText] = useState('')
  const [password, setPassword] = useState('PDA_D00001')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [bundle, setBundle] = useState<LogBundle | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const [fileQuery, setFileQuery] = useState('')
  const [contentQuery, setContentQuery] = useState('')
  const [status, setStatus] = useState<ImportState>('idle')
  const [message, setMessage] = useState('等待导入日志')
  const [progress, setProgress] = useState<Progress | null>(null)

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

    const nextPassword = password || parsed.password
    setPassword(nextPassword)
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
    const nextPassword = password || metadata.password
    setPassword(nextPassword)
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
    if (/\.txt$/i.test(file.name)) {
      void importTextFile(file)
      return
    }

    const metadata = inferArchiveMetadata(file.name)
    setSelectedFile(file)
    setPassword((current) => current || metadata.password)

    if (metadata.password || password) {
      void importLocalFile(file)
    }
  }

  async function importTextFile(file: File) {
    setStatus('loading')
    setProgress(null)
    setMessage(`正在读取 ${file.name}`)

    try {
      const text = await file.text()
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
            <p>日志分析工具</p>
          </div>
        </div>

        <div className="import-right">
          <div className="import-row">
            <textarea
              className="import-textarea"
              value={notificationText}
              onChange={(event) => setNotificationText(event.target.value)}
              spellCheck={false}
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
          accept=".zip,.txt,application/zip,text/plain"
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
            <button
              type="button"
              className="pane-import"
              title="导入日志文件"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              导入
            </button>
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
            {!bundle ? <div className="empty" /> : null}
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
              <h2>等待日志</h2>
              <p>导入后会在这里显示选中文件的详细内容。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

const CHUNK_SIZE = 5000

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
  const [renderedCount, setRenderedCount] = useState(CHUNK_SIZE)
  const [isLoading, setIsLoading] = useState(false)
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
    if (timeFilteredLines.length <= CHUNK_SIZE) {
      setRenderedCount(timeFilteredLines.length)
      setIsLoading(false)
      return
    }

    setRenderedCount(CHUNK_SIZE)
    setIsLoading(true)

    let current = CHUNK_SIZE
    let rafId: number

    function renderNextChunk() {
      current = Math.min(current + CHUNK_SIZE, timeFilteredLines.length)
      setRenderedCount(current)

      if (current < timeFilteredLines.length) {
        rafId = requestAnimationFrame(renderNextChunk)
      } else {
        setIsLoading(false)
      }
    }

    rafId = requestAnimationFrame(renderNextChunk)
    return () => cancelAnimationFrame(rafId)
  }, [timeFilteredLines.length, entry.id, bleFilter, pumpAdFilter, pumpHistoryFilter, networkFilter, deviceInfoFilter, cgmHistoryFilter])

  useEffect(() => {
    if (!normalizedQuery) return
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector('.log-viewer code.hit')
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [normalizedQuery, entry.id])

  const visibleLines = timeFilteredLines.slice(0, renderedCount)
  const loadPercent = timeFilteredLines.length > 0
    ? Math.round((renderedCount / timeFilteredLines.length) * 100)
    : 100

  const historyRecords = useMemo(() => {
    if (!pumpHistoryFilter && !pumpAdFilter) return []
    return visibleLines
      .map(({ line, originalIndex }) => {
        const rec = parsePumpHistoryRecord(line)
        return rec ? { ...rec, key: originalIndex, rawLine: line } : null
      })
      .filter(Boolean)
  }, [visibleLines, pumpHistoryFilter, pumpAdFilter])

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
      } else if (current && line.includes('| RequestParams:{')) {
        current.params = extractValue(line, 'RequestParams:')
      } else if (current && line.includes('| Response:')) {
        current.response = extractValue(line, 'Response:')
      } else if (current && line.includes('----------End:')) {
        current.duration = extractValue(line, 'End:')?.replace(/毫秒-+$/, '') + 'ms'
        requests.push({
          key: current.key!,
          timestamp: current.timestamp ?? '',
          method: current.method ?? '',
          url: current.url ?? '',
          params: current.params ?? '',
          response: current.response ?? '',
          duration: current.duration ?? '',
        })
        current = null
      }
    }
    return requests
  }, [timeFilteredLines, networkFilter])

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
        {entry.truncated ? <span className="warn">文件过大，仅显示前 30 MB</span> : null}
      </div>

      {entry.text ? (
        <div className="log-container">
          {isLoading ? (
            <div className="loading-overlay">
              <div className="loading-box">
                <div className="loading-spinner" />
                <p>正在加载内容...</p>
                <div className="loading-progress">
                  <div style={{ width: `${loadPercent}%` }} />
                </div>
                <small>{renderedCount.toLocaleString()} / {timeFilteredLines.length.toLocaleString()} 行</small>
              </div>
            </div>
          ) : null}
          {networkFilter ? (
            <div className="network-list">
              {networkRequests.map((req) => (
                <NetworkCard key={req.key} request={req} />
              ))}
              {networkRequests.length === 0 ? (
                <div className="detail-empty"><p>没有匹配的网络请求</p></div>
              ) : null}
            </div>
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
          ) : pumpHistoryFilter || pumpAdFilter ? (
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
          ) : (
            <pre className="log-viewer">
              {visibleLines.map(({ line, originalIndex }) => {
                const matched = normalizedQuery && line.toLowerCase().includes(normalizedQuery)
                return (
                  <code key={`${entry.id}-${originalIndex}`} className={matched ? 'hit' : undefined}>
                    <span>{originalIndex + 1}</span>
                    {line || ' '}
                  </code>
                )
              })}
            </pre>
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
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)
  if (!tsMatch) return null
  return {
    timestamp: tsMatch[1],
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
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)
  if (!tsMatch) return null
  return {
    timestamp: tsMatch[1],
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

interface NetworkRequest {
  key: number
  timestamp: string
  method: string
  url: string
  params: string
  response: string
  duration: string
}

function extractTimestamp(line: string): string {
  const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)
  return m?.[1] ?? ''
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

function NetworkCard({ request }: { request: NetworkRequest }) {
  const [expanded, setExpanded] = useState(false)
  const [paramsJson, setParamsJson] = useState(true)
  const [responseJson, setResponseJson] = useState(true)
  const methodColor = request.method === 'POST' ? '#e8a838' : request.method === 'GET' ? '#5b9bd5' : '#7aa2c4'

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
    <div className="net-card">
      <div className="net-card-head" onClick={() => setExpanded(!expanded)}>
        <span className="net-time">{request.timestamp.slice(11, 19)}</span>
        <span className="net-method" style={{ color: methodColor }}>{request.method}</span>
        <span className="net-url">{truncateUrl(request.url)}</span>
        <span className="net-duration">{request.duration}</span>
        <span className="net-expand">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded ? (
        <div className="net-card-body">
          <div className="net-section">
            <div className="net-label">URL</div>
            <pre className="net-value">{request.url}</pre>
          </div>
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
  if (!entry.data) return
  const url = URL.createObjectURL(entry.data)
  const a = document.createElement('a')
  a.href = url
  a.download = entry.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
