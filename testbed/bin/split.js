#!/usr/bin/env node
// Which hold-out split (dev/confirm) a participant pseudonym falls into.
//   node bin/split.js NAME [NAME...]
import {participantSplit} from '../src/engine/session.js';

for (const name of process.argv.slice(2)) console.log(`${name}\t${participantSplit(name)}`);
