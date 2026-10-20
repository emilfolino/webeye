import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const protocol = JSON.parse(
    readFileSync(new URL('../protocols/webeye-main.protocol.json', import.meta.url), 'utf8'));
export const tmp = () => mkdtempSync(join(tmpdir(), 'webeye-test-'));
