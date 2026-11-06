Set-Location D:\Peblo\peblo-wt\fix
git fetch -q origin; "HEAD $(git rev-parse --short HEAD) origin/supabase $(git rev-parse --short origin/supabase)"
$files = Get-ChildItem client\src,server\src,e2e,client\index.html -Recurse -File -Include *.jsx,*.js,*.css,*.html,*.mjs,*.ts -ErrorAction SilentlyContinue
$bad = [char]0xFFFD
$files | % { $t = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8); $n = ($t.ToCharArray() | ? { $_ -eq $bad }).Count; $m = ([regex]::Matches($t, 'â€|Â·|Ã')).Count; if ($n -or $m) { "{0}  fffd={1} moji={2}" -f $_.FullName.Replace('D:\Peblo\peblo-wt\fix\',''), $n, $m } }
"--- sample lines"
$files | % { $f=$_; $i=0; Get-Content $f.FullName -Encoding UTF8 | % { $i++; if ($_.Contains($bad)) { "{0}:{1} {2}" -f $f.Name, $i, $_.Trim().Substring(0,[Math]::Min(150,$_.Trim().Length)) } } } | Select-Object -First 60
