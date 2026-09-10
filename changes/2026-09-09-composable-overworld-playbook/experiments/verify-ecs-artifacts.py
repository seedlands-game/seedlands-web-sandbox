"""Verify pinned upstream archives against every installed candidate file; never execute package code."""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit
from urllib.request import urlopen

runtime = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
registry = subprocess.run(['pnpm', 'config', 'get', 'registry'], check=True, capture_output=True, text=True).stdout.strip()
parsed = urlsplit(registry)
registry_origin = ('https://registry.npmjs.org' if parsed.scheme == 'https' and parsed.hostname == 'registry.npmjs.org'
                   else 'redacted: configured registry differs from the public npm origin')
for name, version in [('bitecs', '0.4.0'), ('koota', '0.6.6')]:
    metadata_url = f'https://registry.npmjs.org/{name}/{version}'
    with urlopen(metadata_url, timeout=30) as response:
        meta = json.load(response)
    with urlopen(meta['dist']['tarball'], timeout=30) as response:
        data = response.read()
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    assert integrity == meta['dist']['integrity']
    files = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            parts = Path(member.name).parts
            assert parts[0] == 'package' and '..' not in parts
            relative = Path(*parts[1:])
            expected = archive.extractfile(member).read()
            installed = runtime / 'node_modules' / name / relative
            assert installed.read_bytes() == expected, f'Installed file differs from verified archive: {name}/{relative}'
            files.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(expected).hexdigest()})
    files.sort(key=lambda entry: entry['path'])
    result = {
        'name': name, 'version': version,
        'upstreamMetadataUrl': metadata_url,
        'verifiedArchiveUrl': meta['dist']['tarball'],
        'configuredPnpmRegistryOrigin': registry_origin,
        'actualInstallTransport': 'unknown: original pnpm log reports store reuse/download but no per-package transport URL',
        'actualArchiveSha256': hashlib.sha256(data).hexdigest(),
        'actualArchiveIntegrity': integrity,
        'declaredArchiveIntegrity': meta['dist']['integrity'],
        'installedFilesMatchVerifiedArchive': True,
        'files': files,
        'isolatedManifestSha256': hashlib.sha256((runtime / 'package.json').read_bytes()).hexdigest(),
        'isolatedLockSha256': hashlib.sha256((runtime / 'pnpm-lock.yaml').read_bytes()).hexdigest(),
        'verificationCommand': 'python3 experiments/verify-ecs-artifacts.py <isolated-pnpm-project> <output-directory>',
        'python': sys.version.split()[0], 'exitCode': 0,
    }
    (output / f'{name}-artifact-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'name': name, 'matchedFiles': len(files), 'archiveSha256': result['actualArchiveSha256']}))
