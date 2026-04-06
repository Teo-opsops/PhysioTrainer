# Product Design Record (PDR) — PhysioTrainer

## 1. Introduzione
PhysioTrainer è un'applicazione web progettata per aiutare gli utenti a creare, gestire ed eseguire programmi di esercizi fisioterapici personalizzati. L'app include funzionalità di tracking per serie, ripetizioni e tempi di recupero.
Questo file manterrà traccia delle specifiche e verrà aggiornato iterativamente ad ogni nuova richiesta.

## 2. Architettura e Struttura Informatica
- **Struttura**: Single-file. Tutto il codice (HTML, CSS, JS) è ora inlined all'interno di `index.html`, seguendo il modello dell'app **GluGlu**.
- **Persistenza**: Utilizza `IndexedDB` (con fallback su `localStorage`) per salvare in tempo reale esercizi, allenamenti e progressi al sicuro dallo svuotamento cache del browser.

## 3. Stile Visivo e Design
- **Stile**: Minimal, pulito e moderno.
- **Sfondo**: Tema AMOLED true black (`#000000` di default per lo sfondo principale, elementi card molto scuri come `#111111`).
- **Font**: Inter (Google Fonts) in stile pulito.
- **Icone**: Icone minimaliste e semplificate (o possibilmente emoji, seguendo l'esempio di GluGlu).
- **Atmosfera**: Focus sui contenuti, senza distrazioni visive. Gli elementi interattivi (bottoni, sezioni) sono netti e leggibili.

## 4. Nuove Modifiche (Iterazione Corrente)
- Migrazione a struttura **single-file** (`index.html`) includendo e ottimizzando CSS e moduli JavaScript.
- Rimozione di tutti i file inutili (cartelle `js`, `css`, `build.ps1`, e i vecchi file di backup/richieste nella cartella `Training`).
- Adozione dello **stile AMOLED** (sfondo nero assoluto, card grigio scuro).
- Rimozione del design eccessivamente gradient/colorato precedente in favore di palette più minimal e funzionali.
- Sostituzione di **tutte** le vecchie immagini SVG e le emoji sperimentali (inclusi i riferimenti superflui come le gocce testuali da altre app) con un **set coerente di icone SVG minimaliste, senza riempimento (stroke-only)**, in puro stile elegante e focalizzato sugli allenamenti sportivi.
- **Supporto PWA**: Aggiunto `manifest.json`, `sw.js` e icona riprendendo l'architettura offline di GluGlu. Ora potenziato con un _Network-First rigoroso ('no-store')_ che bypassa la cache HTTP del browser e assicura l'aggiornamento istantaneo dell'app (selezionando e aggiornando la cache locale per il fallback offline).
- **Fix Encoding**: Assicurato il corretto funzionamento di tutte le stringhe UTF-8 (testi accentati e simboli).
- **Grafico Settimanale**: Introdotto un grafico a barre nella sezione "Sessions" (Storico) che mostra i workout completati negli ultimi 7 giorni (come implementato su GluGlu).
- **Hardaware Back Button (Android PWA)**: Implementato il supporto per il tasto "Indietro" di Android per chiudere i Modal di sistema (`UI.showModal`) in modo nativo intercettando l'API `history.pushState` e chiudendo l'avviso popup corrente.
- **PWA Install Banner**: Utilizzati i comportamenti di default del sistema operativo (es. mini-infobar nativo di Chrome/Android) per suggerire l'installazione della PWA al primo avvio. Non viene usato nessun banner custom né l'API `beforeinstallprompt`, seguendo la stessa logica semplificata dell'app On Point.
- **Fix UI & Encoding**: Sistemati i caratteri anomali per i checkbox (sostituiti con entità HTML validamente encodate e content CSS `\2713`), corrette le icone nella barra di navigazione inferiore (sostituito dumbbell con activity per uniformità con la home), e risolti i bug di overflow orizzontale (blocchi che fuoriuscivano a destra) nelle impostazioni, timer e rep counter tramite l'utilizzo di `flex-wrap` e css-grid `minmax(0, 1fr)`.
- **Icone e UX Selezione**: Consolidato il sistema di icone SVG per evitare simboli errati e migliorato l'aspetto del "grip" (6 puntini pieni). Ho integrato la libreria **SortableJS** per gestire il riordinamento degli esercizi in modo fluido e professionale sia su desktop che su dispositivi touch (mobile), garantendo che il trascinamento tramite i 6 puntini funzioni perfettamente in ogni scenario. Il cestino è ora minimal e non invasivo.
- **Icona App**: Sostituita l'icona dell'applicazione (PWA) con la nuova versione `icon.png` (dumbell bianca su sfondo nero) e aggiornato il `manifest.json` calibrando rigorosamente il `purpose: "any"` accanto al `purpose: "maskable"`. Questo assicura che il prompt di installazione nativo di Chrome ritorni a funzionare in modo affidabile, ripristinando il comportamento classico come nell'app OnPoint.
- **Workout UX & Prevenzione Perdita Dati**: Riorganizzato il layout dei box nella sezione allenamenti sistemando il titolo nella parte alta e i pulsanti (Start, Modifica, Elimina) raggruppati in basso. Rimosso ogni tasto di "Refresh" che generava confusione, impedendo il "Pull-to-refresh" scivolando in basso da mobile tramite regole CSS (`overscroll-behavior-y: none;`). Aggiunto infine il supporto intercettivo nativo per il tasto "indietro" (hardware back button e gesture) che, se premuto durante un allenamento in corso, disattiva il timer e mostra un popup che chiede all'utente se intende salvare i progressi o uscire, come già avviene sull'app OnPoint.
- **Rifiniture Settings**: Aggiunta la visualizzazione coerente in stile "card icon" per la sezione Esporta/Importa Dati nelle impostazioni, uniformandola al resto del design.
- **Visualizzazione Colori Storico**: Assegnato un colore identificativo a ciascun gruppo di workout completato nella schermata dello storico (Sessions) che viene poi ripreso per visualizzare il grafico in alto. I vari allenamenti della stessa giornata vengono rappresentati come blocchi sovrapposti con i relativi colori identificativi (stacked bar chart), permettendo all'utente di capire a colpo d'occhio quale allenamento è stato fatto in una specifica data.
- **Migrazione a IndexedDB**: Riscritto interamente il modulo `Storage` per utilizzare IndexedDB asincrono con caching in memoria. Questa modifica allinea PhysioTrainer alla metodologia robusta impiegata nelle app Notes e On Point, tutelando i salvataggi in caso di cancellazione cache del browser e implementando la migrazione trasparente e automatica dalla vecchia architettura localStorage.
