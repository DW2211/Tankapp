# Antworten für die Formulare in der Play Console

> Stand: so, wie die App heute funktioniert. Wenn sich Funktionen ändern, müssen die Angaben angepasst werden.

## App-Inhalte → Datenschutzerklärung
`https://dw2211.github.io/Tankapp/privacy.html`

## App-Inhalte → App-Zugriff
**Alle Funktionen ohne besondere Zugriffsrechte verfügbar** (kein Login).
Optional als Hinweis für die Prüfer: „Für Live-Preise kann unter Einstellungen ein kostenloser Tankerkönig-API-Key eingetragen werden; alle anderen Funktionen und die Demo-Daten (Einstellungen → Demo-Daten laden) funktionieren ohne.“

## App-Inhalte → Anzeigen
**Nein**, die App enthält keine Werbung.

## App-Inhalte → Einstufung des Inhalts (IARC-Fragebogen)
- Kategorie: **Alle anderen App-Typen** (Dienstprogramm/Produktivität)
- Gewalt, Sexualität, Sprache, Drogen, Glücksspiel: jeweils **Nein**
- Nutzer können miteinander interagieren / Inhalte teilen: **Nein**
- Teilt den Standort mit anderen Nutzern: **Nein**
- Digitale Käufe: **Nein**
→ Ergebnis erwartet: USK ab 0 / PEGI 3

## App-Inhalte → Zielgruppe
- Zielaltersgruppe: **18 und älter** (Auto-/Finanz-App; vermeidet die strengeren Familien-Richtlinien)
- Spricht Kinder an: **Nein**

## App-Inhalte → Nachrichten-App / COVID / Behörden-App
jeweils **Nein**

## App-Inhalte → Datensicherheit
**Werden Nutzerdaten erhoben oder geteilt?** → **Ja** (wegen des Standorts für Live-Preise – er wird an Tankerkönig gesendet)

**Werden alle Daten bei der Übertragung verschlüsselt?** → **Ja** (nur HTTPS)

**Können Nutzer die Löschung beantragen?** → **Ja** (alles liegt auf dem Gerät; Löschen in der App unter Einstellungen → Alles löschen oder durch Deinstallation). Es gibt kein Konto → „Konto erstellen“: **Nein**.

| Datentyp | Erhoben | Geteilt | Optional? | Zweck | Hinweis |
|---|---|---|---|---|---|
| **Standort → Genauer Standort** | Ja | Ja (an Tankerkönig, um Preise abzurufen) | Ja, optional | App-Funktionen | „vorübergehend verarbeitet“ = Ja; die App speichert die Koordinaten nicht |
| Standort → Ungefährer Standort | Ja | Ja (wie oben) | Ja, optional | App-Funktionen | Google verlangt bei „genau“ meist beide Häkchen |
| Fotos & Videos | **Nein** | – | – | – | Belegfotos werden nur auf dem Gerät verarbeitet und gespeichert |
| Finanzinformationen (Tankbeträge) | **Nein** | – | – | – | bleiben auf dem Gerät; optionaler Export geht in das eigene Google-Konto des Nutzers, auf Wunsch des Nutzers |
| Alle anderen Kategorien | Nein | – | – | – | – |

*Begründung:* Laut Google gilt Datenübertragung, die der Nutzer selbst auslöst und an ein Konto des Nutzers selbst geht (eigenes Google Sheet), nicht als „Teilen“. Die Belegerkennung läuft lokal (Tesseract im Gerät).

## Preisgestaltung & Vertrieb
- **Kostenlos**
- Länder: **Deutschland** (die Preisdaten gibt es nur für Deutschland), optional Österreich/Schweiz nicht sinnvoll
- Enthält Werbung: **Nein**
