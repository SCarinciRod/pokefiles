using System;
using System.Diagnostics;
using System.IO;
using System.Text;

public static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string setupScript = Path.Combine(baseDir, "tools", "setup.ps1");

            if (!File.Exists(setupScript))
            {
                Console.Error.WriteLine("[setup.exe] Script nao encontrado: " + setupScript);
                return 1;
            }

            StringBuilder forwardedArgs = new StringBuilder();
            for (int i = 0; i < args.Length; i++)
            {
                if (i > 0)
                {
                    forwardedArgs.Append(" ");
                }

                forwardedArgs.Append(QuoteArg(args[i]));
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + setupScript + "\" " + forwardedArgs.ToString();
            psi.UseShellExecute = false;
            psi.WorkingDirectory = baseDir;

            using (Process process = Process.Start(psi))
            {
                if (process == null)
                {
                    Console.Error.WriteLine("[setup.exe] Falha ao iniciar powershell.exe");
                    return 1;
                }

                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[setup.exe] " + ex.Message);
            return 1;
        }
    }

    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrEmpty(arg))
        {
            return "\"\"";
        }

        return "\"" + arg.Replace("\"", "\\\"") + "\"";
    }
}
