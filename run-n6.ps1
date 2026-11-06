$ErrorActionPreference = 'Continue'
Set-Location D:\Peblo\peblo-wt\fix
$pg = Get-Process postgres -ErrorAction SilentlyContinue
if (-not $pg) { & 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' start -D D:\Peblo\peblo-e2e\pgdata17 -o '-p 55432' -s -w | Out-Null }
Set-Location client; npx vite build 2>&1 | Select-Object -Last 3; Set-Location ..
foreach ($n in $args) { Write-Output "=== $n"; node scripts/run-e2e.mjs $n 2>&1 | Select-Object -Last 14 }
