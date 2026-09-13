@echo off
chcp 65001 > nul
title NPB 順位表システム 【ワンクリックWeb公開】
cd /d "%~dp0"

echo ========================================================
echo   NPB 順位表・対戦表システム Web公開プログラム
echo ========================================================
echo.
echo インターネット公開URLを発行し、サーバーを起動しています...
echo.

python tunnel.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [エラー] 起動に失敗しました。Pythonが正しくインストールされているか確認してください。
    pause
)
