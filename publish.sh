#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
gh auth status
gh auth setup-git
if [[ -e .git ]]; then echo 'Git checkout exists; review it before publishing manually.'; exit 1; fi
if gh repo view cuzzaintit321/web-log-inspector >/dev/null 2>&1; then
    echo 'Repository exists; review it before publishing manually.'; exit 1
fi
git init -b main
git add .
git -c user.name='Jason Edwards' \
    -c user.email='228125969+cuzzaintit321@users.noreply.github.com' \
    commit -m 'Add Node.js log analyzer with HTML reporting, tests, and CI'
gh repo create cuzzaintit321/web-log-inspector --public --source . --remote origin --push \
    --description 'Dependency-free Node.js HTTP log analyzer with error summaries, route rankings, latency percentiles, and offline HTML reports.'
