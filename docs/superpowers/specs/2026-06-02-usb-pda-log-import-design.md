# USB PDA Log Import Design

## Goal

Add a USB import entry to the file list toolbar so a locally connected Android 9 PDA can export `/sdcard/Android/data/com.microtechmd.pda/cache/pdaLog` through ADB and load the result directly into the current file list.

## Approach

The app remains a Vite/React workbench. Browser code cannot execute `adb`, so USB import is available through a local Vite middleware endpoint while running the dev server. The endpoint runs ADB on the host machine, pulls the PDA log directory into a temporary workspace export folder, packages the exported files as a zip response, and returns that zip to the browser.

The React UI adds a compact `USB` button immediately before the existing `导入` button in the `文件列表` header. Clicking it calls the local endpoint, shows progress/status text, and passes the returned zip blob through the existing archive import path. The loaded files then appear in the same file list as notification and local imports.

## Data Flow

1. User clicks `USB`.
2. Frontend requests `/api/usb/pda-log`.
3. Vite middleware runs `adb devices -l` and `adb pull /sdcard/Android/data/com.microtechmd.pda/cache/pdaLog <export-dir>`.
4. Middleware zips the exported files and returns `application/zip`.
5. Frontend imports the returned blob with password metadata inferred from the generated zip name.

## Error Handling

The endpoint reports clear errors when ADB is missing, no device is authorized, multiple devices require a serial choice, the PDA log directory is missing, or `adb pull` fails. The frontend shows those messages in the existing import status area and keeps the current file list intact until a USB import succeeds.

## Testing

Core server helpers should be tested before UI wiring:

- ADB device output is parsed into usable device records.
- USB export package naming uses stable timestamp and serial data.
- The frontend USB import helper throws the server-provided error message when the endpoint fails.

Manual verification should include a connected PDA, clicking `USB`, and confirming the exported files appear in the file list.
