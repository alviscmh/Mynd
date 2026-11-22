using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Mynd
{
    sealed partial class ComicWindow
    {
        private const int SetImmersiveDarkMode = 20;
        private const int SetBorderColor = 34;
        private const int SetCaptionColor = 35;
        private const int SetTextColor = 36;
        private const int ReconnectCommand = 0x110;
        private string captionTheme;

        internal void ApplyTheme(string name)
        {
            captionTheme = name;
            ApplyCaption();
        }

        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            ApplyCaption();
            if (ReaderOnly)
            {
                var menu = GetSystemMenu(Handle, false);
                if (menu != IntPtr.Zero)
                    InsertMenu(menu, 0, 0x400, new UIntPtr(ReconnectCommand), "Reconnect reader");
            }
        }

        private void ApplyCaption()
        {
            var surface = Color.FromArgb(21, 18, 29);
            var border = Color.FromArgb(59, 49, 74);
            var text = Color.FromArgb(243, 237, 249);
            var dark = 1;
            if (captionTheme == "graphite")
            {
                surface = Color.FromArgb(21, 23, 28);
                border = Color.FromArgb(58, 65, 79);
                text = Color.FromArgb(240, 244, 251);
            }
            else if (captionTheme == "paper")
            {
                surface = Color.FromArgb(247, 240, 231);
                border = Color.FromArgb(218, 206, 190);
                text = Color.FromArgb(42, 32, 36);
                dark = 0;
            }
            BackColor = surface;
            if (view != null) view.BackColor = surface;
            if (loading != null) loading.ForeColor = text;
            if (controller != null) controller.DefaultBackgroundColor = surface;
            if (!IsHandleCreated) return;
            var caption = ColorTranslator.ToWin32(surface);
            var outline = ColorTranslator.ToWin32(border);
            var foreground = ColorTranslator.ToWin32(text);
            DwmSetWindowAttribute(Handle, SetImmersiveDarkMode, ref dark, sizeof(int));
            DwmSetWindowAttribute(Handle, SetBorderColor, ref outline, sizeof(int));
            DwmSetWindowAttribute(Handle, SetCaptionColor, ref caption, sizeof(int));
            DwmSetWindowAttribute(Handle, SetTextColor, ref foreground, sizeof(int));
        }

        protected override bool ShowWithoutActivation { get { return ReaderOnly && Opacity == 0; } }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0112 && message.WParam.ToInt64() == ReconnectCommand)
            {
                application.RequestDetached(false);
                return;
            }
            base.WndProc(ref message);
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

        [DllImport("user32.dll")]
        private static extern IntPtr GetSystemMenu(IntPtr window, bool revert);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool InsertMenu(IntPtr menu, uint position, uint flags, UIntPtr id, string title);
    }
}
