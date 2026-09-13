#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NPB 順位表・対戦表システム
アクセスカウンター機能付き Webサーバー (server.py)

- 静的ファイル (HTML, JS, CSS, 画像等) を配信
- 本日のアクセス数 / 総アクセス数を SQLite に自動記録・集計
- 同一ユーザーの短時間連続リロードによる過剰カウントを防止 (クールダウン機能)
- ローカル実行およびクラウド (Render, Railway, Docker 等) の両環境に対応 (PORT環境変数対応)
"""

import os
import sys
import json
import sqlite3
import hashlib
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse

# タイムゾーン (日本標準時 JST: UTC+9)
JST = timezone(timedelta(hours=9))

# データベースファイルの保存先 (スクリプトと同じディレクトリ)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "access_stats.db")

# クールダウン秒数 (同一クライアントからのアクセスを連続カウントしない時間: 180秒 = 3分)
COOLDOWN_SECONDS = 180


def init_db():
    """SQLite データベースとテーブルの初期化"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 訪問ログテーブル (IPハッシュと訪問時刻)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS visit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date_str TEXT NOT NULL,
            client_hash TEXT NOT NULL,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_visit_date ON visit_logs (date_str)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_visit_hash ON visit_logs (client_hash, created_at)")

    # 日別サマリーテーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_counts (
            date_str TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()


def get_current_jst_date():
    """JST基準の現在日付文字列 (YYYY-MM-DD) を取得"""
    now = datetime.now(JST)
    return now.strftime("%Y-%m-%d"), now


def record_visit(client_ip, visitor_id, user_agent=""):
    """
    訪問を記録し、本日のアクセス数と総アクセス数を返す。
    短時間の連続アクセスは重複カウントを防ぐ。
    """
    today_str, now_dt = get_current_jst_date()
    
    # クライアント識別ハッシュ (IPアドレス + クライアントID)
    raw_ident = f"{client_ip}:{visitor_id}"
    client_hash = hashlib.sha256(raw_ident.encode("utf-8")).hexdigest()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    counted = False
    try:
        # 直近 COOLDOWN_SECONDS 秒以内の同一クライアントのアクセスをチェック
        threshold = (datetime.utcnow() - timedelta(seconds=COOLDOWN_SECONDS)).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            SELECT id FROM visit_logs
            WHERE client_hash = ? AND created_at > ?
            LIMIT 1
        """, (client_hash, threshold))
        
        recent_log = cursor.fetchone()
        
        if not recent_log:
            # カウント対象
            cursor.execute("""
                INSERT INTO visit_logs (date_str, client_hash, user_agent)
                VALUES (?, ?, ?)
            """, (today_str, client_hash, user_agent[:255] if user_agent else ""))
            
            cursor.execute("""
                INSERT INTO daily_counts (date_str, count)
                VALUES (?, 1)
                ON CONFLICT(date_str) DO UPDATE SET count = count + 1
            """, (today_str,))
            conn.commit()
            counted = True
            
        # 本日および全体の集計値を取得
        cursor.execute("SELECT count FROM daily_counts WHERE date_str = ?", (today_str,))
        row = cursor.fetchone()
        today_count = row[0] if row else 0
        
        cursor.execute("SELECT SUM(count) FROM daily_counts")
        row = cursor.fetchone()
        total_count = row[0] if row and row[0] is not None else 0
        
    except Exception as e:
        print(f"[ERROR] DB Error in record_visit: {e}", file=sys.stderr)
        today_count = 1
        total_count = 1
    finally:
        conn.close()
        
    return {
        "today": today_count,
        "total": total_count,
        "counted": counted
    }


def get_stats():
    """現在のアクセス数を取得 (カウントアップなし)"""
    today_str, _ = get_current_jst_date()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT count FROM daily_counts WHERE date_str = ?", (today_str,))
        row = cursor.fetchone()
        today_count = row[0] if row else 0
        
        cursor.execute("SELECT SUM(count) FROM daily_counts")
        row = cursor.fetchone()
        total_count = row[0] if row and row[0] is not None else 0
    except Exception as e:
        print(f"[ERROR] DB Error in get_stats: {e}", file=sys.stderr)
        today_count = 0
        total_count = 0
    finally:
        conn.close()
        
    return {
        "today": today_count,
        "total": total_count
    }


class NPBServerHandler(SimpleHTTPRequestHandler):
    """静的ファイル配信とアクセスカウンターAPIを処理するハンドラー"""

    def __init__(self, *args, **kwargs):
        # 配信ディレクトリをスクリプトと同じディレクトリに固定
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _get_client_ip(self):
        """プロキシ (Cloudflare, Render等) 経由のクライアント実IPアドレスを抽出"""
        # Cloudflare Tunnel / プロキシヘッダーを優先
        cf_ip = self.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = self.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        return self.client_address[0]

    def _send_json(self, data, status_code=200):
        """JSON レスポンスを送信 (CORSヘッダー付き)"""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """CORSプリフライトリクエストの処理"""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """GET リクエストのハンドリング"""
        parsed_url = urllib.parse.urlparse(self.path)
        
        # API: アクセス数取得 (カウントアップなし)
        if parsed_url.path == "/api/stats":
            stats = get_stats()
            self._send_json(stats)
            return
            
        # デフォルトの静的ファイル配信
        super().do_GET()

    def do_POST(self):
        """POST リクエストのハンドリング"""
        parsed_url = urllib.parse.urlparse(self.path)
        
        # API: 訪問カウントアップ & 最新数取得
        if parsed_url.path == "/api/stats/visit":
            content_length = int(self.headers.get("Content-Length", 0))
            payload = {}
            if content_length > 0:
                try:
                    post_data = self.rfile.read(content_length)
                    payload = json.loads(post_data.decode("utf-8"))
                except Exception:
                    payload = {}
            
            client_ip = self._get_client_ip()
            visitor_id = str(payload.get("visitor_id", "anonymous"))
            user_agent = self.headers.get("User-Agent", "")
            
            result = record_visit(client_ip, visitor_id, user_agent)
            self._send_json(result)
            return

        self.send_error(404, "Endpoint not found")

    def log_message(self, format, *args):
        """ログ出力を整形"""
        msg = format % args
        if "/api/stats" in msg:
            sys.stdout.write(f"[API] {msg}\n")
        else:
            sys.stdout.write(f"[HTTP] {msg}\n")
        sys.stdout.flush()


def run_server(port=8080):
    """サーバー起動"""
    init_db()
    
    server_address = ("", port)
    httpd = HTTPServer(server_address, NPBServerHandler)
    
    print("=" * 60)
    print("  NPB 順位表システム サーバーが起動しました")
    print("=" * 60)
    print(f"  ローカルURL: http://localhost:{port}")
    print(f"  データベース: {DB_PATH}")
    print("  アクセスカウンターAPI: /api/stats (GET), /api/stats/visit (POST)")
    print("=" * 60)
    print("サーバーを終了するには [Ctrl + C] を押してください。\n")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しています...")
    finally:
        httpd.server_close()
        print("サーバーが停止しました。")


if __name__ == "__main__":
    env_port = os.environ.get("PORT")
    port = int(env_port) if env_port and env_port.isdigit() else 8080
    run_server(port)
