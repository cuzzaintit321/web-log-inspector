import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Analyzer, analyzeFile, parseLine, percentile } from '../analyzer.js';
import { htmlReport } from '../report.js';

const record = (extra={}) => JSON.stringify({method:'GET',path:'/api/checks',status:200,duration_ms:10,...extra});

test('query strings and fragments are stripped before aggregation',()=>{
  const analyzer=new Analyzer();
  analyzer.addLine(record({path:'/api/checks?token=private'}));
  analyzer.addLine(record({path:'/api/checks?status=open#section'}));
  const result=analyzer.summary();
  assert.equal(result.top_routes.length,1);
  assert.equal(result.top_routes[0].requests,2);
  assert.doesNotMatch(JSON.stringify(result),/private|token|status=open/);
});

test('counts errors by class and ignores invalid/blank records',()=>{
  const analyzer=new Analyzer();
  analyzer.addLine(record());analyzer.addLine(record({status:404}));analyzer.addLine(record({status:503}));
  analyzer.addLine('{bad');analyzer.addLine('');
  const result=analyzer.summary();
  assert.equal(result.requests,3);assert.equal(result.client_errors,1);assert.equal(result.server_errors,1);
  assert.equal(result.error_rate_percent,66.67);assert.equal(result.invalid_lines,1);assert.equal(result.blank_lines,1);
});

test('combined logs parse without inventing duration data',()=>{
  const parsed=parseLine('192.0.2.1 - - [19/Oct/2026:06:00:00 +0000] "GET /health HTTP/1.1" 200 12 "-" "Example/1.0"');
  assert.equal(parsed.path,'/health');assert.equal(parsed.duration_ms,undefined);
  const analyzer=new Analyzer();analyzer.addLine(JSON.stringify(parsed));
  assert.equal(analyzer.summary().latency.p95_ms,null);
});

test('nearest-rank percentiles and zero-duration samples are correct',()=>{
  assert.equal(percentile([1,2,3,4,5],95),5);
  assert.equal(percentile([4,1,3,2],50),2);
  assert.equal(percentile([],95),null);
  const analyzer=new Analyzer();analyzer.addLine(record({duration_ms:0}));
  assert.equal(analyzer.summary().latency.samples,1);
  assert.equal(analyzer.summary().latency.mean_ms,0);
});

test('invalid statuses, timings, and paths are rejected',()=>{
  for(const extra of [{status:'200'},{status:600},{duration_ms:-1},{duration_ms:'fast'},{path:'https://example.com/'},{method:'get'}]) {
    assert.throws(()=>parseLine(record(extra)));
  }
});

test('HTML output escapes path content and contains no active script',()=>{
  const analyzer=new Analyzer();analyzer.addLine(record({path:'/x/<script>alert(1)</script>'}));
  const report=htmlReport(analyzer.summary());
  assert.ok(report.includes('&lt;script&gt;'));
  assert.doesNotMatch(report,/<script[\s>]/i);
  assert.doesNotMatch(report,/https?:\/\//);
});

test('file analysis supports mixed valid and malformed input',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'logs-'));
  try {
    const path=join(directory,'input.jsonl');await writeFile(path,record()+'\ninvalid\n');
    const result=await analyzeFile(path);assert.equal(result.requests,1);assert.equal(result.invalid_lines,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('CLI writes reports, refuses overwrite, and can fail on HTTP errors',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'log-cli-'));
  const cli=resolve('cli.js');
  try {
    const input=join(directory,'input.jsonl'),html=join(directory,'report.html'),json=join(directory,'report.json');
    await writeFile(input,record({status:500})+'\n');
    const result=spawnSync(process.execPath,[cli,input,'--html',html,'--json',json,'--fail-on-errors'],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    assert.equal(JSON.parse(await readFile(json,'utf8')).server_errors,1);
    const again=spawnSync(process.execPath,[cli,input,'--html',html],{encoding:'utf8'});
    assert.equal(again.status,2);assert.match(again.stderr,/already exists/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('CLI rejects logs with no valid records and invalid arguments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'log-empty-'));
  try {
    const input=join(directory,'empty.log');await writeFile(input,'not a supported log\n');
    const result=spawnSync(process.execPath,[resolve('cli.js'),input],{encoding:'utf8'});
    assert.equal(result.status,2);assert.match(result.stderr,/No valid/);
    assert.equal(spawnSync(process.execPath,[resolve('cli.js'),'--unknown']).status,2);
  } finally {await rm(directory,{recursive:true,force:true});}
});
