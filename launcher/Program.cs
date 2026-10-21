using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace VttToolLauncher
{
    class Program
    {
        #region Windows API & Job Object for Process Tree Cleanup
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr hJob, JobObjectInfoType infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        public enum JobObjectInfoType
        {
            ExtendedLimitInformation = 9
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public Int64 PerProcessUserTimeLimit;
            public Int64 PerJobUserTimeLimit;
            public UInt32 LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public UInt32 ActiveProcessLimit;
            public UIntPtr Affinity;
            public UInt32 PriorityClass;
            public UInt32 SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct IO_COUNTERS
        {
            public UInt64 ReadOperationCount;
            public UInt64 WriteOperationCount;
            public UInt64 OtherOperationCount;
            public UInt64 ReadTransferCount;
            public UInt64 WriteTransferCount;
            public UInt64 OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryLimit;
            public UIntPtr PeakJobMemoryLimit;
        }

        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        static IntPtr hJob = IntPtr.Zero;

        static void SetupJobObject(Process proc)
        {
            try
            {
                hJob = CreateJobObject(IntPtr.Zero, null);
                var extendedLimits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                {
                    BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                    {
                        LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    }
                };

                int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr extendedLimitsPtr = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(extendedLimits, extendedLimitsPtr, false);
                    SetInformationJobObject(hJob, JobObjectInfoType.ExtendedLimitInformation, extendedLimitsPtr, (uint)length);
                    AssignProcessToJobObject(hJob, proc.Handle);
                }
                finally
                {
                    Marshal.FreeHGlobal(extendedLimitsPtr);
                }
            }
            catch
            {
                // Non-critical fallback if job object fails
            }
        }
        #endregion

        static Process serverProcess = null;

        static void Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = System.Text.Encoding.UTF8;
            }
            catch { }

            Console.Title = "VTT SlideSync Studio Server Launcher";

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("================================================================");
            Console.WriteLine("             VTT SlideSync Studio - Server Launcher             ");
            Console.WriteLine("================================================================");
            Console.ResetColor();

            // 1. Locate project root directory
            string projectDir = LocateProjectDirectory();
            if (string.IsNullOrEmpty(projectDir) || !File.Exists(Path.Combine(projectDir, "package.json")))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[!] Error: Could not find project directory with package.json.");
                Console.WriteLine("    Checked directory: " + (projectDir ?? "null"));
                Console.ResetColor();
                Console.WriteLine("\nPress any key to exit...");
                Console.ReadKey();
                return;
            }

            Console.WriteLine("[*] Project directory: " + projectDir);

            // 2. Check if server is already running on port 3000 (or standard ports 3000-3010)
            int activePort = FindAlreadyRunningPort(3000, 3010);
            if (activePort > 0)
            {
                string activeUrl = "http://localhost:" + activePort;
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("\n[✓] VTT SlideSync Studio is already running at: " + activeUrl);
                Console.WriteLine("[✓] Opening your default browser now...");
                Console.ResetColor();

                OpenBrowser(activeUrl);
                Thread.Sleep(2000);
                return;
            }

            // 3. Find first available port for the server
            int targetPort = FindAvailablePort(3000, 3020);
            if (targetPort < 0)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[!] Error: Could not find an available port between 3000 and 3020.");
                Console.ResetColor();
                Console.WriteLine("\nPress any key to exit...");
                Console.ReadKey();
                return;
            }

            string serverUrl = "http://localhost:" + targetPort;
            Console.WriteLine("[*] Selected local port: " + targetPort);
            Console.WriteLine("[*] Starting local server at " + serverUrl + " ...");

            // 4. Register cleanup handlers
            Console.CancelKeyPress += (s, e) =>
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("\n[*] Shutting down server...");
                KillServerProcess();
            };

            AppDomain.CurrentDomain.ProcessExit += (s, e) =>
            {
                KillServerProcess();
            };

            // 5. Start the Next.js development server
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm run dev -- -p " + targetPort,
                    WorkingDirectory = projectDir,
                    UseShellExecute = false,
                    CreateNoWindow = false
                };

                // Ensure PATH includes standard nodejs if missing
                string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                string nodeDir = @"C:\Program Files\nodejs";
                if (Directory.Exists(nodeDir) && !currentPath.Contains(nodeDir))
                {
                    psi.EnvironmentVariables["PATH"] = nodeDir + ";" + currentPath;
                }

                serverProcess = Process.Start(psi);
                if (serverProcess == null)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[!] Failed to launch server process.");
                    Console.ResetColor();
                    Console.ReadKey();
                    return;
                }

                SetupJobObject(serverProcess);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[!] Exception starting server: " + ex.Message);
                Console.ResetColor();
                Console.ReadKey();
                return;
            }

            // 6. Monitor server readiness on a background thread and open browser
            Thread monitorThread = new Thread(() =>
            {
                int maxRetries = 60; // 30 seconds
                for (int i = 0; i < maxRetries; i++)
                {
                    Thread.Sleep(500);

                    if (serverProcess == null || serverProcess.HasExited)
                    {
                        return;
                    }

                    if (IsServerResponding(targetPort))
                    {
                        Console.Title = "VTT SlideSync Studio [RUNNING] - " + serverUrl;
                        Console.ForegroundColor = ConsoleColor.Green;
                        Console.WriteLine("\n================================================================");
                        Console.WriteLine("          [✓] VTT SlideSync Studio is Active & Ready!           ");
                        Console.WriteLine("================================================================");
                        Console.WriteLine("  Local URL: " + serverUrl);
                        Console.WriteLine("  Browser opened automatically.");
                        Console.WriteLine();
                        Console.ForegroundColor = ConsoleColor.Cyan;
                        Console.WriteLine("  • Keep this window open while using the software.");
                        Console.WriteLine("  • To stop the server: close this window or press Ctrl+C.");
                        Console.WriteLine("================================================================\n");
                        Console.ResetColor();

                        OpenBrowser(serverUrl);
                        break;
                    }
                }
            });
            monitorThread.IsBackground = true;
            monitorThread.Start();

            // Wait for server process to complete
            serverProcess.WaitForExit();
        }

        static void KillServerProcess()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    // Kill process tree
                    Process killProc = Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill.exe",
                        Arguments = "/F /T /PID " + serverProcess.Id,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    });
                    if (killProc != null)
                    {
                        killProc.WaitForExit(2000);
                    }
                }
            }
            catch { }
        }

        static string LocateProjectDirectory()
        {
            // 1. Current base directory of executable
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(baseDir, "package.json")))
            {
                return Path.GetFullPath(baseDir);
            }

            // 2. Relative subfolder "august\vtttool" (e.g. if exe is on Desktop)
            string desktopSub = Path.Combine(baseDir, "august", "vtttool");
            if (File.Exists(Path.Combine(desktopSub, "package.json")))
            {
                return Path.GetFullPath(desktopSub);
            }

            // 3. Known absolute path
            string defaultAbsPath = @"c:\Users\zafee\Desktop\august\vtttool";
            if (File.Exists(Path.Combine(defaultAbsPath, "package.json")))
            {
                return defaultAbsPath;
            }

            // 4. Walk up parent directories
            DirectoryInfo current = new DirectoryInfo(baseDir);
            for (int i = 0; i < 4 && current != null; i++)
            {
                if (File.Exists(Path.Combine(current.FullName, "package.json")))
                {
                    return current.FullName;
                }
                current = current.Parent;
            }

            return null;
        }

        static int FindAlreadyRunningPort(int startPort, int endPort)
        {
            for (int port = startPort; port <= endPort; port++)
            {
                if (IsServerResponding(port))
                {
                    return port;
                }
            }
            return -1;
        }

        static bool IsServerResponding(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://localhost:" + port + "/");
                req.Timeout = 800;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 400);
                }
            }
            catch (WebException ex)
            {
                HttpWebResponse webResp = ex.Response as HttpWebResponse;
                if (webResp != null)
                {
                    return ((int)webResp.StatusCode >= 200 && (int)webResp.StatusCode < 500);
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        static int FindAvailablePort(int startPort, int endPort)
        {
            for (int port = startPort; port <= endPort; port++)
            {
                if (IsPortAvailable(port))
                {
                    return port;
                }
            }
            return -1;
        }

        static bool IsPortAvailable(int port)
        {
            TcpListener tcpListener = null;
            try
            {
                tcpListener = new TcpListener(IPAddress.Loopback, port);
                tcpListener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (tcpListener != null)
                {
                    try { tcpListener.Stop(); } catch { }
                }
            }
        }

        static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch
            {
                try
                {
                    Process.Start("cmd.exe", "/c start " + url);
                }
                catch { }
            }
        }
    }
}
