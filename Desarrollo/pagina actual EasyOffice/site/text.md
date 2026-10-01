-- Para correr:
python -m http.server 8080 -d site

-- Para detener si cierras el CMD:
Get-NetTCPConnection -LocalPort 8080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }