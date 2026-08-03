#!/usr/bin/env node

import assert from 'node:assert/strict';

import { judge } from '../source-runtime/core-shim.mjs';

process.env.HARBOR_JUDGE_COMMAND = 'false';

await assert.rejects(
  () => judge({ input: 'test input', rubric: 'test rubric' }),
  (error) => {
    assert.match(String(error), /HARBOR_JUDGE_INFRASTRUCTURE_ERROR:/);
    return true;
  }
);

console.log('Validated judge transport failures are classified as infrastructure.');
