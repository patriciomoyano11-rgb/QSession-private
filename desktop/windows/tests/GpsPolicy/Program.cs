using QSession.Host;
using Windows.Devices.Geolocation;
var now=DateTimeOffset.UtcNow;
int checks=0;
void Check(bool expected,PositionSource source,double accuracy,DateTimeOffset time) {
    bool actual=SatelliteLocation.IsUsable(source==PositionSource.Satellite,accuracy,time,now);
    if(actual!=expected) throw new Exception($"Incorrect GPS policy for {source}, {accuracy}, {time}");
    checks++;
}
Check(true,PositionSource.Satellite,20,now);
foreach(var source in new[]{PositionSource.WiFi,PositionSource.IPAddress,PositionSource.Default,PositionSource.Cellular,PositionSource.Unknown}) Check(false,source,5,now);
Check(false,PositionSource.Satellite,2000,now);
Check(false,PositionSource.Satellite,double.NaN,now);
Check(false,PositionSource.Satellite,20,now.AddMinutes(-3));
Check(false,PositionSource.Satellite,20,now.AddMinutes(1));
Console.WriteLine($"{checks} GPS policy checks passed. No physical sensor was queried.");
