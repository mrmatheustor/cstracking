# Testa se o servidor recebe GSI (simula o CS2)
# Uso: .\scripts\test-gsi.ps1

$Token = "586deedbb9f34436bee3a8f67dc9e775"
$Uri = "http://127.0.0.1:3000/api/gsi/live/$Token"
$Body = @{
  map = @{
    name = "de_dust2"
    phase = "live"
    mode = "deathmatch"
  }
  player = @{
    name = "TesteManual"
    match_stats = @{
      kills = 5
      deaths = 2
      assists = 1
      score = 100
    }
  }
} | ConvertTo-Json -Depth 5

Write-Host "Enviando POST para $Uri"
Write-Host "Olhe o terminal do npm run dev - deve aparecer [GSI] POST recebido"
Write-Host ""

try {
  $r = Invoke-RestMethod -Uri $Uri -Method POST -Body $Body -ContentType "application/json"
  Write-Host "Resposta:" ($r | ConvertTo-Json)
  Write-Host ""
  Write-Host "OK: Servidor funciona. Se o CS2 nao mostra [GSI], o jogo nao le o .cfg."
} catch {
  Write-Host "ERRO: Servidor nao respondeu. Rode npm run dev"
  Write-Host $_.Exception.Message
}
