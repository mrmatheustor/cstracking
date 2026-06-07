const { buildGsiCfgContent } = require('./gsiConfig');

const CFG_NAME = 'gamestate_integration_cstracking.cfg';

function buildInstallerPs1(gsiToken, baseUrl, authToken) {
  const cfgContent = buildGsiCfgContent(gsiToken, baseUrl, authToken);
  const cfgEscaped = cfgContent.replace(/'/g, "''");

  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$CfgName = '${CFG_NAME}'`,
    "$CfgBody = @'",
    cfgEscaped,
    "'@",
    '',
    'function Get-SteamLibraries {',
    '  $libs = [System.Collections.Generic.List[string]]::new()',
    '  $roots = @()',
    "  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'Steam') }",
    '  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Steam") }',
    "  $roots += @('C:\\Program Files (x86)\\Steam','D:\\Steam','D:\\SteamLibrary')",
    '  foreach ($root in $roots) {',
    '    if (-not $root -or -not (Test-Path $root)) { continue }',
    "    $r = $root.TrimEnd('\\')",
    '    if (-not $libs.Contains($r)) { $libs.Add($r) | Out-Null }',
    "    $vdf = Join-Path $r 'steamapps\\libraryfolders.vdf'",
    '    if (Test-Path $vdf) {',
    '      $raw = Get-Content $vdf -Raw -ErrorAction SilentlyContinue',
    '      if ($raw) {',
    `        [regex]::Matches($raw, '"path"\\s+"([^"]+)"') | ForEach-Object {`,
    "          $p = $_.Groups[1].Value -replace '\\\\\\\\', '\\'",
    '          if ((Test-Path $p) -and -not $libs.Contains($p)) { $libs.Add($p) | Out-Null }',
    '        }',
    '      }',
    '    }',
    '  }',
    "  foreach ($d in @('C','D','E','F')) {",
    "    $sl = $d + ':\\SteamLibrary'",
    '    if ((Test-Path $sl) -and -not $libs.Contains($sl)) { $libs.Add($sl) | Out-Null }',
    '  }',
    '  return $libs',
    '}',
    '',
    "$rel = 'steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg'",
    '$folders = [System.Collections.Generic.List[string]]::new()',
    'foreach ($lib in (Get-SteamLibraries)) {',
    '  $cfg = Join-Path $lib $rel',
    '  if (Test-Path $cfg) { $folders.Add($cfg) | Out-Null }',
    '}',
    '',
    'if ($folders.Count -eq 0) {',
    "  Write-Host ''",
    "  Write-Host 'CS2 nao encontrado. Instale o jogo pela Steam.' -ForegroundColor Red",
    "  Read-Host 'Pressione Enter para fechar'",
    '  exit 1',
    '}',
    '',
    '$target = $null',
    'if ($folders.Count -eq 1) {',
    '  $target = $folders[0]',
    '} else {',
    "  Write-Host ''",
    "  Write-Host 'Varias pastas do CS2 encontradas:'",
    '  for ($i = 0; $i -lt $folders.Count; $i++) { Write-Host ("  [" + $i + "] " + $folders[$i]) }',
    "  $pick = Read-Host 'Escolha o numero'",
    '  $target = $folders[[int]$pick]',
    '}',
    '',
    '$dest = Join-Path $target $CfgName',
    'if (Test-Path $dest) {',
    "  $bak = $dest + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')",
    '  Copy-Item $dest $bak -Force',
    "  Write-Host 'Backup:' $bak -ForegroundColor Yellow",
    '}',
    '',
    'Set-Content -Path $dest -Value $CfgBody -Encoding ASCII',
    "Write-Host ''",
    "Write-Host 'GSI instalado com sucesso!' -ForegroundColor Green",
    'Write-Host $dest',
    "Write-Host ''",
    "Write-Host 'Proximos passos:' -ForegroundColor Cyan",
    "Write-Host '  1. Feche o CS2 completamente e abra de novo'",
    "Write-Host '  2. Mantenha o CS2 Tracking rodando neste PC ou use o site online'",
    "Write-Host '  3. Entre em uma partida'",
    "Read-Host 'Pressione Enter para fechar'",
  ];

  return lines.join('\n');
}

function buildInstallerBat(gsiToken, baseUrl, authToken) {
  const ps1 = buildInstallerPs1(gsiToken, baseUrl, authToken);
  const encoded = Buffer.from(ps1, 'utf16le').toString('base64');

  return [
    '@echo off',
    'chcp 65001 >nul',
    'title CS2 Tracking - Instalar GSI',
    'echo.',
    'echo   CS2 Tracking - Instalador GSI',
    'echo   Nao compartilhe este arquivo (contem seu token).',
    'echo.',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    'if errorlevel 1 (',
    '  echo.',
    '  echo Falha na instalacao. Tente clicar com botao direito - Executar como administrador.',
    '  pause',
    ')',
    '',
  ].join('\r\n');
}

module.exports = { CFG_NAME, buildInstallerPs1, buildInstallerBat };
