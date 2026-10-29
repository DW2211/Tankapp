#!/usr/bin/env bash
# Signiert die von GitHub Actions gebaute AAB mit dem Upload-Schlüssel (liegt NICHT im Repo).
# Aufruf: ./sign-aab.sh pfad/zu/tankbuch-upload.jks
set -euo pipefail
KEY="${1:?Pfad zum Upload-Schlüssel (.jks) angeben}"
git fetch -q origin android-build
git show origin/android-build:tankbuch-release-unsigned.aab > tankbuch-release.aab
jarsigner -keystore "$KEY" -sigalg SHA256withRSA -digestalg SHA-256 tankbuch-release.aab upload
jarsigner -verify tankbuch-release.aab
echo "Fertig: tankbuch-release.aab ($(git show origin/android-build:build-info.txt | head -1))"
