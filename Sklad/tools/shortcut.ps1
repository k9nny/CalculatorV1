param($here, [switch]$DryRun)
# ULTIMATE SHOP СКЛАД: puts the program into a permanent folder and creates shortcuts
# on the Desktop and in the Start menu that open it in its own browser window.
# Nothing is downloaded from the internet. Written for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$title = 'ULTIMATE SHOP СКЛАД'

function Say([string]$text, [int]$kind = 64) {
  if ($DryRun) { Write-Output "[$kind] $text"; return }
  try { [void](New-Object -ComObject WScript.Shell).Popup($text, 0, $title, $kind) } catch { Write-Output $text }
}
# the browser that opens .html files for this person; they already used it, so their data is there
function ExeOf([string]$progId) {
  if (-not $progId) { return $null }
  try { $c = (Get-ItemProperty -LiteralPath ('Registry::HKEY_CLASSES_ROOT\' + $progId + '\shell\open\command')).'(default)' } catch { return $null }
  if ($c -match '^\s*"([^"]+)"') { $e = $Matches[1] } elseif ($c -match '^\s*(\S+)') { $e = $Matches[1] } else { return $null }
  if (Test-Path -LiteralPath $e) { return $e }
  return $null
}
function Choice([string]$key) {
  try { return (Get-ItemProperty -LiteralPath ('HKCU:\' + $key)).ProgId } catch { return $null }
}

try {
  $home0 = $env:USERPROFILE
  if (-not $home0) { $home0 = $HOME }
  $downloads = Join-Path $home0 'Downloads'
  if (-not $DryRun) { try { $d = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path; if ($d) { $downloads = $d } } catch {} }
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { $desktop = Join-Path $home0 'Desktop' }

  # 1. the program file: next to this file, in Downloads or on the Desktop; the newest one wins
  $places = @($here, $downloads, $desktop) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  $src = $places | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter '*.html' -File -ErrorAction SilentlyContinue } |
    Where-Object { $_.Name -like '*ULTIMATE SHOP*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1

  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = Join-Path $home0 '.local' }
  $dest = Join-Path $base 'UltimateShopSklad'
  $app = Join-Path $dest 'ULTIMATE SHOP SKLAD.html'
  if (-not $src -and -not (Test-Path -LiteralPath $app)) {
    Say "Не нашёл файл программы.`n`nСкачайте с Яндекс Диска файл «2. ULTIMATE SHOP СКЛАД.html» в папку «Загрузки» и откройте этот файл ещё раз." 48
    return
  }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  if ($src) { Copy-Item -LiteralPath $src.FullName -Destination $app -Force }

  # 2. the icon: the gold «US» square from the program's menu
  $ico = Join-Path $dest 'ULTIMATE SHOP SKLAD.ico'
  [IO.File]::WriteAllBytes($ico, [Convert]::FromBase64String('__ICON__'))

  # 3. the browser; Chrome, Yandex Browser and Edge open the program as a window without tabs
  $browser = $null
  if (-not $DryRun) {
    $browser = ExeOf (Choice 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.html\UserChoice')
    if (-not $browser) { $browser = ExeOf (Choice 'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice') }
    if (-not $browser) {
      $pf = $env:ProgramFiles; $pf86 = ${env:ProgramFiles(x86)}; $la = $env:LOCALAPPDATA
      $browser = @(
        "$pf\Google\Chrome\Application\chrome.exe", "$pf86\Google\Chrome\Application\chrome.exe", "$la\Google\Chrome\Application\chrome.exe",
        "$la\Yandex\YandexBrowser\Application\browser.exe",
        "$pf86\Microsoft\Edge\Application\msedge.exe", "$pf\Microsoft\Edge\Application\msedge.exe"
      ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    }
  }
  $url = ([Uri]$app).AbsoluteUri
  $appMode = $browser -and ($browser -match '(^|[\\/])(chrome|msedge|browser|brave|vivaldi)\.exe$')
  if ($browser) { $target = $browser } else { $target = $app }
  if ($appMode) { $argv = '--app="' + $url + '"' } elseif ($browser) { $argv = '"' + $url + '"' } else { $argv = '' }

  # 4. shortcuts on the Desktop and in the Start menu
  $links = @(Join-Path $desktop ($title + '.lnk'))
  $menu = [Environment]::GetFolderPath('Programs')
  if ($menu) { $links += Join-Path $menu ($title + '.lnk') }
  if ($DryRun) {
    Write-Output "source=$($src.FullName)"; Write-Output "app=$app"; Write-Output "icon=$ico ($((Get-Item -LiteralPath $ico).Length) bytes)"
    Write-Output "url=$url"; Write-Output "links=$($links -join ' | ')"
    return
  }
  $ws = New-Object -ComObject WScript.Shell
  foreach ($l in $links) {
    $sc = $ws.CreateShortcut($l)
    $sc.TargetPath = $target
    $sc.Arguments = $argv
    $sc.WorkingDirectory = $dest
    $sc.IconLocation = $ico + ',0'
    $sc.Description = 'Склад: заказы, закупка, приёмка'
    $sc.Save()
  }
  if ($argv) { Start-Process -FilePath $target -ArgumentList $argv } else { Start-Process -FilePath $target }
  Say "Готово!`n`nНа рабочем столе появился ярлык «$title». Программа сейчас откроется.`n`nДальше открывайте её этим ярлыком." 64
} catch {
  Say ("Не получилось создать ярлык.`n`n" + $_.Exception.Message + "`n`nПрограмму можно открыть и без ярлыка: двойной щелчок по файлу «2. ULTIMATE SHOP СКЛАД.html».") 16
}
