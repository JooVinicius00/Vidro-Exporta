@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22.13 ou superior para executar o Vidro Exporta.
  pause
  exit /b 1
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if errorlevel 1 (
  echo Atualize o Node.js para a versao 22.13 ou superior.
  pause
  exit /b 1
)
echo Iniciando o Vidro Exporta...
echo Abra http://127.0.0.1:3000 no navegador.
echo Para encerrar, pressione Ctrl+C.
node backend/server.js
pause
