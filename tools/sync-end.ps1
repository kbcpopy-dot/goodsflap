param(
    [string]$Message = 'Update Goodsflap site'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
    throw '이 폴더가 아직 Git 저장소로 연결되지 않았습니다.'
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw '패키지 설치에 실패했습니다.' }
}

npm test
if ($LASTEXITCODE -ne 0) { throw '테스트 실패로 GitHub 동기화를 중단했습니다.' }

$changes = git status --porcelain
if (-not $changes) {
    Write-Host '동기화할 변경이 없습니다.'
    exit 0
}

git add --all
$blocked = git diff --cached --name-only | Where-Object {
    $_ -eq '.env' -or
    (($_ -like '.env.*') -and ($_ -ne '.env.example')) -or
    $_ -match '(^|/)(data/|node_modules/|\.vercel/)'
}
if ($blocked) {
    git reset
    throw "공개 저장소에 올릴 수 없는 파일이 포함되어 중단했습니다: $($blocked -join ', ')"
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw '커밋에 실패했습니다.' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub 업로드에 실패했습니다.' }
Write-Host '작업 내용을 GitHub main 브랜치에 동기화했습니다.'
