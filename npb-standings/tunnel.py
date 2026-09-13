#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NPB 順位表・対戦表システム
ワンクリック公開スクリプト (tunnel.py)

- バックエンドサーバー (server.py) を自動起動
- 無料・登録不要の Cloudflare Quick Tunnel を使って世界中からアクセス可能な公開URL (https://*.trycloudflare.com) を即時発行
- ブラウザを自動で開く
- コマンドプロンプトに公開URLとQRコードを表示
"""

import os
import sys
import time
import re
import urllib.request
import subprocess
import threading
import webbrowser
import platform

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLOUDFLARED_EXE = os.path.join(BASE_DIR, "cloudflared.exe")
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
PORT = 8080


def print_banner():
    print("=" * 68)
    print("      ⚾ NPB 順位表・対戦表システム Web公開プログラム ⚾")
    print("=" * 68)


def ensure_cloudflared():
    """cloudflared.exe が存在しない場合は自動ダウンロード"""
    # PATHにあればそれを使う
    try:
        res = subprocess.run(["cloudflared", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode == 0:
            return "cloudflared"
    except Exception:
        pass

    if os.path.exists(CLOUDFLARED_EXE):
        return CLOUDFLARED_EXE

    print("\n[準備] 公開用トンネルツール (Cloudflare Quick Tunnel) をダウンロードしています...")
    print("       ※ 初回のみダウンロード（約30MB・登録不要・公式ツール）が行われます。")
    try:
        def reporthook(count, block_size, total_size):
            if total_size > 0:
                percent = int(count * block_size * 100 / total_size)
                percent = min(100, percent)
                sys.stdout.write(f"\r       ダウンロード進捗: {percent}% [={'=' * (percent // 5)}>")
                sys.stdout.flush()

        urllib.request.urlretrieve(CLOUDFLARED_URL, CLOUDFLARED_EXE, reporthook)
        print("\n[準備] ダウンロードが完了しました！\n")
        return CLOUDFLARED_EXE
    except Exception as e:
        print(f"\n[警告] 自動ダウンロードに失敗しました: {e}")
        print("       ローカルサーバーのみ起動します。")
        return None


def run_local_server():
    """server.py をインポートして別スレッドで実行"""
    import server
    server.run_server(PORT)


def print_qr_code(url):
    """コンソールに簡易QRコードを表示 (qr-image または ascii)"""
    try:
        # qrencodeライブラリがなくてもコンソールで見れるよう、QRコード画像生成APIの短縮案内も併記
        encoded_url = urllib.parse.quote(url)
        qr_image_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={encoded_url}"
        print(f"  📱 スマホ読み取り用QR画像: {qr_image_url}")
    except Exception:
        pass


def main():
    print_banner()
    
    # 1. バックエンドサーバー (server.py) をバックグラウンドスレッドで起動
    print("[1/3] ローカルWebサーバーを起動中 (ポート 8080)...")
    server_thread = threading.Thread(target=run_local_server, daemon=True)
    server_thread.start()
    time.sleep(1.0)  # サーバー起動待ち

    # 2. cloudflared の準備
    print("[2/3] 公開用トンネルの接続を準備中...")
    cloudflared_path = ensure_cloudflared()

    tunnel_url = None
    tunnel_proc = None

    if cloudflared_path:
        print("[3/3] 世界中に公開できる専用URL (HTTPS) を発行しています...")
        cmd = [cloudflared_path, "tunnel", "--url", f"http://localhost:{PORT}"]
        try:
            tunnel_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace"
            )

            # ログから trycloudflare.com のURLを検索
            url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
            start_time = time.time()

            while time.time() - start_time < 30:
                line = tunnel_proc.stdout.readline()
                if not line:
                    if tunnel_proc.poll() is not None:
                        break
                    time.sleep(0.1)
                    continue

                match = url_pattern.search(line)
                if match:
                    tunnel_url = match.group(0)
                    break

        except Exception as e:
            print(f"[エラー] トンネル起動に失敗しました: {e}")

    # 3. 結果表示
    print("\n" + "=" * 68)
    if tunnel_url:
        print("  🎉 Web公開が完了しました！世界中誰でもアクセスできます！")
        print("=" * 68)
        print(f"\n  🌐 公開URL (スマホ・友達への共有用):")
        print(f"     👉  \033[1;32m{tunnel_url}\033[0m")
        print(f"\n  💻 あなたのPC用 (ローカル):")
        print(f"     👉  http://localhost:{PORT}")
        print("\n" + "-" * 68)
        print_qr_code(tunnel_url)
        print("-" * 68)
        print("\n  ※ この黒い画面を閉じるとWeb公開が終了します。")
        print("     公開中は画面を最小化しておいてください。")
        print("  ※ 終了するには [Ctrl + C] を押してください。")
        print("=" * 68 + "\n")

        # ブラウザで開く
        try:
            webbrowser.open(tunnel_url)
        except Exception:
            webbrowser.open(f"http://localhost:{PORT}")
    else:
        print("  ℹ️ ローカルサーバーモードで起動しました。")
        print("=" * 68)
        print(f"  👉 http://localhost:{PORT}")
        print("=" * 68 + "\n")
        webbrowser.open(f"http://localhost:{PORT}")

    # 終了待機
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n公開サーバーを安全に終了しています...")
        if tunnel_proc:
            tunnel_proc.terminate()
        sys.exit(0)


if __name__ == "__main__":
    main()
