namespace QSession.Host;

internal enum AudioSourceKind
{
    Output,
    Input,
    BrowserTab,
}

internal sealed record MediaDevice(int Index, string Name)
{
    public override string ToString() => Name;
}

internal sealed record AudioSourceOption(AudioSourceKind Kind, string Label)
{
    public override string ToString() => Label;
}

internal sealed record RoomTypeOption(
    string Value,
    string Label,
    string Description,
    bool AllowPublicChat,
    bool AllowGuestCameras,
    bool AllowSocialProfiles,
    bool AllowMatchmaking,
    bool AllowProfileGifts)
{
    public override string ToString() => Label;
}

internal sealed record RoomDraft(
    string Name,
    string DjName,
    string RoomType,
    string Visibility,
    string? Password,
    bool AllowPublicChat,
    bool AllowGuestCameras,
    bool AllowSocialProfiles,
    bool AllowMatchmaking,
    bool AllowProfileGifts,
    string TimeZone,
    int Capacity = 0,
    string[]? Sponsors = null);

internal sealed record RoomDto(
    string Code,
    string Name,
    string DjName,
    string RoomType,
    string Visibility,
    string Status,
    DateTimeOffset? StartedAt);

internal sealed record CreateRoomResponse(
    bool Ok,
    RoomDto Room,
    string HostToken,
    string JoinUrl,
    bool MediaConfigured);

internal sealed record MediaCredentialsResponse(bool Ok, string Url, string Token);

internal sealed record ActiveSession(
    string Code,
    string HostToken,
    string JoinUrl,
    string Name,
    string HostName,
    string RoomType,
    string Visibility,
    DateTimeOffset StartedAt,
    AudioSourceKind AudioSource,
    string AudioDeviceName,
    bool CameraEnabled,
    string? CameraName);
