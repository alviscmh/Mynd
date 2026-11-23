# Mynd changelog

Mynd was called KKomic through version 0.2.5. New versions are listed first.

## 0.3.0

- Evened out library header spacing and aligned the tag icon, folder path, and collection count.
- Added an **IMG** badge next to the page count for volumes stored as folders of images.
- Added new README screenshots and a downloadable library of original manga and comic samples.

## 0.2.9

- Aligned the reader's purple progress fill with the slider dot in single-page and two-page views.
- Added background page counting for CBZ, CBR, and PDF. Counts appear as you browse, are saved across restarts, and refresh when the comic file changes.

## 0.2.8

- Added **Show current volume in library** beside the reader’s Close button. It opens the volume’s containing folder from either reader window. If that folder is already open, the volume’s row moves to the top of the library.
- Added **Folders first** as a saved checkbox that works with either name order or with reading progress. Existing sort preferences keep their previous ordering.
- Added this changelog to the source and portable packages.

## 0.2.7

- Extended the overshoot-and-settle selection animation to the Library and Reader sidebar, All and Any filters, Grid and List views, and Single page and Two-page reader controls. Sped up the shared animation by 25%.
- Animated covers into their new positions when the library grid gains or loses a column, with support for reduced motion.
- Added CBZ, CBR, and PDF badges next to volume page counts, and a translucent right-click **Show in File Explorer** menu for volumes and folders.
- Kept library controls visible while covers scroll. Moved **Library** to the top, with the folder path and counts below it on one line.
- Removed the Done button from About.

## 0.2.6

- Renamed KKomic to **Mynd**, added the Folded M icon, and retained access to existing library data.
- Added separate startup options to open no comic, resume the last comic at its saved page, or restart it at page one. The factory default leaves the reader empty. The filmstrip remembers its open or collapsed state independently.
- Refined the filmstrip handle’s size and spacing, shortened the zoom slider, centered its percentage, and moved the folder icon next to the item count.
- Added a Close button to the reader that preserves reading progress, and reset buttons for each configurable Settings section.
- Set the double-click interval range to 150–350 ms with a 250 ms default. Set the control auto-hide range to 0.5–2 seconds with a 1.5-second default.
- Added a restrained overshoot-and-settle motion to the filmstrip handle and Settings navigation. Widened the startup dropdown to keep its choices on one line and added the developer’s GitHub link to About.

## 0.2.5

- Moved the local interface to a loopback WebView2 origin to eliminate startup DNS waits. Improved rapid restarts by allowing a second runtime data folder while the previous one is closing.
- Reduced redundant startup work and refined incremental library scanning and reuse of unchanged cache entries.
- Kept the progress bar and volume buttons visible and aligned below the filmstrip, with the bottom controls hiding together.

## 0.2.4

- Reused a saved library index at startup, checked for changes in the background, and updated watched branches incrementally. Loaded cover thumbnails as they approached the visible library area and retained manual refresh.
- Corrected the root series count to include top-level folders that directly hold comic pages.
- Added a **Paged / Vertical scroll** selector to the reader toolbar and synchronized it with Settings.
- Added a configurable double-click zoom level with a 175% default. During double-click zoom, the wheel changes zoom in 5, 10, or 15 percentage-point steps. A second double-click returns to the default page scale.
- Refined filmstrip motion, zoom indicator sizing, reader control transparency, and auto-hide timing.

## 0.2.3

- Let users close dropdowns by pressing the trigger again, made settings and dropdowns translucent, and added an Extra Large Details List cover size.
- Corrected Fit height for two-page spreads and added drag-to-pan when zoomed artwork extends beyond the reader.
- Kept the compact zoom slider available while other controls hid, dimmed it when inactive, and used the default page scale as its lower endpoint and double-click reset.
- Widened and lifted the floating progress bar, refined filmstrip motion, and expanded library counts.
- Showed the main window while the library scanned and added opt-in startup diagnostics.

## 0.2.2

- Added Extra Large grid covers, an independent cover size for the Details List, and series and volume counts.
- Centered Settings, anchored smaller settings popups to their panes, and added dropdown open and close animations. Removed the duplicate reading mode setting from the reader menu.
- Integrated the animated filmstrip handle into the progress controls, enlarged the progress bar, and increased the size of reader titles and page numbers.
- Added a double-click zoom slider with a live percentage synced to the toolbar. Removed the 50% zoom preset and added **Default page scale**, initially set to Fit height.

## 0.2.1

- Restored native Windows dragging and window buttons to the compact themed captions and improved caption button sizing.
- Enlarged breadcrumbs, made the app logo return to the library root, added four text-size presets, and extended the focused accent color.
- Made grid cover size and spacing independent, expanded the Poker Fan to five covers, and enlarged the filmstrip with a handle above it.

## 0.2.0

- Added compact themed window captions, a focused third accent color, clearer text sizing, readable page-scale menus, and a one- or two-line library title setting.
- Added an adaptive cover grid, cover sizes and spacing, three series cover styles, and a resizable divider between the library and reader.
- Removed the animated page turn, added configurable single- and double-click timing, and enabled wheel navigation in paged mode.
- Enlarged filmstrip thumbnails, improved detached-reader loading, and added library and dialog shortcuts, including Alt+Up for the parent folder.

## 0.1.0

- First testable KKomic preview for Windows 11 x64, with a portable build and source.
- Read local image folders, CBZ, CBR, and PDF offline. Added watched library folders, nested browsing, search, grid and list views, automatic covers, multi-volume tagging, All and Any filters, and saved reading progress.
- Added single-page, two-page, and vertical reading, page and volume navigation, configurable shortcuts, cursor-centered zoom, themes, and auto-hiding reader controls.
- Added a detachable reader, a wheel-scrollable filmstrip, and an adjustable page thumbnail grid.
