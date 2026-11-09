"""Encoder-only cleanup of one finished synthetic run. Never deletes other runs."""
import argparse
import importlib.util
import json
import pathlib
import re


def main(run_id):
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    if not re.fullmatch(r'[a-f0-9]{16}', run_id):
        raise ValueError('Expected a single exact synthetic run ID')
    path = pathlib.Path('/opt/qsession-encoder/ops/synthetic-hls-origin.py')
    spec = importlib.util.spec_from_file_location('synthetic_origin', path)
    origin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(origin)
    storage = origin.read_credentials()
    endpoint, bucket = origin.require_staging_storage(storage.get('endpoint'), storage.get('bucket'))
    client = boto3.client('s3', endpoint_url=endpoint, region_name=storage.get('region', 'auto'),
                          aws_access_key_id=storage['accessKey'], aws_secret_access_key=storage['secretKey'],
                          config=Config(connect_timeout=5, read_timeout=10, retries={'total_max_attempts': 1},
                                        s3={'addressing_style': 'path'}, request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    own_prefix = origin.PREFIX + 'segment_load_' + run_id + '_'
    listed = client.list_objects_v2(Bucket=bucket, Prefix=own_prefix, MaxKeys=100)
    if listed.get('IsTruncated'):
        raise ValueError('Unexpected bounded synthetic segment count')
    keys = [item['Key'] for item in listed.get('Contents', [])]
    if any(not re.fullmatch(re.escape(own_prefix) + r'[0-9]{5}\.ts', key) for key in keys):
        raise ValueError('Unexpected object outside this exact synthetic run')
    if keys:
        result = client.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': key} for key in keys], 'Quiet': True})
        if result.get('Errors'):
            raise ValueError('Synthetic object deletion did not complete')
    shared_removed = []
    for suffix in ('index.m3u8', 'load-origin.lock'):
        key = origin.PREFIX + suffix
        try:
            body = client.get_object(Bucket=bucket, Key=key)['Body'].read(65537)
            owned = run_id.encode() in body if suffix == 'index.m3u8' else json.loads(body).get('runId') == run_id
            if owned:
                client.delete_object(Bucket=bucket, Key=key)
                shared_removed.append(suffix)
        except ClientError as exc:
            if exc.response.get('Error', {}).get('Code') not in ('NoSuchKey', '404'):
                raise
    remaining = client.list_objects_v2(Bucket=bucket, Prefix=own_prefix, MaxKeys=1).get('Contents', [])
    print(json.dumps({'runId': run_id, 'ownedSegmentsRemoved': len(keys),
                      'ownedSharedObjectsRemoved': shared_removed, 'remainingOwnedSegments': len(remaining),
                      'cleanupComplete': not remaining, 'otherRunsRemoved': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    try:
        main(args.run_id)
    except Exception as exc:
        print(json.dumps({'errorClass': type(exc).__name__, 'detailsSuppressed': True}))
        raise SystemExit(2)
