# Web Log Inspector

A **JavaScript / Node.js** command-line tool that turns HTTP request logs into an error summary, route rankings, response-time statistics, and a self-contained HTML report. No npm dependencies, external services, or network requests.

Built as a new learning and portfolio project for Jason Edwards. The sample logs are fictional; this repository does not claim production use or professional incident-response history.

## Run the sample

Requires Node.js 20 or newer. No `npm install` is needed.

```bash
node cli.js samples/access.jsonl
mkdir -p reports
node cli.js samples/access.jsonl --html reports/demo.html --json reports/demo.json
```

Open `reports/demo.html` in your browser. The report contains embedded CSS, no JavaScript, and no remote assets. It can also be printed using the browser's print command.

The fictional JSONL sample contains **10 requests, one 4xx, two 5xx, a 30% combined error rate, p50 22 ms, and p95 940 ms**. The 95th percentile of only ten samples is the largest sample under the documented nearest-rank method; it should not be mistaken for a stable production latency estimate.

## Supported input

JSON Lines: one object per line, with the following fields:

```json
{"method":"GET","path":"/api/health","status":200,"duration_ms":14.5}
```

`method`, `path`, and numeric `status` are required. `duration_ms` is optional and must be a finite nonnegative number no greater than one day in milliseconds. Only origin-form paths beginning with `/` are accepted. Paths may contain query strings or fragments, which are removed before aggregation. Methods must be uppercase ASCII letters. Statuses must be integers between 100 and 599.

Nginx/Apache **combined access logs** are also accepted:

```bash
node cli.js samples/access.combined
```

This parser supports the conventional quoted request, status, byte count, referrer, and user-agent structure. Custom formats, escaped-quote fields, malformed requests, and other variants can be rejected. Combined logs do not provide response times in this parser, so latency is shown as unavailable rather than fabricated. Mixed supported formats are accepted in the same file. Timestamps are not interpreted; the tool does not calculate time-window request rates or uptime.

## Analysis

| Output | Meaning |
| --- | --- |
| Valid requests | Successfully parsed records |
| 4xx / 5xx counts | Client/server HTTP status classes |
| Combined error rate | `(4xx + 5xx) / valid records × 100` |
| Status/method distribution | Counts of exact statuses and methods |
| Top routes | Method + path grouped after removing query/fragment |
| Error routes | Routes ranked by count of 4xx/5xx responses |
| Mean / p50 / p95 | Only records that supply `duration_ms` |
| Invalid/blank lines | Explicitly reported parsing exclusions |

Percentiles use exact nearest rank, not interpolation. All timing samples are retained for sorting. Route counts are capped at 10,000 distinct method/path keys; additional distinct routes are grouped into `(other routes)`. Reports show the top 15 routes in each ranking, while the terminal shows the top five. Numeric IDs in paths are not normalized into route templates.

Input is read line by line, with a regular-file size cap of 100 MiB and a post-read line-length cap of 1 MiB. Memory depends on the longest line, timing samples, and distinct routes; this is not a constant-memory analyzer or a hostile-input sandbox. Do not use it for untrusted multi-gigabyte logs.

## Output files and exit codes

Output files are created with private permissions and never overwritten. Create their parent folders first and choose new filenames for repeat reports. JSON is written before HTML if both are requested; a later write failure can leave the earlier report in place.

```bash
node cli.js samples/access.jsonl --fail-on-errors
```

- **0:** valid records analyzed; malformed lines can still be present and are counted.
- **1:** analysis succeeded, but `--fail-on-errors` detected any 4xx/5xx responses. Requested reports are still written.
- **2:** invalid arguments, file/format failure, no valid records, or output conflict.

## Privacy and interpretation

The tool does not retain client IPs, user agents, request bodies, or query strings. However, **route paths can contain account IDs, emails, or other private data**. Reports are not automatically anonymized. Inspect outputs before sharing; never commit real access logs or reports containing customer data. The ignored `logs/` and `reports/` folders are intended for local files.

The report HTML escapes route text, preventing it from becoming active markup. No findings are transmitted anywhere by the analyzer. A high error rate is evidence about the supplied records, not a root-cause diagnosis or proof of an outage.

## Tests

```bash
node --test
```

Nine tests cover query stripping, error aggregation, combined logs without timing, percentile math, input validation, HTML escaping, streaming file analysis, CLI output/overwrite behavior, failure exit codes, and invalid input. CI runs them on Node.js 20 and 22. Workflow configuration is included; inspect the Actions tab after publishing to confirm its result.

No visual browser layout check was completed in the preparation environment because a Chromium executable was unavailable. HTML content and escaping are tested, but responsive rendering still needs browser review.

## Publish

With the GitHub CLI signed in, run:

```bash
bash publish.sh
```

This creates **public** repository `cuzzaintit321/web-log-inspector`, sets its description, and pushes the source, fictional samples, tests, and CI workflow. It stops when the remote repository or a local Git checkout already exists. Review any partial publication before retrying. No software license has been chosen on your behalf.
