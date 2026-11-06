$bin = 'C:\Program Files\PostgreSQL\17\bin'
foreach ($d in 'C:\Users\tejas\peblo-e2e\pgdata17','C:\Users\tejas\peblo-e2e\pgdata','C:\Users\tejas\Documents\pgtest') {
  $conf = Join-Path $d 'postgresql.conf'; $port = if (Test-Path $conf) { (Select-String $conf -Pattern '^\s*port\s*=\s*(\d+)').Matches | % { $_.Groups[1].Value } | Select-Object -First 1 } else { '' }
  $ver = Get-Content (Join-Path $d 'PG_VERSION')
  "$d version=$ver port=$port"
}
