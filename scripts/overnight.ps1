# Overnight soak: runs the whole e2e suite again and again on fresh databases until the stop time, one log per cycle.
# Cycles alternate: even = encryption off, odd = encryption on (a random key). Never touches production.
param([string]$Stop = '06:30')
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$out = Join-Path $env:USERPROFILE 'peblo-overnight'; New-Item -ItemType Directory -Force $out | Out-Null
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'; $env:PGPASSWORD = 'postgres'
$stopAt = [datetime]::Parse($Stop); if ($stopAt -lt (Get-Date)) { $stopAt = $stopAt.AddDays(1) }
$n = 0
while ((Get-Date) -lt $stopAt) {
  $n++; $db = "peblo_test_night$n"
  & $psql -w -h 127.0.0.1 -p 55432 -U postgres -c "DROP DATABASE IF EXISTS $db" 2>&1 | Out-Null
  & $psql -w -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE $db ENCODING 'UTF8' TEMPLATE template0" 2>&1 | Out-Null
  $env:PEBLO_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/$db"
  if ($n % 2 -eq 0) { $env:PEBLO_DATA_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; $mode = 'enc-on' } else { Remove-Item Env:PEBLO_DATA_KEY -ErrorAction SilentlyContinue; $mode = 'enc-off' }
  $log = Join-Path $out ("cycle-{0:D2}-{1}.log" -f $n, $mode)
  "START $(Get-Date -Format o) $mode" | Out-File $log -Encoding ascii
  node scripts/run-e2e.mjs *>> $log
  "END $(Get-Date -Format o)" | Add-Content $log
  Copy-Item e2e-results.json (Join-Path $out ("cycle-{0:D2}-{1}.json" -f $n, $mode)) -ErrorAction SilentlyContinue
  & $psql -w -h 127.0.0.1 -p 55432 -U postgres -c "DROP DATABASE IF EXISTS $db" 2>&1 | Out-Null
}
"DONE $(Get-Date -Format o)" | Out-File (Join-Path $out 'FINISHED.txt') -Encoding ascii
