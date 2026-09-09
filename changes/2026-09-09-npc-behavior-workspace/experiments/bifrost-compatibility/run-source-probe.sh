#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE=${1:?usage: run-source-probe.sh /path/to/bifrost-v2.1.0-source}
TARGET="$SOURCE/core/providers/utils/compatibility_probe_test.go"

cleanup() { rm -f "$TARGET"; }
trap cleanup EXIT INT TERM
cp "$HERE/compatibility_probe_test.go" "$TARGET"
(cd "$SOURCE/core" && go test ./providers/utils -run '^TestCompatibilityProbe' -count=1 -v)
