from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DesktopFoundationTests(unittest.TestCase):
    def read(self, relative: str) -> str:
        path = ROOT / relative
        self.assertTrue(path.is_file(), f"Falta {relative}")
        return path.read_text(encoding="utf-8")

    def test_windows_is_a_separate_qsession_product(self):
        project = self.read("windows/QSession.Host/QSession.Host.csproj")
        self.assertIn("<Product>Q Session Desktop</Product>", project)
        self.assertIn("<AssemblyName>QSession.Host</AssemblyName>", project)

    def test_windows_launcher_reuses_the_complete_qsession_web_product_in_chrome(self):
        app = self.read("windows/QSession.Host/App.xaml.cs")
        launcher = self.read("windows/QSession.Host/ChromeAppLauncher.cs")

        self.assertIn("ChromeAppLauncher.Open();", app)
        self.assertNotIn("new WebShellWindow", app)
        identity = self.read("windows/QSession.Host/TaskbarIdentity.cs")
        self.assertIn('https://qsession.org/?desktop=windows&app=0.4.15', launcher)
        self.assertIn('startInfo.ArgumentList.Add($"--app={ProductUrl}")', launcher)
        self.assertIn('"Google", "Chrome", "Application", "chrome.exe"', launcher)
        self.assertIn("TaskbarIdentity.SynchronizeChromeTaskbarIdentity", launcher)
        self.assertIn("SHGetPropertyStoreForWindow", identity)
        self.assertIn('StartsWith("Chrome.qsession.org_"', identity)
        self.assertIn("AppUserModelIdKey", identity)
        self.assertIn("SetShortcutAppUserModelId", identity)
        self.assertIn("IPersistFile", identity)
        self.assertIn('"User Pinned"', identity)
        self.assertIn('"Q Session.lnk"', identity)

    def test_windows_distribution_is_a_single_self_installing_executable(self):
        app = self.read("windows/QSession.Host/App.xaml.cs")
        installer = self.read("windows/QSession.Host/WindowsSelfInstaller.cs")
        project = self.read("windows/QSession.Host/QSession.Host.csproj")
        build = self.read("windows/build.ps1")
        icon_builder = self.read("windows/create-icon.ps1")

        self.assertIn("QSESSION_SELF_INSTALLER", app)
        self.assertIn("WindowsSelfInstaller.InstallAndLaunchIfRequired()", app)
        self.assertIn('<PublishSingleFile>true</PublishSingleFile>', project)
        self.assertIn('<EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>', project)
        self.assertIn('"Programs"', installer)
        self.assertIn('"Q Session.lnk"', installer)
        self.assertIn('LegacyExecutableName = "QSession.Host.exe"', installer)
        self.assertIn('InstalledIconName = "qsession-taskbar-v8.ico"', installer)
        self.assertIn("platform\\public\\brand\\qsession-icon-master.png", icon_builder)
        self.assertNotIn("qsession-windows-icon-master.png", icon_builder)
        self.assertIn('"User Pinned"', installer)
        self.assertIn("File.Exists(pinnedTaskbarShortcut)", installer)
        self.assertIn("Application.GetResourceStream", installer)
        self.assertIn('RemoveLegacyInstallFiles(installDirectory, installedExecutable)', installer)
        self.assertIn('RemoveLegacyChromeShortcuts()', installer)
        self.assertIn('"Chrome Apps"', installer)
        self.assertIn('"chrome_proxy.exe"', installer)
        self.assertIn("Process.Start(new ProcessStartInfo", installer)
        self.assertIn("Instalar-QSession-Windows.exe", build)
        self.assertIn("QSessionSelfInstaller=true", build)

    def test_windows_has_native_capture_and_recovery(self):
        native = self.read("windows/QSession.Host/NativeMedia.cs")
        project = self.read("windows/QSession.Host/QSession.Host.csproj")
        store = self.read("windows/QSession.Host/SecureSessionStore.cs")
        power = self.read("windows/QSession.Host/PowerGuard.cs")
        window = self.read("windows/QSession.Host/MainWindow.xaml.cs")
        for export in (
            "qsession_wasapi_start_capture",
            "qsession_wasapi_start_input_capture",
            "qsession_stream_start_mode",
            "qsession_stream_enable_video",
        ):
            self.assertIn(export, native)
        self.assertIn('LibraryName = "QSession.Audio.dll"', native)
        self.assertIn("native-media\\build\\ninja\\QSession.Audio.dll", project)
        self.assertIn("ProtectedData.Protect", store)
        self.assertIn("SetThreadExecutionState", power)
        self.assertIn("int[] delays = [0, 2, 5, 10, 20, 30]", window)

    def test_chrome_app_captures_and_publishes_the_same_track_directly(self):
        launcher = self.read("windows/QSession.Host/ChromeAppLauncher.cs")
        browser_app = self.read("../platform/public/app.js")
        browser_styles = self.read("../platform/public/styles.css")
        project = self.read("windows/QSession.Host/QSession.Host.csproj")

        self.assertIn('--app={ProductUrl}', launcher)
        self.assertIn('navigator.mediaDevices.getDisplayMedia', browser_app)
        self.assertIn('publishTrack(audioTrack', browser_app)
        self.assertIn("source: LiveKit.Track.Source.ScreenShareAudio", browser_app)
        self.assertIn("forceStereo: true", browser_app)
        self.assertIn("dtx: false", browser_app)
        self.assertIn("red: false", browser_app)
        self.assertIn("function mediaActionPresentation", browser_app)
        self.assertIn("{icon: 'pause', state: 'active'}", browser_app)
        self.assertIn("{icon: 'play', state: 'paused'}", browser_app)
        self.assertIn('.media-icon-action[data-control-state="active"]', browser_styles)
        self.assertIn('.media-icon-action:disabled::after', browser_styles)
        self.assertIn("<Version>0.4.15</Version>", project)

    def test_both_platforms_use_the_same_room_contract(self):
        windows = self.read("windows/QSession.Host/QSessionApiClient.cs")
        mac = self.read("macos/QSessionHost/Sources/QSessionHost/QSessionAPI.swift")
        contract = self.read("shared/qsession-room-api.md")
        for endpoint in ("/api/rooms", "/media-token", "/broadcast/start", "/end"):
            self.assertIn(endpoint, windows)
            self.assertIn(endpoint, mac)
            self.assertIn(endpoint, contract)

    def test_macos_uses_native_livekit_and_keychain(self):
        package = self.read("macos/QSessionHost/Package.swift")
        publisher = self.read("macos/QSessionHost/Sources/QSessionHost/LiveKitPublisher.swift")
        keychain = self.read("macos/QSessionHost/Sources/QSessionHost/SecureSessionStore.swift")
        self.assertIn("client-sdk-swift", package)
        self.assertIn("room.localParticipant.setMicrophone", publisher)
        self.assertIn("SecItemAdd", keychain)


if __name__ == "__main__":
    unittest.main()
