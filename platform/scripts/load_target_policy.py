"""Staging-only targets for HLS load tools.

Load entry points call these helpers and refuse production by default.
There is no environment-variable override and no canary flag that selects
a production host, bucket, or SSH target.

The playback-host check lives in hls-load-client.py because that file is the
one uploaded to a generator. This module re-exports it so the operator-side
tools and the generator cannot drift.
"""

import importlib.util
import ipaddress
import pathlib
import re
import urllib.parse

def _load_client():
    path = pathlib.Path(__file__).resolve().with_name('hls-load-client.py')
    spec = importlib.util.spec_from_file_location('qsession_hls_load_client_for_policy', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

_client = _load_client()
require_staging_delivery_host = _client.require_staging_delivery_host
KNOWN_CANARY_HOSTS = _client.KNOWN_CANARY_HOSTS

PRODUCTION_DELIVERY_HOSTS = frozenset({
    'live.qsession.org',
    'www.qsession.org',
    'qsession.org',
    'media.qsession.org',
    'qsession-live.patriciomoyano11.workers.dev',
})
# Permanent production servers. Load SSH must not land here by default.
PROTECTED_SSH_HOSTS = frozenset({
    '104.238.137.144',
    '45.77.192.82',
    '45.77.118.43',
    '45.76.25.22',
})
PRODUCTION_BUCKETS = frozenset({'qsession-live', 'qsession-live-preview'})
PRODUCTION_R2_ENDPOINT = 'https://b3d60daa8319692b18a8bef39b34f14d.r2.cloudflarestorage.com'


def require_staging_ssh_host(host):
    """Accept only a canonical dotted IPv4 address.

    Leading zeros, hex, integer form and IPv6-mapped text are rejected so a
    production address cannot be disguised. Being canonical is not permission
    to connect: callers must also pass require_allowlisted_staging_ssh.
    """
    if type(host) is not str:
        raise ValueError('Staging SSH host must be a canonical IPv4 address')
    text = host.strip()
    if not re.fullmatch(r'(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}'
                        r'(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])', text):
        raise ValueError('Staging SSH host must be a canonical IPv4 address')
    if any(len(part) > 1 and part.startswith('0') for part in text.split('.')):
        raise ValueError('Staging SSH host rejects encoded addresses')
    ip = ipaddress.ip_address(text)
    if (str(ip) in PROTECTED_SSH_HOSTS or ip.is_loopback or ip.is_multicast
            or ip.is_unspecified or ip.is_link_local or ip.is_reserved):
        raise ValueError('Production and non-routable SSH targets are refused')
    if not (ip.is_global or ip.is_private):
        raise ValueError('Staging SSH host must be a private or public IPv4 address')
    return str(ip)


def parse_staging_ssh_allowlist(raw):
    """Positive allowlist. Empty means no SSH target is permitted."""
    if type(raw) is not str or not raw.strip():
        raise ValueError('A staging SSH allowlist is required')
    found = []
    for part in raw.split(','):
        item = part.strip()
        if item:
            found.append(require_staging_ssh_host(item))
    if not found:
        raise ValueError('A staging SSH allowlist is required')
    return tuple(dict.fromkeys(found))


def require_allowlisted_staging_ssh(host, allowlist):
    normalized = require_staging_ssh_host(host)
    if normalized not in allowlist:
        raise ValueError('SSH target is outside the staging allowlist')
    return normalized


def require_staging_storage(endpoint, bucket):
    """Refuse the production R2 account endpoint and the live buckets."""
    if type(endpoint) is not str or type(bucket) is not str:
        raise ValueError('Staging storage endpoint and bucket are required')
    endpoint = endpoint.strip().rstrip('/')
    bucket = bucket.strip()
    if bucket in PRODUCTION_BUCKETS or endpoint == PRODUCTION_R2_ENDPOINT:
        raise ValueError('Synthetic origin refuses the production R2 bucket and endpoint')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,62}', bucket) or 'staging' not in bucket:
        raise ValueError('Load origin bucket must be a staging bucket name')
    parsed = urllib.parse.urlsplit(endpoint)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
        raise ValueError('Staging storage endpoint must be an HTTPS origin without credentials')
    return endpoint, bucket
