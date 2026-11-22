# Mynd

Mynd is an offline comic reader for Windows 11 x64. It reads image folders, CBZ, CBR, and PDF and keeps your library, tags, reading progress, and settings on your PC.

**0.2.8 Preview** can show the current volume in the library from either reader window and adds a Folders first toggle that works with any sort order. See the [changelog](CHANGELOG.md) for the release history.

## Try the preview

1. Extract `Mynd-win-x64.zip` and keep the extracted files together.
2. Run `Mynd.exe`. The preview is unsigned, so Windows may display a SmartScreen prompt.
3. Select **Add library folder** and choose your comics folder. Use **Settings** to manage roots or turn off automatic watching.

Windows 11 normally includes the Microsoft Edge WebView2 Runtime. If your PC lacks it, install Microsoft's [Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) before opening Mynd. The app works offline after setup.

- Click either half of the artwork to move backward or forward. Double-click to zoom around the pointer at the preset level. The vertical slider runs from your **Default page scale** up to 500%. Drag it in 5-point steps, or use the mouse wheel over the artwork or slider during double-click zoom. Double-click again to return to your default scale. Drag the artwork to pan when it extends beyond the reader. Under **Settings → Reader**, the factory defaults are **Fit height**, **175%** starting zoom, **250 ms** double-click interval, and **10 percentage points** per wheel step. The wheel step can also be set to 5 or 15. The **×** below the reader toolbar closes the current comic and keeps its progress.
- Choose **Paged** or **Vertical scroll** in the reader toolbar or in **Settings → Reader**. In Paged mode, the wheel turns one page in Single or one spread in Two-page. In Vertical scroll mode, the wheel scrolls the comic continuously. During double-click zoom, it changes the zoom percentage.
- Under **Settings → Reader → Comic to open on startup**, choose **None** to start in the library, **Resume last comic** to open at the last-read page, or **Restart last comic** to open at page 1. The default is **None**. The filmstrip remembers its last open or collapsed state independently.
- Each Settings section with preferences has a **Reset to defaults** button. Reader controls auto-hide after **1.5 seconds** by default, with choices from **0.5 to 2 seconds**.
- The bottom corners move between volumes in the same series or among standalone volumes in your library roots. A new volume starts on page one and an existing volume resumes its saved page.
- Click the pill handle above the progress controls to pull out or fold away the filmstrip. The progress bar and volume buttons stay in place, and the bottom controls auto-hide together. Scroll through thumbnails with the mouse wheel, or open **Browse all pages** for a larger grid. Set filmstrip size under **Settings → Reader**. Use **Detach** for a movable reader window and **Reconnect** in its reader toolbar or Windows title-bar menu to dock it.
- Drag the divider or focus it and press the arrow keys to resize the panes. The library toolbar opens cover controls for the active view. The grid and Details list have separate cover sizes. **Settings → Library** also includes title length and series cover styles. **Poker fan** shows up to five volume covers.
- Choose a text size under **Settings → Appearance**. The **Mynd** logo opens the library home. Use **Alt + Up** to go to the parent folder, **Ctrl + F** to search, and **Esc** or a click outside a popup to dismiss it.
- The library header stays in place as you scroll the covers or list. Right-click a folder or volume to show its location in File Explorer. **CBZ**, **CBR**, and **PDF** labels appear beside the page-count row.
- Settings, tags, progress, the saved library index, and thumbnails live under `%LOCALAPPDATA%\Mynd` on a fresh install. If you upgrade from KKomic, Mynd reuses the existing profile under `%LOCALAPPDATA%\KKomic`. Mynd shows the saved index while it verifies library files in the background. It reuses valid thumbnails and generates missing library covers as you browse. Use **Refresh library** for a full rescan. Mynd opens the selected comic files read-only.

For startup diagnostics, set `$env:MYND_TRACE_STARTUP = '1'` in PowerShell before running `Mynd.exe`. Timings for the window, WebView, saved index, verification scan, and first rendered library view are appended to `startup.log` in the active profile folder. They record phase names and elapsed time.

## Build from source

On Windows 11 x64, run this from the repository in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\Build.ps1 -Zip
```

The build uses the x64 .NET Framework compiler and Windows Runtime metadata included on Windows. The first build downloads the pinned Microsoft WebView2 SDK from NuGet. For an offline build, pass `-WebView2SdkPath` with the extracted SDK directory. The portable build and ZIP are written to `dist`.

`src` contains the Windows host, scan and cache logic, and format readers. `ui` contains the local WebView2 interface. The GitHub Actions workflow builds the portable ZIP as a workflow artifact. For a GitHub release, attach `Mynd-win-x64.zip` to the release after checking it on a Windows 11 PC. Keep comic files, personal library data, and the local build cache outside the repository.

The repository is ready to upload with your choice of project license. Third-party license notices are included separately.
