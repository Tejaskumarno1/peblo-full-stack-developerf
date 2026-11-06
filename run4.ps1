$ErrorActionPreference = 'Continue'
Set-Location C:\Users\tejas\peblo-wt\fix\client
npx vite build 2>&1 | Select-Object -Last 4
Set-Location C:\Users\tejas\peblo-wt\fix
node scripts/run-e2e.mjs fix-four colors table-edit collab edited-by 2>&1 | Select-String -Pattern 'PASS|FAIL|passed|failed|✗|✖|crash|=>' | Select-Object -Last 60
