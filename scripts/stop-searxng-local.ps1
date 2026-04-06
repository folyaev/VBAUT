param(
  [string]$ContainerName = "vbaut-searxng"
)

$ErrorActionPreference = "Stop"

$null = Get-Command docker -ErrorAction Stop

$existingContainerId = docker ps -aq -f "name=^${ContainerName}$"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list Docker containers."
}

if ([string]::IsNullOrWhiteSpace($existingContainerId)) {
  Write-Host "Container $ContainerName was not found."
  exit 0
}

$isRunning = docker inspect -f "{{.State.Running}}" $ContainerName
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read container state for $ContainerName."
}

if ($isRunning -eq "true") {
  Write-Host "Stopping container $ContainerName..."
  docker stop $ContainerName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to stop container $ContainerName."
  }
}

Write-Host "Removing container $ContainerName..."
docker rm $ContainerName | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to remove container $ContainerName."
}

Write-Host "SearxNG container $ContainerName was removed. Data in data\\searxng was preserved."
