#!/usr/bin/env bash
# macOS: double-click this file in Finder to install Hermes for Office.
cd "$(dirname "$0")" || exit 1
./install.sh install
echo; read -r -p "Nhan Enter de dong / Press Enter to close..." _
