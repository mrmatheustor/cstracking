# Instala gamestate_integration_cstracking.cfg na pasta cfg do CS2
#
# Uso:
#   .\scripts\install-gsi-cfg.ps1 -Email "seu@email.com"
#   .\scripts\install-gsi-cfg.ps1 -Token "seu_gsi_token"
#   npm run install:gsi
#
# Parametros:
#   -Email     Busca gsi_token no banco local (data/cstracking.db)
#   -Token     Token GSI manual (ignora -Email)
#   -Port      Porta do servidor (padrao 3000)
#   -Cs2CfgPath Caminho completo da pasta cfg do CS2 (pula busca automatica)

param(
  [string]$Email = "",
  [string]$Token = "",
  [int]$Port = 3000,
  [string]$Cs2CfgPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$DbPath = Join-Path $ProjectRoot "data\cstracking.db"
$CfgFileName = "gamestate_integration_cstracking.cfg"

function Get-SteamLibraryPaths {
  $libraries = [System.Collections.Generic.List[string]]::new()
  $steamRoots = @(
    "${env:ProgramFiles(x86)}\Steam",
    "C:\Program Files (x86)\Steam",
    "D:\Steam",
    "D:\SteamLibrary"
  )

  foreach ($root in $steamRoots) {
    if (-not (Test-Path $root)) { continue }
    $libraries.Add($root.TrimEnd('\'))

    $vdf = Join-Path $root "steamapps\libraryfolders.vdf"
    if (Test-Path $vdf) {
      $content = Get-Content $vdf -Raw -ErrorAction SilentlyContinue
      if ($content) {
        $matches = [regex]::Matches($content, '"path"\s+"([^"]+)"')
        foreach ($m in $matches) {
          $p = $m.Groups[1].Value -replace '\\\\', '\'
          if ((Test-Path $p) -and -not $libraries.Contains($p)) {
            $libraries.Add($p)
          }
        }
      }
    }
  }

  foreach ($drive in @("C", "D", "E", "F")) {
    $sl = "${drive}:\SteamLibrary"
    if ((Test-Path $sl) -and -not $libraries.Contains($sl)) {
      $libraries.Add($sl)
    }
  }

  return $libraries
}

function Get-Cs2CfgFolders {
  $folders = [System.Collections.Generic.List[string]]::new()
  $rel = "steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg"

  foreach ($lib in (Get-SteamLibraryPaths)) {
    $cfg = Join-Path $lib $rel
    if (Test-Path $cfg) {
      $folders.Add($cfg)
    }
  }

  return $folders | Select-Object -Unique
}

function Get-GsiTokenFromDb {
  param([string]$UserEmail)

  if (-not (Test-Path $DbPath)) {
    throw "Banco nao encontrado: $DbPath. Cadastre-se no app antes."
  }

  $helper = Join-Path $ProjectRoot "scripts\get-gsi-token.js"
  Push-Location $ProjectRoot
  try {
    $out = node $helper $DbPath $UserEmail 2>&1
    if ($LASTEXITCODE -eq 2) {
      throw "E-mail nao encontrado: $UserEmail"
    }
    if ($LASTEXITCODE -ne 0) {
      throw ($out -join "`n")
    }
    return ($out | ConvertFrom-Json)
  } finally {
    Pop-Location
  }
}

function New-GsiCfgContent {
  param([string]$GsiToken, [int]$ServerPort)

  $uri = "http://127.0.0.1:$ServerPort/api/gsi/live/$GsiToken"

  return @"
"CS2 Tracking"
{
    "uri" "$uri"
    "timeout" "5.0"
    "buffer"  "0.1"
    "throttle" "0.1"
    "heartbeat" "30.0"
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "round"         "1"
        "player_id"     "1"
        "player_state"  "1"
        "player_match_stats" "1"
        "allplayers_id" "1"
        "allplayers_state" "1"
        "allplayers_match_stats" "1"
    }
}
"@
}

Write-Host ""
Write-Host "=== CS2 Tracking - Instalar GSI ===" -ForegroundColor Cyan
Write-Host ""

# Resolver token
$userRow = $null
if ($Token) {
  $gsiToken = $Token.Trim()
  Write-Host "Token informado manualmente."
} elseif ($Email) {
  $userRow = Get-GsiTokenFromDb -UserEmail $Email.Trim().ToLower()
  $gsiToken = $userRow.gsi_token
  Write-Host "Conta: $($userRow.username) ($Email)"
} else {
  $Email = Read-Host "E-mail cadastrado no CS2 Tracking"
  if (-not $Email) { throw "Informe -Email ou -Token" }
  $userRow = Get-GsiTokenFromDb -UserEmail $Email.Trim().ToLower()
  $gsiToken = $userRow.gsi_token
  Write-Host "Conta: $($userRow.username)"
}

if (-not $gsiToken) { throw "Token GSI vazio" }

# Resolver pasta cfg
$targetCfg = $null
if ($Cs2CfgPath) {
  $targetCfg = $Cs2CfgPath.TrimEnd('\')
  if (-not (Test-Path $targetCfg)) {
    throw "Pasta nao existe: $targetCfg"
  }
} else {
  $found = @(Get-Cs2CfgFolders)
  if ($found.Count -eq 0) {
    throw @"
CS2 nao encontrado automaticamente.

Use o caminho manual:
  .\scripts\install-gsi-cfg.ps1 -Email `"seu@email.com`" -Cs2CfgPath `"D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg`"

Ou no Steam: CS2 -> Gerenciar -> Arquivos locais -> Procurar -> game\csgo\cfg
"@
  }
  if ($found.Count -eq 1) {
    $targetCfg = $found[0]
  } else {
    Write-Host "Varias instalacoes do CS2 encontradas:"
    for ($i = 0; $i -lt $found.Count; $i++) {
      Write-Host "  [$i] $($found[$i])"
    }
    $pick = Read-Host "Escolha o numero"
    $targetCfg = $found[[int]$pick]
  }
}

$destFile = Join-Path $targetCfg $CfgFileName
$content = New-GsiCfgContent -GsiToken $gsiToken -ServerPort $Port

if (Test-Path $destFile) {
  $backup = "$destFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $destFile $backup -Force
  Write-Host "Backup: $backup" -ForegroundColor Yellow
}

Set-Content -Path $destFile -Value $content -Encoding ASCII -NoNewline
# Garantir newline final
Add-Content -Path $destFile -Value "" -Encoding ASCII

Write-Host ""
Write-Host "Arquivo instalado:" -ForegroundColor Green
Write-Host "  $destFile"
Write-Host ""
Write-Host "URI: http://127.0.0.1:$Port/api/gsi/live/$gsiToken"
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. Feche o CS2 completamente e abra de novo"
Write-Host "  2. Rode: npm run dev"
Write-Host "  3. Entre numa partida e veja [GSI] no terminal do servidor"
Write-Host ""
