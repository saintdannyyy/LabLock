// Lockdown Kiosk Browser — global low-level keyboard hook.
//
// This is a companion process (not part of the Electron app) that installs a
// WH_KEYBOARD_LL hook and swallows the escape combos a kiosk must suppress:
//
//   Alt+F4          close foreground window
//   Alt+Tab         task switching
//   Win key (L/R)   Start menu / Win combos
//   Ctrl+Shift+Esc  Task Manager
//
// Why a separate C# process instead of Electron's globalShortcut or an npm
// native module:
//   - Electron globalShortcut (RegisterHotKey under the hood) was tested and
//     CANNOT register any of these system-level combos (Alt+F4, Alt+Tab,
//     Ctrl+Shift+Esc all return false; the bare Win key is not a valid
//     accelerator at all).
//   - A maintained npm native addon would require node-gyp/MSVC to compile,
//     which is not guaranteed to exist on lab machines or this dev box.
//   - A WH_KEYBOARD_LL hook is the standard Windows mechanism for exactly
//     this job. Compiling this small program with the .NET Framework's
//     built-in csc.exe (present on every Windows 10/11) avoids any toolchain
//     requirement.
//
// What this hook CANNOT block (by design, documented honestly):
//   - Ctrl+Alt+Del is the Secure Attention Sequence; Windows never delivers
//     it to application-level hooks. No app can intercept it.
//
// Build:  scripts/build-inputhook.ps1
// Run:    spawned by the kiosk app's main process in kiosk mode, watched and
//         restarted if it dies (the hook is auto-removed by the OS when this
//         process exits, so a killed hook means a live hole — hence restart).

using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;

namespace LockdownInputHook
{
    internal static class Program
    {
        private const int WH_KEYBOARD_LL = 13;

        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const int LLKHF_ALTDOWN = 0x20;

        private const int VK_TAB = 0x09;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12;   // Alt
        private const int VK_SHIFT = 0x10;
        private const int VK_ESCAPE = 0x1B;
        private const int VK_LWIN = 0x5B;
        private const int VK_RWIN = 0x5C;
        private const int VK_F4 = 0x73;
        private const int VK_F12 = 0x7B;

        // Modifier state tracked from the events the hook itself sees. This is
        // deterministic: GetAsyncKeyState from inside the hook callback does
        // not reliably reflect keys injected via SendInput/keybd_event.
        private static bool _ctrlDown;
        private static bool _shiftDown;
        private static bool _altDown;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public int vkCode;
            public int scanCode;
            public int flags;
            public int time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private static IntPtr _hookId = IntPtr.Zero;
        private static readonly LowLevelKeyboardProc _proc = HookCallback;

        private static bool IsAltDown(int flags)
        {
            return _altDown || (flags & LLKHF_ALTDOWN) != 0 || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
        }

        private static void TrackModifier(int vk, int msg)
        {
            bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            if (vk == VK_CONTROL) _ctrlDown = down;
            else if (vk == VK_SHIFT) _shiftDown = down;
            else if (vk == VK_MENU) _altDown = down;
        }

        private static void DebugLog(string msg)
        {
            if (Environment.GetEnvironmentVariable("LOCKDOWN_HOOK_DEBUG") != "1") return;
            try
            {
                File.AppendAllText(
                    Path.Combine(Path.GetTempPath(), "lockdown-inputhook.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + Environment.NewLine);
            }
            catch
            {
                // Logging must never affect hook behavior.
            }
        }

        private static string VkName(int vk)
        {
            if (vk == VK_CONTROL) return "Ctrl";
            if (vk == VK_SHIFT) return "Shift";
            if (vk == VK_MENU) return "Alt";
            if (vk == VK_LWIN) return "LWIN";
            if (vk == VK_RWIN) return "RWIN";
            if (vk == VK_TAB) return "Tab";
            if (vk == VK_ESCAPE) return "Esc";
            if (vk == VK_F4) return "F4";
            return "vk=" + vk;
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                var data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                int vk = data.vkCode;
                int msg = (int)wParam;

                TrackModifier(vk, msg);
                DebugLog("event " + VkName(vk) + " msg=" + msg + " ctrl=" + _ctrlDown + " shift=" + _shiftDown + " alt=" + _altDown);

                bool swallow = false;

                if (vk == VK_F4 && IsAltDown(data.flags))
                {
                    swallow = true;       // Alt+F4
                }
                else if (vk == VK_TAB && IsAltDown(data.flags))
                {
                    swallow = true;       // Alt+Tab
                }
                else if (vk == VK_ESCAPE && (_ctrlDown || (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) && (_shiftDown || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0))
                {
                    swallow = true;       // Ctrl+Shift+Esc
                }
                else if (vk == VK_LWIN || vk == VK_RWIN)
                {
                    swallow = true;       // Win key, left or right
                }
                else if (vk == VK_F12 && (_ctrlDown || (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) &&
                         (_altDown || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0) &&
                         (_shiftDown || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0))
                {
                    swallow = true;       // Ctrl+Alt+Shift+F12 = admin escape hatch
                    SignalEscapeHatch();
                }

                if (swallow)
                {
                    DebugLog("swallowing vk=" + vk + " msg=" + msg + " flags=" + data.flags);
                    return new IntPtr(1); // non-zero return swallows the event
                }
            }
            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        private static void SignalEscapeHatch()
        {
            try
            {
                // Connect to the Electron app's named pipe server
                using (var client = new NamedPipeClientStream(".", "lockdown-escape", PipeDirection.Out))
                {
                    client.Connect(1000); // 1 second timeout
                    if (client.IsConnected)
                    {
                        byte[] msg = Encoding.UTF8.GetBytes("ESCAPE");
                        client.Write(msg, 0, msg.Length);
                        DebugLog("Sent ESCAPE signal via named pipe");
                    }
                }
            }
            catch (Exception ex)
            {
                DebugLog("SignalEscapeHatch failed: " + ex.Message);
            }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
            if (_hookId == IntPtr.Zero)
            {
                DebugLog("SetWindowsHookEx failed GetLastError=" + Marshal.GetLastWin32Error());
                return 1;
            }

            DebugLog("hook installed, entering message loop");

            // The hook callback is delivered via messages on this thread, so a
            // message loop is required. /target:winexe means no console window.
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookWindowsHookEx(_hookId);
            DebugLog("hook removed");
            return 0;
        }
    }
}
