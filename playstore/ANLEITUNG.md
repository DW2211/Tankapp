# Tankbuch in den Play Store bringen – Schritt für Schritt

Vorbereitet ist alles, was kostenlos geht: Android-App, Signatur, Store-Texte, Grafiken, Datenschutzerklärung,
Antworten für alle Formulare. Was nur du machen kannst (Konto, Zahlung, Ausweis), steht unten mit ✋.

## Was du bekommen hast
| Datei | Wofür |
|---|---|
| `tankbuch-release.aab` | **Die Datei für den Play Store** (signiert mit deinem Upload-Schlüssel) |
| `tankbuch-test.apk` | Zum direkten Ausprobieren auf deinem Android-Handy (vor dem Store) |
| `tankbuch-upload.jks` + Passwort | **Dein Upload-Schlüssel – sicher aufbewahren, nie teilen!** Ohne ihn kannst du keine Updates hochladen (Google kann ihn zwar zurücksetzen, das dauert aber Tage). |

Store-Texte: `store-eintrag.md` · Formular-Antworten: `formulare.md` · Grafiken: `app-icon-512.png`, `feature-graphic-1024x500.png`, `screenshots/framed/`

---

## 1. ✋ Entwicklerkonto anlegen (einmalig, 25 US-$)
1. https://play.google.com/console/signup öffnen, mit deinem Google-Konto anmelden.
2. **Persönliches Konto** wählen, 25 $ zahlen, Identität mit Ausweis bestätigen (dauert meist 1–3 Tage).
3. Als Kontakt-E-Mail `onlinehandel.dw@gmail.com` angeben.

> **Wichtig für neue persönliche Konten:** Google verlangt vor der Veröffentlichung einen **geschlossenen Test mit mindestens 12 Testern, die 14 Tage am Stück dabei sind**. Plane das ein (Familie, Freunde – jeder braucht nur ein Google-Konto und installiert die App über einen Einladungslink).

## 2. ✋ Prüf-Repo anlegen (30 Sekunden) – damit die App ohne Adressleiste startet
1. Auf https://github.com/new gehen.
2. Repository name: **`DW2211.github.io`** (genau so), **Public**, sonst nichts ankreuzen → *Create repository*.
3. Mir Bescheid sagen – ich lege dort die Prüfdatei ab (`assetlinks/assetlinks.json` in diesem Ordner).

## 3. App in der Play Console anlegen
1. **App erstellen** → Name `Tankbuch: Spritpreise & Kosten`, Sprache **Deutsch**, **App**, **Kostenlos**, Erklärungen bestätigen.
2. **Dashboard → App einrichten** – die Punkte der Reihe nach mit den Antworten aus `formulare.md` ausfüllen:
   Datenschutzerklärung · App-Zugriff · Anzeigen · Einstufung · Zielgruppe · Datensicherheit · Behörden-App usw.
3. **Store-Eintrag** → Texte aus `store-eintrag.md`, Grafiken hochladen (Symbol, Funktionsgrafik, 2–8 Screenshots).

## 4. Geschlossener Test (Pflicht bei neuem Konto)
1. **Testen → Geschlossene Tests → Track erstellen** → Tester-Liste mit den E-Mail-Adressen deiner 12+ Tester.
2. **Neuen Release erstellen** → bei „App-Signatur“ **Play App Signing** akzeptieren (Standard) → `tankbuch-release.aab` hochladen.
3. Versionshinweis aus `store-eintrag.md` → **Überprüfen** → **Rollout starten**.
4. Den Einladungslink an die Tester schicken. Nach 14 Tagen: **Produktion beantragen**.

## 5. ✋ Fingerabdruck an mich schicken (für die Verknüpfung)
Nach dem ersten Upload: **Testen und veröffentlichen → App-Integrität → App-Signatur** →
den **SHA-256-Zertifikatfingerabdruck des App-Signaturschlüssels** kopieren und mir schicken.
Ich trage ihn in die Prüfdatei ein. Erst dann startet die Store-Version ohne Adressleiste
(vorher funktioniert sie auch, zeigt aber oben eine schmale Browserleiste).

## Updates
- **Neue Funktionen der App** brauchen **kein** neues Store-Release – die Android-App lädt immer die aktuelle Web-App.
- Nur wenn sich am Android-Teil etwas ändert (Symbol, Name, Android-Version), wird eine neue `.aab` gebaut
  (automatisch über GitHub Actions, Branch `android-build`) und mit `sign-aab.sh` signiert.

## Gut zu wissen
- **Tankerkönig-Schlüssel:** Jeder Nutzer braucht für Live-Preise einen eigenen kostenlosen Schlüssel (steht so in der Beschreibung). Wird die App sehr beliebt, sollte man später einen eigenen kleinen Server dazwischenschalten – dann ginge es ohne.
- **Impressum:** Für eine private, kostenlose App ohne Werbung in der Regel nicht nötig. Solltest du die App gewerblich anbieten, brauchst du eins.
