"""Publish a bounded synthetic CBR HLS signal to the isolated PRB10A prefix.

Run only on the dedicated encoder after confirming PRB10A has no Egress writer.
Never reads camera, microphone, library media or JNTUBY. Requires FFmpeg + boto3.
Storage credentials stay on the encoder at the fixed root-only path below.
"""
import argparse
import datetime
import json
import math
import os
import pathlib
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from load_target_policy import (
    KNOWN_CANARY_HOSTS, PRODUCTION_R2_ENDPOINT,
    require_staging_delivery_host, require_staging_storage)

CREDENTIALS = '/opt/qsession-encoder/private/probe-storage.json'
# Historical production destination. Load publication refuses these unless
# --known-canary is set for the one-client PRB10A pilot.
ENDPOINT = PRODUCTION_R2_ENDPOINT
BUCKET = 'qsession-live'
PREFIX = 'live/PRB10A-hWrdBkirH_2yHmZ9lp/'
SEGMENT_SECONDS = 6


class PublishDeadline(Exception):
    """The media upload window is over, including any blocked storage operation."""


def read_credentials():
    descriptor = os.open(CREDENTIALS, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != 0 or info.st_size > 16384:
            raise ValueError('Storage configuration must be a bounded root-owned private file')
        config = json.load(source)
    if not config.get('accessKey') or not config.get('secretKey'):
        raise ValueError('Missing technical storage credentials')
    return config


def ffmpeg_command(directory):
    # One bounded render keeps CPU impact small while the real DJ remains on air.
    # Repeated media uses explicit HLS discontinuities to reset MPEG-TS timestamps.
    return ['nice', '-n', '10', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
            '-t', '6', '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '1',
            '-pix_fmt', 'yuv420p', '-r', '30', '-b:v', '1600k', '-minrate', '1600k',
            '-maxrate', '1600k', '-bufsize', '3200k', '-g', '180', '-keyint_min', '180',
            '-sc_threshold', '0', '-x264-params', 'nal-hrd=cbr:force-cfr=1',
            '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-af', 'volume=0.15',
            '-mpegts_flags', '+resend_headers', '-f', 'mpegts', str(directory / 'render.ts')]


def make_manifest(segments, ended=False):
    if not 1 <= len(segments) <= 5:
        raise ValueError('Technical window must contain one to five segments')
    lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6',
             '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MEDIA-SEQUENCE:' + str(segments[0]['sequence']),
             '#EXT-X-DISCONTINUITY-SEQUENCE:' + str(segments[0]['sequence'])]
    for segment in segments:
        lines.extend(['#EXT-X-DISCONTINUITY', '#EXT-X-PROGRAM-DATE-TIME:' + segment['programDateTime'],
                      '#EXTINF:6.000000,', segment['filename']])
    if ended:
        lines.append('#EXT-X-ENDLIST')
    return '\n'.join(lines) + '\n'


def inspect_segment(path):
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                            'stream=codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration',
                            '-of', 'json', str(path)], capture_output=True, timeout=15, check=True)
    result = json.loads(probe.stdout)
    video = next((stream for stream in result['streams'] if stream.get('codec_name') == 'h264'), None)
    audio = next((stream for stream in result['streams'] if stream.get('codec_name') == 'aac'), None)
    if (not video or video.get('width') != 1280 or video.get('height') != 720
            or video.get('r_frame_rate') != '30/1' or not audio
            or audio.get('sample_rate') != '48000' or audio.get('channels') != 2):
        raise ValueError('Synthetic segment does not match the approved profile')
    duration = float(result['format']['duration'])
    size = path.stat().st_size
    if (not math.isfinite(duration) or not 5.9 <= duration <= 6.2 or not 1100000 <= size <= 1600000
            or size*8/duration < 1600000):
        raise ValueError('Synthetic CBR segment has unexpected duration or size')
    return {'video': video, 'audio': audio, 'durationSeconds': duration, 'bytes': size,
            'totalMbps': round(size*8/duration/1000000, 3)}


def read_control_stop(source, run_id, stop):
    """Only an explicit command for this exact run may stop its publisher."""
    for line in source:
        if len(line)>1024:continue
        try:command=json.loads(line)
        except ValueError:continue
        if (not isinstance(command,dict) or set(command)!={'command','runId','reason'}
                or command['command']!='stop' or command['runId']!=run_id
                or command['reason'] not in ('load-completed','load-failed','preparation-failed')):
            continue
        stop(command['reason']);return


def destination(args, storage):
    """Staging by default. --known-canary keeps the historical one-client pilot."""
    if getattr(args, 'known_canary', False) is True:
        if args.delivery_host not in KNOWN_CANARY_HOSTS:
            raise ValueError('Known canary playback is limited to the historical PRB10A hostnames')
        if storage.get('endpoint') != ENDPOINT or storage.get('bucket') != BUCKET:
            raise ValueError('Known canary storage destination does not match the historical bucket')
        return args.delivery_host, ENDPOINT, BUCKET
    host = require_staging_delivery_host(args.delivery_host)
    endpoint, bucket = require_staging_storage(storage.get('endpoint'), storage.get('bucket'))
    return host, endpoint, bucket


def main(args):
    # Reject a production playback host before opening storage credentials.
    if getattr(args, 'known_canary', False) is not True:
        require_staging_delivery_host(args.delivery_host)
    elif args.delivery_host not in KNOWN_CANARY_HOSTS:
        raise ValueError('Known canary playback is limited to the historical PRB10A hostnames')
    storage = read_credentials()
    delivery_host, endpoint, bucket = destination(args, storage)
    from botocore.config import Config
    from botocore.exceptions import ClientError
    import boto3
    public_url = 'https://' + delivery_host + '/' + PREFIX + 'index.m3u8'
    client = boto3.client('s3', endpoint_url=endpoint, region_name=storage.get('region', 'auto'),
                          aws_access_key_id=storage['accessKey'], aws_secret_access_key=storage['secretKey'],
                          config=Config(connect_timeout=5, read_timeout=10,
                                        retries={'mode': 'standard', 'total_max_attempts': 2},
                                        s3={'addressing_style': 'path'},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    del storage
    run_id = secrets.token_hex(8)
    owned_keys, window = [], []
    lock_key, manifest_key = PREFIX + 'load-origin.lock', PREFIX + 'index.m3u8'
    report = {'schemaVersion': 1, 'synthetic': True, 'certifiesProductionCapacity': False,
              'runId': run_id, 'publicUrl': public_url, 'profile': {'videoKbps': 1600,
              'audioKbps': 128, 'width': 1280, 'height': 720, 'fps': 30, 'segmentSeconds': 6},
              'maximumMediaPublishSeconds': args.duration, 'uploadedSegments': 0,
              'repeatedSixSecondClip': True, 'discontinuityPerSegment': True,
              'cleanupComplete': False, 'startedAtUnix': time.time()}
    lock_owned = False
    publishing_started = None
    cancelled = False
    control_reason = None

    def handle_signal(_number, _frame):
        nonlocal cancelled, control_reason
        cancelled = True
        control_reason = None

    def handle_control(reason):
        nonlocal cancelled, control_reason
        control_reason = reason
        cancelled = True

    def handle_publish_deadline(_number, _frame):
        raise PublishDeadline()

    def sleep_until(deadline):
        while not cancelled and time.monotonic() < deadline:
            time.sleep(min(.2, max(0, deadline-time.monotonic())))

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    try:
        # Conditional creation prevents two origin scripts from publishing over one another.
        # This does not lock LiveKit Egress: the operator must separately verify PRB10A is idle.
        client.put_object(Bucket=bucket, Key=lock_key,
                          Body=json.dumps({'runId': run_id, 'expiresAtUnix': time.time()+args.duration+300}).encode(),
                          ContentType='application/json', IfNoneMatch='*')
        lock_owned = True
        with tempfile.TemporaryDirectory(prefix='qsession-synthetic-hls-') as temporary:
            directory = pathlib.Path(temporary)
            render_started = time.monotonic()
            subprocess.run(ffmpeg_command(directory), capture_output=True, timeout=30, check=True)
            report['renderSeconds'] = round(time.monotonic()-render_started, 3)
            source = directory / 'render.ts'
            report['segment'] = inspect_segment(source)
            payload = source.read_bytes()
            publishing_started, wall_started = time.monotonic(), time.time()
            report['publishingStartedAtUnix'] = wall_started
            signal.signal(signal.SIGALRM, handle_publish_deadline)
            signal.setitimer(signal.ITIMER_REAL, args.duration)
            for index in range(args.duration // SEGMENT_SECONDS + 2):
                sleep_until(publishing_started + max(0, index-2)*SEGMENT_SECONDS)
                if cancelled:
                    break
                filename = 'segment_load_' + run_id + '_' + str(index).zfill(5) + '.ts'
                key = PREFIX + filename
                # Include attempted writes in cleanup even when a network timeout hides the outcome.
                owned_keys.append(key)
                client.put_object(Bucket=bucket, Key=key, Body=payload,
                                  ContentType='video/mp2t', CacheControl='public,max-age=86400,immutable')
                timestamp = datetime.datetime.fromtimestamp(wall_started + (index-2)*SEGMENT_SECONDS,
                                                            datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                window = (window + [{'sequence': index, 'filename': filename,
                                      'programDateTime': timestamp}])[-5:]
                if index >= 2:
                    client.put_object(Bucket=bucket, Key=manifest_key, Body=make_manifest(window).encode(),
                                      ContentType='application/vnd.apple.mpegurl', CacheControl='public,max-age=1,s-maxage=2')
                report['uploadedSegments'] += 1
                if index == 2:
                    print(json.dumps({'originReady': True, 'runId': run_id, 'publicUrl': public_url,
                                      'publishingStartedAtUnix': wall_started,
                                      'plannedStopAtUnix': wall_started+args.duration}), flush=True)
                    if getattr(args,'control_stdin',False):
                        threading.Thread(target=read_control_stop,args=(sys.stdin,run_id,handle_control),daemon=True).start()
            if not cancelled:
                sleep_until(publishing_started + args.duration)
            report['publishSeconds'] = round(time.monotonic()-publishing_started, 3)
    except PublishDeadline:
        report['plannedPublishDeadlineReached'] = True
    except Exception as exc:
        # Exception strings may contain signed URLs or credential-bearing provider messages.
        report['errorClass'] = type(exc).__name__
        if isinstance(exc, ClientError):
            report['storageErrorCode'] = str(exc.response.get('Error', {}).get('Code', 'Unknown'))[:80]
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        if publishing_started is not None:
            report['mediaPublishSeconds'] = round(time.monotonic()-publishing_started, 3)
        report['cancelled'] = cancelled
        if control_reason is not None:report['controlStopReason']=control_reason
        if lock_owned:
            try:
                current = client.get_object(Bucket=bucket, Key=manifest_key)['Body'].read(65537)
                if run_id.encode() in current:
                    if window:
                        client.put_object(Bucket=bucket, Key=manifest_key, Body=make_manifest(window, ended=True).encode(),
                                          ContentType='application/vnd.apple.mpegurl', CacheControl='public,max-age=1,s-maxage=2')
                    # Give already-started segment downloads a bounded grace period.
                    time.sleep(12)
                    client.delete_object(Bucket=bucket, Key=manifest_key)
            except ClientError as exc:
                if exc.response.get('Error', {}).get('Code') not in ('NoSuchKey', '404'):
                    report['cleanupManifestErrorClass'] = type(exc).__name__
            except Exception as exc:
                report['cleanupManifestErrorClass'] = type(exc).__name__
            try:
                if owned_keys:
                    removed = client.delete_objects(Bucket=bucket,
                                                     Delete={'Objects': [{'Key': key} for key in owned_keys], 'Quiet': True})
                    if removed.get('Errors'):
                        report['cleanupObjectErrorCount'] = len(removed['Errors'])
                client.delete_object(Bucket=bucket, Key=lock_key)
                report['cleanupComplete'] = not any(key.startswith('cleanup') and key != 'cleanupComplete'
                                                    for key in report)
            except Exception as exc:
                report['cleanupErrorClass'] = type(exc).__name__
        report['endedAtUnix'] = time.time()
        print(json.dumps({'originReport': report}), flush=True)
    return 0 if ('errorClass' not in report and report['cleanupComplete']
                 and (not cancelled or control_reason=='load-completed')) else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration', type=int, default=180)
    parser.add_argument('--delivery-host', required=True,
                        help='Staging playback hostname. Production hosts require --known-canary.')
    parser.add_argument('--known-canary', action='store_true',
                        help='One-client PRB10A pilot only. Load runs must not set this.')
    parser.add_argument('--control-stdin',action='store_true')
    args = parser.parse_args()
    if not 12 <= args.duration <= 864 or args.duration % SEGMENT_SECONDS:
        parser.error('Synthetic publication must last 12..864 seconds in six-second segments')
    raise SystemExit(main(args))
