#!/usr/bin/env node
import {main} from '../src/runtime/cli.mjs';
import {run} from '../src/cli.mjs';
await main(()=>run(process.argv.slice(2)));
