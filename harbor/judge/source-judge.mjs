#!/usr/bin/env node

// Run the source eval's judge with the same model, prompt, structured-output
// contract, token limit, and provider options as packages/core/src/index.ts.
// The HTTP service is only a transport boundary for remote Harbor verifiers.

import { openai } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const judgeOutputSchema = z.object({
  passed: z.boolean(),
  notes: z.string(),
});

const { output } = await generateText({
  model: openai('gpt-5.5'),
  system:
    'You are a strict eval judge. Return only the requested structured judgment.',
  prompt: ['Rubric:', String(args.rubric ?? ''), '', 'Input:', String(args.input ?? '')].join(
    '\n'
  ),
  output: Output.object({ schema: judgeOutputSchema }),
  maxOutputTokens: 4096,
  providerOptions: {
    openai: {
      reasoningEffort: 'low',
      textVerbosity: 'low',
    },
  },
});

process.stdout.write(`${JSON.stringify(output)}\n`);
