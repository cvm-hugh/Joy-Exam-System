#!/bin/zsh
set -euo pipefail

MERGE_ROOT="${0:A:h:h}"
RESULTS_ROOT="$MERGE_ROOT/services/results"
APP_NAME="佳音考试管理"
OUTPUT_DIR="$MERGE_ROOT/output"
OUTPUT_APP_DIR="$OUTPUT_DIR/$APP_NAME.app"
OUTPUT_ZIP="$OUTPUT_DIR/$APP_NAME.app.zip"
STAGING_ROOT="$(/usr/bin/mktemp -d /private/tmp/joy-unified-app.XXXXXX)"
APP_DIR="$STAGING_ROOT/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
MODULE_CACHE="$STAGING_ROOT/swift-module-cache"
BUILD_VERSION="$(date '+%Y%m%d%H%M%S')"
NODE_BIN="${JOY_NODE_BIN:-$(command -v node || true)}"
NPM_BIN="$(command -v npm || true)"
trap 'rm -rf "$STAGING_ROOT"' EXIT

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" || ! -x "$MERGE_ROOT/.venv/bin/python" || -L "$RESULTS_ROOT/node_modules" || ! -d "$RESULTS_ROOT/node_modules" ]]; then
  print -u2 -- "缺少本项目独立依赖，请先运行 npm run setup。"
  exit 69
fi
export PATH="${NODE_BIN:h}:$PATH"
cd "$MERGE_ROOT"
"$NODE_BIN" scripts/check-source-independence.mjs
cd "$RESULTS_ROOT"
"$NPM_BIN" run build
"$NODE_BIN" scripts/check-build-secrets.mjs "$MERGE_ROOT/runtime"
mkdir -p "$OUTPUT_DIR" "$MACOS_DIR" "$RESOURCES_DIR" "$MODULE_CACHE"
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" /usr/bin/swiftc -O -module-cache-path "$MODULE_CACHE" -framework Cocoa -framework WebKit \
  "$MERGE_ROOT/desktop/UnifiedExamLauncher.swift" -o "$MACOS_DIR/$APP_NAME"
cp "$MERGE_ROOT/desktop/server-wrapper.sh" "$RESOURCES_DIR/server-wrapper.sh"
# A development App uses only this unified project's source and dependencies.
# A fully bundled distributable runtime is a separate release step.
print -r -- "$MERGE_ROOT" > "$RESOURCES_DIR/project-root.txt"
chmod +x "$RESOURCES_DIR/server-wrapper.sh" "$MACOS_DIR/$APP_NAME"
APP_VERSION="$("$NODE_BIN" -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$MERGE_ROOT/package.json")"
/usr/bin/plutil -create xml1 "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleName -string "$APP_NAME" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleDisplayName -string "$APP_NAME" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string "com.joyeducation.exam-management.unified" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string "$APP_NAME" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundlePackageType -string "APPL" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleShortVersionString -string "$APP_VERSION" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert CFBundleVersion -string "$BUILD_VERSION" "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert NSHighResolutionCapable -bool true "$CONTENTS_DIR/Info.plist"
/usr/bin/plutil -insert NSAppTransportSecurity -xml '<dict><key>NSAllowsLocalNetworking</key><true/></dict>' "$CONTENTS_DIR/Info.plist"
/usr/bin/xattr -cr "$APP_DIR"
/usr/bin/codesign --force --deep --sign - "$APP_DIR"
/usr/bin/codesign --verify --deep --strict "$APP_DIR"
rm -rf "$OUTPUT_APP_DIR"
rm -f "$OUTPUT_ZIP"
/usr/bin/ditto --norsrc "$APP_DIR" "$OUTPUT_APP_DIR"
/usr/bin/ditto -c -k --keepParent --norsrc "$APP_DIR" "$OUTPUT_ZIP"
print -r -- "$OUTPUT_APP_DIR"
print -r -- "$OUTPUT_ZIP"
