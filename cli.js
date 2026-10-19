#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { analyzeFile } from './analyzer.js';
import { htmlReport } from './report.js';

try {
  const {values, positionals} = parseArgs({allowPositionals:true, options:{help:{type:'boolean',short:'h'},json:{type:'string'},html:{type:'string'},'fail-on-errors':{type:'boolean'}}});
  if(values.help) {
    console.log('Usage: node cli.js FILE [--json NEW_FILE] [--html NEW_FILE] [--fail-on-errors]\nSupports JSONL request records and Nginx/Apache combined access logs. No network requests.');
  } else {
    if(positionals.length !== 1) throw Error('Provide exactly one log filename. Use --help for usage.');
    const summary = await analyzeFile(positionals[0]);
    if(!summary.requests) throw Error(`No valid request records found (${summary.invalid_lines} invalid lines).`);
    if(values.json) await writeFile(values.json, JSON.stringify(summary,null,2)+'\n', {flag:'wx',mode:0o600});
    if(values.html) await writeFile(values.html, htmlReport(summary), {flag:'wx',mode:0o600});
    console.log(`WEB LOG INSPECTOR\nRequests: ${summary.requests}\n4xx: ${summary.client_errors} | 5xx: ${summary.server_errors} | Error rate: ${summary.error_rate_percent}%\nInvalid lines: ${summary.invalid_lines} | Latency samples: ${summary.latency.samples}\np50: ${summary.latency.p50_ms ?? 'N/A'} ms | p95: ${summary.latency.p95_ms ?? 'N/A'} ms`);
    for(const item of summary.top_routes.slice(0,5)) console.log(`${item.requests} request(s), ${item.errors} error(s): ${item.route}`);
    if(values.json) console.log('JSON report saved.');
    if(values.html) console.log('HTML report saved.');
    if(values['fail-on-errors'] && summary.client_errors+summary.server_errors > 0) process.exitCode=1;
  }
} catch(error) {
  console.error(`Web Log Inspector: ${error.code === 'EEXIST' ? 'An output file already exists; choose a new filename.' : error.message}`);
  process.exitCode=2;
}
