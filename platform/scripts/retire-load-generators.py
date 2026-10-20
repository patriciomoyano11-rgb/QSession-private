"""Independent, fail-closed retirement worker for a single approved load batch.

Default is a read-only preview. Install with the accompanying systemd timer
on a permanent host BEFORE provisioning. No provisioning endpoint is used.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

API = 'https://api.vultr.com/v2'
PERMANENT_IPS = {'104.238.137.144', '45.77.192.82', '45.77.118.43'}


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('UTC offset required')
    return parsed.timestamp()


def validate_scope(scope):
    required = {'schemaVersion', 'runId', 'tag', 'plan', 'region', 'notBefore',
                'retireAt', 'maximumInstances', 'budgetAuthorizationReference'}
    if set(scope) != required or scope['schemaVersion'] != 1:
        raise ValueError('Invalid retirement scope')
    if not re.fullmatch(r'qsession-load-\d{8}-[a-z0-9]{8,16}', scope['runId']):
        raise ValueError('Invalid disposable batch label')
    if not re.fullmatch(r'qs-retire-[a-f0-9]{32}', scope['tag']):
        raise ValueError('Unique unpredictable batch tag required')
    if scope['plan'] not in {'vhp-8c-16gb-amd','voc-c-8c-16gb-150s-amd'} or scope['region'] != 'ord':
        raise ValueError('Unreviewed plan or region')
    if type(scope['maximumInstances']) is not int or not 1 <= scope['maximumInstances'] <= 8:
        raise ValueError('Invalid batch size')
    if not isinstance(scope['budgetAuthorizationReference'], str) or not re.fullmatch(
            r'call_[a-zA-Z0-9_]{8,160}', scope['budgetAuthorizationReference']):
        raise ValueError('Recorded new budget authorization required')
    if scope['budgetAuthorizationReference'] in {
            'call_7a6df35e769a41afaaca8f49a07ded5c',
            'call_20594bf6150345798708fead2c0ce86a'}:
        raise ValueError('Previous exhausted authorization cannot be reused')
    start, end = instant(scope['notBefore']), instant(scope['retireAt'])
    if not 300 <= end - start <= 2700:
        raise ValueError('Retirement must be within 45 minutes of batch start')
    return scope


def matches(instance, scope):
    # Discovery uses an unpredictable per-run tag, not a broad name prefix.
    # Recheck all attributes immediately before each deletion.
    if scope['tag'] not in instance.get('tags', []):
        return False
    identifier = instance.get('id', '')
    if str(uuid.UUID(identifier)) != identifier:
        raise ValueError('Invalid instance identifier')
    address = instance.get('main_ip', '')
    if address in PERMANENT_IPS:
        raise ValueError('Permanent server explicitly protected')
    # Early provisioning can return no address; an ID/tag/label match remains
    # deletable so a broken provisioning process cannot leave a billable orphan.
    if address and address != '0.0.0.0' and not ipaddress.ip_address(address).is_global:
        raise ValueError('Unexpected instance address')
    label = re.escape(scope['runId']) + r'-chi[1-8]'
    if not re.fullmatch(label, instance.get('label', '')):
        raise ValueError('Tagged instance label mismatch')
    if instance.get('plan') != scope['plan'] or instance.get('region') != scope['region']:
        raise ValueError('Tagged instance plan or region mismatch')
    created = instant(instance['date_created'])
    if not instant(scope['notBefore']) <= created < instant(scope['retireAt']):
        raise ValueError('Tagged instance creation outside approved window')
    return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Vultr:
    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, endpoint):
        # Never accept a next-link URL from an API response.
        if not re.fullmatch(r'/instances(?:/[a-f0-9-]{36}|\?per_page=100&cursor=[A-Za-z0-9_=-]*)?', endpoint):
            raise ValueError('Unscoped provider endpoint')
        request = urllib.request.Request(API + endpoint, method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json'})
        try:
            with self.opener.open(request, timeout=12) as response:
                if response.status == 204:
                    return None
                payload = response.read(2_000_001)
                if len(payload) > 2_000_000:
                    raise ValueError('Provider response too large')
                return json.loads(payload)
        except urllib.error.HTTPError as error:
            if error.code == 404 and re.fullmatch(r'/instances/[a-f0-9-]{36}', endpoint):
                return None
            raise RuntimeError('Provider request failed with status ' + str(error.code)) from None

    def instances(self):
        instances, cursor, seen = [], '', set()
        for _ in range(20):
            page = self.request('GET', '/instances?per_page=100&cursor=' + cursor)
            instances.extend(page['instances'])
            cursor = page.get('meta', {}).get('links', {}).get('next', '') or ''
            if not cursor:
                return instances
            if cursor in seen:
                raise ValueError('Repeated provider cursor')
            seen.add(cursor)
        raise ValueError('Provider inventory pagination limit exceeded')


def assess(api, scope, now, apply=False):
    validate_scope(scope)
    report = {'runId': scope['runId'], 'due': now >= instant(scope['retireAt']),
              'apply': apply, 'deleted': [], 'pending': [], 'errors': []}
    candidates = []
    for instance in api.instances():
        try:
            if matches(instance, scope):
                candidates.append(instance)
        except (ValueError, KeyError, TypeError):
            # Continue cleaning the other valid targets; never delete a mismatch.
            report['errors'].append('tagged_target_scope_mismatch')
    if len(candidates) > scope['maximumInstances']:
        report['errors'].append('batch_size_exceeded')
        return report
    for instance in candidates:
        identifier = instance['id']
        report['pending'].append(identifier)
        if not apply or not report['due']:
            continue
        try:
            current = api.request('GET', '/instances/' + identifier)
            if current is not None:
                fresh = current['instance']
                if fresh.get('id') != identifier or not matches(fresh, scope):
                    raise ValueError('Target changed since inventory')
                api.request('DELETE', '/instances/' + identifier)
                # A successful DELETE alone is not evidence of retirement.
                if api.request('GET', '/instances/' + identifier) is not None:
                    report['errors'].append('provider_deletion_not_confirmed')
                    continue
            report['deleted'].append(identifier)
            report['pending'].remove(identifier)
        except (RuntimeError, ValueError, KeyError, TypeError, OSError):
            report['errors'].append('target_retirement_failed')
    return report


def private_text(file):
    metadata = file.lstat()
    if (sys.platform != 'linux' or not stat.S_ISREG(metadata.st_mode) or
            metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 8192):
        raise ValueError('Require Linux root-owned regular file with mode 0600')
    return file.read_text(encoding='utf8').strip()


def preflight(api, scope, now):
    report = assess(api, scope, now, apply=False)
    for mode in ('is-active', 'is-enabled'):
        status = subprocess.run(['systemctl', mode, '--quiet', 'qsession-load-retirement.timer'],
                                capture_output=True, timeout=10)
        if status.returncode:
            raise ValueError('Independent retirement timer not enabled and active')
    if report['errors'] or report['due'] or instant(scope['retireAt']) - now < 900:
        raise ValueError('Retirement preflight unavailable or less than 15 minutes remaining')
    report.update(independentTimerActive=True, checkedAtUnix=now,
        retireAt=scope['retireAt'], maximumInstances=scope['maximumInstances'],
        budgetAuthorizationReference=scope['budgetAuthorizationReference'],
        scopeFingerprint=hashlib.sha256(json.dumps(scope, sort_keys=True).encode('utf8')).hexdigest())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', type=pathlib.Path, required=True)
    parser.add_argument('--key-file', type=pathlib.Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    try:
        scope = validate_scope(json.loads(private_text(args.scope)))
        token = private_text(args.key_file)
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,256}', token):
            raise ValueError('Invalid API credential format')
        if args.preflight and args.apply:
            raise ValueError('Preflight is read-only')
        now = dt.datetime.now(dt.timezone.utc).timestamp()
        report = (preflight(Vultr(token), scope, now) if args.preflight else
                  assess(Vultr(token), scope, now, args.apply))
        print(json.dumps(report), flush=True)
        return 2 if report['errors'] or (report['due'] and report['pending']) else 0
    except Exception as error:
        # No provider payload, exception message or credential reaches the journal.
        print(json.dumps({'retirementCheckFailed': True, 'errorClass': type(error).__name__}), flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
