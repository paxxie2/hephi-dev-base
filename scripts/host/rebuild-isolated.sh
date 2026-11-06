#!/bin/sh
# P7 专用测试宿主：从模板实例复制配置到新的隔离实例目录，改写路径与端口，并校验不重叠。
# 只做本机可验证的脚手架；干净机器重建、真实端到端和独立操作者仍需人工执行。
# 路径/端口改写自动适配 BSD（macOS）与 GNU（Linux）sed。
# 用法：./scripts/host/rebuild-isolated.sh --template <实例目录> --target <新目录> --port <端口> [--profile <名>]
set -eu

usage() {
  echo "usage: $0 --template <dir> --target <dir> --port <n> [--profile <name>]" >&2
  exit 2
}

template=""
target=""
port=""
profile="experiment"
while [ $# -gt 0 ]; do
  case "$1" in
    --template) [ $# -ge 2 ] || usage; template="$2"; shift 2 ;;
    --target) [ $# -ge 2 ] || usage; target="$2"; shift 2 ;;
    --port) [ $# -ge 2 ] || usage; port="$2"; shift 2 ;;
    --profile) [ $# -ge 2 ] || usage; profile="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[ -n "$template" ] && [ -n "$target" ] && [ -n "$port" ] || usage
[ -d "$template" ] || { echo "模板实例不存在：$template" >&2; exit 2; }
[ -e "$target" ] && { echo "目标已存在，拒绝覆盖：$target" >&2; exit 2; }
case "$port" in ''|*[!0-9]*) echo "端口必须是数字：$port" >&2; exit 2 ;; esac

template_abs=$(cd "$template" && pwd)
case "$target" in /*) target_abs="$target" ;; *) target_abs="$(pwd)/$target" ;; esac
case "$target_abs" in
  "$template_abs"|"$template_abs"/*) echo "目标不能位于模板实例内" >&2; exit 2 ;;
esac
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口已被占用：$port" >&2
  exit 2
fi

mkdir -p "$target_abs/dsh-home" "$target_abs/state" "$target_abs/work" "$target_abs/logs"
for file in start.sh prepare.sh; do
  if [ -f "$template/$file" ]; then
    cp -f "$template/$file" "$target_abs/$file"
    chmod +x "$target_abs/$file"
  fi
done
if [ -d "$template/dsh-home/profiles/$profile" ]; then
  mkdir -p "$target_abs/dsh-home/profiles"
  cp -R "$template/dsh-home/profiles/$profile" "$target_abs/dsh-home/profiles/$profile"
fi

# BSD sed 需要 `-i ''`，GNU sed 需要 `-i`；用临时文件实现可移植改写。
edit_in_place() {
  file="$1"; shift
  sed "$@" "$file" > "$file.tmp.$$" && mv "$file.tmp.$$" "$file"
}

# 改写模板绝对路径为真实目标路径（BSD sed），并同步 profile 端口。
for file in "$target_abs/start.sh" "$target_abs/prepare.sh" "$target_abs/dsh-home/profiles/$profile/cordis.patch.yml" "$target_abs/dsh-home/profiles/$profile/package.json"; do
  [ -f "$file" ] || continue
  edit_in_place "$file" "s#${template_abs}#${target_abs}#g"
  case "$file" in
    */cordis.patch.yml) edit_in_place "$file" "s/port: [0-9][0-9]*/port: $port/" ;;
  esac
done

# 隔离自检：新目录里不得残留模板路径，端口必须是目标端口。
if grep -R "$template_abs" "$target_abs" >/dev/null 2>&1; then
  echo "自检失败：新实例仍引用模板路径 $template_abs" >&2
  exit 1
fi

echo "已创建隔离实例：${target_abs}（端口 ${port}，profile ${profile}）"
echo "仍需人工执行：安装/复制 DSH runtime，核对 prepare.sh 的仓库与检查配置，启动并做真实端到端。"
