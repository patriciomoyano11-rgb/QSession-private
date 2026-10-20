#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este preparador con sudo o como root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "No fue posible identificar el sistema operativo." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Q Session requiere un VPS nuevo con Ubuntu 24.04 LTS." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl ufw unattended-upgrades

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Abrir SSH antes de activar UFW evita perder el acceso durante la preparacion.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7881/tcp
ufw allow 3478/udp
ufw allow 50000:60000/udp
ufw --force enable

# Márgenes para miles de conexiones WebSocket/WebRTC. Los valores son
# conservadores para un nodo de producción y sustituyen los límites mínimos del
# kernel que trae un VPS recién instalado.
cat > /etc/sysctl.d/99-qsession-scale.conf <<'EOF'
fs.file-max = 1048576
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 16384
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_max_syn_backlog = 16384
net.ipv4.ip_local_port_range = 10240 65535
EOF
sysctl --system >/dev/null

install -d -m 0750 /opt/qsession

echo "VPS preparado exclusivamente para Q Session."
docker --version
docker compose version
ufw status verbose
