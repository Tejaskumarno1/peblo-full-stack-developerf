Set-Location D:\Peblo\peblo-wt\fix\server
Get-ChildItem -Directory | Select-Object -ExpandProperty Name
Get-ChildItem -Recurse -File -Include *.js,*.mjs | Where-Object { $_.FullName -notmatch 'node_modules' -and $_.Length -lt 200000 } | Select-String -Pattern '/s/', 'share/note', 'serveShare', 'index.html' | ForEach-Object { $x = $_.Line.Trim(); if ($x.Length -gt 130) { $x = $x.Substring(0,130) }; "$($_.Path.Replace((Get-Location).Path,'')):$($_.LineNumber): $x" } | Select-Object -First 14
