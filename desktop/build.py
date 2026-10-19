#!/usr/bin/env python3
"""Build a clean, self-contained Apple Silicon app. Never copies user data."""
from pathlib import Path
import json, os, plistlib, shutil, subprocess, sys

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
destination = root / 'dist' / 'Spiral Jobs.app'
node = Path(os.environ.get('NODE_BINARY') or shutil.which('node') or '')
tectonic = Path(os.environ.get('TECTONIC_BINARY', root / '.cache/tectonic/tectonic'))
ollama = Path(os.environ.get('OLLAMA_RUNTIME', '/Applications/Ollama.app/Contents/Resources'))
browsers = Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH', Path.home() / 'Library/Caches/ms-playwright'))
if sys.platform != 'darwin' or os.uname().machine != 'arm64':
    raise SystemExit('Build on an Apple Silicon Mac with Xcode command line tools.')
for binary in (node, tectonic, ollama / 'ollama'):
    if not binary.is_file(): raise SystemExit(f'Missing runtime: {binary}')
    dependencies = subprocess.check_output(['otool', '-L', str(binary)], text=True)
    if '/opt/homebrew/' in dependencies or '/usr/local/' in dependencies:
        raise SystemExit(f'{binary.name} must be a portable official binary, not Homebrew-linked.')
browser_versions = json.loads((root / 'node_modules/playwright-core/browsers.json').read_text())['browsers']
browser_dirs = []
for item in browser_versions:
    if item['name'] in ('chromium', 'chromium-headless-shell', 'ffmpeg'):
        revision = item.get('revisionOverrides', {}).get('mac-arm64', item['revision'])
        folder = browsers / (item['name'].replace('-', '_') + '-' + revision)
        if not folder.is_dir(): raise SystemExit('Run npx playwright install chromium first: ' + str(folder))
        browser_dirs.append(folder)
if destination.exists(): shutil.rmtree(destination)  # generated dist output only
contents = destination / 'Contents'
resources = contents / 'Resources'
executable = contents / 'MacOS' / 'SpiralJobs'
executable.parent.mkdir(parents=True)
(resources / 'bin').mkdir(parents=True)
app = resources / 'app'
app.mkdir()
for name in ('lib', 'public', 'resources'):
    shutil.copytree(root / name, app / name)
for name in ('server.mjs', 'package.json', 'LICENSE'):
    shutil.copy2(root / name, app / name)
(app / 'desktop').mkdir()
shutil.copy2(root / 'desktop/launch.mjs', app / 'desktop/launch.mjs')
# Release config contains no paths, model choices, credentials, or personal profile.
(app / 'desktop/config.json').write_text('{}\n')
shutil.copy2(node, resources / 'bin/node')
shutil.copy2(tectonic, resources / 'bin/tectonic')
for name in ('playwright', 'playwright-core'):
    shutil.copytree(root / 'node_modules' / name, app / 'node_modules' / name, symlinks=True)
for folder in browser_dirs:
    shutil.copytree(folder, resources / 'browsers' / folder.name, symlinks=True)
shutil.copytree(ollama, resources / 'ollama', symlinks=True, ignore=shutil.ignore_patterns('*.png', '*.svg', '*.icns'))
shutil.copytree(root / 'desktop/licenses', resources / 'licenses')
info = {
    'CFBundleExecutable': 'SpiralJobs', 'CFBundleIdentifier': 'dk.edtireli.spiraljobs',
    'CFBundleName': 'Spiral Jobs', 'CFBundleDisplayName': 'Spiral Jobs',
    'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': version, 'CFBundleVersion': '1',
    'CFBundleIconFile': 'SpiralJobs', 'LSMinimumSystemVersion': '14.0',
    'NSHighResolutionCapable': True, 'NSPrincipalClass': 'NSApplication',
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
    'NSHumanReadableCopyright': 'Spiral Jobs · Edis Devin Tireli',
}
with (contents / 'Info.plist').open('wb') as stream: plistlib.dump(info, stream)
subprocess.run(['xcrun', 'clang', '-fobjc-arc', '-fblocks', '-O2', '-arch', 'arm64', '-mmacosx-version-min=14.0', str(root / 'desktop/JobDesk.m'), '-o', str(executable), '-framework', 'Cocoa', '-framework', 'WebKit'], check=True)
icon_script = root / '.cache/make-icon'
subprocess.run(['xcrun', 'clang', '-fobjc-arc', '-fblocks', str(root / 'desktop/make-icon.m'), '-o', str(icon_script), '-framework', 'Cocoa'], check=True)
iconset = root / '.cache/SpiralJobs.iconset'
subprocess.run([str(icon_script), str(iconset)], check=True)
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(resources / 'SpiralJobs.icns')], check=True)
subprocess.run(['xattr', '-cr', str(destination)], check=True)
subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(destination)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(destination)], check=True)
print(destination)
