using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string installedExe = Path.Combine(localAppData, "PokedexChatbot", "app", "win-unpacked", "Pokedex Desktop.exe");
        string logDir = Path.Combine(localAppData, "PokedexChatbot", "logs");
        string logFile = Path.Combine(logDir, "run_gui.log");

        try
        {
            if (!Directory.Exists(logDir))
            {
                Directory.CreateDirectory(logDir);
            }

            WriteLog(logFile, "Iniciando run_gui.exe");

            if (!File.Exists(installedExe))
            {
                string message = "Executor GUI nao encontrado.\n\n" +
                                 "Esperado em:\n" + installedExe + "\n\n" +
                                 "Execute setup.exe primeiro para instalar/atualizar o app.";

                WriteLog(logFile, "Falha: " + message);
                MessageBox.Show(message, "Pokedex Desktop", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = installedExe;
            psi.UseShellExecute = true;

            Process.Start(psi);
            WriteLog(logFile, "Executor iniciado: " + installedExe);
            return 0;
        }
        catch (Exception ex)
        {
            WriteLog(logFile, "Erro: " + ex.Message);
            MessageBox.Show(
                "Falha ao iniciar o Pokedex Desktop.\n\n" + ex.Message + "\n\nConsulte o log em:\n" + logFile,
                "Pokedex Desktop",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
    }

    private static void WriteLog(string logFile, string message)
    {
        try
        {
            string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine;
            File.AppendAllText(logFile, line, Encoding.UTF8);
        }
        catch
        {
            // Logging cannot break launcher flow.
        }
    }
}
