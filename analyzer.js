import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_ROUTES = 10000;

export function parseLine(line) {
  let item;
  if (line.trimStart().startsWith('{')) {
    item = JSON.parse(line);
  } else {
    // Nginx/Apache combined-log request and status; trailing fields are ignored.
    const match = line.match(/^\S+ \S+ \S+ \[[^\]]+\] "([A-Z]+) ([^\s"]+) HTTP\/[\d.]+" (\d{3}) (?:\d+|-) "[^"\r\n]*" "[^"\r\n]*"(?:\s.*)?$/);
    if (!match) throw Error('Unsupported log format');
    item = { method: match[1], path: match[2], status: Number(match[3]) };
  }
  if (typeof item !== 'object' || item === null || !Number.isInteger(item.status) || item.status < 100 || item.status > 599) throw Error('Invalid status');
  if (typeof item.method !== 'string' || !/^[A-Z]{1,16}$/.test(item.method)) throw Error('Invalid method');
  if (typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.length > 2048 || /[\x00-\x20\x7f]/.test(item.path)) throw Error('Invalid request path');
  if (item.duration_ms !== undefined && (typeof item.duration_ms !== 'number' || !Number.isFinite(item.duration_ms) || item.duration_ms < 0 || item.duration_ms > 86400000)) throw Error('Invalid duration');
  // Drop query strings/fragments; never retain IPs, user agents or request bodies.
  return { method: item.method, path: item.path.split(/[?#]/, 1)[0], status: item.status, duration_ms: item.duration_ms };
}

export function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percent / 100 * sorted.length) - 1)];
}

export class Analyzer {
  constructor() {
    this.total = 0; this.invalid = 0; this.blank = 0;
    this.statuses = {}; this.methods = {}; this.routes = new Map();
    this.durations = []; this.errors4xx = 0; this.errors5xx = 0;
  }

  addLine(line) {
    if (!line.trim()) { this.blank++; return; }
    let item;
    try {
      if (line.length > 1024 * 1024) throw Error('Line too long');
      item = parseLine(line);
    } catch { this.invalid++; return; }
    this.total++;
    this.statuses[item.status] = (this.statuses[item.status] || 0) + 1;
    this.methods[item.method] = (this.methods[item.method] || 0) + 1;
    if (item.status >= 400 && item.status < 500) this.errors4xx++;
    if (item.status >= 500) this.errors5xx++;
    let key = item.method + ' ' + item.path;
    if (!this.routes.has(key) && this.routes.size >= MAX_ROUTES) key = '(other routes)';
    const route = this.routes.get(key) || { route: key, requests: 0, errors: 0 };
    route.requests++;
    if (item.status >= 400) route.errors++;
    this.routes.set(key, route);
    if (item.duration_ms !== undefined) this.durations.push(item.duration_ms);
  }

  summary() {
    const routes = [...this.routes.values()].sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
    const durationTotal = this.durations.reduce((sum, value) => sum + value, 0);
    return {
      schema_version: 1, requests: this.total, invalid_lines: this.invalid, blank_lines: this.blank,
      client_errors: this.errors4xx, server_errors: this.errors5xx,
      error_rate_percent: this.total ? Number(((this.errors4xx + this.errors5xx) / this.total * 100).toFixed(2)) : 0,
      statuses: this.statuses, methods: this.methods,
      latency: { samples: this.durations.length,
        mean_ms: this.durations.length ? Number((durationTotal / this.durations.length).toFixed(2)) : null,
        p50_ms: percentile(this.durations, 50), p95_ms: percentile(this.durations, 95) },
      top_routes: routes.slice(0, 15),
      error_routes: routes.filter(route => route.errors).sort((a, b) => b.errors - a.errors || a.route.localeCompare(b.route)).slice(0, 15),
      route_limit: MAX_ROUTES, latency_method: 'exact nearest-rank percentile; only records with duration_ms'
    };
  }
}

export async function analyzeFile(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw Error('Input must be a regular file no larger than 100 MiB');
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const analyzer = new Analyzer();
  let bytes = 0;
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (bytes > MAX_FILE_BYTES + 1) throw Error('Input grew beyond 100 MiB while reading');
      analyzer.addLine(line);
    }
  } finally { lines.close(); input.destroy(); }
  return analyzer.summary();
}
