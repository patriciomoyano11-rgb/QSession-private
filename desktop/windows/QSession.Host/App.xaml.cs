using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace QSession.Host;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

#if QSESSION_SELF_INSTALLER
        try
        {
            if (WindowsSelfInstaller.InstallAndLaunchIfRequired())
            {
                Shutdown();
                return;
            }
        }
        catch (Exception error)
        {
            ReportStartupFailure(new InvalidOperationException(
                "No pudimos instalar Q Session. Intenta abrir nuevamente el instalador.",
                error));
            Shutdown(-1);
            return;
        }
#endif

        try
        {
            ChromeAppLauncher.Open();
            Shutdown();
        }
        catch (Exception error)
        {
            ReportStartupFailure(error);
            Shutdown(-1);
        }
    }

    private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        ReportStartupFailure(e.Exception);
        e.Handled = true;
        Shutdown(-1);
    }

    private static void ReportStartupFailure(Exception error)
    {
        try
        {
            string diagnosticsDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QSession");
            Directory.CreateDirectory(diagnosticsDirectory);
            File.WriteAllText(
                Path.Combine(diagnosticsDirectory, "startup-error.log"),
                $"{DateTimeOffset.Now:O}{Environment.NewLine}{error}");
        }
        catch
        {
            // The message below remains the fallback if the diagnostics file cannot be written.
        }

        MessageBox.Show(
            $"Q Session no pudo abrir su ventana.{Environment.NewLine}{Environment.NewLine}{error.Message}",
            "Q Session",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
    }
}
