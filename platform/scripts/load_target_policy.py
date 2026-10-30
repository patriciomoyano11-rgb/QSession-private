"""Staging-only targets for HLS load tools.

Load entry points call these helpers and refuse production by default.
There is no environment-variable override. A one-client canary can opt in
only through an explicit argument that the load CLIs do not expose.

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
})
PRODUCTION_BUCKETS = frozenset({'qsession-live', 'qsession-live-preview'})
PRODUCTION_R2_ENDPOINT = 'https://b3d60daa8319692b18a8bef39b34f14d.r2.cloudflarestorage.com'


def require_staging_ssh_host(host):
    """Refuse the permanent production servers and non-routable addresses."""
    if type(host) is not str or not host:
        raise ValueError('A staging SSH host is required')
    try:
        ip = ipaddress.ip_address(host)
    except ValueError as error:
        raise ValueError('Staging SSH host must be an IPv4 address') from error
    if (ip.version != 4 or str(ip) in PROTECTED_SSH_HOSTS or ip.is_loopback
            or ip.is_multicast or ip.is_unspecified or ip.is_link_local or ip.is_reserved):
        raise ValueError('Production and non-routable SSH targets are refused')
    if not (ip.is_global or ip.is_private):
        raise ValueError('Staging SSH host must be a private or public IPv4 address')
    return str(ip)


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
