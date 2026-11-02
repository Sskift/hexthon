"""Archive the verified release, leaving all source and QA files untouched."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

workspace = Path(__file__).resolve().parent.parent
release = workspace / 'dist' / 'Hexthon-win32-x64'
output = workspace / 'dist' / 'Hexthon-0.1.0-win32-x64.zip'
with ZipFile(output, 'x', ZIP_DEFLATED, compresslevel=6) as archive:
    for filename in release.rglob('*'):
        relative = filename.relative_to(release)
        if filename.is_file() and '.qa' not in relative.parts:
            archive.write(filename, Path(release.name) / relative)
print(f'{output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)')
