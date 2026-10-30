"""Refuse a Worker config that could publish onto production.

Reads wrangler.staging.toml and checks the name and bucket. It does not log in,
deploy, or call Cloudflare.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'platform/edge/wrangler.staging.toml'
PRODUCTION_NAMES = {'qsession-live', 'qsession-live-preview'}
PRODUCTION_HOSTS = ('live.qsession.org', 'www.qsession.org', 'qsession.org')


def fields(text):
    name = re.search(r'(?m)^name\s*=\s*"([^"]+)"', text)
    buckets = re.findall(r'(?m)^bucket_name\s*=\s*"([^"]+)"', text)
    previews = re.findall(r'(?m)^preview_bucket_name\s*=\s*"([^"]+)"', text)
    routes = re.findall(r'(?m)^pattern\s*=\s*"([^"]+)"', text)
    return {
        'name': name.group(1) if name else '',
        'buckets': buckets,
        'previews': previews,
        'routes': routes,
    }


def problems_in(text):
    parsed = fields(text)
    problems = []
    if 'staging' not in parsed['name'] or parsed['name'] in PRODUCTION_NAMES:
        problems.append('worker name must be a staging name')
    if not parsed['buckets'] or any(bucket in PRODUCTION_NAMES or 'staging' not in bucket for bucket in parsed['buckets']):
        problems.append('bucket must be a staging bucket')
    if any(bucket in PRODUCTION_NAMES or 'staging' not in bucket for bucket in parsed['previews']):
        problems.append('preview bucket must be a staging bucket')
    for host in PRODUCTION_HOSTS:
        for line in text.splitlines():
            stripped = line.strip()
            if host in stripped and not stripped.startswith('#'):
                problems.append(f'production host {host} is configured, not merely mentioned')
    for route in parsed['routes']:
        if 'qsession.org' in route:
            problems.append(f'route {route} points at the production zone')
    return problems


def main():
    problems = problems_in(CONFIG.read_text(encoding='utf-8'))
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        return 1
    print('staging worker config is isolated from production names')
    print('next, with a staging Cloudflare login only:')
    print('  cd platform/edge && npx wrangler deploy --config wrangler.staging.toml')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
