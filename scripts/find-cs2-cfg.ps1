# Localiza onde colocar o .cfg do GSI no CS2
Write-Host "Procurando instalacoes do CS2..."
Write-Host ""

$drives = @("C", "D", "E", "F")
$paths = @(
  "SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg",
  "Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg"
)

foreach ($d in $drives) {
  foreach ($p in $paths) {
    $cfgDir = Join-Path "${d}:\" $p
    if (Test-Path $cfgDir) {
      Write-Host "[OK] Pasta cfg do CS2:"
      Write-Host "     $cfgDir"
      Write-Host "     Coloque aqui: gamestate_integration_cstracking.cfg"
      Get-ChildItem $cfgDir -Filter "*cstracking*.cfg" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "     (encontrado) $($_.Name)"
      }
      Write-Host ""
    }
  }
}

Write-Host "Confirme no Steam: CS2 -> Gerenciar -> Arquivos locais -> Procurar pasta do jogo -> game\csgo\cfg"
