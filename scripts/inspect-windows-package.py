# -*- coding: utf-8 -*-
"""Inspect packaged files only; never starts services or reads application data."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import zipfile

root = Path(sys.argv[1])
version = sys.argv[2]
manifest = json.loads((root / 'build-manifest.json').read_text(encoding='utf-8'))
if manifest['version'] != version:
    raise ValueError('Unexpected Windows package version')
for line in (root / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
    expected, name = line.split('  ', 1)
    if Path(name).name != name:
        raise ValueError('Invalid package filename')
    with (root / name).open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ValueError('Package checksum mismatch')

with zipfile.ZipFile(root / f'Joy-Exam-System-{version}-Windows-x64.zip') as archive:
    names = set(archive.namelist())
    standalone = PurePosixPath('resources/runtime/results/dist/standalone')
    modules = standalone / 'node_modules'
    dependency_manifest = json.loads(archive.read(str(standalone / 'runtime-dependencies.json')))
    if dependency_manifest['format'] != 1:
        raise ValueError('Invalid dependency manifest')
    packages = dependency_manifest['packages']
    declared = {entry['path'] for entry in packages}
    if not declared or len(declared) != len(packages):
        raise ValueError('Empty or duplicate runtime dependency paths')

    def metadata(path):
        return json.loads(archive.read(str(path / 'package.json')))

    def resolve_dependency(name, importer):
        while importer == standalone or standalone in importer.parents:
            candidate = importer / 'node_modules' / name
            if str(candidate / 'package.json') in names and metadata(candidate)['name'] == name:
                return candidate
            importer = importer.parent
        return None

    for entry in packages:
        path = PurePosixPath(entry['path'])
        if path.is_absolute() or '..' in path.parts or not path.parts:
            raise ValueError('Invalid dependency path')
        package_root = modules / path
        actual = metadata(package_root)
        if actual['name'] != entry['name'] or actual['version'] != entry['version']:
            raise ValueError('Dependency version mismatch: ' + entry['name'])
        for dependency in entry['dependencies']:
            if dependency['path'] is None:
                if not dependency['optional']:
                    raise ValueError('Missing required dependency')
                continue
            found = resolve_dependency(dependency['name'], package_root)
            if dependency['path'] not in declared or found != modules / dependency['path']:
                raise ValueError('Missing or incorrectly nested dependency: ' + dependency['name'])
    for name in dependency_manifest['seeds']:
        found = resolve_dependency(name, standalone)
        if found is None or str(found.relative_to(modules)) not in declared:
            raise ValueError('Missing runtime entry dependency: ' + name)
    excel = resolve_dependency('exceljs', standalone)
    unzipper = resolve_dependency('unzipper', excel) if excel else None
    fstream = resolve_dependency('fstream', unzipper) if unzipper else None
    rimraf = resolve_dependency('rimraf', fstream) if fstream else None
    if rimraf is None or str(rimraf / 'rimraf.js') not in names:
        raise ValueError('Missing ExcelJS rimraf runtime file')
    if archive.read('resources/runtime/build-manifest.json') != (root / 'build-manifest.json').read_bytes():
        raise ValueError('Packaged build manifest mismatch')
    forbidden = ['resources/runtime/scanner/sessions/', 'resources/runtime/scanner/config/',
                 'resources/runtime/results/.local/']
    if any(name.startswith(prefix) for name in names for prefix in forbidden) or 'resources/runtime/results/results.sqlite' in names:
        raise ValueError('Application data found in Windows package')
    with archive.open('佳音考试管理.exe') as stream:
        header = stream.read(4096)
    offset = struct.unpack_from('<I', header, 0x3c)[0]
    if header[:2] != b'MZ' or list(header[offset:offset + 4]) != [80, 69, 0, 0] or struct.unpack_from('<H', header, offset + 4)[0] != 0x8664:
        raise ValueError('Packaged app is not Windows x64')
    print(json.dumps({'checksums': 'matched', 'runtimeDependencies': len(packages),
                      'exceljsRimraf': 'present', 'nestedVersions': 'preserved',
                      'userData': 'excluded', 'appArchitecture': 'x64', 'archiveEntries': len(names)}))
