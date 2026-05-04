using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LlmWikiWebUiLauncher
{
    /// <summary>
    /// Launcher entry point. Shows a splash window while building and starting the
    /// Electron app, then closes automatically once the main window is visible.
    /// </summary>
    internal static class Program
    {
        private static readonly string DesktopRoot = ResolveDesktopRoot();

        private static readonly string AppRoot = Path.Combine(DesktopRoot, "desktop-webui");

        private static readonly string ElectronExe = Path.Combine(
            AppRoot, "node_modules", "electron", "dist", "electron.exe");

        private sealed class LauncherConfig
        {
            public string ProjectRoot { get; set; }
        }

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (!ValidatePaths())
                return;

            if (IsElectronWindowVisible())
                return;

            using (Form splash = BuildSplash())
            using (Timer timer = new Timer { Interval = 1000 })
            {
                int elapsed = 0;
                bool launched = false;

                timer.Tick += (_, __) =>
                {
                    elapsed++;

                    if (!launched && elapsed == 1)
                    {
                        launched = true;
                        LaunchInBackground(splash);
                    }

                    if (IsElectronWindowVisible() || elapsed >= 35)
                        splash.Close();
                };

                timer.Start();
                Application.Run(splash);
            }
        }

        private static bool ValidatePaths()
        {
            if (!File.Exists(ElectronExe))
            {
                MessageBox.Show(
                    "Electron binary not found.\nExpected:\n" + ElectronExe,
                    "LLM Wiki Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return false;
            }
            return true;
        }

        private static string ResolveDesktopRoot()
        {
            if (!string.IsNullOrWhiteSpace(BuildProjectRoot.Value))
                return BuildProjectRoot.Value;

            string configRoot = ReadConfiguredProjectRoot(AppDomain.CurrentDomain.BaseDirectory);
            if (!string.IsNullOrWhiteSpace(configRoot))
                return configRoot;

            string candidate = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
            return Directory.Exists(Path.Combine(candidate, "desktop-webui"))
                ? candidate
                : AppDomain.CurrentDomain.BaseDirectory;
        }

        private static string ReadConfiguredProjectRoot(string baseDirectory)
        {
            string configPath = Path.Combine(baseDirectory, "launcher-config.json");
            if (!File.Exists(configPath))
                return null;

            try
            {
                string json = File.ReadAllText(configPath);
                LauncherConfig config = new JavaScriptSerializer().Deserialize<LauncherConfig>(json);
                return Directory.Exists(config.ProjectRoot) ? config.ProjectRoot : null;
            }
            catch { return null; }
        }

        private static void LaunchInBackground(Form splash)
        {
            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                string error = BuildAndLaunch();
                if (error != null)
                {
                    splash.Invoke(new Action(() =>
                    {
                        MessageBox.Show(splash, error, "LLM Wiki Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        splash.Close();
                    }));
                }
            });
        }

        private static string BuildAndLaunch()
        {
            // Step 1: build the shared web client bundle used by the desktop server.
            string buildError;
            int webBuildExit = RunCmd("npm run web:build", DesktopRoot, out buildError);
            if (webBuildExit != 0)
                return "Web build failed (exit " + webBuildExit + "):\n" + buildError;

            // Step 2: run TypeScript build via cmd.exe — .cmd files require cmd.exe as host
            int buildExit = RunCmd("npm run build", AppRoot, out buildError);
            if (buildExit != 0)
                return "Build failed (exit " + buildExit + "):\n" + buildError;

            // Step 3: start electron directly — no npm wrapper
            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = ElectronExe,
                Arguments = "\"" + AppRoot + "\"",
                WorkingDirectory = AppRoot,
                UseShellExecute = false,
                CreateNoWindow = false,
            };

            try { Process.Start(info); }
            catch (Exception ex) { return "Failed to start Electron: " + ex.Message; }

            return null;
        }

        private static int RunCmd(string command, string workDir, out string stderr)
        {
            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c " + command,
                WorkingDirectory = workDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            };

            using (Process proc = Process.Start(info))
            {
                if (proc == null) { stderr = "Process failed to start."; return -1; }
                string errText = proc.StandardError.ReadToEnd();
                proc.WaitForExit();
                stderr = errText.Trim();
                return proc.ExitCode;
            }
        }

        private static bool IsElectronWindowVisible()
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("electron"))
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero && !string.IsNullOrWhiteSpace(p.MainWindowTitle))
                            return true;
                    }
                    catch { }
                }
            }
            catch { }
            return false;
        }

        private static Form BuildSplash()
        {
            Form form = new Form
            {
                Text = "LLM Wiki",
                ClientSize = new System.Drawing.Size(280, 84),
                FormBorderStyle = FormBorderStyle.FixedDialog,
                StartPosition = FormStartPosition.CenterScreen,
                ControlBox = false,
                TopMost = true,
                BackColor = System.Drawing.Color.White,
            };

            Label label = new Label
            {
                Text = "LLM Wiki 正在启动…",
                Dock = DockStyle.Fill,
                TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
                Font = new System.Drawing.Font("Microsoft YaHei UI", 13),
            };

            form.Controls.Add(label);
            return form;
        }
    }
}
