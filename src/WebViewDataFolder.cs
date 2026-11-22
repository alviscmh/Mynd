using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;

namespace Mynd
{
    sealed class WebViewDataFolder
    {
        internal readonly string Path;
        internal readonly bool UsingAlternate;
        private int recordedProcess;

        internal WebViewDataFolder(string profile)
        {
            var primary = System.IO.Path.Combine(profile, "WebView2");
            var alternate = System.IO.Path.Combine(profile, "WebView2-Reopen");
            // Mynd stores reader settings, the index and thumbnails outside these runtime folders.
            UsingAlternate = IsRunning(primary) && !IsRunning(alternate);
            Path = UsingAlternate ? alternate : primary;
        }

        private static bool IsRunning(string path)
        {
            try
            {
                var marker = File.ReadAllLines(path + ".process");
                int id;
                long started;
                if (marker.Length != 2 || !Int32.TryParse(marker[0], out id) ||
                    !Int64.TryParse(marker[1], out started) || id <= 0) return false;
                using (var process = Process.GetProcessById(id))
                    return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == started;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
            catch (Win32Exception) { return false; }
        }

        internal void RecordProcess(int id)
        {
            if (id <= 0 || id == recordedProcess) return;
            try
            {
                using (var process = Process.GetProcessById(id))
                {
                    File.WriteAllLines(Path + ".process", new[] {
                        id.ToString(CultureInfo.InvariantCulture),
                        process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture)
                    });
                }
                recordedProcess = id;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
        }
    }
}
