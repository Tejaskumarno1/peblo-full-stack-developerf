Get-PSDrive -PSProvider FileSystem | % { "{0}: free {1:N1} GB of {2:N1} GB" -f $_.Name, ($_.Free/1GB), (($_.Used+$_.Free)/1GB) }
function sz($p) { if (Test-Path $p) { $s = (Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | ? { -not $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) } | Measure-Object Length -Sum).Sum; "{0,8:N2} GB  {1}" -f ($s/1GB), $p } else { "missing  $p" } }
sz 'C:\Users\tejas\Documents\peblo-full-stack-developerf'
sz 'C:\Users\tejas\peblo-wt'
sz 'C:\Users\tejas\peblo-e2e'
sz 'C:\Users\tejas\Documents\pgtest'
Get-ChildItem C:\Users\tejas -Directory -Force -ErrorAction SilentlyContinue | ? { $_.Name -match 'peblo|backup' } | % FullName
Get-ChildItem C:\Users\tejas\Documents -Directory -ErrorAction SilentlyContinue | ? { $_.Name -match 'peblo|backup' } | % FullName
Get-ChildItem C:\Users\tejas\peblo-wt -Directory | % { $_.Name + ' -> ' + ((Get-ChildItem $_.FullName -Force | ? { $_.Attributes -match 'ReparsePoint' } | % Name) -join ',') }
"--- env path refs"
Get-ChildItem C:\Users\tejas\Documents\peblo-full-stack-developerf -Recurse -Force -Include .env,.env.* -Depth 2 -ErrorAction SilentlyContinue | ? { $_.FullName -notmatch 'node_modules' } | % { $f = $_.FullName; Select-String $f -Pattern 'C:\\\\|C:/|Users' | % { $f.Replace('C:\Users\tejas\Documents\','') + ': ' + ($_.Line -replace '=.*','=<value hidden if secret>') } }
Get-Service postgresql-x64-17 | % { $_.Name + ' ' + $_.Status }
(Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'").PathName
