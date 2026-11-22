using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Data.Pdf;
using Windows.Foundation;
using Windows.Storage;
using Windows.Storage.Streams;

namespace Mynd
{
    sealed class LibraryEntry
    {
        public string id { get; set; }
        public string parent { get; set; }
        public string title { get; set; }
        public string type { get; set; }
        public string format { get; set; }
        public string revision { get; set; }
        public int pages { get; set; }
        public int directFolders { get; set; }
        public string[] covers { get; set; }
        internal string Path;
        internal FilePage[] Images;
        internal string FileVersion;
        internal readonly SemaphoreSlim OpenLock = new SemaphoreSlim(1);
        internal string[] ArchivePages;
        internal PdfDocument Pdf;
    }

    sealed class FilePage
    {
        internal string Path;
        internal string Version;
    }

    sealed class LibraryRoot
    {
        public string id { get; set; }
        public string path { get; set; }
        public bool available { get; set; }
    }

    sealed class Media
    {
        internal readonly byte[] Bytes;
        internal readonly string Mime;
        internal Media(byte[] bytes, string mime) { Bytes = bytes; Mime = mime; }
    }

    sealed partial class Library
    {
        private const int MaxPageSize = 160 * 1024 * 1024;
        private const int ThumbnailSize = 420;
        private readonly string cache;
        private readonly SemaphoreSlim imageWork = new SemaphoreSlim(4);
        private readonly SemaphoreSlim pageWork = new SemaphoreSlim(2);
        private readonly ConcurrentDictionary<string, Lazy<Task<Media>>> thumbnails = new ConcurrentDictionary<string, Lazy<Task<Media>>>();
        private sealed class Catalog
        {
            internal readonly LibraryRoot[] Roots;
            internal readonly Dictionary<string, LibraryEntry> Entries;
            internal Catalog(LibraryRoot[] roots, Dictionary<string, LibraryEntry> entries) { Roots = roots; Entries = entries; }
        }
        private volatile Catalog catalog = new Catalog(new LibraryRoot[0], new Dictionary<string, LibraryEntry>());
        private volatile bool hasCatalog;
        internal bool HasCatalog { get { return hasCatalog; } }

        internal Library(string cachePath)
        {
            cache = cachePath;
            Directory.CreateDirectory(cache);
        }

        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
        private static extern int StrCmpLogicalW(string a, string b);

        private static readonly IComparer<string> Natural = Comparer<string>.Create((a, b) => StrCmpLogicalW(a, b));
        private static readonly HashSet<string> ImageKinds = new HashSet<string>(
            new[] { ".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".avif", ".ico" }, StringComparer.OrdinalIgnoreCase);
        private static readonly HashSet<string> ArchiveKinds = new HashSet<string>(
            new[] { ".cbz", ".cbr", ".pdf" }, StringComparer.OrdinalIgnoreCase);

        private static string Hash(SHA256 sha, string value)
        {
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value)), 0, 16).Replace("-", "").ToLowerInvariant();
        }

        private static string Id(SHA256 sha, string path) { return Hash(sha, path.ToUpperInvariant()); }

        internal static string NormalizeRoot(string path)
        {
            var full = Path.GetFullPath(path);
            var root = Path.GetPathRoot(full);
            return full.Length == root.Length ? full : full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static string Version(SHA256 sha, FileInfo file)
        {
            return Hash(sha, file.FullName.ToUpperInvariant() + "|" + file.Length + "|" + file.LastWriteTimeUtc.Ticks);
        }

        private static bool Readable(Exception error)
        {
            return error is IOException || error is UnauthorizedAccessException || error is System.Security.SecurityException;
        }

        internal object Snapshot()
        {
            var current = catalog;
            return new { roots = current.Roots, entries = current.Entries.Values.ToArray() };
        }

        internal bool Scan(string[] configuredRoots, string[] changes)
        {
            using (var sha = SHA256.Create()) return Scan(configuredRoots, changes, sha);
        }

        private bool Scan(string[] configuredRoots, string[] changes, SHA256 sha)
        {
            var tree = new Dictionary<string, LibraryEntry>();
            var rootList = new List<LibraryRoot>();
            var rootPaths = new HashSet<string>(configuredRoots, StringComparer.OrdinalIgnoreCase);
            var previous = catalog.Entries;
            var previousChildren = previous.Values.ToLookup(entry => entry.parent);
            foreach (var path in configuredRoots)
            {
                var folder = new DirectoryInfo(path);
                var root = new LibraryRoot { id = Id(sha, path), path = path, available = Directory.Exists(path) };
                rootList.Add(root);
                if ((!root.available || (changes != null && !Affected(path, changes))) &&
                    previous.ContainsKey(root.id))
                {
                    CopyBranch(previous[root.id], previousChildren, tree, rootPaths);
                    continue;
                }
                var entry = Branch(folder, root.id, "libraries");
                tree[entry.id] = entry;
                if (root.available)
                    Visit(folder, entry, tree, rootPaths, previous, previousChildren, changes, sha);
            }
            var changed = !hasCatalog || !Equivalent(catalog, rootList, tree);
            if (changed) catalog = new Catalog(rootList.ToArray(), tree);
            hasCatalog = true;
            return changed;
        }

        private static bool ContainsPath(string folder, string path)
        {
            return String.Equals(folder, path, StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith(folder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        private static bool Affected(string path, string[] changes)
        {
            return changes.Any(change => ContainsPath(path, change) || ContainsPath(change, path));
        }

        private static void CopyBranch(LibraryEntry entry, ILookup<string, LibraryEntry> children, Dictionary<string, LibraryEntry> tree, HashSet<string> rootPaths)
        {
            tree.Add(entry.id, entry);
            foreach (var child in children[entry.id])
                if (!rootPaths.Contains(child.Path)) CopyBranch(child, children, tree, rootPaths);
        }

        private static LibraryEntry Branch(DirectoryInfo folder, string id, string parent)
        {
            return new LibraryEntry {
                id = id, parent = parent, title = folder.Name, Path = folder.FullName,
                type = "folder", covers = new string[0]
            };
        }

        private static void Visit(DirectoryInfo folder, LibraryEntry branch, Dictionary<string, LibraryEntry> tree,
            HashSet<string> rootPaths, Dictionary<string, LibraryEntry> previous, ILookup<string, LibraryEntry> previousChildren, string[] changes, SHA256 sha)
        {
            FileSystemInfo[] items;
            try
            {
                items = folder.GetFileSystemInfos();
                branch.directFolders = items.OfType<DirectoryInfo>().Count();
                items = items
                    .Where(item => (item.Attributes & System.IO.FileAttributes.ReparsePoint) == 0)
                    .OrderBy(item => item.Name, Natural).ToArray();
            }
            catch (Exception error)
            {
                if (!Readable(error)) throw;
                LibraryEntry cached;
                if (previous.TryGetValue(branch.id, out cached) && cached.type == "folder" && cached.parent == branch.parent)
                {
                    branch.directFolders = cached.directFolders;
                    foreach (var child in previousChildren[branch.id])
                        if (!rootPaths.Contains(child.Path)) CopyBranch(child, previousChildren, tree, rootPaths);
                    branch.covers = cached.covers.Where(tree.ContainsKey).ToArray();
                }
                return;
            }

            var directories = items.OfType<DirectoryInfo>().Where(item => !rootPaths.Contains(item.FullName)).ToArray();
            var pictures = new List<FilePage>();
            var archives = new List<LibraryEntry>();
            foreach (var file in items.OfType<FileInfo>())
            {
                try
                {
                    if (ImageKinds.Contains(file.Extension))
                        pictures.Add(new FilePage { Path = file.FullName, Version = Version(sha, file) });
                    else if (ArchiveKinds.Contains(file.Extension))
                    {
                        var id = Id(sha, file.FullName);
                        var revision = Version(sha, file);
                        LibraryEntry existing;
                        if (previous.TryGetValue(id, out existing) && existing.FileVersion == revision && existing.parent == branch.id)
                            archives.Add(existing);
                        else
                            archives.Add(new LibraryEntry {
                                id = id, parent = branch.id, title = Path.GetFileNameWithoutExtension(file.Name),
                                Path = file.FullName, format = file.Extension.Substring(1).ToUpperInvariant(),
                                revision = revision, FileVersion = revision
                            });
                    }
                }
                catch (Exception error) { if (!Readable(error)) throw; }
            }

            if (branch.parent != "libraries" && pictures.Count > 0 && directories.Length == 0 && archives.Count == 0)
            {
                branch.type = null;
                branch.format = "Image folder";
                branch.pages = pictures.Count;
                branch.Images = pictures.ToArray();
                branch.revision = Hash(sha, String.Join("|", pictures.Select(picture => picture.Version)));
                branch.covers = null;
                return;
            }

            const int coverLimit = 5;
            var covers = new List<string>(coverLimit);
            var looseCovers = new List<string>(coverLimit);
            foreach (var subfolder in directories)
            {
                var child = Branch(subfolder, Id(sha, subfolder.FullName), branch.id);
                LibraryEntry existing;
                if (changes != null && !Affected(child.Path, changes) && previous.TryGetValue(child.id, out existing) && existing.parent == branch.id)
                {
                    child = existing;
                    CopyBranch(child, previousChildren, tree, rootPaths);
                }
                else
                {
                    tree[child.id] = child;
                    Visit(subfolder, child, tree, rootPaths, previous, previousChildren, changes, sha);
                }
                if (child.type == null)
                {
                    if (covers.Count < coverLimit) covers.Add(child.id);
                }
                else
                {
                    foreach (var candidate in child.covers)
                    {
                        var candidates = tree[candidate].type == "image" ? looseCovers : covers;
                        if (candidates.Count < coverLimit) candidates.Add(candidate);
                    }
                }
            }
            foreach (var archive in archives)
            {
                tree[archive.id] = archive;
                if (covers.Count < coverLimit) covers.Add(archive.id);
            }
            foreach (var picture in pictures)
            {
                var id = Id(sha, picture.Path);
                tree[id] = new LibraryEntry {
                    id = id, parent = branch.id, title = Path.GetFileName(picture.Path),
                    Path = picture.Path, type = "image", pages = 1, format = Path.GetExtension(picture.Path).Substring(1).ToUpperInvariant(),
                    Images = new[] { picture }, revision = picture.Version
                };
                if (looseCovers.Count < coverLimit) looseCovers.Add(id);
            }
            branch.covers = covers.Concat(looseCovers).Take(coverLimit).ToArray();
        }

        internal bool IsVolume(string id)
        {
            LibraryEntry entry;
            return id != null && catalog.Entries.TryGetValue(id, out entry) && entry.type == null;
        }

        private LibraryEntry Find(string id)
        {
            LibraryEntry entry;
            if (!catalog.Entries.TryGetValue(id, out entry) || entry.type == "folder")
                throw new IOException("This volume is no longer in your library.");
            return entry;
        }

        internal string EntryFolder(string id)
        {
            LibraryEntry entry;
            if (!catalog.Entries.TryGetValue(id, out entry) || entry.type == "image")
                throw new IOException("This folder or volume is unavailable.");
            return entry.type == "folder" || entry.format == "Image folder" ? entry.Path : Path.GetDirectoryName(entry.Path);
        }

        internal async Task<LibraryEntry> OpenAsync(string id)
        {
            var entry = Find(id);
            if (entry.Images != null) return entry;
            await entry.OpenLock.WaitAsync().ConfigureAwait(false);
            try
            {
                if (entry.pages > 0) return entry;
                if (entry.format == "PDF")
                {
                    var file = await Complete(StorageFile.GetFileFromPathAsync(entry.Path)).ConfigureAwait(false);
                    entry.Pdf = await Complete(PdfDocument.LoadFromFileAsync(file)).ConfigureAwait(false);
                    entry.pages = checked((int)entry.Pdf.PageCount);
                }
                else
                {
                    if (entry.format == "CBZ")
                    {
                        using (var stream = OpenFile(entry.Path))
                        using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                            entry.ArchivePages = SortPages(archive.Entries.Where(member => member.Length > 0).Select(member => member.FullName));
                    }
                    else
                    {
                        var list = await RunTarAsync(8 * 1024 * 1024, "-tf", entry.Path).ConfigureAwait(false);
                        entry.ArchivePages = SortPages(Encoding.UTF8.GetString(list).Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                            .Where(name => name.IndexOfAny(new[] { '*', '?', '[', ']', '\\' }) < 0));
                    }
                    entry.pages = entry.ArchivePages.Length;
                }
                if (entry.pages == 0) throw new IOException("This volume contains no supported pages.");
                return entry;
            }
            finally { entry.OpenLock.Release(); }
        }

        private static string[] SortPages(IEnumerable<string> names)
        {
            return names.Where(name => !name.StartsWith("__MACOSX/", StringComparison.OrdinalIgnoreCase) &&
                !name.Split('/').Last().StartsWith("._", StringComparison.Ordinal) && ImageKinds.Contains(Path.GetExtension(name)))
                .OrderBy(name => name, Natural).ThenBy(name => name, StringComparer.Ordinal).ToArray();
        }

        private static FileStream OpenFile(string path)
        {
            return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        }

        private static string PageVersion(LibraryEntry entry, int number)
        {
            return entry.Images == null ? entry.FileVersion : number <= entry.Images.Length ? entry.Images[number - 1].Version : null;
        }

        internal void SweepThumbnails()
        {
            var baseline = catalog;
            try
            {
                foreach (var cached in Directory.EnumerateFiles(cache, "*.jpg"))
                {
                    if (!ReferenceEquals(baseline, catalog)) return;
                    var parts = Path.GetFileNameWithoutExtension(cached).Split('.');
                    LibraryEntry entry;
                    int number;
                    if (parts.Length != 3 || !Int32.TryParse(parts[1], out number) || number < 1) continue;
                    if (baseline.Entries.TryGetValue(parts[0], out entry) && PageVersion(entry, number) == parts[2]) continue;
                    try { File.Delete(cached); }
                    catch (Exception error) { if (!Readable(error)) throw; }
                }
            }
            catch (Exception error) { if (!Readable(error)) throw; }
        }

        internal async Task<Media> LoadAsync(string id, int number, bool thumb, int scale)
        {
            var entry = Find(id);
            if (number < 1) throw new IOException("Invalid page number.");
            if (!thumb)
            {
                await pageWork.WaitAsync().ConfigureAwait(false);
                try
                {
                    entry = await OpenAsync(id).ConfigureAwait(false);
                    if (number > entry.pages) throw new IOException("That page is outside this volume.");
                    return await ReadPageAsync(entry, number, scale).ConfigureAwait(false);
                }
                finally { pageWork.Release(); }
            }

            var version = PageVersion(entry, number);
            if (version == null) throw new IOException("That page is outside this volume.");
            var key = id + "." + number.ToString(CultureInfo.InvariantCulture) + "." + version;
            var request = thumbnails.GetOrAdd(key, ignored => new Lazy<Task<Media>>(() => ThumbnailAsync(entry, number, key)));
            try { return await request.Value.ConfigureAwait(false); }
            finally
            {
                ((ICollection<KeyValuePair<string, Lazy<Task<Media>>>>)thumbnails)
                    .Remove(new KeyValuePair<string, Lazy<Task<Media>>>(key, request));
            }
        }

        private async Task<Media> ThumbnailAsync(LibraryEntry entry, int number, string key)
        {
            await imageWork.WaitAsync().ConfigureAwait(false);
            try
            {
                var target = Path.Combine(cache, key + ".jpg");
                if (File.Exists(target))
                {
                    try { return new Media(File.ReadAllBytes(target), "image/jpeg"); }
                    catch (Exception error) { if (!Readable(error)) throw; }
                }
                entry = await OpenAsync(entry.id).ConfigureAwait(false);
                if (number > entry.pages) throw new IOException("That page is outside this volume.");
                var original = await ReadPageAsync(entry, number, ThumbnailSize).ConfigureAwait(false);
                var image = Resize(original);
                if (image.Mime != "image/jpeg" || Object.ReferenceEquals(image, original)) return image;
                var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    File.WriteAllBytes(temporary, image.Bytes);
                    if (!File.Exists(target)) File.Move(temporary, target);
                }
                catch (Exception error) { if (!Readable(error)) throw; }
                finally
                {
                    try { File.Delete(temporary); }
                    catch (Exception error) { if (!Readable(error)) throw; }
                }
                return image;
            }
            finally { imageWork.Release(); }
        }

        private static Media Resize(Media input)
        {
            try
            {
                using (var stream = new MemoryStream(input.Bytes, false))
                using (var image = Image.FromStream(stream, false, true))
                {
                    var ratio = Math.Min(1, (double)ThumbnailSize / Math.Max(image.Width, image.Height));
                    using (var bitmap = new Bitmap(Math.Max(1, (int)(image.Width * ratio)), Math.Max(1, (int)(image.Height * ratio))))
                    using (var graphics = Graphics.FromImage(bitmap))
                    using (var output = new MemoryStream())
                    {
                        graphics.Clear(Color.White);
                        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        graphics.DrawImage(image, 0, 0, bitmap.Width, bitmap.Height);
                        bitmap.Save(output, ImageFormat.Jpeg);
                        return new Media(output.ToArray(), "image/jpeg");
                    }
                }
            }
            catch (ArgumentException) { return input; }
            catch (ExternalException) { return input; }
            catch (OutOfMemoryException) { return input; }
        }

        private static async Task<Media> ReadPageAsync(LibraryEntry entry, int number, int width)
        {
            if (entry.Images != null)
            {
                var path = entry.Images[number - 1].Path;
                using (var stream = OpenFile(path))
                    return new Media(await ReadBoundedAsync(stream, MaxPageSize).ConfigureAwait(false), Mime(path));
            }
            if (entry.format == "PDF")
            {
                using (var buffer = new InMemoryRandomAccessStream())
                using (var page = entry.Pdf.GetPage((uint)(number - 1)))
                {
                    var bounds = page.Size;
                    var largest = Math.Max(bounds.Width, bounds.Height);
                    var side = (uint)Math.Max(1, Math.Min(4400, width));
                    var options = new PdfPageRenderOptions {
                        DestinationWidth = (uint)Math.Max(1, bounds.Width / largest * side),
                        DestinationHeight = (uint)Math.Max(1, bounds.Height / largest * side)
                    };
                    await Complete(page.RenderToStreamAsync(buffer, options)).ConfigureAwait(false);
                    if (buffer.Size > MaxPageSize) throw new IOException("The rendered PDF page is too large.");
                    using (var stream = buffer.GetInputStreamAt(0))
                    using (var reader = new DataReader(stream))
                    {
                        var bytes = new byte[await Complete(reader.LoadAsync((uint)buffer.Size)).ConfigureAwait(false)];
                        reader.ReadBytes(bytes);
                        return new Media(bytes, DetectImage(bytes));
                    }
                }
            }
            var name = entry.ArchivePages[number - 1];
            if (entry.format == "CBZ")
            {
                using (var file = OpenFile(entry.Path))
                using (var archive = new ZipArchive(file, ZipArchiveMode.Read))
                {
                    var member = archive.GetEntry(name);
                    if (member == null || member.Length > MaxPageSize) throw new IOException("This archive page is missing or too large.");
                    using (var stream = member.Open())
                        return new Media(await ReadBoundedAsync(stream, MaxPageSize).ConfigureAwait(false), Mime(name));
                }
            }
            var data = await RunTarAsync(MaxPageSize, "-xOf", entry.Path, "--", name).ConfigureAwait(false);
            return new Media(data, Mime(name));
        }

        private static string DetectImage(byte[] data)
        {
            if (data.Length > 4 && data[0] == 0xff && data[1] == 0xd8) return "image/jpeg";
            if (data.Length > 4 && data[0] == 0x42 && data[1] == 0x4d) return "image/bmp";
            return "image/png";
        }

        private static Task<T> Complete<T>(IAsyncOperation<T> operation)
        {
            var completion = new TaskCompletionSource<T>();
            operation.Completed = (result, status) =>
            {
                try { completion.TrySetResult(result.GetResults()); }
                catch (Exception error) { completion.TrySetException(error); }
            };
            return completion.Task;
        }

        private static Task<bool> Complete(IAsyncAction operation)
        {
            var completion = new TaskCompletionSource<bool>();
            operation.Completed = (result, status) =>
            {
                try { result.GetResults(); completion.TrySetResult(true); }
                catch (Exception error) { completion.TrySetException(error); }
            };
            return completion.Task;
        }

        private static string Mime(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".jpg": case ".jpeg": case ".jfif": return "image/jpeg";
                case ".png": return "image/png";
                case ".gif": return "image/gif";
                case ".bmp": return "image/bmp";
                case ".webp": return "image/webp";
                case ".avif": return "image/avif";
                case ".ico": return "image/x-icon";
                default: return "application/octet-stream";
            }
        }

        private static async Task<byte[]> ReadBoundedAsync(Stream source, int limit)
        {
            using (var output = new MemoryStream())
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
                {
                    if (output.Length + read > limit) throw new IOException("This page or archive index is too large.");
                    output.Write(buffer, 0, read);
                }
                return output.ToArray();
            }
        }

        private static async Task<byte[]> RunTarAsync(int limit, params string[] args)
        {
            var setup = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "tar.exe"),
                String.Join(" ", args.Select(QuoteArgument))) {
                UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true,
                RedirectStandardInput = true, CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = Process.Start(setup))
            {
                process.StandardInput.Close();
                var errors = process.StandardError.ReadToEndAsync();
                var output = ReadBoundedAsync(process.StandardOutput.BaseStream, limit);
                try
                {
                    if (await Task.WhenAny(output, Task.Delay(30000)).ConfigureAwait(false) != output)
                        throw new IOException("The CBR archive took too long to read.");
                    var data = await output.ConfigureAwait(false);
                    if (!process.WaitForExit(3000)) throw new IOException("The CBR reader did not finish.");
                    await errors.ConfigureAwait(false);
                    if (process.ExitCode != 0) throw new IOException("Windows could not read this CBR archive.");
                    return data;
                }
                finally
                {
                    try { if (!process.HasExited) process.Kill(); }
                    catch (InvalidOperationException) { }
                }
            }
        }

        private static string QuoteArgument(string value)
        {
            var quote = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') quote.Append('\\', slashes * 2 + 1);
                else quote.Append('\\', slashes);
                slashes = 0;
                quote.Append(character);
            }
            return quote.Append('\\', slashes * 2).Append('"').ToString();
        }
    }
}
