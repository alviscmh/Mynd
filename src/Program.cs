using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Mynd
{
    static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                var profile = args.Length == 2 && args[0] == "--profile"
                    ? Path.GetFullPath(args[1])
                    : DefaultProfile(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
                using (var app = new ComicApplication(profile))
                    Application.Run(app);
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show("Mynd could not start.\n\n" + error.Message, "Mynd", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string DefaultProfile(string localData)
        {
            var current = Path.Combine(localData, "Mynd");
            var legacy = Path.Combine(localData, "KKomic");
            if (!HasProfile(current) && HasProfile(legacy)) return legacy;
            return current;
        }

        private static bool HasProfile(string folder)
        {
            return File.Exists(Path.Combine(folder, "library.json")) || File.Exists(Path.Combine(folder, "library.json.bak"));
        }
    }

    sealed class Profile
    {
        public List<string> Roots { get; set; }
        public Dictionary<string, object> State { get; set; }
        public int[] MainBounds { get; set; }
        public int[] ReaderBounds { get; set; }
    }

    sealed class ComicApplication : ApplicationContext
    {
        internal static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue }; }
        private readonly string appData;
        private readonly string profileFile;
        private readonly string indexFile;
        private readonly Profile profile;
        private readonly Stopwatch startup = Stopwatch.StartNew();
        private readonly bool traceStartup = Environment.GetEnvironmentVariable("MYND_TRACE_STARTUP") == "1" ||
            Environment.GetEnvironmentVariable("KKOMIC_TRACE_STARTUP") == "1";
        private readonly List<FileSystemWatcher> watchers = new List<FileSystemWatcher>();
        private readonly Timer scanTimer = new Timer { Interval = 650 };
        private readonly Timer saveTimer = new Timer { Interval = 400 };
        private readonly Timer detachTimer = new Timer { Interval = 8000 };
        private readonly Timer warmReaderTimer = new Timer { Interval = 600 };
        private readonly Timer sweepTimer = new Timer { Interval = 20000 };
        private readonly HashSet<string> changedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly ComicWindow main;
        private ComicWindow reader;
        private Task<CoreWebView2Environment> web;
        private WebViewDataFolder webData;
        private Task scan;
        private bool scanAgain;
        private bool scanAll;
        private bool indexPending;
        private bool startupIndexChecked;
        private bool libraryFrameReady;
        private bool sweeping;
        private bool quitting;
        private int detachTicket;
        private int preparingTicket;

        internal readonly Library Library;

        internal ComicApplication(string path)
        {
            appData = path;
            Directory.CreateDirectory(appData);
            profileFile = Path.Combine(appData, "library.json");
            indexFile = Path.Combine(appData, "library-index.json");
            profile = LoadProfile();
            TraceStartup("Profile loaded");
            var restoreReader = BeginReaderSession();
            profile.State["detached"] = false;
            Library = new Library(Path.Combine(appData, "Thumbnails"));
            scanTimer.Tick += async (sender, args) => { scanTimer.Stop(); await RefreshAsync(false); };
            saveTimer.Tick += (sender, args) => { saveTimer.Stop(); WriteProfile(); };
            main = new ComicWindow(this, false, profile.MainBounds);
            main.ApplyTheme(ThemeName());
            detachTimer.Tick += (sender, args) =>
            {
                RequestDetached(false);
                main.Send(new { type = "notice", message = "The separate reader did not become ready." });
            };
            warmReaderTimer.Tick += (sender, args) =>
            {
                warmReaderTimer.Stop();
                if (!quitting && reader == null) EnsureReader().WarmWeb();
            };
            sweepTimer.Tick += async (sender, args) =>
            {
                sweepTimer.Stop();
                if (scan != null || sweeping) { sweepTimer.Start(); return; }
                if (quitting) return;
                sweeping = true;
                try { await Task.Run(() => Library.SweepThumbnails()); }
                catch (Exception error) { TraceStartup("Thumbnail cleanup deferred: " + error.GetType().Name); }
                finally { sweeping = false; }
            };
            MainForm = main;
            main.FormClosing += (sender, args) =>
            {
                quitting = true;
                profile.MainBounds = main.GetSavedBounds();
                if (reader != null) reader.Close();
                WriteProfile();
            };
            main.Shown += async (sender, args) =>
            {
                TraceStartup("Main window shown");
                SetupWatchers();
                try
                {
                    await RefreshAsync();
                    if (!quitting && restoreReader && Library.IsVolume(GetString(profile.State, "current"))) RequestDetached(true);
                    else ScheduleWarmReader();
                }
                catch (Exception error) { main.Send(new { type = "notice", message = error.Message }); }
            };
            main.Show();
        }

        internal void TraceStartup(string phase)
        {
            if (!traceStartup) return;
            var line = String.Format(CultureInfo.InvariantCulture, "{0,8:F1} ms  {1}{2}", startup.Elapsed.TotalMilliseconds, phase, Environment.NewLine);
            try { File.AppendAllText(Path.Combine(appData, "startup.log"), line); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private Profile LoadProfile()
        {
            Profile loaded = null;
            foreach (var file in new[] { profileFile, profileFile + ".bak" })
            {
                try
                {
                    if (File.Exists(file)) loaded = Json().Deserialize<Profile>(File.ReadAllText(file));
                    if (loaded != null) break;
                }
                catch (IOException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
            loaded = loaded ?? new Profile();
            loaded.Roots = loaded.Roots ?? new List<string>();
            loaded.State = loaded.State ?? new Dictionary<string, object>();
            foreach (var key in new[] { "prefs", "reader" })
            {
                object raw, mode, sort;
                var options = loaded.State.TryGetValue(key, out raw) ? raw as Dictionary<string, object> : null;
                if (options == null) continue;
                if (options.TryGetValue("mode", out mode) && Object.Equals(mode, "turn")) options["mode"] = "paged";
                if (key == "prefs" && options.TryGetValue("sort", out sort))
                {
                    var legacyFolderSort = Object.Equals(sort, "folders");
                    if (!options.ContainsKey("foldersFirst")) options["foldersFirst"] = legacyFolderSort;
                    if (legacyFolderSort) options["sort"] = "name";
                }
            }
            return loaded;
        }

        private bool BeginReaderSession()
        {
            object raw;
            var prefs = profile.State.TryGetValue("prefs", out raw) ? raw as Dictionary<string, object> : null;
            if (prefs == null) profile.State["prefs"] = prefs = new Dictionary<string, object>();
            if (!prefs.ContainsKey("filmstripOpen")) prefs["filmstripOpen"] = ReadFlag("filmstrip", false);
            profile.State.Remove("filmstrip");

            if (!profile.State.ContainsKey("lastVolume")) profile.State["lastVolume"] = GetString(profile.State, "current");
            var startupComic = GetString(prefs, "startupComic");
            var volume = startupComic == "resume" || startupComic == "first" ? GetString(profile.State, "lastVolume") : null;
            profile.State["current"] = volume;
            // Page one at startup is a session override. Only reading activity changes saved progress.
            profile.State["pageOverride"] = startupComic == "first" && volume != null ? (object)1 : null;
            if (volume == null) profile.State["workspace"] = "split";
            return volume != null && ReadFlag("detached", false);
        }

        private void WriteProfile()
        {
            var temporary = profileFile + ".tmp";
            try
            {
                File.WriteAllText(temporary, Json().Serialize(profile), Encoding.UTF8);
                if (File.Exists(profileFile)) File.Replace(temporary, profileFile, profileFile + ".bak");
                else File.Move(temporary, profileFile);
            }
            catch (IOException error) { if (!quitting) main.Send(new { type = "notice", message = "Could not save library settings. " + error.Message }); }
            catch (UnauthorizedAccessException error) { if (!quitting) main.Send(new { type = "notice", message = "Could not save library settings. " + error.Message }); }
        }

        internal Task<CoreWebView2Environment> EnvironmentAsync()
        {
            if (web == null)
            {
                var options = new CoreWebView2EnvironmentOptions("--disable-background-networking --disable-sync");
                webData = new WebViewDataFolder(appData);
                if (webData.UsingAlternate) TraceStartup("Previous WebView2 runtime still closing; using alternate data folder");
                web = CoreWebView2Environment.CreateAsync(null, webData.Path, options);
            }
            return web;
        }

        internal void RecordWebViewProcess(int processId)
        {
            webData.RecordProcess(processId);
        }

        private void QueueSave()
        {
            saveTimer.Stop();
            saveTimer.Start();
        }

        private bool ReadFlag(string field, bool fallback)
        {
            object value;
            return profile.State.TryGetValue(field, out value) && value is bool ? (bool)value : fallback;
        }

        private bool WatchEnabled()
        {
            object value, enabled;
            var prefs = profile.State.TryGetValue("prefs", out value) ? value as Dictionary<string, object> : null;
            return prefs == null || !prefs.TryGetValue("watch", out enabled) || !Object.Equals(enabled, false);
        }

        private string ThemeName()
        {
            object value;
            var prefs = profile.State.TryGetValue("prefs", out value) ? value as Dictionary<string, object> : null;
            return prefs == null ? null : GetString(prefs, "theme");
        }

        private void SetupWatchers()
        {
            foreach (var existing in watchers) existing.Dispose();
            watchers.Clear();
            if (!WatchEnabled() || quitting) return;
            foreach (var path in profile.Roots.Where(Directory.Exists))
            {
                FileSystemWatcher watcher = null;
                try
                {
                    watcher = new FileSystemWatcher(path) {
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                        SynchronizingObject = main
                    };
                    watcher.Created += ScheduleScan;
                    watcher.Deleted += ScheduleScan;
                    watcher.Changed += ScheduleScan;
                    watcher.Renamed += ScheduleScan;
                    watcher.Error += (sender, args) => ScheduleScan(sender, null);
                    watcher.EnableRaisingEvents = true;
                    watchers.Add(watcher);
                }
                catch (IOException) { if (watcher != null) watcher.Dispose(); }
                catch (UnauthorizedAccessException) { if (watcher != null) watcher.Dispose(); }
                catch (ArgumentException) { if (watcher != null) watcher.Dispose(); }
            }
        }

        private void ScheduleScan(object sender, FileSystemEventArgs args)
        {
            if (quitting) return;
            if (main.InvokeRequired)
            {
                try { main.BeginInvoke(new Action(() => ScheduleScan(sender, args))); }
                catch (InvalidOperationException) { }
                return;
            }
            if (args == null || changedPaths.Count >= 128) scanAll = true;
            else
            {
                changedPaths.Add(args.FullPath);
                var rename = args as RenamedEventArgs;
                if (rename != null) changedPaths.Add(rename.OldFullPath);
            }
            scanTimer.Stop();
            scanTimer.Start();
        }

        private async Task RefreshAsync(bool full = true)
        {
            if (!full && !scanAll && changedPaths.Count == 0) return;
            scanAll |= full;
            scanAgain = true;
            if (scan == null) scan = ScanLoopAsync();
            await scan;
        }

        private async Task ScanLoopAsync()
        {
            // Yield before the first scan so every caller sees the in-flight task.
            await Task.Yield();
            try
            {
                while (scanAgain && !quitting)
                {
                    scanAgain = false;
                    var roots = profile.Roots.ToArray();
                    var changes = scanAll ? null : changedPaths.ToArray();
                    scanAll = false;
                    changedPaths.Clear();
                    if (!startupIndexChecked)
                    {
                        startupIndexChecked = true;
                        TraceStartup("Saved library index read started");
                        var loaded = await Task.Run(() => Library.LoadIndex(indexFile, roots));
                        TraceStartup(loaded ? "Saved library index ready" : "No usable saved library index");
                        if (loaded && !quitting) Broadcast(new { type = "library", catalog = Library.Snapshot() }, null);
                    }
                    if (quitting) break;
                    TraceStartup(changes == null ? "Library verification started" : "Changed folders scan started");
                    var changed = await Task.Run(() => Library.Scan(roots, changes));
                    TraceStartup(changes == null ? "Library verification completed" : "Changed folders scan completed");
                    if (changed && !quitting) Broadcast(new { type = "library", catalog = Library.Snapshot() }, null);
                    indexPending |= changed;
                    if (indexPending) indexPending = !await Task.Run(() => Library.SaveIndex(indexFile));
                    if (!quitting && !sweepTimer.Enabled) sweepTimer.Start();
                }
            }
            catch (Exception error)
            {
                if (!quitting) Broadcast(new { type = "library", catalog = Library.Snapshot() }, null);
                Broadcast(new { type = "notice", message = "Could not refresh the library. " + error.Message }, null);
            }
            finally { scan = null; }
        }

        private void Broadcast(object message, ComicWindow exclude)
        {
            if (main != exclude) main.Send(message);
            if (reader != null && reader != exclude && (preparingTicket != 0 || ReadFlag("detached", false)))
                reader.Send(message);
        }

        private void ScheduleWarmReader()
        {
            if (!quitting && libraryFrameReady && reader == null && !String.IsNullOrEmpty(GetString(profile.State, "current")) && !warmReaderTimer.Enabled)
                warmReaderTimer.Start();
        }

        private ComicWindow EnsureReader()
        {
            if (reader != null) return reader;
            var target = new ComicWindow(this, true, profile.ReaderBounds);
            target.ApplyTheme(ThemeName());
            reader = target;
            target.FormClosing += (sender, args) => { profile.ReaderBounds = target.GetSavedBounds(); };
            target.FormClosed += (sender, args) =>
            {
                if (reader != target) return;
                reader = null;
                if (!quitting) RequestDetached(false);
            };
            return target;
        }

        internal void RequestDetached(bool detached)
        {
            if (!detached)
            {
                preparingTicket = 0;
                detachTimer.Stop();
                main.Send(new { type = "detaching", preparing = false });
                if (ReadFlag("detached", false))
                {
                    PublishDetached(false);
                    main.Activate();
                }
                if (reader != null)
                {
                    profile.ReaderBounds = reader.GetSavedBounds();
                    reader.Hide();
                }
                return;
            }
            if (preparingTicket != 0 || ReadFlag("detached", false)) return;
            preparingTicket = ++detachTicket;
            main.Send(new { type = "detaching", preparing = true });
            detachTimer.Start();
            EnsureReader();
            if (reader.WindowState == FormWindowState.Minimized) reader.WindowState = FormWindowState.Normal;
            reader.Opacity = 0;
            reader.Show();
            if (reader.Bootstrapped)
            {
                reader.Send(new { type = "prepare-reader", ticket = preparingTicket, state = profile.State, catalog = Library.Snapshot() });
            }
        }

        private void PublishDetached(bool detached)
        {
            profile.State["detached"] = detached;
            profile.State["workspace"] = "split";
            QueueSave();
            Broadcast(new { type = "state", patch = new { detached = detached, workspace = "split" } }, null);
        }

        private void ReadyToDetach(ComicWindow window, Dictionary<string, object> data)
        {
            object value;
            if (reader != window || preparingTicket == 0 || !data.TryGetValue("ticket", out value) ||
                Convert.ToInt32(value, CultureInfo.InvariantCulture) != preparingTicket) return;
            if (!data.TryGetValue("ready", out value) || !Object.Equals(value, true))
            {
                RequestDetached(false);
                main.Send(new { type = "notice", message = "The separate reader could not load this page." });
                return;
            }
            preparingTicket = 0;
            detachTimer.Stop();
            window.Opacity = 1;
            window.Activate();
            PublishDetached(true);
            main.Send(new { type = "detaching", preparing = false });
        }

        private void MergeState(Dictionary<string, object> patch)
        {
            foreach (var pair in patch)
            {
                if (pair.Key == "progress" || pair.Key == "prefs" || pair.Key == "volumeTags" || pair.Key == "keys")
                {
                    object existing;
                    var map = profile.State.TryGetValue(pair.Key, out existing) ? existing as Dictionary<string, object> : null;
                    var updates = pair.Value as Dictionary<string, object>;
                    if (updates == null) continue;
                    if (map == null) profile.State[pair.Key] = map = new Dictionary<string, object>();
                    foreach (var item in updates) map[item.Key] = item.Value;
                }
                else if (pair.Key != "detached") profile.State[pair.Key] = pair.Value;
            }
            QueueSave();
        }

        private static string GetString(Dictionary<string, object> data, string name)
        {
            object value;
            return data.TryGetValue(name, out value) ? value as string : null;
        }

        internal async Task<object> DispatchAsync(ComicWindow window, string method, Dictionary<string, object> data)
        {
            switch (method)
            {
                case "bootstrap":
                    if (!window.ReaderOnly) TraceStartup("Main UI requested saved state");
                    window.Bootstrapped = true;
                    return new { role = window.ReaderOnly ? "reader" : "main", version = typeof(ComicApplication).Assembly.GetName().Version.ToString(3),
                        state = profile.State, catalog = Library.HasCatalog || scan == null ? Library.Snapshot() : null,
                        ticket = window.ReaderOnly ? preparingTicket : 0 };
                case "libraryFrame":
                    if (!window.ReaderOnly && !libraryFrameReady)
                    {
                        libraryFrameReady = true;
                        TraceStartup("First library view rendered");
                        ScheduleWarmReader();
                    }
                    return null;
                case "save":
                    var wasWatching = WatchEnabled();
                    var theme = ThemeName();
                    MergeState(data);
                    if (wasWatching != WatchEnabled()) SetupWatchers();
                    if (theme != ThemeName())
                    {
                        main.ApplyTheme(ThemeName());
                        if (reader != null) reader.ApplyTheme(ThemeName());
                    }
                    if (data.ContainsKey("current"))
                    {
                        if (preparingTicket != 0 && GetString(profile.State, "current") == null) RequestDetached(false);
                        ScheduleWarmReader();
                    }
                    Broadcast(new { type = "state", patch = data }, window);
                    return null;
                case "scan":
                    await RefreshAsync();
                    SetupWatchers();
                    return Library.Snapshot();
                case "addRoot":
                    using (var pick = new FolderBrowserDialog { Description = "Choose a folder containing comics", ShowNewFolderButton = false })
                    {
                        if (pick.ShowDialog(window) != DialogResult.OK) return null;
                        var folder = Library.NormalizeRoot(pick.SelectedPath);
                        if (profile.Roots.Contains(folder, StringComparer.OrdinalIgnoreCase)) return Library.Snapshot();
                        profile.Roots.Add(folder);
                    }
                    WriteProfile();
                    SetupWatchers();
                    await RefreshAsync();
                    return Library.Snapshot();
                case "removeRoot":
                    var path = GetString(data, "path");
                    profile.Roots.RemoveAll(root => String.Equals(root, path, StringComparison.OrdinalIgnoreCase));
                    WriteProfile();
                    SetupWatchers();
                    await RefreshAsync();
                    return Library.Snapshot();
                case "open":
                    var entry = await Task.Run(() => Library.OpenAsync(GetString(data, "id") ?? ""));
                    Broadcast(new { type = "volume", entry = entry }, window);
                    return entry;
                case "showEntryFolder":
                    var entryFolder = Library.EntryFolder(GetString(data, "id") ?? "");
                    if (!Directory.Exists(entryFolder)) throw new IOException("This folder is unavailable.");
                    Process.Start(new ProcessStartInfo(entryFolder) { UseShellExecute = true, Verb = "open" });
                    return null;
                case "openGithubProfile":
                    Process.Start(new ProcessStartInfo("https://github.com/alviscmh") { UseShellExecute = true });
                    return null;
                case "focusReader":
                    if (reader != null && ReadFlag("detached", false))
                    {
                        if (reader.WindowState == FormWindowState.Minimized) reader.WindowState = FormWindowState.Normal;
                        reader.Activate();
                    }
                    return null;
                case "showVolumeInLibrary":
                    var volumeId = GetString(data, "id");
                    if (!Library.IsVolume(volumeId)) throw new IOException("This volume is no longer in your library.");
                    if (main.WindowState == FormWindowState.Minimized) main.WindowState = FormWindowState.Normal;
                    main.Activate();
                    main.Send(new { type = "show-volume-in-library", volumeId = volumeId });
                    return null;
                case "detach":
                    object requested;
                    RequestDetached(data.TryGetValue("detached", out requested) && Object.Equals(requested, true));
                    return null;
                case "readerReady":
                    ReadyToDetach(window, data);
                    return null;
                default:
                    throw new InvalidOperationException("Unknown Mynd action.");
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                foreach (var watcher in watchers) watcher.Dispose();
                scanTimer.Dispose();
                saveTimer.Dispose();
                detachTimer.Dispose();
                warmReaderTimer.Dispose();
                sweepTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    sealed partial class ComicWindow : Form
    {
        // The reserved loopback suffix keeps WebView2 from waiting on DNS for this virtual host.
        private const string AssetHost = "kkomic.localhost";
        internal const string Origin = "https://" + AssetHost;
        private readonly ComicApplication application;
        private readonly Panel view = new Panel { Dock = DockStyle.Fill, TabStop = true };
        private readonly Label loading = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
            Text = "Starting Mynd…" };
        private CoreWebView2Controller controller;
        private readonly string assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui");
        internal readonly bool ReaderOnly;
        internal bool Bootstrapped;
        private bool webStarted;
        private bool webReady;
        private static readonly Dictionary<string, string> StaticFiles = new Dictionary<string, string>(StringComparer.Ordinal) {
            { "/index.html", "text/html; charset=utf-8" }, { "/app.css", "text/css; charset=utf-8" },
            { "/app.js", "text/javascript; charset=utf-8" }, { "/bridge.js", "text/javascript; charset=utf-8" },
            { "/vendor/lucide.js", "text/javascript; charset=utf-8" }, { "/mynd-icon.png", "image/png" }
        };

        internal ComicWindow(ComicApplication owner, bool readerOnly, int[] bounds)
        {
            application = owner;
            ReaderOnly = readerOnly;
            Text = readerOnly ? "Mynd Reader" : "Mynd";
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(21, 18, 29);
            MinimumSize = new Size(395, 370);
            Size = readerOnly ? new Size(760, 940) : new Size(1320, 850);
            StartPosition = FormStartPosition.CenterScreen;
            if (bounds != null && bounds.Length == 4 && bounds[2] >= MinimumSize.Width && bounds[3] >= MinimumSize.Height)
            {
                var requested = new Rectangle(bounds[0], bounds[1], bounds[2], bounds[3]);
                if (Screen.AllScreens.Any(screen => Rectangle.Intersect(screen.WorkingArea, requested).Width >= 150 &&
                    Rectangle.Intersect(screen.WorkingArea, requested).Height >= 70))
                {
                    StartPosition = FormStartPosition.Manual;
                    Bounds = requested;
                }
            }
            var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Mynd.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            Controls.Add(view);
            if (!ReaderOnly) view.Controls.Add(loading);
            view.SizeChanged += (sender, args) => SynchronizeWebView();
            view.Enter += (sender, args) =>
            {
                if (controller != null) controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
            };
            Shown += InitializeWeb;
        }

        internal int[] GetSavedBounds()
        {
            var rectangle = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            return new[] { rectangle.X, rectangle.Y, rectangle.Width, rectangle.Height };
        }

        protected override void OnResize(EventArgs args)
        {
            base.OnResize(args);
            SynchronizeWebView();
        }

        protected override void OnLocationChanged(EventArgs args)
        {
            base.OnLocationChanged(args);
            SynchronizeWebView();
        }

        protected override void OnVisibleChanged(EventArgs args)
        {
            base.OnVisibleChanged(args);
            SynchronizeWebView();
        }

        protected override void OnActivated(EventArgs args)
        {
            base.OnActivated(args);
            if (controller != null) BeginInvoke(new Action(SynchronizeWebView));
        }

        private void SynchronizeWebView()
        {
            if (controller == null || IsDisposed || Disposing) return;
            var visible = Visible && WindowState != FormWindowState.Minimized;
            if (visible)
            {
                controller.Bounds = view.ClientRectangle;
                controller.NotifyParentWindowPositionChanged();
            }
            controller.IsVisible = visible && webReady;
        }

        internal void WarmWeb()
        {
            Opacity = 0;
            // Creating the invisible control avoids exposing an empty native window during startup.
            var handle = view.Handle;
            InitializeWeb(this, EventArgs.Empty);
        }

        private async void InitializeWeb(object sender, EventArgs e)
        {
            Shown -= InitializeWeb;
            if (webStarted) return;
            webStarted = true;
            try
            {
                var environment = await application.EnvironmentAsync();
                if (!ReaderOnly) application.TraceStartup("WebView2 environment ready");
                if (IsDisposed || Disposing) return;
                var browser = await environment.CreateCoreWebView2ControllerAsync(view.Handle);
                if (IsDisposed || Disposing) { browser.Close(); return; }
                controller = browser;
                if (!ReaderOnly) application.TraceStartup("WebView2 controller ready");
                browser.DefaultBackgroundColor = view.BackColor;
                SynchronizeWebView();
                var core = browser.CoreWebView2;
                application.RecordWebViewProcess((int)core.BrowserProcessId);
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.NavigationStarting += (s, args) => { if (args.Uri != Origin + "/index.html") args.Cancel = true; };
                core.NavigationCompleted += (s, args) =>
                {
                    if (!args.IsSuccess) return;
                    webReady = true;
                    if (!ReaderOnly)
                    {
                        loading.Hide();
                        application.TraceStartup("Main UI loaded");
                    }
                    SynchronizeWebView();
                };
                core.NewWindowRequested += (s, args) => args.Handled = true;
                core.PermissionRequested += (s, args) => args.State = CoreWebView2PermissionState.Deny;
                core.DownloadStarting += (s, args) => args.Cancel = true;
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += ServeResource;
                core.WebMessageReceived += Receive;
                if (!ReaderOnly) application.TraceStartup("Main navigation requested");
                core.Navigate(Origin + "/index.html");
            }
            catch (Exception error)
            {
                if (!IsDisposed)
                {
                    MessageBox.Show(this, "The Microsoft Edge WebView2 Runtime could not start.\n\n" + error.Message,
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Close();
                }
            }
        }

        private async void ServeResource(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            var deferral = args.GetDeferral();
            try
            {
                var environment = controller.CoreWebView2.Environment;
                Uri uri;
                string contentType;
                if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != Origin || args.Request.Method != "GET")
                {
                    args.Response = environment.CreateWebResourceResponse(null, 403, "Forbidden", "");
                    return;
                }
                if (StaticFiles.TryGetValue(uri.AbsolutePath, out contentType))
                {
                    if (!ReaderOnly && uri.AbsolutePath == "/index.html") application.TraceStartup("Main document requested");
                    var name = Path.Combine(assets, uri.AbsolutePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                    args.Response = environment.CreateWebResourceResponse(File.OpenRead(name), 200, "OK",
                        "Content-Type: " + contentType + "\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff");
                    return;
                }
                var parts = uri.AbsolutePath.Split('/');
                int page, scale;
                if (parts.Length == 5 && parts[1] == "media" && (parts[2] == "thumb" || parts[2] == "page") &&
                    parts[3].Length == 32 && Int32.TryParse(parts[4], NumberStyles.None, CultureInfo.InvariantCulture, out page))
                {
                    var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
                    if (!Int32.TryParse(query["scale"], NumberStyles.None, CultureInfo.InvariantCulture, out scale)) scale = 2400;
                    var media = await Task.Run(() => application.Library.LoadAsync(parts[3], page, parts[2] == "thumb", Math.Max(420, Math.Min(4400, scale))));
                    if (IsDisposed) return;
                    args.Response = environment.CreateWebResourceResponse(new MemoryStream(media.Bytes, false), 200, "OK",
                        "Content-Type: " + media.Mime + "\r\nCache-Control: private, max-age=2592000\r\nX-Content-Type-Options: nosniff");
                    return;
                }
                args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            }
            catch (Exception)
            {
                if (!IsDisposed && controller != null)
                    args.Response = controller.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Unavailable", "Cache-Control: no-store");
            }
            finally { deferral.Complete(); }
        }

        internal void Send(object message)
        {
            if (!IsDisposed && controller != null)
                controller.CoreWebView2.PostWebMessageAsJson(ComicApplication.Json().Serialize(message));
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && controller != null)
            {
                var browser = controller;
                controller = null;
                browser.Close();
            }
            base.Dispose(disposing);
        }

        private async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args.Source != Origin + "/index.html") return;
            var id = 0;
            try
            {
                var message = ComicApplication.Json().Deserialize<Dictionary<string, object>>(args.WebMessageAsJson);
                id = Convert.ToInt32(message["id"], CultureInfo.InvariantCulture);
                var method = message["method"] as string;
                var data = message["data"] as Dictionary<string, object> ?? new Dictionary<string, object>();
                var result = await application.DispatchAsync(this, method, data);
                Send(new { id = id, result = result });
            }
            catch (Exception error) { Send(new { id = id, error = error.Message }); }
        }
    }
}
