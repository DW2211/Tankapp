# ⛽️ Tankbuch

Deine Tank-App fürs Handy: Belege scannen, Tankpreise wie eine Aktie verfolgen, günstigstes E10 in der Nähe finden, Steuer-Export und automatischer Abgleich mit Google Sheets.

Eine installierbare Web-App (PWA). Sie läuft auf iPhone und Android wie eine normale App, ohne App Store. Alle Daten bleiben auf deinem Gerät, bis du sie selbst an Google Sheets überträgst.

## Funktionen

| | |
|---|---|
| 📈 **Börsen-Chart** | Tageskerzen des günstigsten E10-Preises in deiner Nähe, deine Tankungen als ▲-Markierung (grün = unter dem Durchschnitt der Umgebung getankt). Umschaltbar auf Linie, Kosten (wie eine Depotkurve) und Verbrauch. Zeiträume 1M bis Max, Fadenkreuz zeigt jeden Wert. |
| 📸 **Beleg-Scan** | Foto vom Tankbeleg → Datum, Uhrzeit, Liter, €/L, Betrag, Kraftstoff und Tankstelle werden automatisch ausgefüllt. Läuft komplett auf dem Gerät. Das Belegfoto wird gespeichert. |
| 📍 **Günstig tanken** | Live-E10-Preise im Umkreis (Tankerkönig / Markttransparenzstelle), sortiert nach Preis, Entfernung oder **Preis + Weg** (rechnet den Umweg mit ein). Route per Google Maps, „Hier getankt“ füllt das Formular vor. |
| 🧮 **Lohnt sich der Weg?** | Jede Tankstelle zeigt, ob sich die Fahrt lohnt: Kosten der Tankfüllung plus Sprit für Hin- und Rückweg (Straße ≈ 1,3 × Luftlinie, dein Verbrauch), verglichen mit der nächstgelegenen Tankstelle. „Beste Wahl“ sortiert danach. |
| 🏷️ **Meine Rabatte** | PAYBACK-Coupons, Shell ClubSmart, ADAC-Rabatte oder eigene (z. B. Firmenkarte) anschalten – die App zieht sie vom Preis ab und rechnet sie bei der besten Wahl mit ein. Mit Ablaufdatum. |
| 🔔 **Preisalarm** | Benachrichtigung, wenn E10 in der Nähe unter deinen Wunschpreis fällt (beim Öffnen der App). |
| 🧮 **Automatisch rechnen** | Zwei von drei Werten (Liter, €/L, Betrag) eingeben, der dritte wird berechnet. Verbrauch (Voll-zu-Voll-Methode), Kosten/100 km, Reichweite. |
| 🧾 **Steuer** | Jahresübersicht mit MwSt.-Anteil, beruflicher Anteil je Tankung (privat / beruflich / gemischt in %), Vorsteuer, Pendlerpauschale (0,38 €/km ab km 1, ab 2026). Export als **CSV** (Excel / Steuerberater), **PDF-Jahresbericht** und **ZIP aller Belegfotos**. |
| 📊 **Google Sheets** | Komplette Liste mit einem Tipp oder automatisch nach jeder Änderung. Zusätzlich ein Blatt „Monate“ mit Diagramm. |
| 💾 **Automatische Sicherung** | Mit Google verbunden: bei jeder Änderung Komplettsicherung im (versteckten) Blatt „Backup“ und alle Belegfotos im Drive-Ordner „Tankbuch Belege“. Neues Handy → Einrichtungs-Link antippen → alles ist wieder da. Eine leere App überschreibt nie eine gefüllte Sicherung. Ohne Google: Die App bittet das Handy, die Daten dauerhaft zu behalten, und erinnert alle 30 Tage an ein Backup. |
| 💡 **Insights** | „Guter Moment zum Tanken“, günstigste Uhrzeit laut deinen eigenen Messungen, nächstes Tanken in X Tagen, was 1 ct/L dich im Jahr kostet, Verbrauchsauffälligkeiten, wie viel du ggü. dem Schnitt der Umgebung gespart hast. |
| 🌗 Extras | Hell/Dunkel automatisch, offline nutzbar, Backup als JSON, Demo-Daten zum Ausprobieren, Schnellaktionen am App-Icon. |

## Einrichtung

### 1. App öffnen
Die App läuft unter **<https://dw2211.github.io/Tankapp/>** (GitHub Pages aus dem Branch `gh-pages`, der ein Spiegel von `main` ist).
Am Handy öffnen → **Teilen → Zum Home-Bildschirm** (iPhone) bzw. **⋮ → App installieren** (Android).

**Einrichtungs-Link:** `https://dw2211.github.io/Tankapp/#setup&key=<Tankerkönig-Key>&sheets=<Apps-Script-URL>&secret=<Schlüssel>&car=<Name>` trägt alles mit einem Tipp ein (alle Parameter optional).

### 2. Live-Preise freischalten
1. Kostenlosen API-Key holen: <https://onboarding.tankerkoenig.de/>
2. In der App: ⚙️ **Einstellungen → Live-Preise → API-Key** einfügen.

### 3. Google Sheets verbinden (2 Minuten)
1. Neues Google Sheet anlegen → **Erweiterungen → Apps Script**.
2. Inhalt von [`google-apps-script/Code.gs`](google-apps-script/Code.gs) einfügen (in der App unter Einstellungen → „Einrichtung“ gibt es einen Kopieren-Knopf). Oben `SECRET` auf ein eigenes Passwort setzen.
3. **Bereitstellen → Neue Bereitstellung → Web-App**, Ausführen als **Ich**, Zugriff **Jeder** → Zugriff erlauben.
4. Die `…/exec`-URL und dein Passwort in der App eintragen → **Jetzt übertragen**. Optional „automatisch übertragen“ einschalten.

## Tipps für den Beleg-Scan
- Beleg flach hinlegen, gutes Licht, möglichst gerade von oben fotografieren.
- Beim ersten Scan lädt die Texterkennung einmalig ca. 10 MB, danach geht es offline und schneller.
- Erkannte Felder blinken kurz grün. Bitte immer kurz gegenprüfen.

## Technik
Reines HTML/CSS/JavaScript, kein Build-Schritt. Bibliotheken liegen in `vendor/`:
[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0), [JSZip](https://github.com/Stuk/jszip) (MIT).
Preisdaten: [Tankerkönig](https://creativecommons.tankerkoenig.de) unter CC BY 4.0.

Lokal testen: `python3 -m http.server` im Projektordner → <http://localhost:8000>.

*Keine Steuerberatung. Die Steuerwerte sind Hilfen für deine Unterlagen.*
