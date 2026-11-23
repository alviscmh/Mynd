(() => {
  const app = document.getElementById('kkomic-viewer');
  const $ = (selector) => app.querySelector(selector);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const settleDuration = parseFloat(getComputedStyle(app).getPropertyValue('--settle-duration'));
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { width: 16, height: 16 } });
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const desktop = window.desktop;
  const archiveFormats = new Set(['CBZ', 'CBR', 'PDF']);
  const libraryRoot = { id: 'libraries', title: 'Library folders', type: 'folder' };
  let byId = { libraries: libraryRoot };
  let sourcePaths = {};
  let childMap = new Map();
  let folderCounts = new Map();
  const isVolume = (entry) => entry && !entry.type;
  const children = (id) => childMap.get(id) || [];
  const descendants = (id) => children(id).flatMap((entry) => entry.type === 'folder' ? [entry, ...descendants(entry.id)] : [entry]);
  const initialPrefs = {
    theme: 'purple', view: 'grid', sort: 'name', foldersFirst: true, mode: 'paged', layout: 'spread', defaultScale: 'height', hide: true, delay: 1.5, watch: true,
    doubleZoomStart: 175, wheelZoomStep: 10,
    startupComic: 'none', filmstripOpen: false,
    clickDelay: 250, titleLines: '2', textSize: 'small', filmSize: 'medium', coverSize: 'medium', listCoverSize: 'medium', coverGap: 'medium', coverStack: 'offset', splitRatio: 40,
  };
  const clickDelays = [150, 200, 250, 300, 350];
  const hideDelays = [.5, 1, 1.5, 2];
  const wheelZoomSteps = [5, 10, 15];
  const startupComics = [['none', 'None'], ['resume', 'Resume last comic'], ['first', 'Restart last comic']];
  const sizeOptions = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
  const extendedSizes = [...sizeOptions, ['extra-large', 'Extra Large']];
  const spacingOptions = [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']];
  const stackOptions = [['offset', 'Angled stack'], ['poker', 'Poker fan'], ['previews', 'Lead cover + previews']];
  const pokerLayouts = {
    2: { width: 58, height: 76, cards: [[41, 9, -10], [61, 13, 12]] },
    3: { width: 54, height: 73, cards: [[50, 8, 0], [33, 14, -15], [67, 14, 15]] },
    4: { width: 48, height: 66, cards: [[44, 9, -5], [56, 12, 7], [29, 20, -17], [71, 20, 17]] },
    5: { width: 42, height: 60, cards: [[50, 8, 0], [39, 14, -10], [61, 14, 10], [28, 24, -20], [72, 24, 20]] },
  };
  const settingsSections = [
    ['appearance', 'Appearance', 'palette'], ['library', 'Library', 'library-big'],
    ['reader', 'Reader', 'book-open'], ['shortcuts', 'Shortcuts', 'keyboard'], ['about', 'About', 'info'],
  ];
  const sectionPreferences = {
    appearance: ['theme', 'textSize'],
    library: ['watch', 'view', 'coverSize', 'coverGap', 'listCoverSize', 'titleLines', 'coverStack'],
    reader: ['startupComic', 'mode', 'layout', 'defaultScale', 'clickDelay', 'doubleZoomStart', 'wheelZoomStep', 'filmSize', 'filmstripOpen', 'hide', 'delay'],
    shortcuts: [],
  };
  const initialKeys = { left: 'ArrowLeft', right: 'ArrowRight', next: ' ', controls: 'h', focus: 'f' };
  const keyLabels = { left: 'Previous page', right: 'Next page', next: 'Advance page', controls: 'Show or hide controls', focus: 'Expand reader' };
  const initialReader = { mode: 'paged', layout: 'spread', zoom: initialPrefs.defaultScale };
  const zoomSteps = [75, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
  const fitModes = [['fit', 'Fit page'], ['width', 'Fit width'], ['height', 'Fit height'], ['fill', 'Fill window'], ['actual', 'Actual size']];
  const zooms = [...fitModes, ...zoomSteps.map((scale) => [String(scale), `${scale}%`])];
  const minZoom = zoomSteps[0];
  const maxZoom = zoomSteps.at(-1);
  const numericZoom = (value) => Number.isInteger(Number(value)) && Number(value) >= minZoom && Number(value) <= maxZoom;
  const normalizeScale = (value, fallback) => String(value) === '50' ? String(minZoom)
    : numericZoom(value) || fitModes.some(([id]) => id === value) ? String(value) : fallback;
  const sortOptions = [['name', 'Name A–Z'], ['reverse', 'Name Z–A'], ['progress', 'Reading progress']];
  let state;
  let search = '';
  let selectionAnchor = '';
  let visibleEntries = [];
  let hideTimer;
  let filmMotionTimer;
  let dialogKind = '';
  let dialogTrigger;
  let lastSaved;
  let role = 'main';
  let openSequence = 0;
  let prefetched = [];
  let scanTimer;
  let scanMessage = '';
  let waitingForLibrary = Boolean(desktop);
  let reportedLibraryFrame = false;
  let filmVolume = '';
  let clickGesture = null;
  let wheelDelta = 0;
  let lastWheel = 0;
  let wheelTurn = 0;
  let settingsSection = 'appearance';
  let detachPreparing = false;
  let dividerDrag = null;
  let readerTicket = null;
  let noticeTimer;
  let zoomAnimation;
  let detailZoomOpen = false;
  let sliderMinimum = 100;
  let fixedZoomScroll = null;
  let pan = null;
  let suppressArtClick = false;
  let appVersion = '';

  const libraryPane = $('.library');
  const libraryScroll = $('.library-scroll');
  const collection = $('.collection');
  const requestedPageCounts = new WeakSet();
  const coverObserver = new IntersectionObserver((entries, observer) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      target.src = target.dataset.coverSrc;
      const volume = byId[target.closest('.entry-open')?.dataset.value];
      if (desktop && role === 'main' && volume && !volume.pages && archiveFormats.has(volume.format) && !requestedPageCounts.has(volume)) {
        requestedPageCounts.add(volume);
        desktop.request('countPages', { id: volume.id, revision: volume.revision }).catch(() => {});
      }
    }
  }, { root: libraryScroll, rootMargin: '120px 0px' });
  const stage = $('.reader-stage');
  const viewport = $('.page-viewport');
  const pages = $('.pages');
  const scrubber = $('.page-scrubber input');
  const dialog = $('.app-dialog');
  const dialogContent = $('.dialog-content');
  const filmstrip = $('.filmstrip');
  const filmItems = $('.film-items');
  const readerDock = $('.reader-dock');
  const sizeFilmstrip = () => readerDock.style.setProperty('--film-height', `${filmItems.offsetHeight}px`);
  new ResizeObserver(sizeFilmstrip).observe(filmItems);
  const filmToggle = $('[data-action="filmstrip"]');
  const zoomPill = $('.detail-zoom');
  const zoomSlider = $('#kkomic-detail-zoom');
  const zoomPicker = $('[data-action="scale-menu"]');
  const scaleMenu = $('.scale-menu');
  const entryMenu = $('.entry-menu');
  let entryMenuTrigger;
  let entryMenuScrollTop;
  const dropdown = document.createElement('div');
  dropdown.id = 'kkomic-dropdown';
  dropdown.className = 'option-menu';
  dropdown.setAttribute('popover', 'auto');
  dropdown.setAttribute('role', 'listbox');
  app.append(dropdown);
  let dropdownTrigger;
  const workspace = $('.workspace');
  const divider = $('.split-divider');
  const notice = $('.reader-notice');
  const scrollbarMeasure = document.createElement('div');
  scrollbarMeasure.className = 'scrollbar-measure';
  scrollbarMeasure.setAttribute('aria-hidden', 'true');
  stage.append(scrollbarMeasure);
  const gridResize = new ResizeObserver(() => { if (dialog.open && dialogKind === 'page-grid') resizePageGrid(); });
  const dialogResize = new ResizeObserver(positionAnchoredDialog);
  const scaleItems = (options) => options.map(([value, label]) => `<button type="button" data-action="set-scale" data-value="${value}" aria-pressed="false">${label}</button>`).join('');
  scaleMenu.innerHTML = `<h3>Fit and display</h3>${scaleItems(fitModes)}<h3>Percent of fit page</h3>${scaleItems(zooms.slice(fitModes.length))}`;

  const translate = (x, y) => `translate(${x}px, ${y}px)`;
  function animateSettle(element, from, to, maxOvershoot = 5) {
    const { x: startX, y: startY, ...startSize } = from;
    const { x, y, ...endSize } = to;
    const distance = Math.hypot(x - startX, y - startY);
    const overshoot = distance ? Math.min(maxOvershoot / distance, .12) : 0;
    return element.animate([
      { ...startSize, transform: translate(startX, startY), easing: 'cubic-bezier(.39,0,.24,1)' },
      { ...endSize, transform: translate(x + (x - startX) * overshoot, y + (y - startY) * overshoot), offset: .8, easing: 'cubic-bezier(.22,.7,.32,1)' },
      { ...endSize, transform: translate(x, y) },
    ], { duration: settleDuration });
  }

  let coverColumnCount = 0;
  const coverPositions = new Map();
  const coverAnimations = new WeakMap();

  function updateCoverPositions() {
    if (collection.dataset.view !== 'grid' || !collection.clientWidth) {
      coverColumnCount = 0;
      coverPositions.clear();
      return;
    }
    const columns = getComputedStyle(collection).gridTemplateColumns.split(' ').length;
    if (columns === coverColumnCount) return;
    const animate = coverColumnCount !== 0 && !reducedMotion.matches;
    coverColumnCount = columns;
    const bounds = collection.getBoundingClientRect();
    const frame = libraryScroll.getBoundingClientRect();
    const moves = [];
    for (const tile of collection.children) {
      if (!tile.matches('.entry')) continue;
      const previous = coverPositions.get(tile);
      const x = tile.offsetLeft;
      const y = tile.offsetTop;
      coverPositions.set(tile, { x, y });
      if (!previous || (previous.x === x && previous.y === y)) continue;
      const motion = coverAnimations.get(tile);
      const height = tile.offsetHeight;
      if (animate && bounds.top + Math.max(previous.y, y) + height >= frame.top && bounds.top + Math.min(previous.y, y) <= frame.bottom) {
        const carry = motion?.playState === 'running' ? new DOMMatrixReadOnly(getComputedStyle(tile).transform) : null;
        moves.push({ tile, motion, x: previous.x - x + (carry?.m41 || 0), y: previous.y - y + (carry?.m42 || 0) });
      } else if (motion) {
        moves.push({ tile, motion });
      }
    }
    for (const { tile, motion, x, y } of moves) {
      motion?.cancel();
      if (x || y) coverAnimations.set(tile, animateSettle(tile, { x, y }, { x: 0, y: 0 }));
    }
  }

  new ResizeObserver(updateCoverPositions).observe(collection);

  function load(saved = {}) {
    state = {
      folder: 'libraries', current: null, lastVolume: null, pageOverride: null, workspace: 'split', match: 'any', detached: false, gridColumns: 4,
      filters: [], selected: [], groups: [], catalog: [], ...saved, sources: [],
      prefs: { ...initialPrefs, ...saved.prefs }, keys: { ...initialKeys, ...saved.keys }, reader: { ...initialReader, ...saved.reader },
      progress: { ...saved.progress }, volumeTags: { ...saved.volumeTags },
    };
    // The old implicit Fit page default migrates to Fit height. Keep other saved choices.
    if (!saved.prefs?.defaultScale && saved.prefs?.zoom !== 'fit') {
      state.prefs.defaultScale = normalizeScale(saved.prefs?.zoom, initialPrefs.defaultScale);
    }
    delete state.prefs.zoom;
    delete state.detailZoom;
    if (!saved.current || !saved.reader?.zoom) state.reader.zoom = state.prefs.defaultScale;
    normalizeReaderPreferences();
    if (!Number.isInteger(state.gridColumns) || state.gridColumns < 2 || state.gridColumns > 6) state.gridColumns = 4;
    selectionAnchor = state.selected.at(-1) || '';
  }

  function normalizeReaderPreferences() {
    for (const options of [state.reader, state.prefs]) {
      if (!['paged', 'continuous'].includes(options.mode)) options.mode = 'paged';
    }
    if (!clickDelays.includes(state.prefs.clickDelay)) state.prefs.clickDelay = initialPrefs.clickDelay;
    if (!hideDelays.includes(state.prefs.delay)) state.prefs.delay = initialPrefs.delay;
    if (!wheelZoomSteps.includes(state.prefs.wheelZoomStep)) state.prefs.wheelZoomStep = initialPrefs.wheelZoomStep;
    if (!numericZoom(state.prefs.doubleZoomStart)) state.prefs.doubleZoomStart = initialPrefs.doubleZoomStart;
    if (!startupComics.some(([id]) => id === state.prefs.startupComic)) state.prefs.startupComic = initialPrefs.startupComic;
    if (!Number.isFinite(state.prefs.splitRatio)) state.prefs.splitRatio = initialPrefs.splitRatio;
    state.prefs.defaultScale = normalizeScale(state.prefs.defaultScale, initialPrefs.defaultScale);
    state.reader.zoom = normalizeScale(state.reader.zoom, state.prefs.defaultScale);
  }

  function save() {
    if (!lastSaved) return;
    const patch = {};
    for (const key of Object.keys(state)) {
      if (key === 'sources' || key === 'detached') continue;
      if (mapFields.has(key)) {
        const updates = Object.fromEntries(Object.entries(state[key]).filter(([id, item]) => !same(item, lastSaved[key]?.[id])));
        if (Object.keys(updates).length) patch[key] = updates;
      } else if (!same(state[key], lastSaved[key])) patch[key] = state[key];
    }
    lastSaved = structuredClone(state);
    if (Object.keys(patch).length) desktop.request('save', patch).catch(showError);
  }

  const mapFields = new Set(['prefs', 'keys', 'progress', 'volumeTags']);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const showError = (error) => {
    const message = error.message || String(error);
    showNotice(message);
    if (!current().pages || (state.detached && role === 'main')) {
      clearTimeout(scanTimer);
      scanMessage = message;
      renderLibraryStatus();
      scanTimer = setTimeout(() => { scanMessage = ''; renderLibraryStatus(); }, 6000);
    }
  };

  function useCatalog(catalog) {
    const wasWaiting = waitingForLibrary;
    waitingForLibrary = false;
    const firstRoot = state.sources.length === 0;
    const previousEntry = current();
    byId = { libraries: libraryRoot, ...Object.fromEntries(catalog.entries.map((entry) => [entry.id, entry])) };
    sourcePaths = Object.fromEntries(catalog.roots.map((root) => [root.id, root]));
    state.sources = catalog.roots.map((root) => root.id);
    childMap = new Map();
    for (const entry of catalog.entries) {
      if (!childMap.has(entry.parent)) childMap.set(entry.parent, []);
      childMap.get(entry.parent).push(entry);
    }
    folderCounts = new Map();
    function countFolder(folder) {
      const count = { volumes: 0, subseries: 0 };
      for (const entry of children(folder)) {
        if (isVolume(entry)) count.volumes++;
        if (entry.type !== 'folder') continue;
        const nested = countFolder(entry.id);
        count.volumes += nested.volumes;
        if (nested.volumes && !Object.hasOwn(sourcePaths, entry.id)) count.subseries++;
      }
      folderCounts.set(folder, count);
      return count;
    }
    countFolder(libraryRoot.id);
    if (!byId[state.folder] || (firstRoot && state.folder === 'libraries' && state.sources.length === 1)) {
      state.folder = state.sources.length === 1 ? state.sources[0] : 'libraries';
    }
    if (wasWaiting && state.current && !isVolume(byId[state.current])) {
      if (byId[state.current] && state.lastVolume === state.current) state.lastVolume = null;
      state.current = null;
      state.pageOverride = null;
      state.workspace = 'split';
      if (role === 'main') save();
    }
    state.selected = state.selected.filter((id) => isVolume(byId[id]));
    renderLibrary();
    if (desktop && role === 'main' && !reportedLibraryFrame) {
      reportedLibraryFrame = true;
      requestAnimationFrame(() => requestAnimationFrame(() => desktop.request('libraryFrame').catch(() => {})));
    }
    if (previousEntry.id !== current().id || previousEntry.revision !== current().revision) {
      if (current().id && (!current().pages || archiveFormats.has(current().format))) {
        if (wasWaiting) renderReader(false);
        openVolume(current().id, true);
      }
      else renderReader();
    } else if (wasWaiting) renderReader(false);
  }

  const pathTo = (id) => {
    const path = [byId[id]];
    for (let parent = byId[id].parent; parent; parent = byId[parent].parent) path.unshift(byId[parent]);
    return path;
  };
  const percentage = (entry) => entry.pages ? Math.min(100, Math.round((state.progress[entry.id] || 0) / entry.pages * 100)) : 0;

  function matches(entry) {
    if (!state.filters.length) return true;
    if (entry.type === 'folder') return descendants(entry.id).some((child) => isVolume(child) && matches(child));
    if (!isVolume(entry)) return false;
    const tags = state.volumeTags[entry.id] || [];
    return state.match === 'all' ? state.filters.every((tag) => tags.includes(tag)) : state.filters.some((tag) => tags.includes(tag));
  }

  function getEntries() {
    const term = search.trim().toLocaleLowerCase();
    const items = term ? descendants(state.folder) : children(state.folder);
    const alpha = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true });
    const sorters = {
      name: alpha, reverse: (a, b) => alpha(b, a),
      progress: (a, b) => (percentage(b) || 0) - (percentage(a) || 0) || alpha(a, b),
    };
    const sort = sorters[state.prefs.sort];
    return items.filter((entry) => (!term || entry.title.toLocaleLowerCase().includes(term)) && matches(entry)).sort((a, b) => {
      const folders = state.prefs.foldersFirst ? Number(b.type === 'folder') - Number(a.type === 'folder') : 0;
      return folders || sort(a, b);
    });
  }

  function cover(entry) {
    const layer = (id, position, style) => id ? `<span class="book-cover ${position}"${style ? ` style="${style}"` : ''}><img decoding="async" alt="" data-cover-src="${mediaUrl(byId[id], 1, true)}"></span>` : '';
    if (entry.type === 'folder') {
      const allowed = stackOptions.some(([value]) => value === state.prefs.coverStack) ? state.prefs.coverStack : 'offset';
      const valid = (entry.covers || []).filter((id) => byId[id]);
      const volumes = valid.filter((id) => isVolume(byId[id]));
      const covers = allowed === 'poker' ? (volumes.length ? volumes : valid).slice(0, 5) : valid.slice(0, 3);
      const [front, back, middle] = covers;
      const fan = allowed === 'poker' ? pokerLayouts[covers.length] : null;
      const cards = fan
        ? covers.map((id, index) => {
            const [x, y, angle] = fan.cards[index];
            return layer(id, 'poker-card', `--fan-x:${x}%;--fan-y:${y}%;--fan-angle:${angle}deg;--fan-width:${fan.width}%;--fan-height:${fan.height}%;z-index:${covers.length - index}`);
          }).join('')
        : layer(middle, 'middle') + layer(back, 'back') + layer(front, 'front');
      return `<span class="cover-art stack stack-${allowed}" data-covers="${covers.length}" aria-hidden="true">${cards}</span>`;
    }
    const read = isVolume(entry) ? percentage(entry) : 0;
    const bar = read ? `<span class="tile-progress" role="progressbar" aria-label="Reading progress" aria-valuenow="${read}"><i style="width:${read}%"></i></span>` : '';
    return `<span class="cover-art">${layer(entry.id, 'front')}${bar}</span>`;
  }

  function entryMarkup(entry) {
    const selected = state.selected.includes(entry.id);
    const count = (amount, noun) => `${amount} ${noun}${amount === 1 ? '' : 's'}`;
    const detail = entry.type === 'folder' ? count(children(entry.id).length, 'item')
      : entry.type === 'image' ? entry.format : pageCountLabel(entry.pages);
    const format = entry.format === 'Image folder' ? 'IMG' : archiveFormats.has(entry.format) ? entry.format : '';
    const folderIcon = entry.type === 'folder' ? icon('folder') : '';
    const check = isVolume(entry) ? `<button class="select-volume" type="button" data-action="select-volume" data-value="${entry.id}" aria-label="Select ${escape(entry.title)}" aria-pressed="${selected}" title="Select ${escape(entry.title)}">${selected ? icon('check') : ''}</button>` : '';
    const meta = format ? `<span class="entry-detail entry-format-row"><span class="entry-page-count" title="${escape(detail)}">${escape(detail)}</span><span class="entry-format" title="${entry.format}">${format}</span></span>`
      : `<span class="entry-detail" title="${escape(detail)}">${escape(detail)}${folderIcon}</span>`;
    return `<div class="entry" data-selected="${selected}" data-current="${entry.id === state.current}"><button type="button" class="entry-open" data-action="entry" data-value="${entry.id}">${cover(entry)}<span class="entry-title" title="${escape(entry.title)}">${escape(entry.title)}</span>${meta}</button>${check}</div>`;
  }

  function renderLibrary(preserveFocus = true) {
    const focused = document.activeElement;
    const focusAction = focused?.dataset.action;
    const focusValue = focused?.dataset.value;
    const restore = preserveFocus && $('.library').contains(focused) && focusAction;
    const path = pathTo(byId[state.folder] ? state.folder : libraryRoot.id)
      .filter((part) => part.id !== 'libraries' || state.sources.length !== 1 || state.folder === 'libraries');
    const breadcrumbs = $('.breadcrumbs');
    breadcrumbs.innerHTML = path.map((entry, index) =>
      `${index ? icon('chevron-right') : ''}<button type="button" data-action="folder" data-value="${entry.id}" title="${escape(entry.title)}" ${entry.id === state.folder ? 'aria-current="location"' : ''}>${index ? '' : icon('folder-open')}<span>${escape(entry.title)}</span></button>`).join('');
    const featured = [...new Set([...state.catalog.slice(0, 2), ...state.filters])];
    $('.filter-list').innerHTML = `${icon('tags')}${featured.map((tag) => `<button class="tag-filter" type="button" data-action="filter" data-value="${escape(tag)}" aria-pressed="${state.filters.includes(tag)}">${escape(tag)}</button>`).join('')}<button class="icon" type="button" data-action="filter-dialog" aria-label="More tags and saved groups" title="More tags and saved groups">${icon('plus')}</button>`;
    const count = state.selected.length;
    const selectionBar = $('.selection-bar');
    selectionBar.dataset.selected = Boolean(count);
    selectionBar.innerHTML = count ? `<span class="selection-label">${icon('check-square')} <strong>${count} selected</strong></span><span class="selection-actions"><button class="primary" type="button" data-action="tag">Tag volumes</button><button class="icon" type="button" data-action="clear-selection" aria-label="Clear selection" title="Clear selection">${icon('x')}</button></span>` : `<span class="selection-label">${icon('check-square')} Select volumes to tag</span>`;
    const entries = getEntries();
    if (libraryScroll.style.getPropertyValue('--library-reveal-tail') &&
      (entries.length !== visibleEntries.length || entries.some((entry, index) => entry.id !== visibleEntries[index].id))) {
      libraryScroll.style.removeProperty('--library-reveal-tail');
    }
    visibleEntries = entries;
    renderLibraryStatus();
    collection.dataset.view = state.prefs.view;
    collection.dataset.titleLines = state.prefs.titleLines;
    collection.dataset.coverSize = state.prefs.coverSize;
    collection.dataset.listCoverSize = state.prefs.listCoverSize;
    collection.dataset.coverGap = state.prefs.coverGap;
    const coverOptions = $('[data-action="cover-options"]');
    const coverLabel = state.prefs.view === 'list' ? 'Details list cover size' : 'Cover grid size and spacing';
    coverOptions.title = coverLabel;
    coverOptions.setAttribute('aria-label', coverLabel);
    $('.library').setAttribute('aria-busy', waitingForLibrary);
    coverObserver.disconnect();
    if (entryMenu.matches(':popover-open')) entryMenu.hidePopover();
    coverColumnCount = 0;
    coverPositions.clear();
    collection.innerHTML = waitingForLibrary ? '' : visibleEntries.length ? visibleEntries.map(entryMarkup).join('') : state.sources.length
      ? '<p class="empty">No comics in this view.</p>' : '<div class="empty">Choose a folder with your comics.<br><button class="primary" type="button" data-action="add-source">Add library folder</button></div>';
    for (const image of collection.querySelectorAll('[data-cover-src]')) coverObserver.observe(image);
    syncDropdown($('[data-change="sort"]'), state.prefs.sort);
    setSelection($('.view-buttons'), state.prefs.view);
    setSelection($('.match-buttons'), state.match);
    refreshIcons();
    breadcrumbs.scrollLeft = breadcrumbs.scrollWidth;
    updateCoverPositions();
    if (restore && !focused.isConnected) {
      [...$('.library').querySelectorAll('button')].find((button) => button.dataset.action === focusAction && button.dataset.value === focusValue)?.focus({ preventScroll: true });
    }
  }

  function renderLibraryStatus() {
    const isRoot = state.folder === libraryRoot.id || Object.hasOwn(sourcePaths, state.folder);
    const count = folderCounts.get(state.folder);
    const volumes = count?.volumes ?? 0;
    const series = state.folder === libraryRoot.id
      ? state.sources.reduce((sum, id) => sum + (byId[id]?.directFolders || 0), 0)
      : isRoot ? (byId[state.folder]?.directFolders || 0) : (count?.subseries || 0);
    $('.item-count').textContent = scanMessage || (waitingForLibrary ? 'Scanning library…' : `${series} ${isRoot ? 'series' : 'subseries'} · ${volumes} ${volumes === 1 ? 'volume' : 'volumes'}`);
  }

  async function refreshLibrary() {
    clearTimeout(scanTimer);
    scanMessage = state.sources.length ? 'Scanning folders…' : 'No library folders';
    const refresh = $('.refresh-button');
    refresh.setAttribute('aria-busy', 'true');
    renderLibraryStatus();
    try {
      useCatalog(await desktop.request('scan'));
      scanMessage = state.sources.length ? 'Library up to date' : 'No library folders';
    } catch (error) {
      scanMessage = 'Could not refresh library';
      showError(error);
    } finally {
      refresh.removeAttribute('aria-busy');
      renderLibrary();
      scanTimer = setTimeout(() => { scanMessage = ''; renderLibraryStatus(); }, 2200);
    }
  }

  const emptyEntry = { id: null, pages: 0 };
  const current = () => byId[state.current] || emptyEntry;
  const page = () => Math.max(1, Math.min(current().pages, state.pageOverride ?? state.progress[state.current] ?? 1));
  const scrolling = () => current().pages > 0 && state.reader.mode === 'continuous' && current().type !== 'image';
  const spread = () => current().pages > 0 && state.reader.layout === 'spread' && !scrolling() && current().type !== 'image';
  const mediaUrl = (entry, number, thumb = false, scale = 2400) =>
    `/media/${thumb ? 'thumb' : 'page'}/${entry.id}/${number}?v=${entry.revision || ''}${entry.format === 'PDF' && !thumb ? `&scale=${scale}` : ''}`;

  function thumbnails() {
    const entry = current();
    return Array.from({ length: entry.pages }, (_, index) => {
      const number = index + 1;
      return `<button type="button" class="page-thumb" data-action="jump-page" data-value="${number}" aria-label="Go to page ${number}" ${number === page() ? 'aria-current="page"' : ''}><img class="thumb-art" loading="lazy" decoding="async" alt="" src="${mediaUrl(entry, number, true)}"><span>${number}</span></button>`;
    }).join('');
  }

  function resizePageGrid() {
    const grid = $('.page-grid');
    const slider = $('[data-grid-columns]');
    const gap = parseFloat(getComputedStyle(grid).columnGap);
    const contentWidth = grid.clientWidth - 6;
    const max = Math.max(2, Math.min(6, Math.floor((contentWidth + gap) / (94 + gap))));
    const min = max < 4 ? 2 : 3;
    const columns = Math.max(min, Math.min(max, state.gridColumns));
    const gridTop = grid.getBoundingClientRect().top;
    const changing = grid.dataset.columns && Number(grid.dataset.columns) !== columns;
    const anchor = changing && grid.scrollTop > 0 ? [...grid.children].find((tile) => tile.getBoundingClientRect().bottom > gridTop + 3) : null;
    const previousTop = anchor?.getBoundingClientRect().top;
    grid.dataset.columns = columns;
    grid.style.setProperty('--grid-columns', columns);
    if (anchor) grid.scrollTop += anchor.getBoundingClientRect().top - previousTop;
    slider.min = min;
    slider.max = max;
    slider.value = columns;
    slider.disabled = min === max;
    const value = `${columns} across`;
    slider.setAttribute('aria-valuetext', value);
    $('.page-grid-size output').value = value;
  }

  function renderFilmstrip() {
    filmstrip.dataset.size = state.prefs.filmSize;
    const visible = state.prefs.filmstripOpen === true && current().pages > 0;
    readerDock.dataset.filmOpen = visible;
    filmstrip.inert = !visible;
    filmToggle.setAttribute('aria-expanded', visible);
    filmToggle.setAttribute('aria-label', visible ? 'Hide filmstrip' : 'Show filmstrip');
    filmToggle.title = filmToggle.getAttribute('aria-label');
    if (!visible) return;
    const version = state.current + ':' + current().revision + ':' + current().pages;
    if (filmVolume !== version) {
      filmItems.innerHTML = thumbnails();
      filmVolume = version;
    }
    sizeFilmstrip();
    filmItems.querySelector('[aria-current]')?.removeAttribute('aria-current');
    const active = filmItems.children[page() - 1];
    if (active) {
      active.setAttribute('aria-current', 'page');
      const frame = filmItems.getBoundingClientRect();
      const tile = active.getBoundingClientRect();
      if (tile.left < frame.left || tile.right > frame.right) filmItems.scrollLeft += tile.left + tile.width / 2 - frame.left - frame.width / 2;
    }
  }

  function readerStatus() {
    const first = page();
    const total = current().pages;
    const last = spread() && first < total ? first + 1 : first;
    const display = first === last ? String(first) : `${first}–${last}`;
    scrubber.value = first;
    scrubber.style.setProperty('--progress', (first - 1) / Math.max(1, total - 1));
    scrubber.setAttribute('aria-valuetext', `${display} of ${total}`);
    $('.page-number').textContent = `${display} / ${total}`;
    $('[data-value="left"][data-action="arrow"]').disabled = first <= 1;
    $('[data-value="right"][data-action="arrow"]').disabled = last >= total;
    renderFilmstrip();
  }

  function renderReader(rebuild = true) {
    const entry = current();
    app.dataset.theme = state.prefs.theme;
    app.dataset.textSize = state.prefs.textSize;
    app.dataset.workspace = state.workspace;
    app.dataset.detached = state.detached;
    for (const field of app.querySelectorAll('[data-setting="mode"]')) syncDropdown(field, state.prefs.mode);
    layoutSplit();
    setSelection($('.workspace-nav'), state.detached ? 'split' : state.workspace);
    const detach = $('.rail-detach');
    detach.setAttribute('aria-pressed', state.detached);
    detach.setAttribute('aria-label', state.detached ? 'Reconnect reader' : 'Detach reader');
    detach.title = detach.getAttribute('aria-label');
    detach.disabled = detachPreparing || (!entry.pages && !state.detached);
    detach.setAttribute('aria-busy', detachPreparing);
    detach.querySelector('span').textContent = detachPreparing ? 'Opening…' : state.detached ? 'Dock' : 'Detach';
    stage.dataset.empty = !entry.pages;
    $('[data-action="reveal-volume"]').hidden = !isVolume(entry);
    $('.reader-empty').hidden = Boolean(entry.pages);
    $('.reader-empty [data-action="add-source"]').hidden = waitingForLibrary || state.sources.length > 0 || role === 'reader';
    $('.reader-empty-text').textContent = waitingForLibrary ? 'Scanning your library…' : state.sources.length ? 'Choose a volume from your library.' : 'Add a folder to start your library.';
    if (!entry.pages) { zoomPill.hidden = true; pages.replaceChildren(); refreshIcons(); return; }
    $('.reading-title').textContent = entry.title;
    $('.reading-title').title = [...pathTo(entry.parent).slice(1).map((parent) => parent.title), entry.title].join(' / ');
    $('.reading-path').textContent = entry.format === 'Image folder' ? '' : entry.format;
    const layouts = $('.layout-buttons');
    for (const button of layouts.querySelectorAll('button')) button.disabled = scrolling() || entry.type === 'image';
    setSelection(layouts, spread() ? 'spread' : 'single');
    scrubber.max = entry.pages;
    scrubber.disabled = entry.pages <= 1;
    for (const button of app.querySelectorAll('[data-action="volume"]')) button.disabled = !isVolume(entry);
    stage.dataset.layout = spread() && page() < entry.pages ? 'spread' : 'single';
    stage.dataset.scroll = scrolling();
    readerStatus();
    if (rebuild) {
      zoomAnimation?.cancel();
      fixedZoomScroll = null;
      const first = page();
      const numbers = scrolling() ? Array.from({ length: entry.pages }, (_, index) => index + 1) : spread() && first < entry.pages ? [first, first + 1] : [first];
      pages.dataset.layout = stage.dataset.layout;
      const loading = scrolling() ? 'lazy' : 'eager';
      pages.innerHTML = numbers.map((number) => `<img class="comic-page" alt="Comic page ${number}" draggable="false" loading="${loading}" decoding="async" data-page="${number}" src="${mediaUrl(entry, number, false, pdfScale())}">`).join('');
      applyZoom();
      if (scrolling()) scrollToPage();
      else {
        viewport.scrollTo(0, 0);
        prefetch(entry, first, numbers.length);
      }
    }
    refreshIcons();
  }

  function pdfScale() {
    return Number(state.reader.zoom) >= 200 ? 4400 : 2400;
  }

  function prefetch(entry, first, displayed) {
    const candidates = [first + displayed, first + displayed + (spread() ? 1 : 0), Math.max(1, first - (spread() ? 2 : 1))];
    prefetched = [...new Set(candidates)].filter((number) => number < first || (number >= first + displayed && number <= entry.pages)).map((number) => {
      const image = new Image();
      image.fetchPriority = 'low';
      image.src = mediaUrl(entry, number, false, pdfScale());
      return image;
    });
  }

  function zoomGeometry() {
    const { offsetWidth: width, offsetHeight: height } = viewport;
    const spreadFrame = stage.dataset.layout === 'spread';
    const density = spreadFrame ? 1.5 : .75;
    const gap = spreadFrame ? 2 : 0;
    const barWidth = scrollbarMeasure.offsetWidth - scrollbarMeasure.clientWidth;
    const barHeight = scrollbarMeasure.offsetHeight - scrollbarMeasure.clientHeight;
    const heightWidth = height * density + gap;
    const fit = Math.min(width, heightWidth);
    const verticallyScrolling = scrolling() && current().pages > 1;
    const usableWidth = verticallyScrolling || width > heightWidth ? Math.max(0, width - barWidth) : width;
    const availableAtHeight = verticallyScrolling ? Math.max(0, width - barWidth) : width;
    const atHeight = heightWidth > availableAtHeight
      ? Math.max(availableAtHeight, heightWidth - barHeight * density)
      : heightWidth;
    const nativeWidth = () => {
      const images = scrolling() ? [pages.children[page() - 1]] : [...pages.children];
      const width = current().format === 'PDF' ? 0 : Math.max(0, ...images.map((image) => image?.naturalWidth || 0));
      return (width || 380) * (spreadFrame ? 2 : 1) + gap;
    };
    return {
      fit,
      widthFor(value) {
        if (numericZoom(value)) return fit * Number(value) / 100;
        if (value === 'width') return usableWidth;
        if (value === 'height') return atHeight;
        if (value === 'fill') return Math.max(usableWidth, atHeight);
        if (value === 'actual') return nativeWidth();
        return verticallyScrolling ? Math.min(usableWidth, heightWidth) : fit;
      },
    };
  }

  function sliderLevel(position) {
    return Math.min(maxZoom, sliderMinimum + position * 5);
  }

  function changeSliderZoom(level, persist = true, point) {
    if (level === sliderMinimum) {
      changeZoom(state.prefs.defaultScale, point, false);
      if (persist) save();
    } else {
      manualZoom(String(level), point, false, persist);
    }
  }

  function applyZoom() {
    const value = state.reader.zoom;
    const geometry = zoomGeometry();
    const width = geometry.widthFor(value);
    stage.dataset.zoom = value;
    pages.style.setProperty('--page-width', `${width}px`);
    const level = geometry.fit ? 100 * width / geometry.fit : 100;
    const percent = `${Math.round(level)}%`;
    const fitLabel = fitModes.find(([key]) => key === value)?.[1];
    zoomPill.hidden = !detailZoomOpen;
    zoomPicker.querySelector('span').textContent = fitLabel && zoomPill.hidden ? fitLabel : percent;
    zoomPicker.title = fitLabel ? `${fitLabel} · ${percent}` : percent;
    zoomPicker.setAttribute('aria-label', `Page scale: ${zoomPicker.title}`);
    if (!zoomPill.hidden) {
      const minimum = geometry.fit ? Math.round(100 * geometry.widthFor(state.prefs.defaultScale) / geometry.fit) : minZoom;
      sliderMinimum = Math.max(minZoom, Math.min(maxZoom, minimum));
      const bounded = Math.max(sliderMinimum, Math.min(maxZoom, level));
      const maxPosition = Math.ceil((maxZoom - sliderMinimum) / 5);
      const position = bounded === maxZoom ? maxPosition : Math.round((bounded - sliderMinimum) / 5);
      zoomSlider.max = maxPosition;
      zoomSlider.disabled = maxPosition === 0;
      zoomSlider.value = position;
      zoomSlider.setAttribute('aria-valuetext', `${percent}, minimum ${minimum}%`);
      $('.detail-zoom-value').value = percent;
      zoomPill.style.setProperty('--zoom-position', `${maxPosition ? (bounded - sliderMinimum) / (maxZoom - sliderMinimum) * 100 : 0}%`);
    }
    for (const item of scaleMenu.querySelectorAll('button')) item.setAttribute('aria-pressed', item.dataset.value === value);
    $('[data-action="zoom-step"][data-value="out"]').disabled = level <= minZoom + .25;
    $('[data-action="zoom-step"][data-value="in"]').disabled = level >= maxZoom - .25;
    viewport.dataset.pannable = viewport.scrollWidth > viewport.clientWidth + 1 ||
      (viewport.scrollHeight > viewport.clientHeight + 1 && (!scrolling() || detailZoomOpen || level > 100.5));
    stage.style.setProperty('--scrollbar-inset', `${viewport.offsetHeight - viewport.clientHeight}px`);
  }

  function changeZoom(value, point, animate = true) {
    if (!current().pages) return;
    if (value === state.reader.zoom) { applyZoom(); return; }
    cancelPageClick();
    const frame = viewport.getBoundingClientRect();
    const x = point?.clientX ?? frame.left + frame.width / 2;
    const y = point?.clientY ?? frame.top + frame.height / 2;
    const tile = point?.target?.closest('.comic-page') || document.elementFromPoint(x, y)?.closest('.comic-page') || pages.querySelector(`[data-page="${page()}"]`);
    const before = tile.getBoundingClientRect();
    const fraction = (pixel, start, size) => Math.max(0, Math.min(1, (pixel - start) / size));
    zoomAnimation?.cancel();
    state.reader.zoom = value;
    applyZoom();
    const resized = tile.getBoundingClientRect();
    viewport.scrollBy(resized.left + resized.width * fraction(x, before.left, before.width) - x, resized.top + resized.height * fraction(y, before.top, before.height) - y);
    fixedZoomScroll = viewport.scrollTop;
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const after = tile.getBoundingClientRect();
      const origin = pages.getBoundingClientRect();
      const scale = before.width / after.width;
      pages.style.transformOrigin = `${after.left - origin.left}px ${after.top - origin.top}px`;
      zoomAnimation = pages.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${scale})` },
        { transform: 'none' },
      ], { duration: 210, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    if (current().format === 'PDF' && pdfScale() === 4400) {
      const targets = scrolling() ? [tile] : [...pages.children];
      for (const image of targets) {
        const url = mediaUrl(current(), Number(image.dataset.page), false, 4400);
        if (!image.src.endsWith(url)) image.src = url;
      }
    }
    revealControls();
  }

  function manualZoom(value, point, animate = true, persist = true) {
    changeZoom(value, point, animate);
    if (persist) save();
  }

  function stepZoom(delta, point) {
    const geometry = zoomGeometry();
    const level = geometry.fit ? geometry.widthFor(state.reader.zoom) / geometry.fit * 100 : 100;
    const value = delta > 0 ? zoomSteps.find((step) => step > level + .25) : zoomSteps.findLast((step) => step < level - .25);
    if (value) manualZoom(String(value), point);
  }

  function doubleZoom(point) {
    if (detailZoomOpen) {
      detailZoomOpen = false;
      changeZoom(state.prefs.defaultScale, point);
    } else {
      detailZoomOpen = true;
      const geometry = zoomGeometry();
      const baseline = geometry.fit ? 100 * geometry.widthFor(state.prefs.defaultScale) / geometry.fit : minZoom;
      const target = Math.min(maxZoom, Math.max(state.prefs.doubleZoomStart, Math.ceil((baseline + 1) / 5) * 5));
      changeZoom(baseline >= maxZoom ? state.prefs.defaultScale : String(target), point);
    }
    save();
  }

  function pageStride() {
    const [first, second] = pages.children;
    return first && second ? second.getBoundingClientRect().top - first.getBoundingClientRect().top : 0;
  }

  function scrollToPage() {
    const stride = pageStride();
    if (stride) viewport.scrollTop = (page() - 1) * stride;
  }

  function movePage(target) {
    if (!current().pages) return;
    cancelPageClick();
    zoomAnimation?.cancel();
    fixedZoomScroll = null;
    const next = Math.min(current().pages, Math.max(1, target));
    state.pageOverride = null;
    state.progress[state.current] = next;
    if (scrolling()) {
      scrollToPage();
      readerStatus();
    } else {
      renderReader();
    }
    updateReadingProgress();
    revealControls();
    save();
  }

  const pageCountLabel = (pages) => pages ? `${pages} page${pages === 1 ? '' : 's'}` : '';

  function applyPageCount({ volumeId, revision, pages }) {
    const entry = byId[volumeId];
    if (!entry || entry.revision !== revision || entry.pages === pages) return;
    entry.pages = pages;
    const count = collection.querySelector(`.entry-open[data-value="${entry.id}"] .entry-page-count`);
    if (!count) return;
    count.title = count.textContent = pageCountLabel(pages);
    if (state.progress[entry.id]) updateReadingProgress(entry);
  }

  function updateReadingProgress(entry = current()) {
    if (state.prefs.sort === 'progress') {
      renderLibrary();
      return;
    }
    const cover = $(`[data-action="entry"][data-value="${entry.id}"] .cover-art`);
    if (!cover || !isVolume(entry)) return;
    let bar = cover.querySelector('.tile-progress');
    if (!bar) {
      cover.insertAdjacentHTML('beforeend', '<span class="tile-progress" role="progressbar" aria-label="Reading progress"><i></i></span>');
      bar = cover.querySelector('.tile-progress');
    }
    const read = percentage(entry);
    bar.setAttribute('aria-valuenow', read);
    bar.firstElementChild.style.width = `${read}%`;
  }

  function step(delta) {
    if (!current().pages) return;
    cancelPageClick();
    const increment = spread() ? 2 : 1;
    if (delta > 0 ? page() + increment - 1 >= current().pages : page() === 1) {
      showNotice(delta > 0 ? 'Last page of this volume' : 'First page of this volume');
      return;
    }
    movePage(page() + delta * increment);
  }

  function showNotice(message) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    noticeTimer = setTimeout(() => { notice.textContent = ''; }, 2400);
  }

  async function openVolume(id, keepReader = false) {
    cancelPageClick();
    const request = ++openSequence;
    const entry = byId[id];
    if (!entry) return;
    if (!entry.pages || archiveFormats.has(entry.format)) {
      showNotice('Opening volume…');
      try {
        const loaded = await desktop.request('open', { id });
        if (request !== openSequence || !byId[id]) return;
        Object.assign(byId[id], loaded);
      } catch (error) {
        if (request === openSequence) showError(error);
        return;
      }
    }
    if (id !== state.current || !keepReader) {
      if (!keepReader) {
        state.reader.mode = state.prefs.mode;
        state.reader.layout = state.prefs.layout;
      }
      state.reader.zoom = state.prefs.defaultScale;
      state.pageOverride = null;
      detailZoomOpen = false;
    }
    state.current = id;
    if (isVolume(entry)) state.lastVolume = id;
    if (role === 'main' && !state.detached && matchMedia('(max-width: 720px)').matches) state.workspace = 'reader';
    notice.textContent = '';
    renderReader();
    renderLibrary();
    revealControls();
    save();
  }

  function showEntryMenu(trigger, x, y) {
    const entry = byId[trigger?.dataset.value];
    if (!entry || entry === libraryRoot || entry.type === 'image' || dialog.open) return false;
    cancelPageClick();
    if (entryMenu.matches(':popover-open')) entryMenu.hidePopover();
    entryMenuTrigger = trigger;
    entryMenuScrollTop = libraryScroll.scrollTop;
    entryMenu.showPopover({ source: trigger });
    // Keep the menu inside the window when a comic sits near an edge.
    const { width, height } = entryMenu.getBoundingClientRect();
    entryMenu.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, x))}px`;
    entryMenu.style.top = `${Math.max(6, Math.min(innerHeight - height - 6, y))}px`;
    entryMenu.querySelector('button').focus({ preventScroll: true });
    return true;
  }

  const entryMenuTarget = (target) => target.closest('.breadcrumbs button') || target.closest('.entry')?.querySelector('.entry-open');
  libraryPane.addEventListener('contextmenu', (event) => {
    const trigger = entryMenuTarget(event.target);
    if (showEntryMenu(trigger, event.clientX, event.clientY)) event.preventDefault();
  });

  libraryPane.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const trigger = entryMenuTarget(event.target);
    if (!trigger) return;
    const anchor = trigger.getBoundingClientRect();
    if (showEntryMenu(trigger, anchor.left + 12, anchor.bottom)) event.preventDefault();
  });
  libraryScroll.addEventListener('scroll', () => {
    if (entryMenu.matches(':popover-open') && libraryScroll.scrollTop !== entryMenuScrollTop) entryMenu.hidePopover();
  });

  function moveVolume(delta) {
    cancelPageClick();
    if (!current().pages || !isVolume(current())) return;
    const parent = current().parent;
    const rootLevel = Object.hasOwn(sourcePaths, parent);
    const queue = (rootLevel ? state.sources.flatMap(children) : children(parent)).filter(isVolume).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    const index = queue.findIndex((entry) => entry.id === state.current);
    const next = index < 0 ? null : queue[index + delta];
    if (next) openVolume(next.id, true);
    else showNotice(`${delta < 0 ? 'First volume' : 'End'} of the ${rootLevel ? 'library' : 'series'}`);
  }

  function closeComic() {
    const id = state.current;
    openSequence++;
    zoomAnimation?.cancel();
    detailZoomOpen = false;
    prefetched = [];
    state.current = null;
    state.pageOverride = null;
    notice.textContent = '';
    if (!state.detached) state.workspace = 'split';
    renderReader();
    renderLibrary();
    if (role === 'main') ($(`.entry-open[data-value="${id}"]`) || $('.brand')).focus({ preventScroll: true });
    save();
  }

  function setControls(hidden) {
    stage.dataset.hidden = hidden;
    if (hidden && document.activeElement?.closest('.reader-chrome')) document.activeElement.blur();
  }

  function revealControls() {
    setControls(false);
    clearTimeout(hideTimer);
    if (!state.prefs.hide || readerDock.dataset.filmMotion || dialog.open || scaleMenu.matches(':popover-open') || dropdown.matches(':popover-open')) return;
    hideTimer = setTimeout(() => {
      if (!stage.querySelector('.reader-chrome:hover, .reader-chrome :focus-visible') && !dialog.open) setControls(true);
    }, state.prefs.delay * 1000);
  }

  function toggleControls() {
    if (stage.dataset.hidden === 'true') revealControls();
    else {
      clearTimeout(hideTimer);
      setControls(true);
    }
  }

  function showFolder(id) {
    state.folder = id;
    state.selected = [];
    selectionAnchor = '';
    search = '';
    $('.search-box input').value = '';
    libraryScroll.style.removeProperty('--library-reveal-tail');
    libraryScroll.scrollTop = 0;
    renderLibrary(false);
    $('.breadcrumbs [aria-current]').focus({ preventScroll: true });
  }

  function revealVolumeInLibrary(id) {
    const entry = byId[id];
    if (!isVolume(entry)) return;
    const sameFolder = state.folder === entry.parent;
    if (state.workspace !== 'split') {
      state.workspace = 'split';
      renderReader(false);
    }
    const excludedByTags = !matches(entry);
    const excludedBySearch = !entry.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    if (excludedByTags) state.filters = [];
    if (!sameFolder) showFolder(entry.parent);
    else if (excludedBySearch || excludedByTags) {
      if (excludedBySearch) {
        search = '';
        $('.search-box input').value = '';
      }
      renderLibrary(false);
    }
    const target = collection.querySelector(`.entry-open[data-value="${id}"]`);
    if (target) {
      if (sameFolder) {
        libraryScroll.style.removeProperty('--library-reveal-tail');
        const rowTop = collection.getBoundingClientRect().top + target.parentElement.offsetTop;
        const offset = Math.round(libraryScroll.scrollTop + rowTop - libraryScroll.getBoundingClientRect().top);
        // Add just enough scroll space for the final row to reach the top too.
        const tail = offset - (libraryScroll.scrollHeight - libraryScroll.clientHeight);
        if (tail > 0) libraryScroll.style.setProperty('--library-reveal-tail', `${tail}px`);
        libraryScroll.scrollTop = offset;
      } else target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      target.focus({ preventScroll: true });
    }
    save();
  }

  function selectVolume(id, range = false) {
    const volumes = visibleEntries.filter(isVolume).map((entry) => entry.id);
    if (range && volumes.includes(selectionAnchor)) {
      const [from, to] = [volumes.indexOf(selectionAnchor), volumes.indexOf(id)].sort((a, b) => a - b);
      state.selected = [...new Set([...state.selected, ...volumes.slice(from, to + 1)])];
    } else {
      state.selected = state.selected.includes(id) ? state.selected.filter((entry) => entry !== id) : [...state.selected, id];
      selectionAnchor = id;
    }
    renderLibrary();
  }

  const fieldOptions = new Map();

  function dropdownField(label, name, options, value, setting, glyph = '') {
    fieldOptions.set(name, { label, options });
    const selected = options.find(([id]) => id === String(value));
    const popupRole = name === 'sort' ? 'menu' : 'listbox';
    return `<button type="button" class="option-trigger" data-action="dropdown" data-value="${name}" popovertarget="kkomic-dropdown" aria-label="${label}" aria-haspopup="${popupRole}" aria-controls="kkomic-dropdown" aria-expanded="false">${glyph}<span>${selected?.[1] || ''}</span>${icon('chevron-down')}</button><input type="hidden" ${setting ? 'data-setting' : 'data-change'}="${name}" value="${escape(value)}">`;
  }

  function selectField(label, name, options, value) {
    return `<div class="setting-row"><span>${label}</span>${dropdownField(label, name, options, value, true)}</div>`;
  }

  function syncDropdown(field, value) {
    field.value = value;
    const { label, options } = fieldOptions.get(field.dataset.setting || field.dataset.change);
    const caption = options.find(([id]) => id === value)?.[1] || (numericZoom(value) ? `${value}%` : '');
    const trigger = field.previousElementSibling;
    trigger.querySelector('span').textContent = caption;
    trigger.setAttribute('aria-label', caption ? `${label}: ${caption}` : label);
  }

  function positionDropdown(menu, trigger, alignRight = false, allowAbove = false) {
    const anchor = trigger.getBoundingClientRect();
    const minimumWidth = trigger.dataset.value === 'startupComic' ? 200 : 148;
    const width = Math.min(innerWidth - 12, alignRight ? 196 : Math.max(minimumWidth, anchor.width));
    const left = alignRight ? anchor.right - width : anchor.left;
    const below = innerHeight - anchor.bottom - 10;
    const above = anchor.top - 10;
    const opensAbove = allowAbove && below < 145 && above > below;
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, left))}px`;
    menu.style.maxHeight = `${Math.min(430, Math.max(28, opensAbove ? above : below))}px`;
    menu.style.top = opensAbove ? 'auto' : `${anchor.bottom + 4}px`;
    menu.style.bottom = opensAbove ? `${innerHeight - anchor.top + 4}px` : 'auto';
    menu.dataset.above = opensAbove;
  }

  function toggleDropdown(trigger) {
    if (dropdown.matches(':popover-open') && trigger === dropdownTrigger) { dropdown.hidePopover(); return; }
    if (dropdown.matches(':popover-open')) dropdown.hidePopover();
    if (dropdown.parentElement !== (dialog.open ? dialog : app)) (dialog.open ? dialog : app).append(dropdown);
    dropdownTrigger = trigger;
    const { label, options: choices } = fieldOptions.get(trigger.dataset.value);
    const field = trigger.nextElementSibling;
    const options = choices.some(([id]) => id === field.value) || !numericZoom(field.value)
      ? choices : [...choices, [field.value, `${field.value}%`]];
    const sortMenu = trigger.dataset.value === 'sort';
    const choiceRole = sortMenu ? 'menuitemradio' : 'option';
    const selectedAttribute = sortMenu ? 'aria-checked' : 'aria-selected';
    dropdown.setAttribute('role', sortMenu ? 'menu' : 'listbox');
    dropdown.setAttribute('aria-label', label);
    dropdown.innerHTML = options.map(([id, label]) => `<button type="button" role="${choiceRole}" tabindex="-1" data-action="choose-option" data-value="${id}" ${selectedAttribute}="${field.value === id}">${label}</button>`).join('') +
      (sortMenu ? `<div class="option-separator" role="separator"></div><button type="button" role="menuitemcheckbox" tabindex="-1" data-action="toggle-folders-first" aria-checked="${state.prefs.foldersFirst}">Folders first <span class="option-check" aria-hidden="true">✓</span></button>` : '');
    positionDropdown(dropdown, trigger, false, true);
    dropdown.showPopover({ source: trigger });
    trigger.setAttribute('aria-expanded', 'true');
    (dropdown.querySelector(`[data-action="choose-option"][${selectedAttribute}="true"]`) || dropdown.querySelector('button')).focus();
  }

  dropdown.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'closed') dropdownTrigger?.setAttribute('aria-expanded', 'false');
  });
  dropdown.addEventListener('toggle', revealControls);

  const modes = [['paged', 'Paged'], ['continuous', 'Vertical scroll']];
  const layouts = [['single', 'Single page'], ['spread', 'Two-page spread']];
  const views = [['grid', 'Cover grid'], ['list', 'Details list']];
  const showKey = (key) => ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space' })[key] || key.toUpperCase();

  function tagChecks(name, active = []) {
    return state.catalog.map((tag) => `<label class="check-row"><input type="checkbox" name="${name}" value="${escape(tag)}" ${active.includes(tag) ? 'checked' : ''}>${escape(tag)}</label>`).join('');
  }

  function coverFields(view) {
    const prefs = state.prefs;
    if (view === 'list') return selectField('List cover size', 'listCoverSize', extendedSizes, prefs.listCoverSize);
    return selectField('Grid cover size', 'coverSize', extendedSizes, prefs.coverSize) +
      selectField('Cover spacing', 'coverGap', spacingOptions, prefs.coverGap);
  }

  function settingsPanelMarkup() {
    const prefs = state.prefs;
    const library = () => {
      const sources = state.sources.map((id) => `<div class="source-row"><span>${icon('folder-open')}${escape(sourcePaths[id].path)}${sourcePaths[id].available ? '' : '<small class="source-offline">Unavailable</small>'}</span><button type="button" class="icon" data-action="remove-source" data-value="${id}" aria-label="Remove ${escape(byId[id].title)} from library" title="Remove folder from library">${icon('minus')}</button></div>`).join('');
      return `<fieldset><legend>Library folders</legend>${sources || '<p class="dialog-note">No folders selected.</p>'}
        <button type="button" class="source-add" data-action="add-source">${icon('folder-plus')} Add folder</button>
        <label>Watch for new and removed comics<input type="checkbox" data-setting="watch" ${prefs.watch ? 'checked' : ''}></label></fieldset>
        <fieldset><legend>Cover display</legend>${selectField('Library view', 'view', views, prefs.view)}${coverFields('grid')}${coverFields('list')}
        ${selectField('Title lines', 'titleLines', [['1', 'One line'], ['2', 'Two lines']], prefs.titleLines)}
        ${selectField('Series cover stack', 'coverStack', stackOptions, prefs.coverStack)}</fieldset>`;
    };
    const sections = {
      appearance: () => `<fieldset><legend>Appearance</legend>${selectField('Theme', 'theme', [['purple', 'Dark purple'], ['graphite', 'Graphite'], ['paper', 'Warm paper']], prefs.theme)}
        ${selectField('Text size', 'textSize', extendedSizes, prefs.textSize)}</fieldset>`,
      library,
      reader: () => `<fieldset><legend>Reader defaults</legend>${selectField('Comic to open on startup', 'startupComic', startupComics, prefs.startupComic)}${selectField('Reading mode', 'mode', modes, prefs.mode)}${selectField('Page layout', 'layout', layouts, prefs.layout)}${selectField('Default page scale', 'defaultScale', zooms, prefs.defaultScale)}</fieldset>
        <fieldset><legend>Controls and previews</legend>${selectField('Double-click interval', 'clickDelay', clickDelays.map((delay) => [String(delay), delay + ' ms']), prefs.clickDelay)}
        ${selectField('Double-click zoom level', 'doubleZoomStart', zoomSteps.map((level) => [String(level), level + '%']), prefs.doubleZoomStart)}
        ${selectField('Wheel zoom step', 'wheelZoomStep', wheelZoomSteps.map((step) => [String(step), step + '%']), prefs.wheelZoomStep)}
        ${selectField('Filmstrip size', 'filmSize', sizeOptions, prefs.filmSize)}
        <label>Auto-hide controls<input type="checkbox" data-setting="hide" ${prefs.hide ? 'checked' : ''}></label>${selectField('Hide after', 'delay', hideDelays.map((delay) => [String(delay), `${delay} ${delay === 1 ? 'second' : 'seconds'}`]), prefs.delay)}</fieldset>`,
      shortcuts: () => `<fieldset><legend>Keyboard shortcuts</legend>
        <label>Go to parent folder<kbd>Alt + ↑</kbd></label><label>Search library<kbd>Ctrl + F</kbd></label><label>Dismiss popup<kbd>Esc</kbd></label>
        <p class="dialog-note">Focus a shortcut field and press a key.</p>${Object.entries(keyLabels).map(([id, label]) => `<label>${label}<input type="text" readonly data-shortcut="${id}" value="${escape(showKey(state.keys[id]))}" aria-label="Shortcut for ${label.toLowerCase()}"></label>`).join('')}<p class="field-error" role="alert"></p></fieldset>`,
      about: () => `<div class="about"><h3>Mynd</h3>${appVersion ? `<p class="about-version">${escape(appVersion)} Preview</p>` : ''}<p>Offline comic reader for Windows.</p><p class="dialog-note">Created by <a href="https://github.com/alviscmh" data-action="github-profile">alviscmh</a></p></div>`,
    };
    const actions = settingsSection in sectionPreferences
      ? '<div class="dialog-actions"><button class="reset-defaults" type="button" data-action="reset-settings">Reset to defaults</button><button class="primary" type="button" data-action="close-dialog">Done</button></div>' : '';
    return sections[settingsSection]() + actions;
  }

  function settingsMarkup() {
    const links = settingsSections.map(([id, label, glyph]) => `<button type="button" data-action="settings-section" data-value="${id}" aria-pressed="${id === settingsSection}">${icon(glyph)}${label}</button>`).join('');
    return `<nav class="settings-sections" data-slide-selection aria-label="Settings sections"><span class="selection-highlight settings-highlight" aria-hidden="true"></span>${links}</nav><section class="settings-content">${settingsPanelMarkup()}</section>`;
  }

  function positionSelectionHighlight(group, animate = false) {
    const target = group?.querySelector('[aria-pressed="true"]');
    if (!target?.offsetWidth) return;
    const highlight = group.querySelector('.selection-highlight');
    const x = target.offsetLeft;
    const y = target.offsetTop;
    const destination = translate(x, y);
    const width = `${target.offsetWidth}px`;
    const height = `${target.offsetHeight}px`;
    if (highlight.style.transform === destination && highlight.style.width === width && highlight.style.height === height) return;
    const previous = highlight.getBoundingClientRect();
    const frame = group.getBoundingClientRect();
    const startX = previous.left - frame.left + group.scrollLeft - group.clientLeft;
    const startY = previous.top - frame.top + group.scrollTop - group.clientTop;
    highlight.getAnimations().forEach((motion) => motion.cancel());
    Object.assign(highlight.style, { transform: destination, width, height });
    if (!animate || !previous.width || reducedMotion.matches) return;
    animateSettle(highlight, { x: startX, y: startY, width: `${previous.width}px`, height: `${previous.height}px` },
      { x, y, width, height }, group.dataset.slideSelection === 'compact' ? 2 : 5);
  }

  function setSelection(group, value) {
    const previous = group.querySelector('[aria-pressed="true"]');
    for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', button.dataset.value === value);
    positionSelectionHighlight(group, previous?.dataset.value !== value);
  }

  const updateSelections = (entries) => {
    for (const { target } of entries) positionSelectionHighlight(target);
  };
  const selectionResize = new ResizeObserver(updateSelections);
  for (const group of app.querySelectorAll('[data-slide-selection]')) selectionResize.observe(group);
  const settingsResize = new ResizeObserver(updateSelections);

  function renderSettingsPanel() {
    const panel = $('.settings-content');
    panel.innerHTML = settingsPanelMarkup();
    panel.scrollTop = 0;
    refreshIcons();
  }

  function resetSettingsSection() {
    const preferences = sectionPreferences[settingsSection];
    if (!preferences) return;
    for (const key of preferences) state.prefs[key] = initialPrefs[key];
    if (settingsSection === 'shortcuts') state.keys = { ...initialKeys };
    const resetReader = settingsSection === 'reader';
    if (resetReader) {
      detailZoomOpen = false;
      state.reader = { ...initialReader };
    }
    renderReader(resetReader);
    if (settingsSection === 'library' || settingsSection === 'appearance') renderLibrary(false);
    renderSettingsPanel();
    positionSelectionHighlight($('.settings-sections'));
    $('[data-action="reset-settings"]').focus({ preventScroll: true });
    revealControls();
    save();
  }

  function dialogMarkup(kind) {
    if (kind === 'settings') return settingsMarkup();
    if (kind === 'cover-options') return `<fieldset><legend>Cover display</legend>${coverFields(state.prefs.view)}</fieldset><div class="dialog-actions"><button class="primary" type="button" data-action="close-dialog">Done</button></div>`;
    if (kind === 'page-grid') {
      return `<div class="page-grid" aria-label="All page thumbnails">${thumbnails()}</div>`;
    }
    if (kind === 'tag') {
      return `<form data-form="tag"><fieldset><legend>Existing tags</legend>${tagChecks('add-tag')}</fieldset><label class="tag-create">New tag<input type="text" name="new-tag" placeholder="e.g. Artist name" maxlength="28"></label><div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button><button class="primary" type="submit">Add tags</button></div></form>`;
    }
    const groups = state.groups.length ? `<fieldset><legend>Saved groups</legend>${state.groups.map((group, index) => `<label><span>${escape(group.name)}</span><button type="button" data-action="use-group" data-value="${index}">Open</button></label>`).join('')}</fieldset>` : '';
    return `<form data-form="filters"><fieldset><legend>Filter by tag</legend>${tagChecks('filter-tag', state.filters)}</fieldset>${groups}<label class="tag-create">Save as group<input type="text" name="group-name" placeholder="Group name" maxlength="28"></label><div class="dialog-actions filter-dialog-actions"><button type="button" data-action="clear-filters">Clear filters</button><button type="submit" class="primary">Apply filters</button></div></form>`;
  }

  function positionAnchoredDialog() {
    if (dialog.dataset.anchored !== 'true') return;
    const trigger = dialogTrigger?.isConnected ? dialogTrigger : dialogAnchor?.querySelector(`[data-action="${dialogKind}"]`);
    if (!trigger || !dialogAnchor) return;
    const pane = dialogAnchor.getBoundingClientRect();
    const width = Math.min(420, innerWidth - 16, Math.max(232, pane.width - 16));
    const top = Math.min(trigger.getBoundingClientRect().bottom, innerHeight - 140);
    dialog.style.setProperty('--popup-width', `${width}px`);
    dialog.style.setProperty('--popup-left', `${Math.max(8, Math.min(innerWidth - width - 8, pane.left + (pane.width - width) / 2))}px`);
    dialog.style.setProperty('--popup-top', `${Math.max(8, top)}px`);
  }

  let dialogAnchor;
  function openDialog(kind, trigger = document.activeElement) {
    if (!dialog.open) dialogTrigger = trigger;
    cancelPageClick();
    if (scaleMenu.matches(':popover-open')) scaleMenu.hidePopover();
    if (dropdown.matches(':popover-open')) dropdown.hidePopover();
    if (entryMenu.matches(':popover-open')) entryMenu.hidePopover();
    gridResize.disconnect();
    dialogResize.disconnect();
    settingsResize.disconnect();
    dialogKind = kind;
    dialog.dataset.kind = kind;
    dialogAnchor = dialogTrigger?.closest('.library, .reader');
    dialog.dataset.anchored = Boolean(dialogAnchor && kind !== 'settings' && kind !== 'page-grid');
    if (dialog.dataset.anchored === 'true') {
      positionAnchoredDialog();
      dialogResize.observe(dialogAnchor);
    }
    $('.dialog-heading h2').textContent = ({ settings: 'Settings', 'cover-options': state.prefs.view === 'list' ? 'Details list' : 'Cover grid', tag: `Tag ${state.selected.length} ${state.selected.length === 1 ? 'volume' : 'volumes'}`, 'filter-dialog': 'Tags & groups', 'page-grid': 'Browse pages' })[kind];
    const isGrid = kind === 'page-grid';
    const description = $('.page-grid-description');
    description.hidden = !isGrid;
    description.textContent = isGrid ? `${current().title} · ${current().pages} ${current().pages === 1 ? 'page' : 'pages'}` : '';
    $('.page-grid-size').hidden = !isGrid;
    if (isGrid) dialog.style.setProperty('--app-height', `${app.clientHeight}px`);
    dialogContent.innerHTML = dialogMarkup(kind);
    if (!dialog.open) dialog.showModal();
    else $('.dialog-heading button').focus({ preventScroll: true });
    dialog.scrollTop = 0;
    if (kind === 'settings') {
      const nav = $('.settings-sections');
      positionSelectionHighlight(nav);
      settingsResize.observe(nav);
    }
    if (isGrid) {
      const grid = $('.page-grid');
      resizePageGrid();
      const active = grid.querySelector('[aria-current]');
      if (active) grid.scrollTop = active.getBoundingClientRect().top - grid.getBoundingClientRect().top - 3;
      gridResize.observe(grid);
    }
    clearTimeout(hideTimer);
    refreshIcons();
  }

  function setWorkspace(workspace) {
    cancelPageClick();
    if (state.detached && workspace === 'reader') { desktop.request('focusReader').catch(showError); return; }
    state.workspace = workspace;
    renderReader();
    revealControls();
  }

  function toggleScaleMenu() {
    if (scaleMenu.matches(':popover-open')) { scaleMenu.hidePopover(); return; }
    positionDropdown(scaleMenu, zoomPicker, true);
    scaleMenu.showPopover({ source: zoomPicker });
    const active = scaleMenu.querySelector('[aria-pressed="true"]') || scaleMenu.querySelector('button');
    active.focus({ preventScroll: true });
    active.scrollIntoView({ block: 'nearest' });
  }

  scaleMenu.addEventListener('beforetoggle', (event) => {
    zoomPicker.setAttribute('aria-expanded', event.newState === 'open');
  });
  scaleMenu.addEventListener('toggle', revealControls);
  function navigateOptions(event) {
    const menu = event.currentTarget;
    if (event.key === 'Escape' && menu.matches(':popover-open')) {
      event.preventDefault();
      event.stopPropagation();
      menu.hidePopover();
      const trigger = menu === scaleMenu ? zoomPicker : menu === entryMenu ? entryMenuTrigger : dropdownTrigger;
      trigger?.focus({ preventScroll: true });
      return;
    }
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button')];
    const target = buttons.indexOf(document.activeElement) + (event.key === 'ArrowUp' ? -1 : 1);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, target));
    buttons[index].focus();
  }
  scaleMenu.addEventListener('keydown', navigateOptions);
  dropdown.addEventListener('keydown', navigateOptions);
  entryMenu.addEventListener('keydown', navigateOptions);
  entryMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    entryMenu.hidePopover();
    entryMenuTrigger?.focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => {
    if (entryMenu.matches(':popover-open')) entryMenu.hidePopover();
    positionAnchoredDialog();
    if (scaleMenu.matches(':popover-open')) positionDropdown(scaleMenu, zoomPicker, true);
    if (dropdown.matches(':popover-open')) positionDropdown(dropdown, dropdownTrigger, false, true);
  });

  function splitLimits() {
    const width = workspace.clientWidth || 850;
    return [Math.min(47, 24800 / width), Math.max(53, 100 - 26800 / width)];
  }

  function layoutSplit() {
    const [min, max] = splitLimits();
    const percent = Math.min(max, Math.max(min, state.prefs.splitRatio));
    workspace.style.setProperty('--split-width', percent + '%');
    divider.setAttribute('aria-valuemin', Math.ceil(min));
    divider.setAttribute('aria-valuemax', Math.floor(max));
    divider.setAttribute('aria-valuenow', Math.round(percent));
    divider.setAttribute('aria-valuetext', Math.round(percent) + '% library width');
  }

  function resizeSplit(percent) {
    const [min, max] = splitLimits();
    state.prefs.splitRatio = Math.min(max, Math.max(min, percent));
    layoutSplit();
  }

  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dividerDrag = event.pointerId;
    divider.setPointerCapture(event.pointerId);
    divider.dataset.dragging = '';
  });
  divider.addEventListener('pointermove', (event) => {
    if (dividerDrag !== event.pointerId) return;
    const frame = workspace.getBoundingClientRect();
    resizeSplit((event.clientX - frame.left - 4) / frame.width * 100);
  });
  divider.addEventListener('lostpointercapture', () => {
    dividerDrag = null;
    delete divider.dataset.dragging;
    save();
  });
  divider.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const [min, max] = splitLimits();
    const current = Number(divider.getAttribute('aria-valuenow'));
    resizeSplit(event.key === 'Home' ? min : event.key === 'End' ? max : current + (event.key === 'ArrowLeft' ? -2 : 2));
    save();
  });
  new ResizeObserver(() => { if (state) layoutSplit(); }).observe(workspace);

  async function configureRoot(action, id) {
    try {
      const catalog = await desktop.request(action, id ? { path: sourcePaths[id]?.path } : {});
      if (!catalog) return;
      useCatalog(catalog);
      if (dialog.open && dialogKind === 'settings') openDialog('settings');
      renderReader(false);
      save();
    } catch (error) { showError(error); }
  }

  app.addEventListener('click', (event) => {
    if (desktop && event.target.closest('a[data-action="github-profile"]')) {
      event.preventDefault();
      desktop.request('openGithubProfile').catch(showError);
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    cancelPageClick();
    const { action, value } = button.dataset;
    if (action === 'show-entry-folder') {
      const trigger = entryMenuTrigger;
      const id = trigger.dataset.value;
      entryMenu.hidePopover();
      trigger.focus({ preventScroll: true });
      desktop.request('showEntryFolder', { id }).catch(showError);
      return;
    }
    if (['settings', 'cover-options', 'filter-dialog', 'tag', 'page-grid'].includes(action)) {
      if (action === 'settings' && value) settingsSection = value;
      openDialog(action, button);
      return;
    }
    if (action === 'dropdown') { event.preventDefault(); toggleDropdown(button); return; }
    if (action === 'choose-option') {
      const trigger = dropdownTrigger;
      const field = trigger.nextElementSibling;
      dropdown.hidePopover();
      syncDropdown(field, value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.focus({ preventScroll: true });
      return;
    }
    if (action === 'toggle-folders-first') {
      state.prefs.foldersFirst = !state.prefs.foldersFirst;
      button.setAttribute('aria-checked', state.prefs.foldersFirst);
      renderLibrary();
      save();
      return;
    }
    if (action === 'settings-section') {
      if (settingsSection === value) return;
      settingsSection = value;
      setSelection($('.settings-sections'), value);
      renderSettingsPanel();
      return;
    }
    if (action === 'reset-settings') { resetSettingsSection(); return; }
    if (action === 'close-comic') { closeComic(); return; }
    if (action === 'reveal-volume') {
      if (role === 'reader') desktop.request('showVolumeInLibrary', { id: state.current }).catch(showError);
      else revealVolumeInLibrary(state.current);
      return;
    }
    if (action === 'scale-menu') { event.preventDefault(); toggleScaleMenu(); return; }
    if (action === 'set-scale') {
      scaleMenu.hidePopover();
      manualZoom(value);
      zoomPicker.focus({ preventScroll: true });
      return;
    }
    if (action === 'close-dialog') {
      dialog.close();
      return;
    }
    if (action === 'refresh') { refreshLibrary(); return; }
    if (action === 'add-source') { configureRoot('addRoot'); return; }
    if (action === 'remove-source') { configureRoot('removeRoot', value); return; }
    if (action === 'jump-page') {
      if (dialog.open) dialog.close();
      movePage(Number(value));
      return;
    }
    if (action === 'home') {
      setWorkspace('split');
      showFolder(state.sources.length === 1 ? state.sources[0] : 'libraries');
    }
    if (action === 'folder') showFolder(value);
    if (action === 'entry') {
      const entry = byId[value];
      if (entry.type === 'folder') showFolder(value);
      else if (isVolume(entry) && (event.ctrlKey || event.metaKey || event.shiftKey)) selectVolume(value, event.shiftKey);
      else {
        openVolume(value).then(() => {
          if (state.current !== value) return;
          if (state.detached && role === 'main') desktop.request('focusReader').catch(showError);
          else viewport.focus({ preventScroll: true });
        });
        return;
      }
    }
    if (action === 'select-volume') selectVolume(value, event.shiftKey);
    if (action === 'clear-selection') { state.selected = []; selectionAnchor = ''; renderLibrary(); }
    if (action === 'view') { state.prefs.view = value; renderLibrary(); }
    if (action === 'match') { state.match = value; renderLibrary(); }
    if (action === 'filter') {
      state.filters = state.filters.includes(value) ? state.filters.filter((tag) => tag !== value) : [...state.filters, value];
      renderLibrary();
    }
    if (action === 'clear-filters') { state.filters = []; dialog.close(); renderLibrary(); }
    if (action === 'use-group') {
      const group = state.groups[Number(value)];
      state.filters = [...group.tags];
      state.match = group.match;
      dialog.close();
      renderLibrary();
    }
    if (action === 'workspace') setWorkspace(value);
    if (action === 'detach') {
      const wantsDetach = !state.detached;
      desktop.request('detach', { detached: wantsDetach }).catch(showError);
      return;
    }
    if (action === 'layout') { state.reader.layout = value; renderReader(); revealControls(); }
    if (action === 'filmstrip') {
      state.prefs.filmstripOpen = !state.prefs.filmstripOpen;
      renderFilmstrip();
      clearTimeout(filmMotionTimer);
      readerDock.dataset.filmMotion = state.prefs.filmstripOpen ? 'pull' : 'push';
      filmMotionTimer = setTimeout(() => {
        delete readerDock.dataset.filmMotion;
        revealControls();
      }, settleDuration + 10);
      revealControls();
    }
    if (action === 'volume') { moveVolume(value === 'right' ? 1 : -1); return; }
    if (action === 'arrow') { step(value === 'right' ? 1 : -1); return; }
    if (action === 'zoom-step') { stepZoom(value === 'in' ? 1 : -1); return; }
    save();
  });

  app.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = new FormData(form);
    if (form.dataset.form === 'tag') {
      const chosen = values.getAll('add-tag');
      const tag = values.get('new-tag').trim();
      if (tag) {
        const existing = state.catalog.find((entry) => entry.toLocaleLowerCase() === tag.toLocaleLowerCase());
        if (!existing) state.catalog = [...state.catalog, tag];
        chosen.push(existing || tag);
      }
      for (const id of state.selected) {
        if (isVolume(byId[id])) state.volumeTags[id] = [...new Set([...(state.volumeTags[id] || []), ...chosen])];
      }
    } else {
      state.filters = values.getAll('filter-tag');
      const name = values.get('group-name').trim();
      if (name && state.filters.length) {
        state.groups = [...state.groups.filter((group) => group.name !== name), { name, tags: [...state.filters], match: state.match }];
      }
    }
    dialog.close();
    renderLibrary();
    save();
  });

  app.addEventListener('change', (event) => {
    const field = event.target;
    if (field.matches('[data-grid-columns]')) { save(); return; }
    const setting = field.dataset.setting;
    const control = field.dataset.change;
    if (setting) {
      state.prefs[setting] = field.type === 'checkbox' ? field.checked
        : ['delay', 'clickDelay', 'doubleZoomStart', 'wheelZoomStep'].includes(setting) ? Number(field.value) : field.value;
      if (setting in initialReader) state.reader[setting] = field.value;
      if (['view', 'titleLines', 'coverSize', 'listCoverSize', 'coverGap', 'coverStack'].includes(setting)) renderLibrary();
      if (setting === 'filmSize') renderFilmstrip();
      renderReader(setting in initialReader);
      if (setting === 'textSize') positionSelectionHighlight($('.settings-sections'));
      if (setting === 'defaultScale' && current().pages) applyZoom();
      revealControls();
    } else if (control === 'sort') {
      state.prefs.sort = field.value;
      renderLibrary();
    } else return;
    save();
  });

  $('.search-box input').addEventListener('input', (event) => { search = event.target.value; renderLibrary(); });
  dialog.addEventListener('input', (event) => {
    if (!event.target.matches('[data-grid-columns]')) return;
    state.gridColumns = event.target.valueAsNumber;
    resizePageGrid();
  });
  filmItems.addEventListener('wheel', (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || filmItems.scrollWidth <= filmItems.clientWidth) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? filmItems.clientWidth : 1;
    filmItems.scrollLeft += event.deltaY * unit;
  }, { passive: false });
  scrubber.addEventListener('input', () => movePage(Number(scrubber.value)));
  zoomSlider.addEventListener('pointerdown', () => {
    zoomPill.dataset.dragging = 'true';
    zoomPill.dataset.pointerFocus = 'true';
  });
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, () => { delete zoomPill.dataset.dragging; });
  }
  for (const type of ['keydown', 'blur']) {
    zoomSlider.addEventListener(type, () => { delete zoomPill.dataset.pointerFocus; });
  }
  zoomSlider.addEventListener('input', () => changeSliderZoom(sliderLevel(Number(zoomSlider.value)), false));
  zoomSlider.addEventListener('change', save);
  function wheelZoom(event, point) {
    event.preventDefault();
    const step = event.deltaY < 0 ? state.prefs.wheelZoomStep : -state.prefs.wheelZoomStep;
    const geometry = zoomGeometry();
    const currentLevel = geometry.fit ? Math.round(100 * geometry.widthFor(state.reader.zoom) / geometry.fit) : sliderMinimum;
    changeSliderZoom(Math.max(sliderMinimum, Math.min(maxZoom, currentLevel + step)), true, point);
  }
  zoomPill.addEventListener('wheel', (event) => {
    if (event.deltaY) wheelZoom(event);
  }, { passive: false });
  stage.addEventListener('pointermove', revealControls);
  stage.addEventListener('pointerdown', revealControls);
  stage.addEventListener('pointerleave', revealControls);
  stage.addEventListener('focusin', revealControls);
  dialog.addEventListener('close', () => {
    gridResize.disconnect();
    dialogResize.disconnect();
    settingsResize.disconnect();
    if (dropdown.matches(':popover-open')) dropdown.hidePopover();
    if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
    else if (dialogKind === 'tag') $('[data-action="tag"]')?.focus({ preventScroll: true });
    if (dialogKind !== 'tag' && dialogKind !== 'filter-dialog') revealControls();
  });
  let backdropPressed = false;
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  dialog.addEventListener('pointerdown', (event) => { backdropPressed = isBackdrop(event); });
  dialog.addEventListener('click', (event) => {
    if (backdropPressed && isBackdrop(event) && dialog.open) dialog.close();
    backdropPressed = false;
  });

  function cancelPageClick() {
    if (!clickGesture) return;
    clearTimeout(clickGesture.timer);
    clickGesture = null;
  }

  viewport.addEventListener('click', (event) => {
    if (!event.target.closest('.comic-page') || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || suppressArtClick) return;
    const now = performance.now();
    const pending = clickGesture;
    cancelPageClick();
    if (pending && now - pending.at <= pending.interval && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 12) {
      event.preventDefault();
      doubleZoom(event);
      return;
    }
    if (pending) pending.act();
    const view = viewport.getBoundingClientRect();
    const art = scrolling() ? event.target.getBoundingClientRect() : pages.getBoundingClientRect();
    const left = Math.max(art.left, view.left);
    const right = Math.min(art.right, view.right);
    const bottom = Math.min(art.bottom, view.bottom);
    const previous = event.clientX < (left + right) / 2;
    const edge = Math.min(60, (right - left) * .17);
    const corner = event.clientY > bottom - 40 && (event.clientX < left + edge || event.clientX > right - edge);
    const delta = previous ? -1 : 1;
    const act = () => { if (corner) moveVolume(delta); else step(delta); };
    const interval = state.prefs.clickDelay;
    const timer = setTimeout(() => { clickGesture = null; act(); }, interval);
    clickGesture = { at: now, x: event.clientX, y: event.clientY, interval, timer, act };
  });
  viewport.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    if (detailZoomOpen && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      wheelZoom(event, event);
      return;
    }
    if (event.ctrlKey) {
      event.preventDefault();
      stepZoom(event.deltaY < 0 ? 1 : -1, event);
      return;
    }
    if (scrolling() || !current().pages || event.shiftKey || event.altKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 120 || (wheelDelta && Math.sign(wheelDelta) !== Math.sign(event.deltaY))) wheelDelta = 0;
    lastWheel = now;
    if (now - wheelTurn < 180 && wheelTurn) return;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    if (Math.abs(wheelDelta) < 36) return;
    wheelTurn = now;
    const direction = Math.sign(wheelDelta);
    wheelDelta = 0;
    step(direction);
  }, { passive: false });
  viewport.addEventListener('dragstart', (event) => event.preventDefault());
  viewport.addEventListener('pointerdown', (event) => {
    suppressArtClick = scaleMenu.matches(':popover-open') || dropdown.matches(':popover-open') || entryMenu.matches(':popover-open');
    if (suppressArtClick) return;
    if (event.button !== 0 || event.pointerType !== 'mouse' || viewport.dataset.pannable !== 'true') return;
    const frame = viewport.getBoundingClientRect();
    if (event.clientX >= frame.left + viewport.clientWidth || event.clientY >= frame.top + viewport.clientHeight) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!pan || pan.id !== event.pointerId) return;
    const dx = pan.x - event.clientX;
    const dy = pan.y - event.clientY;
    if (!suppressArtClick && Math.hypot(dx, dy) < 5) return;
    if (!suppressArtClick) {
      cancelPageClick();
      zoomAnimation?.cancel();
      suppressArtClick = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.panning = 'true';
    }
    viewport.scrollTo(pan.left + dx, pan.top + dy);
  });
  function stopPan() {
    pan = null;
    viewport.dataset.panning = 'false';
  }
  viewport.addEventListener('lostpointercapture', stopPan);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, stopPan);
  viewport.addEventListener('scroll', () => {
    if (!scrolling() || zoomAnimation?.playState === 'running' || viewport.scrollTop === fixedZoomScroll) return;
    fixedZoomScroll = null;
    const stride = pageStride();
    if (!stride) return;
    const next = Math.min(current().pages, Math.round(viewport.scrollTop / stride) + 1);
    if (next === page()) return;
    state.pageOverride = null;
    state.progress[state.current] = next;
    readerStatus();
    updateReadingProgress();
    save();
  });

  new ResizeObserver(() => {
    if (current().pages) applyZoom();
    if (scrolling()) scrollToPage();
    if (dialog.open && dialogKind === 'page-grid') dialog.style.setProperty('--app-height', `${app.clientHeight}px`);
  }).observe(stage);

  document.addEventListener('keydown', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcut = event.target.dataset?.shortcut;
    if (dialog.open && shortcut && !['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(key)) {
      event.preventDefault();
      const error = $('.field-error');
      if (Object.entries(state.keys).some(([name, value]) => name !== shortcut && value === key)) {
        error.textContent = 'That key is already assigned.';
      } else {
        state.keys[shortcut] = key;
        event.target.value = showKey(key);
        error.textContent = '';
        renderReader(false);
        save();
      }
      return;
    }
    if (dialog.open || scaleMenu.matches(':popover-open') || dropdown.matches(':popover-open') || entryMenu.matches(':popover-open')) return;
    if (role === 'main' && event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowUp' && state.workspace === 'split') {
      event.preventDefault();
      const parent = byId[state.folder]?.parent;
      if (parent) { showFolder(parent); save(); }
      return;
    }
    if (role === 'main' && event.ctrlKey && !event.altKey && !event.metaKey && key === 'f') {
      event.preventDefault();
      if (state.workspace !== 'split') { setWorkspace('split'); save(); }
      $('.search-box input').focus();
      $('.search-box input').select();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input, select, textarea') || event.target === divider) return;
    if (role === 'main' && key === 'Escape' && state.workspace === 'reader') { setWorkspace('split'); save(); return; }
    if (key === state.keys.controls) { event.preventDefault(); toggleControls(); return; }
    if (key === state.keys.focus) { event.preventDefault(); setWorkspace(state.workspace === 'split' ? 'reader' : 'split'); save(); return; }
    if ($('.library').contains(event.target) || (key === ' ' && event.target.closest?.('button'))) return;
    if (![state.keys.left, state.keys.right, state.keys.next].includes(key)) return;
    event.preventDefault();
    step(key === state.keys.left ? -1 : 1);
  });

  viewport.addEventListener('error', (event) => {
    if (event.target.matches('.comic-page') && event.target.isConnected && !scrolling())
      showNotice(`Page ${event.target.dataset.page} could not be loaded.`);
  }, true);
  viewport.addEventListener('load', (event) => {
    if (event.target.matches('.comic-page') && (state.reader.zoom === 'actual' ||
      (detailZoomOpen && state.prefs.defaultScale === 'actual')) && current().format !== 'PDF') {
      applyZoom();
    }
  }, true);

  async function prepareReaderFrame(ticket) {
    if (!ticket || role !== 'reader') return;
    readerTicket = ticket;
    const deadline = new Promise((resolve) => setTimeout(() => resolve(false), 4500));
    let ready = false;
    while (readerTicket === ticket) {
      const expected = scrolling() ? [pages.querySelector(`[data-page="${page()}"]`)].filter(Boolean) : [...pages.children];
      if (!expected.length) break;
      for (const image of expected) image.loading = 'eager';
      const loaded = Promise.all(expected.map((image) => image.decode())).then(() => true, () => false);
      ready = await Promise.race([loaded, deadline]);
      if (expected.every((image) => image.isConnected)) break;
      if (!ready && expected[0]?.isConnected) break;
    }
    if (readerTicket !== ticket) return;
    readerTicket = null;
    desktop.request('readerReady', { ticket, ready }).catch(showError);
  }

  function receive(message) {
    if (message.type === 'show-volume-in-library') { revealVolumeInLibrary(message.volumeId); return; }
    if (message.type === 'page-count') { applyPageCount(message); return; }
    if (message.type === 'library') useCatalog(message.catalog);
    if (message.type === 'notice') showNotice(message.message);
    if (message.type === 'detaching') { detachPreparing = message.preparing; renderReader(false); }
    const patch = message.type === 'prepare-reader' ? message.state : message.patch;
    if (!patch) return;
    cancelPageClick();
    if (Object.hasOwn(patch, 'current') && patch.current !== state.current) {
      openSequence++;
      zoomAnimation?.cancel();
      detailZoomOpen = false;
      prefetched = [];
    }
    for (const [key, value] of Object.entries(patch)) {
      if (mapFields.has(key)) {
        Object.assign(state[key], value);
        Object.assign(lastSaved[key], value);
      } else {
        state[key] = value;
        lastSaved[key] = structuredClone(value);
      }
    }
    normalizeReaderPreferences();
    const keys = Object.keys(patch);
    const uiOnly = keys.every((key) => ['folder', 'filters', 'match', 'selected', 'catalog', 'groups', 'volumeTags'].includes(key));
    if (uiOnly) renderLibrary(false);
    else {
      if (current().id && !current().pages) openVolume(current().id, true);
      else renderReader(keys.some((key) => ['current', 'reader', 'progress', 'pageOverride'].includes(key)));
      renderLibrary(false);
    }
    if (message.type === 'prepare-reader') {
      useCatalog(message.catalog);
      prepareReaderFrame(message.ticket);
    }
  }

  async function start() {
    load();
    $('.sort-box').innerHTML = dropdownField('Sort library', 'sort', sortOptions, state.prefs.sort, false, icon('arrow-down-wide-narrow'));
    $('.reader-mode').innerHTML = dropdownField('Reading mode', 'mode', modes, state.prefs.mode, true, icon('book-open'));
    app.dataset.role = role;
    if (!desktop) {
      renderLibrary();
      renderReader();
      $('.reader-empty-text').textContent = 'Open Mynd.exe to use the local comic library.';
      return;
    }
    try {
      const initial = await desktop.request('bootstrap');
      appVersion = initial.version;
      role = initial.role;
      app.dataset.role = role;
      load(initial.state);
      lastSaved = structuredClone(state);
      desktop.onMessage(receive);
      if (initial.catalog) useCatalog(initial.catalog);
      else {
        renderLibrary();
        renderReader();
      }
      if (initial.ticket) prepareReaderFrame(initial.ticket);
    } catch (error) { showError(error); }
  }

  start();
})();
