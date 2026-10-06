$ErrorActionPreference = "Stop"

$printerKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\Xprinter XP-DT427B"
$driverKey = Join-Path $printerKey "PrinterDriverData"

if (-not (Test-Path -LiteralPath $printerKey)) {
  throw "Xprinter XP-DT427B 프린터 설정을 찾을 수 없습니다."
}

function Set-LabelSize([byte[]]$devMode) {
  # DEVMODEW: orientation=portrait, custom paper, length=40.0mm, width=60.0mm.
  [BitConverter]::GetBytes([int16]1).CopyTo($devMode, 76)
  [BitConverter]::GetBytes([int16]256).CopyTo($devMode, 78)
  [BitConverter]::GetBytes([int16]400).CopyTo($devMode, 80)
  [BitConverter]::GetBytes([int16]600).CopyTo($devMode, 82)
  return $devMode
}

[byte[]]$defaultMode = ((Get-ItemProperty -LiteralPath $printerKey)."Default DevMode").Clone()
$defaultMode = Set-LabelSize $defaultMode
Set-ItemProperty -LiteralPath $printerKey -Name "Default DevMode" -Value $defaultMode

[byte[]]$initialMode = ((Get-ItemProperty -LiteralPath $driverKey)."Initial DevMode").Clone()
$initialMode = Set-LabelSize $initialMode
Set-ItemProperty -LiteralPath $driverKey -Name "Initial DevMode" -Value $initialMode

Restart-Service -Name Spooler -Force

$verified = (Get-ItemProperty -LiteralPath $printerKey)."Default DevMode"
if ([BitConverter]::ToInt16($verified, 80) -ne 400 -or [BitConverter]::ToInt16($verified, 82) -ne 600) {
  throw "변경 후 용지 크기 검증에 실패했습니다."
}

Write-Output "Xprinter XP-DT427B 기본 용지: 60x40mm"
