#!/usr/bin/env bash
# Ускоряет интерфейс Android TV / Google TV, меняя масштаб анимаций через ADB.
# Использование: tv-speedup.sh <IP-телевизора> [fast|off|reset]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Использование: $0 <IP-телевизора> [fast|off|reset]" >&2
  exit 1
fi

command -v adb >/dev/null || { echo "Не найден adb. Установите Android Platform Tools." >&2; exit 1; }

ip="$1"
mode="${2:-fast}"
case "$mode" in
  fast)  scale=0.5 ;;
  off)   scale=0 ;;
  reset) scale=1 ;;
  *) echo "Неизвестный режим: $mode (fast|off|reset)" >&2; exit 1 ;;
esac

target="$ip"
[[ "$target" == *:* ]] || target="$target:5555"

echo "Подключаюсь к $target (подтвердите запрос на экране ТВ)..."
adb connect "$target"
adb -s "$target" wait-for-device

for key in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb -s "$target" shell settings put global "$key" "$scale"
  printf '  %-28s = %s\n' "$key" "$(adb -s "$target" shell settings get global "$key" | tr -d '\r')"
done

echo "Готово: масштаб анимаций = ${scale}x"
