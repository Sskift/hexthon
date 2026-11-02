"""Archive the verified release, leaving all source and QA files untouched."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import os
import re

workspace = Path(__file__).resolve().parent.parent
version = json.loads((workspace / 'package.json').read_text(encoding='utf-8'))['version']
directory = os.environ.get('HEXTHON_BUILD_DIRECTORY', version)
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z0-9]+)?', directory):
    raise ValueError('Invalid build directory name')
release = workspace / 'dist' / directory / 'Hexthon-win32-x64'
output = workspace / 'dist' / f'Hexthon-{version}-win32-x64.zip'
with ZipFile(output, 'x', ZIP_DEFLATED, compresslevel=6) as archive:
    for filename in release.rglob('*'):
        relative = filename.relative_to(release)
        if filename.is_file() and '.qa' not in relative.parts:
            archive.write(filename, Path(release.name) / relative)
    manifest = workspace / 'dist' / directory / 'manifest.json'
    if manifest.is_file():
        archive.write(manifest, Path(release.name) / 'manifest.json')
print(f'{output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)')
