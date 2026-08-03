// Lockdown Kiosk Browser — Watchdog companion process.
//
// Monitors the Electron app and InputHook processes. If either dies
// unexpectedly, restarts the Electron app (which will respawn InputHook).
//
// Why a separate C# process instead of Node.js/Electron self-watch:
//   - If the main Electron process crashes or is killed, a self-watch
//     inside Electron dies with it. An external watchdog survives.
//   - Compiles with OS-bundled csc.exe (no MSVC/node-gyp needed).
//   - Simple, reliable, single-purpose.
//
// Usage (invoked by the Electron main process in KIOSK mode):
//   Watchdog.exe --electron-pid <pid> --hook-pid <pid> --app-exe <path>
//
// The Electron app passes its own PID and the InputHook PID to the watchdog
// on startup. The watchdog polls both; if either disappears, it relaunches
// the app exe. The new app instance will spawn a new InputHook and a new
// watchdog (passing the new PIDs), creating a self-healing loop.
//
// Clean shutdown: when the admin escape hatch closes the app, the main
// process kills InputHook and exits with code 0. The watchdog sees the
// clean exit (exit code 0) and does NOT restart.

using System;
using System.Diagnostics;
using System.Threading;

namespace LockdownWatchdog
{
    internal static class Program
    {
        private static int _electronPid;
        private static int _hookPid;
        private static string _appExe;
        private static bool _cleanShutdown;

        private static int Main(string[] args)
        {
            // Parse args
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--electron-pid":
                        if (i + 1 < args.Length)
                        {
                            int ep;
                            if (int.TryParse(args[i + 1], out ep)) _electronPid = ep;
                        }
                        i++;
                        break;
                    case "--hook-pid":
                        if (i + 1 < args.Length)
                        {
                            int hp;
                            if (int.TryParse(args[i + 1], out hp)) _hookPid = hp;
                        }
                        i++;
                        break;
                    case "--app-exe":
                        if (i + 1 < args.Length) _appExe = args[i + 1];
                        i++;
                        break;
                }
            }

            if (_electronPid <= 0 || _hookPid <= 0 || string.IsNullOrEmpty(_appExe))
            {
                Console.Error.WriteLine("Usage: Watchdog.exe --electron-pid <pid> --hook-pid <pid> --app-exe <path>");
                return 1;
            }

            Console.WriteLine("Watchdog started: monitoring Electron PID " + _electronPid + ", Hook PID " + _hookPid);

            // Wait for either process to exit
            var electronProc = Process.GetProcessById(_electronPid);
            var hookProc = Process.GetProcessById(_hookPid);

            // Poll loop
            while (true)
            {
                try
                {
                    electronProc.Refresh();
                    hookProc.Refresh();
                }
                catch (ArgumentException)
                {
                    // Process already gone
                    break;
                }

                bool electronGone = electronProc.HasExited;
                bool hookGone = hookProc.HasExited;

                if (electronGone || hookGone)
                {
                    int exitCode = electronGone ? electronProc.ExitCode : hookProc.ExitCode;
                    Console.WriteLine("Process exited: Electron=" + electronGone + " (code " + exitCode + "), Hook=" + hookGone + " (code " + hookProc.ExitCode + ")");

                    // If Electron exited cleanly (code 0), don't restart
                    if (electronGone && exitCode == 0)
                    {
                        Console.WriteLine("Clean shutdown detected. Watchdog exiting.");
                        return 0;
                    }

                    // Unexpected exit — restart the app
                    Console.WriteLine("Unexpected exit detected. Restarting app...");
                    RestartApp();
                    return 0; // This watchdog instance exits; new app spawns new watchdog
                }

                Thread.Sleep(1000); // Poll every second
            }

            // If we reach here, both processes are gone unexpectedly
            Console.WriteLine("Both processes gone unexpectedly. Restarting app...");
            RestartApp();
            return 0;
        }

        private static void RestartApp()
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = _appExe,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                Process.Start(startInfo);
                Console.WriteLine("Restarted app: " + _appExe);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Failed to restart app: " + ex.Message);
            }
        }
    }
}