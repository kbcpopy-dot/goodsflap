$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
    throw '이 폴더가 아직 Git 저장소로 연결되지 않았습니다.'
}

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub의 최신 내용을 확인하지 못했습니다.' }

$localChanges = git status --porcelain
if ($localChanges) {
    $distance = git rev-list --left-right --count HEAD...origin/main
    Write-Host '로컬 변경을 보존하기 위해 자동 pull을 건너뜁니다.'
    Write-Host "현재 차이: $distance"
    git status --short
    exit 0
}

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw '자동 병합 없이 최신 내용을 받을 수 없습니다.' }
Write-Host '굿즈플랩 작업 폴더를 GitHub 최신 상태로 맞췄습니다.'

