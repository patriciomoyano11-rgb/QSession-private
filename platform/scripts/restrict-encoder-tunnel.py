"""Production peer: a shell-less system account permitting only local Redis forwarding."""
import os
import pathlib
import pwd
import subprocess

name = 'qsession-egress'
try:
    user = pwd.getpwnam(name)
except KeyError:
    subprocess.run(['useradd', '--system', '--create-home', '--home-dir', '/var/lib/qsession-egress', '--shell', '/usr/sbin/nologin', name], check=True)
    user = pwd.getpwnam(name)
directory = pathlib.Path(user.pw_dir) / '.ssh'
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, user.pw_uid, user.pw_gid)
key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOK/pstyul4rSZsKWaLgYlfYhsXgT3/eKkv0s+cKC4+V'
auth = directory / 'authorized_keys'
auth.write_text('from="45.77.192.82",restrict,port-forwarding,permitopen="127.0.0.1:6379",command="/bin/false" ' + key + ' qsession-encoder-redis-only\n')
os.chown(auth, user.pw_uid, user.pw_gid)
auth.chmod(0o600)
# Place Match at the end, preserving the existing global sshd configuration.
config = pathlib.Path('/etc/ssh/sshd_config')
original = config.read_text()
marker = '# QSession dedicated encoder tunnel'
if marker not in original:
    backup = config.with_name('sshd_config.before-qsession-encoder')
    if not backup.exists():
        backup.write_text(original)
        backup.chmod(0o600)
    config.write_text(original.rstrip() + '\n\n' + marker + '''
Match User qsession-egress
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:6379
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    ForceCommand /bin/false
''')
    try:
        subprocess.run(['sshd', '-t'], check=True)
    except Exception:
        config.write_text(original)
        raise
    subprocess.run(['systemctl', 'reload', 'ssh'], check=True)
# Remove only the superseded dedicated tunnel key from root's keys.
root_auth = pathlib.Path('/root/.ssh/authorized_keys')
root_auth.write_text(''.join(line for line in root_auth.read_text().splitlines(keepends=True) if key not in line))
root_auth.chmod(0o600)
print('Dedicated tunnel account ready: local forwarding only, Redis only, no shell.')
