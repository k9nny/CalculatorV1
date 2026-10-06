param($self, [switch]$DryRun)
# ULTIMATE SHOP СКЛАД: one-file installer for Windows.
# The program itself is the text after the HTML marker line of this file. The script writes it to a
# permanent folder, writes the icon and creates shortcuts on the Desktop and in the Start menu that
# open the program in its own browser window. Nothing is downloaded from the internet.
# Written for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$title = 'ULTIMATE SHOP СКЛАД'

function Say([string]$text, [int]$kind = 64) {
  if ($DryRun) { Write-Output "[$kind] $text"; return }
  try { [void](New-Object -ComObject WScript.Shell).Popup($text, 0, $title, $kind) } catch { Write-Output $text }
}
# the browser that opens .html files for this person: if they opened the program before, their data is there
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
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { $desktop = Join-Path $home0 'Desktop' }
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = Join-Path $home0 '.local' }
  $dest = Join-Path $base 'UltimateShopSklad'
  $app = Join-Path $dest 'ULTIMATE SHOP SKLAD.html'

  # 1. the program: everything after the marker line of this very file
  $all = [IO.File]::ReadAllText($self, [Text.Encoding]::UTF8)
  $mark = '#' + '#HTML' + '#' + '#'
  $at = $all.IndexOf($mark)
  if ($at -lt 0) { throw 'в файле установки нет программы, скачайте его ещё раз' }
  $html = $all.Substring($at + $mark.Length).TrimStart("`r", "`n")
  if (-not $html.StartsWith('<!doctype html>') -or -not $html.TrimEnd().EndsWith('</html>')) { throw 'файл установки скачался не полностью, скачайте его ещё раз' }
  $isUpdate = Test-Path -LiteralPath $app
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  [IO.File]::WriteAllText($app, $html, (New-Object Text.UTF8Encoding $false))

  # 2. the icon: the gold «US» square from the program's menu
  $ico = Join-Path $dest 'ULTIMATE SHOP SKLAD.ico'
  [IO.File]::WriteAllBytes($ico, [Convert]::FromBase64String('__ICON__'))

  # 3. the browser; Chrome, Yandex Browser and Edge open the program as a window without tabs.
  #    An update keeps the browser of the existing shortcut: the data lives in that browser
  $links = @(Join-Path $desktop ($title + '.lnk'))
  $menu = [Environment]::GetFolderPath('Programs')
  if ($menu) { $links += Join-Path $menu ($title + '.lnk') }
  $browser = $null
  if (-not $DryRun) {
    foreach ($l in $links) {
      if ($browser -or -not (Test-Path -LiteralPath $l)) { continue }
      try { $old = (New-Object -ComObject WScript.Shell).CreateShortcut($l).TargetPath; if ($old -match '\.exe$' -and (Test-Path -LiteralPath $old)) { $browser = $old } } catch {}
    }
  }
  if (-not $DryRun -and -not $browser) {
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
  if ($DryRun) {
    Write-Output "app=$app ($((Get-Item -LiteralPath $app).Length) bytes)"; Write-Output "icon=$ico ($((Get-Item -LiteralPath $ico).Length) bytes)"
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
  if ($isUpdate) { Say "Программа обновлена!`n`nВсё, что вы делали раньше, осталось на месте. Программа сейчас откроется.`n`nОткрывайте её, как и раньше, ярлыком «$title» на рабочем столе. Этот файл установки можно удалить." 64 }
  else { Say "Готово!`n`nНа рабочем столе появился ярлык «$title». Программа сейчас откроется.`n`nДальше открывайте её этим ярлыком. Этот файл установки можно удалить.`n`nВышла новая версия — скачайте новый файл установки и откройте его так же. Данные останутся." 64 }
} catch {
  Say ("Не получилось установить программу.`n`n" + $_.Exception.Message) 16
}
