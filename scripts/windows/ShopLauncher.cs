using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ShopLauncher {
    [STAThread]
    private static int Main(string[] args) {
        bool quiet = false, noBrowser = false;
        string action = "Start";
        foreach (string arg in args) {
            switch (arg) {
                case "--stop": action = "Stop"; break;
                case "--restart": action = "Restart"; break;
                case "--status": action = "Status"; break;
                case "--quiet": quiet = true; break;
                case "--no-browser": noBrowser = true; break;
                default: MessageBox.Show("Unknown launcher option: " + arg, "VK AutoMobiles"); return 2;
            }
        }
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "Shop.ps1");
            if (!File.Exists(script)) throw new IOException("Shop.ps1 is missing. Extract the complete application package first.");
            var start = new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -Action " + action + (quiet ? " -Quiet" : "") + (noBrowser ? " -NoBrowser" : ""),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception error) {
            if (!quiet) MessageBox.Show(error.Message, "VK AutoMobiles could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
