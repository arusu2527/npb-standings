# Python 3.10 軽量イメージ
FROM python:3.10-slim

WORKDIR /app

# ファイル一式をコピー
COPY . /app

# ポート環境変数 (Render/Railway等の規定値または8080)
ENV PORT=8080

EXPOSE 8080

# サーバー起動
CMD ["python", "server.py"]
