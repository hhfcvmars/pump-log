# Pump Log Viewer Design

## Goal

Build a pure frontend log analysis workbench for uploaded PDA pump logs. The first version imports encrypted zip logs, lists extracted files on the left, and shows selected file details on the right. Business-level analysis is intentionally deferred, but the code should keep a clear extension point for future timeline, error, and device summaries.

## Inputs

The app supports two import paths:

- Paste an upload notification such as:

```text
[vcs]2026-05-22 11:21:57
uploadLog, fileName: PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip, urlPath: https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/PDA_MTM-Z2_D00001_Patch+Pump+PDA_version2.3.0_.zip
```

- Select or drag a local zip file.

For pasted notifications, the parser extracts the upload time, file name, URL, SN, version, and default password. The password defaults to `PDA_${SN}`. For the example above, the SN is `D00001` and the password is `PDA_D00001`.

For local zip files, the app still tries to infer the SN and password from the file name. The UI also exposes the password field so the user can correct it when naming conventions change.

## Pure Frontend Constraints

The app does not run a backend service. Notification URL downloads use browser `fetch`, so CloudFront CORS policy can block remote imports. If CORS blocks a download, the app must explain that the browser blocked the request and ask the user to download the zip manually, then import it locally.

Encrypted zip support depends on the browser zip library. The implementation should use a library that supports password-protected archives in the browser. Password errors should be shown clearly and should not lose the import form state.

## Architecture

The first version uses focused frontend modules:

- `notificationParser`: parses pasted upload notifications and infers SN, version, URL, and default password.
- `archiveReader`: reads local or downloaded zip files, applies the password, and returns extracted entries.
- `logBundle`: converts extracted entries into a normalized file list with path, display name, size, modified time, type, and readable text state.
- `textPreview`: identifies text-like files and decodes their content for display.
- UI components in `App.tsx`: import panel, file list, file details, content search, and status messages.

The normalized bundle is the extension point for later business analysis. Future analyzers should consume the same file records instead of re-reading zip entries directly.

## Interface

The page is a workbench, not a landing page. It has a compact import header and a two-pane body.

The left pane shows the extracted file list. Each row displays file name, modified time, size, and type. The list supports filtering by file path/name. Rows remain stable in height so scanning large bundles feels predictable.

The right pane shows details for the selected file. It displays path, size, modified time, line count, a content search box, and the text body with line numbers. Binary files or unsupported files show metadata instead of unreadable content.

The default selection is the first readable text file. If no readable file exists, the first file is selected and the details pane explains that no text preview is available.

## Error Handling

The app distinguishes these states:

- Invalid notification text: show the expected `fileName` and `urlPath` fields.
- Remote download blocked or failed: show the URL and suggest local zip import.
- Missing password: ask for a password before extracting.
- Wrong password or unsupported encryption: show the attempted password and allow retry.
- Empty archive: show an empty state.
- Very large text: decode and display a bounded preview to keep the browser responsive.

## Testing

Core logic should be covered before UI wiring:

- Notification parsing extracts file name, URL, SN, version, and password.
- Local file name inference works when no notification text exists.
- File records are sorted and typed consistently.
- Text detection accepts common log/text files and rejects binary-like extensions.
- Search filtering matches nested paths and file names.

The full app should pass TypeScript build and lint. Manual verification should include local zip import and pasted notification download behavior. If a live CloudFront import is blocked by CORS, the fallback message is considered expected behavior.
