#!/usr/bin/env bash
set -euo pipefail

EXT_UUID="ba-vreme@barko.generacija.si"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}"

echo "Installing ${EXT_UUID} to ${DEST_DIR}"
mkdir -p "${DEST_DIR}"

if [[ -d "${DEST_DIR}" ]]; then
    find "${DEST_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

cp -a "${SRC_DIR}"/. "${DEST_DIR}"/
rm -rf "${DEST_DIR}/.git"

if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas "${DEST_DIR}/schemas"
    echo "Schemas compiled"
else
    echo "Warning: glib-compile-schemas not found"
fi

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "${EXT_UUID}" >/dev/null 2>&1 || true
    gnome-extensions enable "${EXT_UUID}" >/dev/null 2>&1 || true
    echo "Extension enable requested"
else
    echo "Warning: gnome-extensions command not found"
fi

echo "Done. If not visible, restart GNOME Shell (or relog on Wayland)."
