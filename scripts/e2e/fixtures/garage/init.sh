#!/bin/sh
# Garage 初始化（LD-02，宿主侧驱动：dxflrs/garage 为无 shell 镜像）。
# 幂等：布局/桶重复执行无害；密钥存在则沿用 keys.env。
set -eu
cd "$(dirname "$0")/../../../.."
CFG="/etc/garage/garage.toml"
g() { docker compose exec -T garage /garage -c "$CFG" "$@" 2>&1 | grep -v " INFO "; }

if [ -f scripts/e2e/fixtures/garage/keys.env ] && grep -q GK scripts/e2e/fixtures/garage/keys.env; then
  echo "garage 已初始化（keys.env 存在）"
  exit 0
fi

NODE=$(g status | grep -oE '^[0-9a-f]{16}' | head -1)
[ -n "$NODE" ] || { echo "无法解析节点 id；先 docker compose --profile attachments up -d garage"; exit 1; }
g layout assign "$NODE" --zone dc1 --capacity 1G >/dev/null
g layout apply --version 1 >/dev/null
g bucket create starter-attachments >/dev/null 2>&1 || true
OUT=$(g key create starter-laravel)
KEY=$(echo "$OUT" | grep -oE 'GK[0-9a-f]+' | head -1)
SECRET=$(echo "$OUT" | grep -oE '[0-9a-f]{64}' | head -1)
[ -n "$KEY" ] && [ -n "$SECRET" ] || { echo "key create 解析失败"; exit 1; }
g bucket allow --read --write starter-attachments --key "$KEY" >/dev/null
printf "ATTACHMENT_S3_KEY=%s\nATTACHMENT_S3_SECRET=%s\n" "$KEY" "$SECRET" > scripts/e2e/fixtures/garage/keys.env
echo "garage 就绪：bucket=starter-attachments key=$KEY"
