# ULTIMATE SHOP СКЛАД: opens the program and, while it is in use, passes its questions to Ozon.
# A page opened from a file may not ask api-seller.ozon.ru itself, so the program asks this helper on
# http://127.0.0.1:37219 and the helper asks Ozon. It listens only on this computer and talks only to
# api-seller.ozon.ru and to Ozon's picture servers.
# It also keeps a copy of the program's Ozon keys, so an update or a cleared browser does not lose them:
# the file ozon-keys.dat next to the program, encrypted by Windows for this Windows user. Only the program
# gets it back: the installer puts a secret into the program and into start.json, and the helper answers
# /keys only to a request that brings that secret. It stops after 12 hours without requests.
# Written for Windows PowerShell 5.1.
param([string]$Dir, [string]$Upstream = 'https://api-seller.ozon.ru', [int]$Port = 37219, [switch]$NoBrowser, [switch]$PlainStoreForTests)
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$here = $Dir
if (-not $here -and $PSCommandPath) { $here = Split-Path -Parent $PSCommandPath }
if (-not $here -and $env:LOCALAPPDATA) { $here = Join-Path $env:LOCALAPPDATA 'UltimateShopSklad' }

# 1. the program window: the browser and its arguments are written by the installer next to this file
$cfg = $null
try { $cfg = Get-Content -LiteralPath (Join-Path $here 'start.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
$token = ''
if ($cfg -and $cfg.token) { $token = [string]$cfg.token }
if (-not $NoBrowser) {
  try {
    if (-not $cfg -or -not $cfg.target) { throw 'no start.json' }
    if ($cfg.args) { Start-Process -FilePath $cfg.target -ArgumentList $cfg.args } else { Start-Process -FilePath $cfg.target }
  } catch {
    $app = Join-Path $here 'ULTIMATE SHOP SKLAD.html'
    if (Test-Path -LiteralPath $app) { Start-Process -FilePath $app }
  }
}

# the keys' copy: Windows encrypts it for this Windows user (DPAPI)
$keyFile = Join-Path $here 'ozon-keys.dat'
$entropy = [Text.Encoding]::UTF8.GetBytes('UltimateShopSklad/ozon-keys')
$dpapi = $false
try { Add-Type -AssemblyName System.Security; $null = [Security.Cryptography.ProtectedData]::Protect([byte[]](1), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser); $dpapi = $true } catch {}
# (the leading comma keeps a byte array whole when a function returns it)
function Seal([byte[]]$b) {
  if ($dpapi) { return ,[Security.Cryptography.ProtectedData]::Protect($b, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
  if ($PlainStoreForTests) { return ,$b }
  throw 'no protected store'
}
function Unseal([byte[]]$b) {
  if ($dpapi) { return ,[Security.Cryptography.ProtectedData]::Unprotect($b, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
  if ($PlainStoreForTests) { return ,$b }
  throw 'no protected store'
}

# 2. one helper is enough: if the port is taken, the helper from an earlier start is still working
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { exit }

$crlf2 = [byte[]](13, 10, 13, 10)
function Find-Crlf2([byte[]]$b, [int]$n) {
  for ($i = 0; $i -le $n - 4; $i++) { if ($b[$i] -eq 13 -and $b[$i + 1] -eq 10 -and $b[$i + 2] -eq 13 -and $b[$i + 3] -eq 10) { return $i } }
  return -1
}
function Send($stream, [int]$code, [string]$type, [byte[]]$body) {
  if (-not $body) { $body = [byte[]]@() }
  $reason = @{200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 501 = 'Not Implemented'; 502 = 'Bad Gateway'}[$code]
  if (-not $reason) { $reason = 'Status' }
  $h = "HTTP/1.1 $code $reason`r`n" +
       "Content-Type: $type`r`n" +
       "Content-Length: $($body.Length)`r`n" +
       "Access-Control-Allow-Origin: *`r`n" +
       "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
       "Access-Control-Allow-Headers: Client-Id, Api-Key, Content-Type, X-Sklad-Token`r`n" +
       "Access-Control-Allow-Private-Network: true`r`n" +
       "Access-Control-Max-Age: 600`r`n" +
       "Cache-Control: no-store`r`n" +
       "Connection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}
function Text([string]$s) { return [Text.Encoding]::UTF8.GetBytes($s) }

# one request from the program: read it, ask Ozon, give the answer back as it is
function Serve($client) {
  $client.ReceiveTimeout = 20000; $client.SendTimeout = 20000
  $stream = $client.GetStream()
  $buf = New-Object byte[] 65536
  $ms = New-Object IO.MemoryStream
  $end = -1
  while ($end -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return }
    $ms.Write($buf, 0, $n)
    if ($ms.Length -gt 2MB) { return }
    $all = $ms.ToArray(); $end = Find-Crlf2 $all $all.Length
  }
  $head = [Text.Encoding]::ASCII.GetString($all, 0, $end)
  $lines = $head -split "`r`n"
  $first = $lines[0] -split ' '
  $method = $first[0]; $path = $first[1]
  $h = @{}
  foreach ($ln in $lines | Select-Object -Skip 1) { $i = $ln.IndexOf(':'); if ($i -gt 0) { $h[$ln.Substring(0, $i).Trim().ToLower()] = $ln.Substring($i + 1).Trim() } }
  $len = 0; if ($h['content-length']) { $len = [int]$h['content-length'] }
  if ($len -gt 1MB) { Send $stream 400 'text/plain' (Text 'too big'); return }
  $body = New-Object byte[] $len
  $have = $all.Length - $end - 4
  if ($have -gt 0) { [Array]::Copy($all, $end + 4, $body, 0, [Math]::Min($have, $len)) }
  while ($have -lt $len) { $n = $stream.Read($body, $have, $len - $have); if ($n -le 0) { return }; $have += $n }

  # only the program itself: a page from a file (origin «null») on this computer's own address
  $origin = $h['origin']
  if (($origin -and $origin -ne 'null' -and $origin -notmatch '^file:') -or ($h['host'] -notmatch "^(127\.0\.0\.1|localhost):$Port$")) { Send $stream 403 'text/plain' (Text 'forbidden'); return }
  if ($method -eq 'OPTIONS') { Send $stream 204 'text/plain' $null; return }
  if ($path -eq '/ping') { Send $stream 200 'application/json' (Text '{"ok":true,"v":2}'); return }
  # the keys' copy: only for the program that knows the secret
  if ($path -eq '/keys') {
    if (-not $token -or -not $h['x-sklad-token'] -or $h['x-sklad-token'] -cne $token) { Send $stream 403 'text/plain' (Text 'forbidden'); return }
    try {
      if ($method -eq 'GET') {
        if (-not (Test-Path -LiteralPath $keyFile)) { Send $stream 404 'application/json' (Text '{}'); return }
        Send $stream 200 'application/json' (Unseal ([IO.File]::ReadAllBytes($keyFile))); return
      }
      if ($method -eq 'POST') {
        $txt = [Text.Encoding]::UTF8.GetString($body)
        if ($txt -notmatch '^\s*\{[\s\S]*"shops"\s*:\s*\[[\s\S]*\}\s*$') { Send $stream 400 'text/plain' (Text 'bad'); return }
        [IO.File]::WriteAllBytes($keyFile, (Seal $body)); Send $stream 204 'text/plain' $null; return
      }
      Send $stream 404 'text/plain' (Text 'not found'); return
    } catch { Send $stream 501 'text/plain' (Text 'no store'); return }
  }

  $target = $null; $isImg = $false
  if ($path -match '^/ozon(/v\d+/[A-Za-z0-9/_\-]+)$') { $target = $Upstream + $Matches[1] }
  elseif ($method -eq 'GET' -and $path -match '^/img\?u=(.+)$') {
    $u = [Uri]::UnescapeDataString($Matches[1])
    try { $uri = [Uri]$u } catch { $uri = $null }
    if ($uri -and $uri.Scheme -eq 'https' -and $uri.Host -match '(^|\.)ozone?\.ru$') { $target = $uri.AbsoluteUri; $isImg = $true }
  }
  if (-not $target) { Send $stream 404 'text/plain' (Text 'not found'); return }

  try {
    $req = [Net.HttpWebRequest]::Create($target)
    $req.Method = $method; $req.Timeout = 60000; $req.ReadWriteTimeout = 60000
    $req.UserAgent = 'UltimateShopSklad'
    if (-not $isImg) {
      $req.ContentType = 'application/json'
      if ($h['client-id']) { $req.Headers.Add('Client-Id', $h['client-id']) }
      if ($h['api-key']) { $req.Headers.Add('Api-Key', $h['api-key']) }
      if ($method -eq 'POST') { $req.ContentLength = $body.Length; $rs = $req.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close() }
    }
    # an answer with an error code (wrong key, too many requests) is passed on as it is
    try { $resp = $req.GetResponse() } catch { $ex = $_.Exception; while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }; if (-not $ex -or -not $ex.Response) { throw }; $resp = $ex.Response }
    $out = New-Object IO.MemoryStream
    $resp.GetResponseStream().CopyTo($out)
    $code = [int]$resp.StatusCode; $type = $resp.ContentType; if (-not $type) { $type = 'application/octet-stream' }
    $resp.Close()
    Send $stream $code $type $out.ToArray()
  } catch {
    Send $stream 502 'application/json' (Text ('{"helper":"' + ($_.Exception.Message -replace '["\\\r\n]', ' ') + '"}'))
  }
}

$last = [DateTime]::Now
try {
  while ($true) {
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 50
      if (([DateTime]::Now - $last).TotalHours -ge 12) { break }
      continue
    }
    $client = $listener.AcceptTcpClient(); $last = [DateTime]::Now
    try { Serve $client } catch {} finally { $client.Close() }
  }
} finally { $listener.Stop() }
