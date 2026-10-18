#!/bin/bash
# Riftbound on a Mac: the play.bat of macOS. Gets Node if the Mac has none, gets (or updates) the game in ~/riftbound, starts
# the co-op server (node server/server.mjs) and opens the forest. Friends on the same wifi open the link it prints.
#   From nothing, one Terminal line:
#     curl -fsSL https://raw.githubusercontent.com/KarlssonChristoffer/riftbound/claude/project-thread-8lnhrc/play-mac.sh | bash
#   From the game's folder: double-click play.command, or ./play-mac.sh. Arguments go to the server (default --seed 1337):
#     ./play-mac.sh --seed 1234
#   RIFTBOUND_DIR (~/riftbound) and RIFTBOUND_BRANCH pick where and which branch a fresh copy comes from.
# Node comes from Homebrew when the Mac has it, otherwise the official build from nodejs.org into ~/.riftbound/node (no sudo).
# Close the Terminal window (or Ctrl+C) to stop the server.
# Everything is in main() so bash has read the whole file before it runs (it arrives through a pipe with curl | bash).

main() {
  set -e
  local REPO=KarlssonChristoffer/riftbound
  local BRANCH="${RIFTBOUND_BRANCH:-claude/project-thread-8lnhrc}"
  local DIR="${RIFTBOUND_DIR:-$HOME/riftbound}"
  local PORT=8320 NODE_LINE=latest-v24.x
  local here=
  [ -n "${BASH_SOURCE[0]}" ] && here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"   # empty through a pipe

  say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
  fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

  [ "$(uname -s)" = Darwin ] || say "This is the Mac launcher, but this isn't a Mac: carrying on anyway."

  # 1. Node
  export PATH="$HOME/.riftbound/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if ! command -v node >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      say "Installing Node with Homebrew"
      brew install node
    else
      local arch; arch="$(uname -m)"; [ "$arch" = x86_64 ] && arch=x64
      local base="https://nodejs.org/dist/$NODE_LINE" tgz
      tgz="$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep "darwin-$arch.tar.gz$" | head -1)"
      [ -n "$tgz" ] || fail "Couldn't find Node for this Mac. Install the LTS from https://nodejs.org and run this again."
      say "Downloading Node (${tgz%.tar.gz}) into ~/.riftbound/node"
      rm -rf "$HOME/.riftbound/node" && mkdir -p "$HOME/.riftbound/node"
      curl -fL --progress-bar "$base/$tgz" | tar -xz -C "$HOME/.riftbound/node" --strip-components 1
    fi
  fi
  command -v node >/dev/null 2>&1 || fail "Node still isn't there. Install the LTS from https://nodejs.org and run this again."
  say "Node $(node --version)"

  # 2. The game: this folder when the script lives in a copy of the game, otherwise ~/riftbound
  if [ -n "$here" ] && [ -f "$here/server/server.mjs" ]; then
    DIR="$here"
  elif [ -d "$DIR/.git" ]; then
    say "Updating the game in $DIR"
    if [ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
      git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" reset -q --hard FETCH_HEAD \
        || say "Couldn't update (offline?): playing the copy that's there."
    else
      say "$DIR has local changes: not updating it, playing it as it is."
    fi
  elif [ -f "$DIR/server/server.mjs" ]; then
    say "Playing the copy in $DIR"
  else
    [ -e "$DIR" ] && fail "$DIR exists but isn't the game. Move it away, or set RIFTBOUND_DIR to another folder."
    # /usr/bin/git on a Mac without the developer tools only opens an install dialog: use it only when the tools are there
    if command -v git >/dev/null 2>&1 && { [ "$(command -v git)" != /usr/bin/git ] || xcode-select -p >/dev/null 2>&1; }; then
      say "Downloading the game into $DIR (a few hundred MB, the first time only)"
      git clone --depth 1 --single-branch -b "$BRANCH" "https://github.com/$REPO.git" "$DIR" \
        || { say "No branch $BRANCH any more: taking main"; rm -rf "$DIR"; git clone --depth 1 "https://github.com/$REPO.git" "$DIR"; }
    else
      say "Downloading the game into $DIR (a few hundred MB, no git needed)"
      mkdir -p "$DIR"
      curl -fL --progress-bar "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$DIR" --strip-components 1 \
        || curl -fL --progress-bar "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar -xz -C "$DIR" --strip-components 1
    fi
  fi
  cd "$DIR"
  chmod +x play-mac.sh play.command 2>/dev/null || true
  xattr -dr com.apple.quarantine play-mac.sh play.command 2>/dev/null || true   # so a double-click is never blocked

  # 3. An old server still on the port (an earlier run): stop it so this one has the new code
  local a prev=
  for a in "$@"; do [ "$prev" = --port ] && PORT="$a"; prev="$a"; done
  local old; old="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  if [ -n "$old" ]; then
    if ps -o command= -p $old 2>/dev/null | grep -q 'server/server.mjs'; then
      say "Stopping the Riftbound server that was already running"; kill $old 2>/dev/null || true; sleep 1
    else
      fail "Port $PORT is taken by another program ($(ps -o comm= -p $old | head -1)). Close it, or run: ./play-mac.sh --port 8321"
    fi
  fi

  # 4. The links
  local ip iface port_arg=$PORT
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  ip="$( { [ -n "$iface" ] && ipconfig getifaddr "$iface"; } 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  ip="$(echo "$ip" | grep -Eo '^[0-9]+([.][0-9]+){3}$' | head -1 || true)"
  local me="http://localhost:$port_arg/src/?mp=1"
  echo
  say "You:              $me"
  if [ -n "$ip" ]; then
    say "Send to friends:  http://$ip:$port_arg/src/?mp=1   (same wifi only)"
  else
    say "No network found: friends can't join until the Mac is on wifi."
  fi
  say "If macOS asks whether node may accept incoming connections: Allow."
  say "Close this window (or Ctrl+C) to stop the server."
  echo

  # 5. Open the forest once the server answers, then run the server here
  ( for _ in $(seq 1 40); do curl -fs -o /dev/null "http://localhost:$port_arg/mp/session" && break; sleep 0.25; done
    command -v open >/dev/null 2>&1 && open "$me" ) &
  [ $# -eq 0 ] && set -- --seed 1337
  exec node server/server.mjs "$@" </dev/null
}

main "$@"
