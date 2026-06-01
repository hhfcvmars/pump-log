# Pump Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure frontend React workbench that imports encrypted pump log zip archives from pasted upload notifications or local files, then displays extracted files and text details.

**Architecture:** Core parsing and file modeling live in focused TypeScript modules under `src/lib`, with tests written before implementation. The React app consumes those modules and keeps archive import state, file filtering, and file selection in `App.tsx`.

**Tech Stack:** React 19, Vite 8, TypeScript 6, Vitest for logic tests, and `@zip.js/zip.js` for browser-side password zip extraction.

---

### Task 1: Test Harness and Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add dependencies**

Run: `npm install @zip.js/zip.js && npm install -D vitest`

Expected: `package.json` contains `@zip.js/zip.js` in dependencies and `vitest` in devDependencies.

- [ ] **Step 2: Add the test script**

Update `package.json` scripts to include:

```json
"test": "vitest run"
```

- [ ] **Step 3: Verify baseline tests command**

Run: `npm test -- --passWithNoTests`

Expected: Vitest exits successfully with no tests found or no test files.

### Task 2: Notification Parsing

**Files:**
- Create: `src/lib/notificationParser.ts`
- Create: `src/lib/notificationParser.test.ts`

- [ ] **Step 1: Write failing tests**

Cover parsing of the provided notification text, file-name-only inference, missing fields, and URL decoding behavior.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/notificationParser.test.ts`

Expected: tests fail because `parseUploadNotification` and `inferArchiveMetadata` are missing.

- [ ] **Step 3: Implement parser**

Create exported functions:

```ts
export function parseUploadNotification(text: string): ParsedNotification
export function inferArchiveMetadata(fileName: string): ArchiveMetadata
export function buildPassword(serialNumber?: string): string
```

The parser extracts `uploadedAt`, `fileName`, `urlPath`, `serialNumber`, `version`, and `password`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/lib/notificationParser.test.ts`

Expected: all notification parser tests pass.

### Task 3: Log Bundle Modeling

**Files:**
- Create: `src/lib/logBundle.ts`
- Create: `src/lib/logBundle.test.ts`

- [ ] **Step 1: Write failing tests**

Cover size formatting, text/binary detection, sorting by path, filter matching, and line statistics.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/logBundle.test.ts`

Expected: tests fail because bundle helpers are missing.

- [ ] **Step 3: Implement model helpers**

Create exported functions:

```ts
export function createLogBundle(input: CreateLogBundleInput): LogBundle
export function isTextLikePath(path: string): boolean
export function formatFileSize(bytes: number): string
export function filterEntries(entries: LogEntry[], query: string): LogEntry[]
export function getTextStats(text?: string): TextStats
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/lib/logBundle.test.ts`

Expected: all bundle tests pass.

### Task 4: Archive Reading

**Files:**
- Create: `src/lib/archiveReader.ts`

- [ ] **Step 1: Implement browser zip reading**

Use `@zip.js/zip.js` to read a `Blob`, skip directories, decode text-like files through `TextDecoder`, and cap previews to keep the browser responsive.

- [ ] **Step 2: Implement remote download helper**

Create `downloadArchive(url: string): Promise<Blob>` using `fetch`. On network or CORS failure, throw an error message that tells the UI to use local import.

- [ ] **Step 3: Type-check archive module**

Run: `npm run build`

Expected: TypeScript accepts the zip.js imports and archive reader types.

### Task 5: React Workbench UI

**Files:**
- Replace: `src/App.tsx`
- Replace: `src/App.css`
- Replace: `src/index.css`

- [ ] **Step 1: Replace template UI**

Build the import panel, local file picker, password input, status area, file list, and detail pane.

- [ ] **Step 2: Wire import flows**

Pasted notification import parses metadata, downloads the archive, then extracts it. Local file import infers metadata from file name, then extracts it with the password field.

- [ ] **Step 3: Wire viewer behavior**

Filtering updates the left list; selecting a row updates the right details; content search highlights matching lines.

- [ ] **Step 4: Verify build and lint**

Run: `npm run build`

Run: `npm run lint`

Expected: both commands succeed.

### Task 6: Manual Browser Verification

**Files:**
- No code changes expected unless verification finds a defect.

- [ ] **Step 1: Start dev server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite prints a local URL.

- [ ] **Step 2: Open browser**

Open the local URL and verify the layout at desktop size.

- [ ] **Step 3: Verify empty and error states**

Paste invalid notification text and confirm the app explains missing fields. Paste the sample notification and confirm either import starts or the CORS fallback is visible.

- [ ] **Step 4: Verify local zip path**

Select a password-protected zip if available. Confirm the file list populates and selecting text files shows content.
