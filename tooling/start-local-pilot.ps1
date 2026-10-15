param(
  [switch]$Stop,
  [switch]$OwnerReview,
  [string]$Service,
  [string]$ConfigPath,
  [int]$Port
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pilotHome = if ($OwnerReview) { Join-Path $env:LOCALAPPDATA '2J\owner-visual-review-097y' } else { Join-Path $env:LOCALAPPDATA '2J\platform-local-pilot' }
$runtimePath = Join-Path $pilotHome 'runtime.json'
$configFile = Join-Path $pilotHome 'config.json'
$pilotLabel = if ($OwnerReview) { 'owner-visual-review' } else { '084' }
$containerName = if ($OwnerReview) { '2j-platform-owner-visual-review-097y' } else { '2j-platform-084-pilot' }
$volumeName = if ($OwnerReview) { '2j-platform-owner-visual-review-097y-data' } else { '2j-platform-084-pilot-data' }
$databasePort = if ($OwnerReview) { 55442 } else { 55440 }
$databaseUrl = "postgres://2j_local:2j_local_dev_only@127.0.0.1:$databasePort/2j_demo"

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Stop-Pilot {
  $runtime = Read-JsonFile $runtimePath
  if ($runtime -and $runtime.processes) {
    foreach ($entry in $runtime.processes) {
      $processId = [int]$entry.pid
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
      if ($process -and $process.CommandLine -like "*$PSScriptRoot*" -and $process.CommandLine -like "*-Service $($entry.name)*") {
        & taskkill.exe /PID $processId /T /F | Out-Null
      }
    }
  }
  if (Test-Path -LiteralPath $runtimePath) { Remove-Item -LiteralPath $runtimePath -Force }
  Write-Host 'Se han detenido los procesos web/API iniciados por este piloto. La base sintética local se conserva.'
  Write-Host "Para iniciar de nuevo: pnpm pilot"
}

function Test-TcpPort([int]$Candidate) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Candidate)
  try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Select-Port([int]$Preferred, [int]$FallbackStart, [string]$Label) {
  if (Test-TcpPort $Preferred) { return $Preferred }
  for ($candidate = $FallbackStart; $candidate -lt ($FallbackStart + 40); $candidate++) {
    if (Test-TcpPort $candidate) {
      Write-Host "${Label}: el puerto $Preferred está ocupado; se usará $candidate."
      return $candidate
    }
  }
  throw "No hay un puerto loopback libre para $Label (preferido: $Preferred). Cierra una app local y vuelve a ejecutar pnpm pilot."
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falló '$Command $($Arguments -join ' ')' con código $LASTEXITCODE." }
  } finally { Pop-Location }
}

function Ensure-LocalDatabase {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker no está instalado o no está en PATH. Instala/inicia Docker Desktop y vuelve a ejecutar pnpm pilot.' }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está iniciado. Inícialo y vuelve a ejecutar pnpm pilot.' }

  $containerNames = @(& docker ps --all --format '{{.Names}}')
  $existing = $null
  if ($containerNames -contains $containerName) { $existing = (& docker inspect $containerName | ConvertFrom-Json) }
  if ($existing) {
    $labels = $existing[0].Config.Labels
    if ($labels.'com.2j.local-pilot' -ne $pilotLabel) { throw "Ya existe un contenedor llamado $containerName que no pertenece a este piloto; no se modificó." }
    $imageEnv = @($existing[0].Config.Env)
    if (($imageEnv -notcontains 'POSTGRES_DB=2j_demo') -or ($imageEnv -notcontains 'POSTGRES_USER=2j_local') -or ($imageEnv -notcontains 'POSTGRES_PASSWORD=2j_local_dev_only')) {
      throw "El contenedor $containerName no coincide con la configuración sintética esperada; no se modificó."
    }
    $binding = $existing[0].HostConfig.PortBindings.'5432/tcp'
    $dataMount = @($existing[0].Mounts | Where-Object { $_.Destination -eq '/var/lib/postgresql/data' })
    if (-not $binding -or $binding[0].HostIp -ne '127.0.0.1' -or $binding[0].HostPort -ne [string]$databasePort -or $dataMount.Count -ne 1 -or $dataMount[0].Name -ne $volumeName) {
      throw "El contenedor $containerName no está ligado al loopback/puerto/volumen aislado esperado; no se modificó."
    }
    if ($existing[0].State.Status -ne 'running') { Invoke-Checked 'docker' @('start', $containerName) $repoRoot }
  } else {
    if (-not (Test-TcpPort $databasePort)) { throw "El puerto local $databasePort está ocupado. No se tocará el proceso que lo usa; libera el puerto y vuelve a ejecutar pnpm pilot." }
    $volumeExists = (& docker volume ls --format '{{.Name}}') -contains $volumeName
    if (-not $volumeExists) { Invoke-Checked 'docker' @('volume','create',$volumeName) $repoRoot | Out-Null }
    Invoke-Checked 'docker' @('run','--detach','--name',$containerName,'--label',("com.2j.local-pilot=$pilotLabel" ),'--env','POSTGRES_DB=2j_demo','--env','POSTGRES_USER=2j_local','--env','POSTGRES_PASSWORD=2j_local_dev_only','--publish',"127.0.0.1:${databasePort}:5432",'--volume',"${volumeName}:/var/lib/postgresql/data",'postgres:17-alpine') $repoRoot | Out-Null
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & docker exec $containerName pg_isready -U 2j_local -d 2j_demo *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 750
  }
  if (-not $ready) { throw 'La base PostgreSQL local no quedó lista dentro del tiempo esperado.' }
}

function Wait-Http([string]$Url, [string]$Label, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "$Label no respondió en $TimeoutSeconds segundos. Revisa sus logs en $pilotHome\logs."
}

function Start-Service([string]$Name, [int]$ServicePort) {
  $powershell = (Get-Process -Id $PID).Path
  $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot\start-local-pilot.ps1`"",'-Service',$Name,'-Port',"$ServicePort",'-ConfigPath',"`"$configFile`"")
  $logPath = Join-Path $pilotHome "logs\$Name.log"
  $errorPath = Join-Path $pilotHome "logs\$Name.err.log"
  $child = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorPath -PassThru
  return [pscustomobject]@{ name = $Name; pid = $child.Id; port = $ServicePort }
}

if ($Stop) { Stop-Pilot; exit 0 }

if ($Service) {
  $config = Read-JsonFile $ConfigPath
  if (-not $config) { throw 'Configuración de proceso local no encontrada.' }
  $env:NODE_ENV = 'development'
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$Port
  if ($Service -eq 'api-trainer') {
    Remove-Item Env:PILOT_MEMBER_AUTH_ENABLED,Env:PILOT_MEMBER_BOOKING_ENABLED,Env:PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED,Env:MEMBER_APP_ORIGIN -ErrorAction SilentlyContinue
    Remove-Item Env:TRAINING_SERVICE_BASE_URL,Env:TRAINING_SERVICE_KEY_ID,Env:TRAINING_SERVICE_SECRET -ErrorAction SilentlyContinue
    $env:DATABASE_URL = $config.databaseUrl; $env:LOCAL_DEMO_ROLE = 'trainer'; $env:CORS_ORIGIN = if ($config.trainerUrl) { $config.trainerUrl } else { $config.staffUrl }
    pnpm --filter @2j/api dev
  } elseif ($Service -eq 'api-admin') {
    Remove-Item Env:PILOT_MEMBER_AUTH_ENABLED,Env:PILOT_MEMBER_BOOKING_ENABLED,Env:MEMBER_APP_ORIGIN -ErrorAction SilentlyContinue
    Remove-Item Env:TRAINING_SERVICE_BASE_URL,Env:TRAINING_SERVICE_KEY_ID,Env:TRAINING_SERVICE_SECRET -ErrorAction SilentlyContinue
    $env:DATABASE_URL = $config.databaseUrl; $env:LOCAL_DEMO_ROLE = 'admin'; $env:CORS_ORIGIN = $config.adminUrl; $env:PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED = 'true'
    pnpm --filter @2j/api dev
  } elseif ($Service -eq 'api-member') {
    Remove-Item Env:TRAINING_SERVICE_BASE_URL,Env:TRAINING_SERVICE_KEY_ID,Env:TRAINING_SERVICE_SECRET,Env:LOCAL_DEMO_ROLE,Env:LOCAL_DEMO_CLIENT_ID,Env:PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED -ErrorAction SilentlyContinue
    $env:DATABASE_URL = $config.databaseUrl; $env:CORS_ORIGIN = $config.memberOrigin
    $env:PILOT_MEMBER_AUTH_ENABLED = 'true'; $env:PILOT_MEMBER_BOOKING_ENABLED = 'true'; $env:MEMBER_APP_ORIGIN = $config.memberOrigin
    pnpm --filter @2j/api dev
  } elseif ($Service -eq 'notification-worker') {
    Remove-Item Env:TRAINING_SERVICE_BASE_URL,Env:TRAINING_SERVICE_KEY_ID,Env:TRAINING_SERVICE_SECRET,Env:LOCAL_DEMO_ROLE,Env:LOCAL_DEMO_CLIENT_ID,Env:PILOT_MEMBER_AUTH_ENABLED,Env:PILOT_MEMBER_BOOKING_ENABLED,Env:PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED,Env:MEMBER_APP_ORIGIN -ErrorAction SilentlyContinue
    $env:DATABASE_URL = $config.databaseUrl
    pnpm --filter @2j/api notifications:worker
  } elseif ($Service -eq 'staff') {
    $env:VITE_API_PROXY = $config.trainerApiUrl
    pnpm --filter @2j/staff-app exec vite --host 127.0.0.1 --port $Port --strictPort
  } elseif ($Service -eq 'admin') {
    $env:VITE_API_URL = $config.adminApiUrl
    pnpm --filter @2j/admin-web exec vite --host 127.0.0.1 --port $Port --strictPort
  } elseif ($Service -eq 'trainer-review') {
    $env:VITE_API_URL = $config.trainerApiUrl
    pnpm --filter @2j/admin-web exec vite --host 127.0.0.1 --port $Port --strictPort
  } elseif ($Service -eq 'member') {
    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
    $env:VITE_API_PROXY = $config.memberApiUrl
    $env:VITE_2J_HUB_PREVIEW = 'true'; $env:VITE_2J_STAFF_URL = $config.staffUrl; $env:VITE_2J_ADMIN_URL = $config.adminUrl
    $env:VITE_2J_PILOT_MEMBER_LOGIN = 'true'
    pnpm --filter @2j/client-app exec vite --host 127.0.0.1 --port $Port --strictPort
  } else { throw "Proceso de piloto desconocido: $Service" }
  exit $LASTEXITCODE
}

function Test-WorkspaceDependencies {
  $requiredBinaries = @(
    (Join-Path $repoRoot 'apps\api\node_modules\.bin\tsx.cmd'),
    (Join-Path $repoRoot 'apps\staff-app\node_modules\.bin\vite.cmd'),
    (Join-Path $repoRoot 'apps\admin-web\node_modules\.bin\vite.cmd'),
    (Join-Path $repoRoot 'apps\client-app\node_modules\.bin\vite.cmd')
  )
  return @($requiredBinaries | Where-Object { -not (Test-Path -LiteralPath $_) })
}

$missingDependencies = Test-WorkspaceDependencies
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules')) -or $missingDependencies.Count -gt 0) {
  Write-Host 'Preparando o reparando dependencias incompletas del repositorio...'
  Invoke-Checked 'pnpm' @('install','--frozen-lockfile') $repoRoot
}
$missingDependencies = Test-WorkspaceDependencies
if ($missingDependencies.Count -gt 0) {
  throw "Faltan ejecutables de los workspaces después de instalar dependencias: $($missingDependencies -join ', '). Revisa la instalación de pnpm y vuelve a ejecutar pnpm pilot."
}
New-Item -ItemType Directory -Force -Path (Join-Path $pilotHome 'logs') | Out-Null
if (Test-Path -LiteralPath $runtimePath) {
  $prior = Read-JsonFile $runtimePath
  $alive = @($prior.processes | Where-Object { Get-Process -Id ([int]$_.pid) -ErrorAction SilentlyContinue })
  if ($alive.Count -gt 0) { throw "El piloto ya está iniciado. Visita las URLs de este archivo: $runtimePath. Para detenerlo usa pnpm pilot:stop." }
  Remove-Item -LiteralPath $runtimePath -Force
}

$memberPort = Select-Port 5173 5180 'Hub de miembro'
$adminPort = Select-Port 5174 5190 'Admin'
$staffPort = Select-Port 5175 5200 'Trainer'
$trainerApiPort = Select-Port 8788 8798 'API Trainer'
$adminApiPort = Select-Port 8789 8808 'API Admin'
$memberApiPort = Select-Port 8810 8820 'API Miembro'
Ensure-LocalDatabase
$config = [ordered]@{
  databaseUrl = $databaseUrl
  memberUrl = "http://127.0.0.1:$memberPort"
  memberOrigin = "http://127.0.0.1:$memberPort"
  adminUrl = "http://127.0.0.1:$adminPort"
  staffUrl = "http://127.0.0.1:$staffPort"
  trainerApiUrl = "http://127.0.0.1:$trainerApiPort"
  adminApiUrl = "http://127.0.0.1:$adminApiPort"
  memberApiUrl = "http://127.0.0.1:$memberApiPort"
}
if ($OwnerReview) {
  $config.trainerUrl = "http://127.0.0.1:$staffPort"
  $config.staffUrl = $config.trainerUrl
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding utf8
$env:NODE_ENV = 'development'; $env:DATABASE_URL = $databaseUrl
Invoke-Checked 'pnpm' @('--filter','@2j/api','db:migrate') $repoRoot
Invoke-Checked 'pnpm' @('seed:demo') $repoRoot

$processes = @()
try {
  $serviceSpecs = @(
    @{ name = 'api-trainer'; port = $trainerApiPort },
    @{ name = 'api-admin'; port = $adminApiPort },
    @{ name = 'api-member'; port = $memberApiPort },
    @{ name = 'notification-worker'; port = 0 },
    @{ name = 'staff'; port = $staffPort },
    @{ name = 'admin'; port = $adminPort },
    @{ name = 'member'; port = $memberPort }
  )
  if ($OwnerReview) {
    $serviceSpecs = @(
      @{ name = 'api-trainer'; port = $trainerApiPort },
      @{ name = 'api-admin'; port = $adminApiPort },
      @{ name = 'api-member'; port = $memberApiPort },
      @{ name = 'notification-worker'; port = 0 },
      @{ name = 'trainer-review'; port = $staffPort },
      @{ name = 'admin'; port = $adminPort },
      @{ name = 'member'; port = $memberPort }
    )
  }
  foreach ($serviceSpec in $serviceSpecs) {
    $processes += Start-Service $serviceSpec.name $serviceSpec.port
    @{ processes = $processes; urls = $config; database = "127.0.0.1:$databasePort/2j_demo"; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $runtimePath -Encoding utf8
  }
  Wait-Http "$($config.trainerApiUrl)/health" 'API Trainer'
  Wait-Http "$($config.adminApiUrl)/health" 'API Admin'
  Wait-Http "$($config.memberApiUrl)/health" 'API Miembro'
  if ($OwnerReview) { Wait-Http $config.trainerUrl 'Vista Trainer' } else { Wait-Http $config.staffUrl 'Vista Staff' }
  Wait-Http $config.adminUrl 'Vista Admin'
  Wait-Http $config.memberUrl 'Inicio de sesión de miembro'
} catch {
  Stop-Pilot
  throw
}

Write-Host ''
Write-Host 'Piloto local 2J listo. Todas las direcciones están limitadas a 127.0.0.1.' -ForegroundColor Green
Write-Host '  MEMBER · misma app, navegar con las pestañas inferiores:' -ForegroundColor Cyan
Write-Host "    Inicio / Reservar / Próxima reserva / Tienda / Perfil / Búnker / Ajustes: $($config.memberUrl)"
Write-Host '    Miembro sintético: María González · código local: 2j-member-a-local'
Write-Host "  Vista previa sintética:    $($config.memberUrl)/?preview=1"
if ($OwnerReview) {
  Write-Host '  TRAINER · abrir una sección desde el menú:' -ForegroundColor Cyan
  Write-Host "    Resumen: $($config.trainerUrl)/#home"
  Write-Host "    Clientes: $($config.trainerUrl)/#clients"
  Write-Host "    Agenda: $($config.trainerUrl)/#calendar"
  Write-Host "    Espacios y servicios: $($config.trainerUrl)/#services"
  Write-Host '  ADMIN · abrir una sección desde el menú:' -ForegroundColor Cyan
  Write-Host "    Resumen: $($config.adminUrl)/#home"
  Write-Host "    Clientes: $($config.adminUrl)/#clients"
  Write-Host "    Cliente 360 · María González: $($config.adminUrl)/#clients?clientId=d0700000-0000-4000-8000-000000000001"
  Write-Host "    Agenda: $($config.adminUrl)/#calendar"
  Write-Host "    Tienda: $($config.adminUrl)/#store"
  Write-Host "    Espacios y servicios: $($config.adminUrl)/#services"
} else {
  Write-Host "  Trainer:                   $($config.staffUrl)"
  Write-Host "  Admin:                     $($config.adminUrl)"
}
Write-Host "  API Trainer:               $($config.trainerApiUrl)/health"
Write-Host "  API Admin:                 $($config.adminApiUrl)/health"
Write-Host "  PostgreSQL sintético:      127.0.0.1:$databasePort/2j_demo"
Write-Host "  Logs:                      $pilotHome\logs"
if ($OwnerReview) { Write-Host 'Para detener las siete aplicaciones/APIs de revisión: pnpm owner:review:stop (la base y sus datos sintéticos se conservan).' } else { Write-Host 'Para detener los siete procesos: pnpm pilot:stop (la base y sus datos sintéticos se conservan).' }
