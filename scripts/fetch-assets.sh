#!/usr/bin/env bash
# Скачивает все 3D-ассеты (CC0) в vendor/. Tier A обязателен, Tier B — best-effort.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"  # корень репо — музыка пишется в public/, остальное в vendor/
mkdir -p vendor
cd vendor

FAIL=0
warn() { echo "WARN: $*" >&2; }

# ---------- Tier A: KayKit (GitHub, git clone) ----------
KAYKIT_REPOS=(
  KayKit-Character-Pack-Adventures-1.0
  KayKit-Character-Pack-Skeletons-1.0
  KayKit-Dungeon-Remastered-1.0
  KayKit-Medieval-Hexagon-Pack-1.0
)
for repo in "${KAYKIT_REPOS[@]}"; do
  if [ -d "$repo/.git" ] || [ -d "$repo" ]; then
    echo "OK (cached): $repo"
  else
    echo "Cloning $repo ..."
    git clone --quiet --depth 1 "https://github.com/KayKit-Game-Assets/$repo.git" \
      || { warn "clone $repo failed"; FAIL=1; }
  fi
done

# ---------- Tier A: Kenney (zip-URL греппится из HTML страницы — хэши волатильны) ----------
fetch_kenney() {
  local slug="$1"
  local dir="kenney_$slug"
  if [ -d "$dir" ]; then echo "OK (cached): $dir"; return 0; fi
  local url
  url=$(curl -sL "https://kenney.nl/assets/$slug" \
    | grep -oE 'https://kenney\.nl/media/pages/assets/[^"]+\.zip' | head -1)
  if [ -z "$url" ]; then warn "kenney $slug: zip url not found in page"; FAIL=1; return 1; fi
  echo "Downloading $slug from $url"
  curl -sL "$url" -o "$dir.zip" && mkdir -p "$dir" && unzip -q -o "$dir.zip" -d "$dir" && rm -f "$dir.zip" \
    || { warn "kenney $slug download/unzip failed"; FAIL=1; }
}
fetch_kenney fantasy-town-kit
fetch_kenney nature-kit
fetch_kenney survival-kit
fetch_kenney rpg-audio
fetch_kenney impact-sounds
fetch_kenney interface-sounds

# ---------- Tier A: Poly Haven (прямые CDN-ссылки) ----------
mkdir -p polyhaven
ph() { # ph <outfile> <url>
  if [ -s "polyhaven/$1" ]; then echo "OK (cached): polyhaven/$1"; return 0; fi
  curl -sL "$2" -o "polyhaven/$1" || { warn "polyhaven $1 failed"; FAIL=1; }
}
ph sky_day_2k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr"
for map in diff nor_gl rough; do
  ph "grass_${map}_1k.jpg" "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_grass_rock/aerial_grass_rock_${map}_1k.jpg"
  ph "dirt_${map}_1k.jpg"  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_leaves_01/brown_mud_leaves_01_${map}_1k.jpg"
  ph "rock_${map}_1k.jpg"  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_02/aerial_rocks_02_${map}_1k.jpg"
done

# ---------- Tier A: телега-корован (poly.pizza CDN, проверенный прямой URL) ----------
mkdir -p polypizza
if [ ! -s polypizza/cart.glb ]; then
  curl -sL "https://static.poly.pizza/94b32c91-4d46-4172-aadd-10176a4eb543.glb" -o polypizza/cart.glb \
    || { warn "cart.glb failed"; FAIL=1; }
else echo "OK (cached): polypizza/cart.glb"; fi

# ---------- Tier B (необязательно): Quaternius с Google Drive через gdown ----------
GDOWN=""
if command -v gdown >/dev/null 2>&1; then GDOWN="gdown";
elif python3 -m gdown --help >/dev/null 2>&1; then GDOWN="python3 -m gdown";
else
  echo "gdown not found, attempting pip install (best-effort)..."
  python3 -m pip install --user --quiet gdown 2>/dev/null \
    || python3 -m pip install --user --quiet --break-system-packages gdown 2>/dev/null \
    || warn "could not install gdown — Tier B (животные, лук) будет пропущен"
  if python3 -m gdown --help >/dev/null 2>&1; then GDOWN="python3 -m gdown"; fi
fi

if [ -n "$GDOWN" ]; then
  if [ ! -d quaternius_animals ]; then
    echo "Downloading Quaternius Ultimate Animated Animal Pack (Drive)..."
    $GDOWN --quiet --folder "https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk" -O quaternius_animals \
      || warn "Tier B: animals folder failed (quota/auth?) — fallback: scripts/fetch-polypizza.mjs"
  fi
  if [ ! -d quaternius_weapons ]; then
    echo "Downloading Quaternius Medieval Weapons (Drive)..."
    $GDOWN --quiet --folder "https://drive.google.com/drive/folders/1Z6vYiQxY8W73FXuMWzaTQAg9rzbumnOr" -O quaternius_weapons \
      || warn "Tier B: weapons folder failed — у эльфа будет арбалет KayKit"
  fi
else
  warn "Tier B пропущен (нет gdown). Фоллбэк: node scripts/fetch-polypizza.mjs"
fi

# ---------- Музыка: записанные CC0-треки RandomMind (OpenGameArt) ----------
# Живой средневековый фон вместо синтеза (игрок забраковал и осциллятор, и
# Карплус-Стронг). Все три — автор RandomMind, лицензия СТРОГО CC0 (Public
# Domain), «credits appreciated but not required». Проверено на страницах файлов:
#   explore.ogg  ← The Bard's Tale  (лютня+флейта, мирное исследование)
#                  https://opengameart.org/content/medieval-the-bards-tale
#                  файл: https://opengameart.org/sites/default/files/The_Bards_Tale.mp3
#   raid.ogg     ← Medieval: Battle (напряжённая боевая, набег)
#                  https://opengameart.org/content/medieval-battle
#                  файл: https://opengameart.org/sites/default/files/battle_8.mp3
#   menu.ogg     ← The Old Tower Inn (спокойная тема меню)
#                  https://opengameart.org/content/medieval-the-old-tower-inn
#                  файл: https://opengameart.org/sites/default/files/The_Old_Tower_Inn.mp3
# Готовые .ogg уже лежат в public/assets/music/ и коммитятся в репо (public НЕ в
# .gitignore). Этот блок лишь ПЕРЕсобирает их при необходимости: качает MP3 с OGA
# и перекодирует в OGG Vorbis 112k моно/стерео (суммарно ~4.9 МБ ≤ 8 МБ).
# Требует ffmpeg; если его нет — пропускаем (файлы и так в репо).
fetch_music() {
  local out="$1" src="$2"
  local dst="$ROOT/public/assets/music/$out"
  if [ -s "$dst" ]; then echo "OK (cached): public/assets/music/$out"; return 0; fi
  if ! command -v ffmpeg >/dev/null 2>&1; then
    warn "ffmpeg отсутствует — пропускаю music/$out (используется версия из репо)"; return 0
  fi
  local tmp; tmp=$(mktemp -t korovany_music).mp3
  curl -sL -A "Mozilla/5.0" "$src" -o "$tmp" \
    && ffmpeg -hide_banner -loglevel error -y -i "$tmp" -map_metadata -1 \
         -c:a libvorbis -b:a 112k -ar 44100 "$dst" \
    || { warn "music $out download/encode failed"; FAIL=1; }
  rm -f "$tmp"
}
mkdir -p "$ROOT/public/assets/music"
fetch_music explore.ogg "https://opengameart.org/sites/default/files/The_Bards_Tale.mp3"
fetch_music raid.ogg    "https://opengameart.org/sites/default/files/battle_8.mp3"
fetch_music menu.ogg    "https://opengameart.org/sites/default/files/The_Old_Tower_Inn.mp3"

# ---------- Шрифты меню/паузы: Forum + Philosopher (Google Fonts, OFL) ----------
# Декоративный заголовок «КОРОВАНЫ» и текст меню. ОБА шрифта — лицензия SIL Open
# Font License 1.1 (OFL), с поддержкой КИРИЛЛИЦЫ, из репозитория google/fonts:
#   Forum        ← автор Denis Masharov; ofl/forum/Forum-Regular.ttf
#                  https://github.com/google/fonts/tree/main/ofl/forum  (OFL.txt там же)
#   Philosopher  ← The Philosopher Project Authors; ofl/philosopher/Philosopher-{Regular,Bold}.ttf
#                  https://github.com/google/fonts/tree/main/ofl/philosopher  (OFL.txt там же)
# Готовые .woff2 уже лежат в public/assets/fonts/ и коммитятся в репо. Этот блок
# лишь ПЕРЕсобирает их при необходимости: качает TTF из google/fonts, сабсетит до
# Latin+Cyrillic и кодирует в woff2 (суммарно ~96 КБ ≤ 1 МБ). Требует
# python3 + fontTools + brotli; если их нет — пропускаем (файлы и так в репо).
FONT_UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+20AC,U+2116,U+2122,U+2191,U+2193,U+0400-045F,U+0490-0491,U+04B0-04B1"
fetch_font() {
  local out="$1" ttf_url="$2"  # out — имя .woff2 в public/assets/fonts/
  local dst="$ROOT/public/assets/fonts/$out"
  if [ -s "$dst" ]; then echo "OK (cached): public/assets/fonts/$out"; return 0; fi
  if ! python3 -c "import fontTools, brotli" >/dev/null 2>&1; then
    warn "python3+fontTools+brotli отсутствуют — пропускаю fonts/$out (используется версия из репо)"; return 0
  fi
  local tmp; tmp=$(mktemp -t korovany_font).ttf
  curl -sL "$ttf_url" -o "$tmp" \
    && python3 -m fontTools.subset "$tmp" --unicodes="$FONT_UNICODES" \
         --layout-features='*' --flavor=woff2 --output-file="$dst" \
    || { warn "font $out download/subset failed"; FAIL=1; }
  rm -f "$tmp"
}
mkdir -p "$ROOT/public/assets/fonts"
GF=https://github.com/google/fonts/raw/main/ofl
fetch_font Forum-Regular.woff2        "$GF/forum/Forum-Regular.ttf"
fetch_font Philosopher-Regular.woff2  "$GF/philosopher/Philosopher-Regular.ttf"
fetch_font Philosopher-Bold.woff2     "$GF/philosopher/Philosopher-Bold.ttf"

echo ""
echo "=== fetch-assets done (FAIL=$FAIL) ==="
exit $FAIL
