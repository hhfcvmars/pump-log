# USB PDA Log Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a USB button that exports PDA logs through local ADB and automatically imports the exported files into the current file list.

**Architecture:** Add focused Vite middleware helpers under `src/lib/usbPdaLogServer.ts` and a browser helper under `src/lib/usbPdaLogClient.ts`. The middleware executes ADB, copies the PDA log directory into a temporary local folder, packages the exported files as a zip, and the React app imports that zip through the existing archive reader path.

**Tech Stack:** React 19, Vite middleware, TypeScript, Node child process/fs/path/os modules, `@zip.js/zip.js`, Vitest.

---

### Task 1: USB Server Helper Tests

**Files:**
- Create: `src/lib/usbPdaLogServer.test.ts`
- Create: `src/lib/usbPdaLogServer.ts`

- [ ] **Step 1: Write failing tests for ADB device parsing and export names**

```ts
import { describe, expect, it } from 'vitest'
import { createUsbExportName, parseAdbDevices } from './usbPdaLogServer'

describe('parseAdbDevices', () => {
  it('parses authorized ADB devices with model and product data', () => {
    const devices = parseAdbDevices(`List of devices attached
1696955                device usb:18087936X product:Patch Pump PDA model:Patch_Pump_PDA device:Patch Pump PDA transport_id:7
`)

    expect(devices).toEqual([
      {
        serial: '1696955',
        state: 'device',
        product: 'Patch Pump PDA',
        model: 'Patch_Pump_PDA',
      },
    ])
  })

  it('keeps unauthorized devices so the caller can report them', () => {
    const devices = parseAdbDevices(`List of devices attached
abc123 unauthorized
`)

    expect(devices).toEqual([
      {
        serial: 'abc123',
        state: 'unauthorized',
      },
    ])
  })
})

describe('createUsbExportName', () => {
  it('creates a stable zip name with serial and timestamp', () => {
    expect(createUsbExportName('1696955', new Date('2026-06-02T08:01:02.000Z'))).toBe(
      'EXPORT_MTM_1696955_2026-06-02_08-01-02.zip',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test src/lib/usbPdaLogServer.test.ts`

Expected: FAIL because `src/lib/usbPdaLogServer.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `parseAdbDevices`, `createUsbExportName`, and Vite middleware registration/export logic in `src/lib/usbPdaLogServer.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test src/lib/usbPdaLogServer.test.ts`

Expected: PASS.

### Task 2: USB Client Helper Tests

**Files:**
- Create: `src/lib/usbPdaLogClient.test.ts`
- Create: `src/lib/usbPdaLogClient.ts`

- [ ] **Step 1: Write failing tests for successful and failed USB fetches**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUsbPdaLogArchive } from './usbPdaLogClient'

describe('downloadUsbPdaLogArchive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the archive blob and source name from response headers', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(blob, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="EXPORT_MTM_1696955_2026-06-02_08-01-02.zip"' },
      })),
    )

    await expect(downloadUsbPdaLogArchive()).resolves.toEqual({
      blob,
      sourceName: 'EXPORT_MTM_1696955_2026-06-02_08-01-02.zip',
    })
  })

  it('throws the server-provided error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '未检测到已授权的 ADB 设备' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })),
    )

    await expect(downloadUsbPdaLogArchive()).rejects.toThrow('未检测到已授权的 ADB 设备')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test src/lib/usbPdaLogClient.test.ts`

Expected: FAIL because `src/lib/usbPdaLogClient.ts` does not exist.

- [ ] **Step 3: Implement the client helper**

Create `downloadUsbPdaLogArchive()` that fetches `/api/usb/pda-log`, extracts `filename` from `content-disposition`, and throws JSON error messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test src/lib/usbPdaLogClient.test.ts`

Expected: PASS.

### Task 3: UI Wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `vite.config.ts`

- [ ] **Step 1: Register the Vite middleware**

Import and call `usbPdaLogPlugin()` in `vite.config.ts`.

- [ ] **Step 2: Add USB import state and handler**

Add `importFromUsb()` in `src/App.tsx`. It sets loading status, calls `downloadUsbPdaLogArchive()`, then calls existing `buildBundle()` with metadata inferred from the USB export zip name.

- [ ] **Step 3: Add the toolbar button**

Render `USB` immediately before the existing `导入` button in the file list header.

- [ ] **Step 4: Style the toolbar buttons**

Add a compact `.pane-actions` wrapper and USB button variant that matches the existing workbench.

- [ ] **Step 5: Verify**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Manual: start Vite, click `USB`, and confirm exported PDA files load into the file list.
