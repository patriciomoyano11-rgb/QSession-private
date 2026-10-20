using Windows.Devices.Geolocation;

namespace QSession.Host;

internal static class SatelliteLocation
{
    internal static bool IsUsable(bool satellite, double accuracy, DateTimeOffset timestamp, DateTimeOffset now)
        => satellite && double.IsFinite(accuracy) && accuracy >= 0 && accuracy <= 1000
            && now - timestamp <= TimeSpan.FromMinutes(2) && timestamp - now <= TimeSpan.FromSeconds(10);

    internal static async Task<Geocoordinate> RequestAsync(CancellationToken cancellationToken)
    {
        if (await Geolocator.RequestAccessAsync() != GeolocationAccessStatus.Allowed)
            throw new InvalidOperationException("Autoriza la ubicación de Q Session en Configuración de Windows → Privacidad y seguridad → Ubicación.");
        var locator = new Geolocator { DesiredAccuracy = PositionAccuracy.High, DesiredAccuracyInMeters = 50, ReportInterval = 1000 };
        var fix = new TaskCompletionSource<Geocoordinate>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Changed(Geolocator sender, PositionChangedEventArgs args)
        {
            var coordinate = args.Position.Coordinate;
            if (IsUsable(coordinate.PositionSource == PositionSource.Satellite, coordinate.Accuracy, coordinate.Timestamp, DateTimeOffset.UtcNow)) fix.TrySetResult(coordinate);
        }
        locator.PositionChanged += Changed;
        try { return await fix.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken); }
        catch (TimeoutException) { throw new InvalidOperationException("No se recibió una posición GPS satelital. Comprueba el sensor GPS; la ubicación por Wi-Fi, IP o predeterminada no activa el localizador. También puedes verificar desde tu teléfono."); }
        finally { locator.PositionChanged -= Changed; }
    }
}
