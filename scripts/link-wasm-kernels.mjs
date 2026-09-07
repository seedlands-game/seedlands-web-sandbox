#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// rustc's wasm32 target adds --stack-first implicitly. The fixed low-address
// ABI arena needs data and the stack AFTER --global-base instead.
const linker = process.env.SEEDLANDS_KERNEL_LINKER;
if (!linker) throw new Error('Run this linker through wasm:simd:build.');
const args = process.argv.slice(2).filter((arg) => arg !== '--stack-first');
if (!args.includes('-flavor')) args.unshift('-flavor', 'wasm');
const result = spawnSync(linker, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
