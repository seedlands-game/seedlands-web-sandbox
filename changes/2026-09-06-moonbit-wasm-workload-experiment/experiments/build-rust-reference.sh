#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
SOURCE="$ROOT/changes/2026-09-06-moonbit-wasm-workload-experiment/experiments/rust-reference.rs"
OUTPUT=${RUST_REFERENCE_OUTPUT:-/tmp/seedlands-rust-reference.wasm}
MOON_WASM_OPT_PATH=${MOON_WASM_OPT:-}
if [ -z "$MOON_WASM_OPT_PATH" ] && [ -n "${SEEDLANDS_MOON_HOME:-}" ]; then
  MOON_WASM_OPT_PATH="$SEEDLANDS_MOON_HOME/bin/moon-wasm-opt"
fi
if [ -z "$MOON_WASM_OPT_PATH" ] || [ ! -x "$MOON_WASM_OPT_PATH" ]; then
  echo "moon-wasm-opt is required; set MOON_WASM_OPT or SEEDLANDS_MOON_HOME to the fixed toolchain" >&2
  exit 1
fi

RUST_VERSION=$(rustc --version | awk '{print $2}')
if [ "$RUST_VERSION" != "1.88.0" ]; then
  echo "rustc 1.88.0 is required; got $RUST_VERSION" >&2
  exit 1
fi
if ! rustc --print target-list | grep -qx 'wasm32-unknown-unknown'; then
  echo "rust target wasm32-unknown-unknown is not installed" >&2
  exit 1
fi

# Rust's normal Wasm code generation does not enable fast-math. Keep relaxed
# SIMD disabled explicitly so the reference remains comparable to MoonBit.
rustc \
  --target wasm32-unknown-unknown \
  --crate-type cdylib \
  -O \
  -C panic=abort \
  -C target-feature=-relaxed-simd \
  -C link-arg=--global-base=16777216 \
  -C link-arg=--export=__heap_base \
  -C link-arg=--initial-memory=16777216 \
  -C link-arg=--max-memory=33554432 \
  "$SOURCE" \
  -o "$OUTPUT"

OPTIMIZED_OUTPUT="$OUTPUT.optimized"
"$MOON_WASM_OPT_PATH" "$OUTPUT" -O3 --enable-bulk-memory --enable-reference-types --enable-multivalue -o "$OPTIMIZED_OUTPUT"
mv "$OPTIMIZED_OUTPUT" "$OUTPUT"

node "$ROOT/changes/2026-09-06-moonbit-wasm-workload-experiment/experiments/check-rust-reference.mjs" "$OUTPUT"

printf '%s\n' "$OUTPUT"
