$f = 'D:\Peblo\peblo-wt\fix\e2e\picture-toolbar.mjs'
$t = [IO.File]::ReadAllText($f)
$n = $t.Replace('at most 12 buttons', 'at most 13 buttons')
$m = [regex]::Matches($n, '.{0,120}<= 12.{0,60}')
$m | % { $_.Value }
$n2 = [regex]::Replace($n, '(\w+\.n|\.length|buttons|count|n)\s*<=\s*12', '$1 <= 13')
[IO.File]::WriteAllText($f, $n2)
Select-String $f -Pattern '13' | % { $_.LineNumber.ToString() + ' ' + $_.Line.Trim().Substring(0, [Math]::Min(260, $_.Line.Trim().Length)) }
