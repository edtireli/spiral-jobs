# Mac build

Build on Apple Silicon with Xcode command line tools, Python 3 and npm. The release bundles runtime software, not model weights or user data.

1. Run `npm ci` and `npx playwright install chromium`.
2. Install the official [Ollama Mac app](https://ollama.com/download/mac), or set `OLLAMA_RUNTIME` to an extracted official runtime directory containing `ollama` and its libraries.
3. Download the [Tectonic 0.17.0 Apple Silicon archive](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0) and extract the executable to `.cache/tectonic/tectonic`, or set `TECTONIC_BINARY`.
4. Set `NODE_BINARY` to the official standalone Node 24 executable. Homebrew-linked binaries are rejected because they are not portable to another Mac.
5. Run `npm test`, `npm run audit:privacy`, then `npm run build:mac`.

The app is written to `dist/Spiral Jobs.app`. The builder never installs over an existing app and never reads the data directory. Its config is empty; the new user's workspace and model directory are discovered at runtime. Include the runtime licenses under `Contents/Resources/licenses` and the Chromium/Ollama notices shipped with those components.

The development build has an ad-hoc signature. A distribution that should open without a Gatekeeper exception needs an Apple Developer ID signature and Apple's notarization process. This repository does not claim that service has been completed.

Create a release ZIP with `ditto -c -k --sequesterRsrc --keepParent 'dist/Spiral Jobs.app' dist/Spiral-Jobs-macOS-arm64.zip`, then publish its SHA-256 checksum. Test a fresh temporary workspace with `--no-models` before publishing. Test on another physical Mac before claiming broad hardware compatibility.
