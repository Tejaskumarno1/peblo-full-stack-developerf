$ErrorActionPreference = 'Continue'
Set-Location D:\Peblo\peblo-wt\fix
$pg = Get-Process postgres -ErrorAction SilentlyContinue
if (-not $pg) { & 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' start -D D:\Peblo\peblo-e2e\pgdata17 -o '-p 55432' -s -w | Out-Null }
node ("e2e\" + $args[0] + ".mjs") *> _d.txt
Write-Output 'finished'
