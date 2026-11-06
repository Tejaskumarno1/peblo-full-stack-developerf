Set-Location D:\Peblo\peblo-wt\fix\client; npx vite build 2>&1 | Select-Object -Last 1
Set-Location D:\Peblo\peblo-wt\fix
node e2e/fix-nov5.mjs 2>&1 | Select-String -Pattern '^(PASS|FAIL)|check\(s\)|crash|Error' | % { $_.Line.Substring(0,[Math]::Min(260,$_.Line.Length)) }
