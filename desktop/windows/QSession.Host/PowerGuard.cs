using System.Runtime.InteropServices;

namespace QSession.Host;

internal sealed class PowerGuard : IDisposable
{
    [Flags]
    private enum ExecutionState : uint
    {
        Continuous = 0x80000000,
        SystemRequired = 0x00000001,
        AwayModeRequired = 0x00000040,
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern ExecutionState SetThreadExecutionState(ExecutionState state);

    private bool _active;

    internal void Acquire()
    {
        SetThreadExecutionState(ExecutionState.Continuous | ExecutionState.SystemRequired | ExecutionState.AwayModeRequired);
        _active = true;
    }

    public void Dispose()
    {
        if (!_active) return;
        SetThreadExecutionState(ExecutionState.Continuous);
        _active = false;
    }
}
