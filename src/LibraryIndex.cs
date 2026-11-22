using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Mynd
{
    sealed partial class Library
    {
        private const int IndexVersion = 1;

        private sealed class SavedIndex
        {
            public int Version { get; set; }
            public LibraryRoot[] Roots { get; set; }
            public SavedEntry[] Entries { get; set; }
        }

        private sealed class SavedEntry
        {
            public LibraryEntry Node { get; set; }
            public string Path { get; set; }
            public string[] Pages { get; set; }
            public string[] Versions { get; set; }
        }

        internal bool LoadIndex(string file, string[] configuredRoots)
        {
            try
            {
                var info = new FileInfo(file);
                if (!info.Exists || info.Length > 128L * 1024 * 1024) return false;
                var saved = ComicApplication.Json().Deserialize<SavedIndex>(File.ReadAllText(file));
                if (saved == null || saved.Version != IndexVersion || saved.Roots == null || saved.Entries == null ||
                    !saved.Roots.Select(root => root.path).SequenceEqual(configuredRoots, StringComparer.OrdinalIgnoreCase)) return false;

                var rootPaths = saved.Roots.ToDictionary(root => root.id, root => root.path);
                var tree = new Dictionary<string, LibraryEntry>(saved.Entries.Length);
                using (var sha = SHA256.Create())
                foreach (var item in saved.Entries)
                {
                    var entry = item.Node;
                    if (!String.Equals(item.Path, NormalizeRoot(item.Path), StringComparison.OrdinalIgnoreCase) ||
                        entry.id != Id(sha, item.Path) || (entry.type != null && entry.type != "folder" && entry.type != "image")) return false;
                    entry.Path = item.Path;
                    if (entry.type == "folder")
                    {
                        if (entry.covers == null) return false;
                    }
                    else if (entry.format == "Image folder" || entry.type == "image")
                    {
                        if (item.Pages == null || item.Versions == null || item.Pages.Length == 0 ||
                            item.Pages.Length != item.Versions.Length || entry.pages != item.Pages.Length) return false;
                        var folder = entry.type == "image" ? Path.GetDirectoryName(entry.Path) : entry.Path;
                        entry.Images = new FilePage[item.Pages.Length];
                        for (int i = 0; i < item.Pages.Length; i++)
                        {
                            var name = item.Pages[i];
                            if (String.IsNullOrEmpty(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
                                !ImageKinds.Contains(Path.GetExtension(name))) return false;
                            entry.Images[i] = new FilePage { Path = Path.Combine(folder, name), Version = item.Versions[i] };
                        }
                        if (entry.type == "image" && (entry.pages != 1 || entry.Images[0].Path != entry.Path)) return false;
                    }
                    else
                    {
                        if (!ArchiveKinds.Contains(Path.GetExtension(entry.Path))) return false;
                        // Archive/PDF handles and page lists are opened lazily in this process.
                        entry.FileVersion = entry.revision;
                        entry.pages = 0;
                    }
                    tree.Add(entry.id, entry);
                }

                foreach (var entry in tree.Values)
                {
                    if (entry.parent == "libraries")
                    {
                        string root;
                        if (entry.type != "folder" || !rootPaths.TryGetValue(entry.id, out root) ||
                            !String.Equals(root, entry.Path, StringComparison.OrdinalIgnoreCase)) return false;
                    }
                    else
                    {
                        LibraryEntry parent;
                        if (!tree.TryGetValue(entry.parent, out parent) || parent.type != "folder" ||
                            !String.Equals(parent.Path, Path.GetDirectoryName(entry.Path), StringComparison.OrdinalIgnoreCase)) return false;
                    }
                    if (entry.covers != null && entry.covers.Any(id => !tree.ContainsKey(id))) return false;
                }
                if (rootPaths.Keys.Any(id => !tree.ContainsKey(id))) return false;

                catalog = new Catalog(saved.Roots, tree);
                hasCatalog = true;
                return true;
            }
            catch (Exception error)
            {
                if (!Readable(error) && !(error is ArgumentException) && !(error is InvalidOperationException) &&
                    !(error is NullReferenceException) && !(error is NotSupportedException) && !(error is FormatException) &&
                    !(error is OverflowException)) throw;
                return false;
            }
        }

        internal bool SaveIndex(string file)
        {
            var current = catalog;
            var saved = new SavedIndex {
                Version = IndexVersion, Roots = current.Roots,
                Entries = current.Entries.Values.Select(entry => new SavedEntry {
                    Node = entry, Path = entry.Path,
                    Pages = entry.Images == null ? null : entry.Images.Select(page => Path.GetFileName(page.Path)).ToArray(),
                    Versions = entry.Images == null ? null : entry.Images.Select(page => page.Version).ToArray()
                }).ToArray()
            };
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, ComicApplication.Json().Serialize(saved), new UTF8Encoding(false));
                if (File.Exists(file)) File.Replace(temporary, file, null);
                else File.Move(temporary, file);
                return true;
            }
            catch (Exception error)
            {
                if (!Readable(error)) throw;
                return false;
            }
            finally
            {
                try { File.Delete(temporary); }
                catch (Exception error) { if (!Readable(error)) throw; }
            }
        }

        private static bool Equivalent(Catalog current, List<LibraryRoot> roots, Dictionary<string, LibraryEntry> tree)
        {
            if (current.Roots.Length != roots.Count || current.Entries.Count != tree.Count) return false;
            for (int i = 0; i < roots.Count; i++)
                if (current.Roots[i].id != roots[i].id || current.Roots[i].available != roots[i].available) return false;
            foreach (var entry in tree.Values)
            {
                LibraryEntry prior;
                if (!current.Entries.TryGetValue(entry.id, out prior)) return false;
                if (ReferenceEquals(entry, prior)) continue;
                if (entry.parent != prior.parent || entry.title != prior.title || entry.type != prior.type ||
                    entry.revision != prior.revision || entry.directFolders != prior.directFolders) return false;
                if (entry.covers != null && (prior.covers == null || !entry.covers.SequenceEqual(prior.covers))) return false;
            }
            return true;
        }
    }
}
