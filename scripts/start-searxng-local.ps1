param(
  [int]$Port = 8888,
  [string]$ContainerName = "vbaut-searxng",
  [string]$Image = "docker.io/searxng/searxng:latest"
)

$ErrorActionPreference = "Stop"

function Require-Docker {
  $null = Get-Command docker -ErrorAction Stop
}

function Get-RepoRoot {
  return Split-Path -Parent $PSScriptRoot
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Wait-ForSearxNg([int]$WaitPort) {
  $deadline = (Get-Date).AddSeconds(30)
  $url = "http://127.0.0.1:$WaitPort"
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

Require-Docker

$repoRoot = Get-RepoRoot
$configDir = Join-Path $repoRoot "data\searxng\config"
$cacheDir = Join-Path $repoRoot "data\searxng\cache"

Ensure-Directory $configDir
Ensure-Directory $cacheDir

$existingContainerId = docker ps -aq -f "name=^${ContainerName}$"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list Docker containers."
}

if ([string]::IsNullOrWhiteSpace($existingContainerId)) {
  Write-Host "Creating container $ContainerName on port $Port..."
  docker run --name $ContainerName -d `
    -p "${Port}:8080" `
    -v "${configDir}:/etc/searxng/" `
    -v "${cacheDir}:/var/cache/searxng/" `
    $Image | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create container $ContainerName."
  }
} else {
  $isRunning = docker inspect -f "{{.State.Running}}" $ContainerName
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read container state for $ContainerName."
  }
  if ($isRunning -ne "true") {
    Write-Host "Starting existing container $ContainerName..."
    docker start $ContainerName | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to start container $ContainerName."
    }
  } else {
    Write-Host "Container $ContainerName is already running."
  }
}

if (-not (Wait-ForSearxNg -WaitPort $Port)) {
  throw "SearxNG did not respond on http://127.0.0.1:$Port within 30 seconds."
}

Write-Host ""
Write-Host "SearxNG is ready at http://127.0.0.1:$Port"
Write-Host "Set this before starting VBAUT:"
Write-Host ('  $env:RESEARCH_SEARXNG_URL="http://127.0.0.1:{0}"' -f $Port)
