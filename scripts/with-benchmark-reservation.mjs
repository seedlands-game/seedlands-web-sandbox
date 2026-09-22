#!/usr/bin/env node

import { main } from './benchmark-window.mjs';

process.exitCode = await main(process.argv.slice(2));
