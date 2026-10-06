$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$deployKey = Join-Path $env:USERPROFILE ".ssh\wms_deploy"
$server = "configds@192.168.100.152"
$remoteRoot = "/home/configds/wms"
$serviceUrl = "http://192.168.100.152:3000"

if (-not (Test-Path -LiteralPath $deployKey)) {
  throw "WMS 배포 키를 찾을 수 없습니다: $deployKey"
}

Push-Location $projectRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "프론트엔드 빌드에 실패했습니다." }

  & scp -i $deployKey -r dist "${server}:${remoteRoot}/"
  if ($LASTEXITCODE -ne 0) { throw "운영 서버 파일 전송에 실패했습니다." }

  $localHtml = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "dist\index.html")
  $remoteHtml = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "$serviceUrl/?deploy_check=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())").Content
  $localAsset = [regex]::Match($localHtml, 'assets/index-[^"'']+\.js').Value
  $remoteAsset = [regex]::Match($remoteHtml, 'assets/index-[^"'']+\.js').Value

  if (-not $localAsset -or $localAsset -ne $remoteAsset) {
    throw "전송은 끝났지만 운영 자산 확인에 실패했습니다. local=$localAsset remote=$remoteAsset"
  }

  Write-Host "Deployment complete: $remoteAsset" -ForegroundColor Green
} finally {
  Pop-Location
}
