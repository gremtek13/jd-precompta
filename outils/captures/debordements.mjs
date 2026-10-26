// Ce qui DÉBORDE du panneau central, onglet par onglet — la vérification à rejouer quand un écran
// change ou quand le panneau de droite gagne un contenu. Ouvert, ce panneau rétrécit le panneau central
// (moins de 700 pixels de contenu à 1 440) : une rangée de boutons ou de champs qui ne passe pas à la
// ligne déborde alors, et son dernier élément disparaît sous le volet sans que rien ne casse ailleurs.
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application (voir vitrine.mjs)
//   node outils/captures/debordements.mjs [largeur] [sans]  # « sans » : panneau de droite fermé
//                                                           # sans « sans », il ne s'ouvre qu'à partir de 1 280 px : dessous il
//                                                           # se superpose et ne rétrécit rien (le total le dit), et sur
//                                                           # téléphone le bouton « Assistant » n'existe pas
//   node outils/captures/debordements.mjs 1440 ouvert barre=200 panneau=760
//                                                           # les volets à une largeur choisie (lib/largeurVolets.ts) :
//                                                           # retenue comme le navigateur la retient, puis bornée par la coque
//   node outils/captures/debordements.mjs 390               # téléphone : la barre du bas (`position: fixed`) n'est pas posée
//                                                           # dans le panneau, elle n'est donc pas mesurée contre lui
//   node outils/captures/debordements.mjs 390 client         # le CLIENT « Mes ventes » (espace client, étape P4a) : le compte du
//   node outils/captures/debordements.mjs 390 client-banque  # banc rattaché à l'atelier (d7) avec la case « Ventes » — et « Banque »
//                                                           # pour la seconde passe —, ses factures et leurs fenêtres, et la barre
//                                                           # du bas du téléphone, dont les entrées doivent tenir (cinq avec « Mes ventes »)
//   Les visites `factures/*` ouvrent chacune une fenêtre superposée et la mesurent contre sa carte (`fenetre`), dont celles
//   d'une facture de REDEVABLE jamais transmise (dossier d7) : son aperçu, qui imprime le numéro de TVA de l'émetteur, et sa
//   fenêtre de transmission, la seule à offrir à la fois « Envoyer par Super PDP » et « Déposer sur… ».
//
// Un élément compte s'il dépasse le bord droit du panneau central SANS être dans un conteneur qui
// défile (un tableau dans .table-scroll a le droit d'être plus large que l'écran : il défile). Seul le
// plus haut élément en faute est cité, ses descendants débordant forcément avec lui.
//
// LE BORD DU PANNEAU NE SUFFISAIT PAS (05/10/2026). Deux défauts de la Vue d'ensemble, volet ouvert à
// 1 280 pixels, restaient DANS le panneau et lui échappaient donc : une tuile chiffrée plus large que sa
// case de la grille, qui passait sous sa voisine, et le bouton d'une ligne de check sorti de sa carte,
// le libellé réduit à un mot par ligne. Deux règles de plus : un élément ne sort pas de sa carte
// (`.card`, `.kpi`, `.widget`, `.cockpit`) ni de sa case de grille (`.bento > *`) ; et un texte ne sort
// pas de sa boîte — un mot plus large que sa colonne déborde sans que la boîte bouge.
//
// UN MOT COUPÉ AU MILIEU NE DÉBORDAIT PAS (08/10/2026). Le bloc téléphone de index.css (`@media (max-width: 720px)`) donnait à
// TOUT tableau `table-layout: fixed` et à toute cellule `word-break: break-word` : des colonnes à parts égales, que les
// `.table-scroll` ne faisaient jamais défiler — rien ne dépassait —, et une colonne écrasée coupait ses mots n'importe où :
// « rembourseme / nts », « 15 000,0 / 0 € », « 202 / 6 ». Le banc ne le voyait pas : un mot qui se coupe reste dans sa boîte,
// et c'est la boîte que les trois règles mesurent. Mesuré à 390 pixels sur les 72 visites : 1 049 morceaux de 2 à 24 caractères
// coupés, dans 28 tableaux, dont 244 montants (77 coupés dans le nombre) et 288 années ; à 720 pixels, 73, dans cinq tableaux
// de six à huit colonnes ; à 1 024, 1 280 et 1 440, aucun. Quatrième règle : un MORCEAU — une suite de caractères sans espace
// ordinaire, recoupée après un trait d'union ou un tiret, et après une barre oblique sauf entre deux chiffres (« 10/09/2026 »
// n'offre aucune coupure au navigateur) — dont les rectangles tombent sur plus d'une ligne est une faute, citée avec une barre
// verticale à l'endroit de la coupure. Les espaces insécables restent DANS le morceau : un montant en est un seul. Au-delà de 24
// caractères (adresse électronique, IBAN, référence longue), couper est admis. Elle ne s'arrête pas aux conteneurs qui défilent :
// c'est dans un `.table-scroll` que les mots se coupaient.
//
// LES BOUTONS D'UNE FENÊTRE SUPERPOSÉE (14/10/2026, ligne 34.93). Cinquième règle. Sur téléphone, la barre du bas (`.sidebar nav` chez
// le client, `.nav-groupes` au cabinet : `position: fixed; z-index: 40`) passait pour recouvrir la dernière rangée de boutons des
// fenêtres (voile `position: fixed; z-index: 50`, carte à 90–92 % de la hauteur) : sur les captures d'A2a et d'A6b1, cette rangée est
// coupée au bord de la carte, juste au-dessus de la barre. Mesuré, la carte la coupe (elle défile en interne), la barre ne la
// recouvre pas : aucun ancêtre d'un voile ne crée de contexte d'empilement (la barre du client est confinée dans `.sidebar`, `sticky;
// z-index: 10` ; celle du cabinet est à 40 dans la racine), et le voile est au-dessus des deux — 0 bouton recouvert sur 162 sondés au
// cabinet et sur 80 chez le client, à toutes les passes du banc (de 390 à 1 440 px, volets et passe du client comprise). La mesure
// reste : la carte de la fenêtre ouverte (celle de la visite, `fenetre`, sinon `[aria-modal="true"]` ; celle du dessus s'il y en a
// plusieurs) est défilée de bout en bout, chaque bouton et chaque lien visible est sondé au centre et au milieu de ses quatre bords
// (`elementFromPoint`), et un bouton qu'aucune position ne dégage — par la barre du bas, ou par tout élément qui n'est ni lui, ni son
// descendant, ni son ancêtre — est une faute, comptée avec les débordements (le banc échoue). Éprouvée par un défaut planté, les
// barres du bas posées AU-DESSUS des fenêtres : à 390 px, 20 boutons recouverts au cabinet et 10 chez le client ; à 720 px, 17 et 12.
// Une ligne de plus dit le compte avant le total.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'

const ONGLETS = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'bilan', 'revision', 'tva', 'immobilisations',
  'cotisations', 'cloture', 'estimation', 'financement', 'supplements', 'packs', 'informations', 'virements', 'acces',
]
// Les onglets qu'un dossier tenu en ENGAGEMENT (d8) rend autrement : le réglage du modèle et le
// brouillon en 401/411, la Clôture sans 2035, les factures sans règlement de la Checklist et de Banque,
// le chiffre d'affaires facturé de l'Estimation, les comptes de tiers de la Balance des comptes, et le Bilan d'une
// société, dont l'exercice en cours attend la validation du précédent.
const ONGLETS_ENGAGEMENT = ['ecritures', 'cloture', 'checklist', 'banque', 'estimation', 'statistiques', 'bilan']
// Les fenêtres de facturation (formulaire, aperçu, transmission) sont SUPERPOSÉES : leur voile est un `div` en
// `position: fixed`, posé par un style en ligne, et leur carte son seul enfant. Aucune classe ne les désigne — celle de la
// plateforme du client en porte une, `.plateforme-client` —, mais sur l'onglet Factures aucun autre élément n'est ainsi posé.
// L'APERÇU fait exception (08/10/2026) : sa mise en page est une classe, `.facture-apercu-voile`, pour que l'impression puisse
// la défaire — un style en ligne l'emporterait sur `@media print` ; le voile est donc désigné des deux manières. `:is()` en
// fait un seul sélecteur, que `FENETRE_FACTURE` et le `${fenetre} *` de la mesure prolongent sans changer de sens.
const VOILE_FACTURE = ':is(div[style*="position: fixed"], .facture-apercu-voile)'
const FENETRE_FACTURE = `${VOILE_FACTURE} > .card`
// Les fenêtres d'ARTICLE (espace client, étape A2b : le choix, la saisie, les deux confirmations) se posent PAR-DESSUS celle de la
// facture, qu'elles ne remplacent pas : seules elles portent un rôle (`dialog`, `alertdialog`), ce qui les désigne sans désigner
// la carte du formulaire, que `FENETRE_FACTURE` prend en premier.
const FENETRE_ARTICLE = 'div[style*="position: fixed"] > .card:is([role="dialog"], [role="alertdialog"])'
const VISITES = [
  // L'onglet TVA sur le seul dossier assujetti tenu en trésorerie : sur le cabinet infirmier, exonéré,
  // il ne montrerait qu'un message, et la vérification ne verrait jamais la déclaration elle-même.
  ...ONGLETS.map((onglet) => ({ dossier: onglet === 'tva' ? 'd7' : 'd1', onglet, nom: onglet })),
  ...ONGLETS_ENGAGEMENT.map((onglet) => ({ dossier: 'd8', onglet, nom: `engagement/${onglet}` })),
  // La connexion bancaire, une récupération faite : l'aperçu de ce qui entrerait — son tableau, son
  // libellé long, ses boutons — n'apparaît qu'après un clic, donc aucune visite ordinaire ne le voit.
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/récupération',
    apres: (page) => page.getByRole('button', { name: 'Récupérer les mouvements' }).click(),
  },
  // Et un dossier sans banque, la liste des banques ouverte : le choix de la banque et de l'espace.
  {
    dossier: 'd2', onglet: 'banque', nom: 'banque/connecter',
    apres: (page) => page.getByRole('button', { name: 'Connecter une banque' }).click(),
  },
  // Le relevé entier : les pastilles d'un mouvement rapproché, affecté, ventilé ou réglé en groupe ne
  // paraissent pas sous « Non rapprochés », le filtre par défaut.
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/tous',
    apres: (page) => page.getByRole('button', { name: 'Tous', exact: true }).click(),
  },
  // Le dossier assujetti : ses recettes du relevé, taxées ou sans taux — la pastille « TVA à choisir », le
  // taux d'une recette affectée —, leurs écritures au 445710, et le point de la Checklist qui les compte.
  {
    dossier: 'd7', onglet: 'banque', nom: 'assujetti/banque',
    apres: (page) => page.getByRole('button', { name: 'Tous', exact: true }).click(),
  },
  // Le STATUT DE TVA (ligne 28.5) : sa carte et celle de la facturation électronique, dans l'onglet TVA d'un dossier
  // exonéré, d'un dossier en franchise et d'un dossier à préciser — ouverte en édition —, puis celle d'un redevable
  // qu'on change ; le point « à préciser » du paramétrage de la Vue d'ensemble.
  { dossier: 'd1', onglet: 'tva', nom: 'statut/exonéré' },
  { dossier: 'd3', onglet: 'tva', nom: 'statut/franchise' },
  // La case du numéro de TVA intracommunautaire (décision du cabinet du 08/10/2026), que la carte ne propose qu'en édition,
  // à un dossier en franchise ou exonéré — ici cochée, avec le numéro que la carte calcule du SIREN du dossier. La route est
  // celle de la visite précédente, que la page ne recharge pas : la carte y est peut-être déjà en édition, et son bouton
  // « Changer le statut » alors absent.
  {
    dossier: 'd3', onglet: 'tva', nom: 'statut/franchise-modifier',
    apres: async (page) => {
      const changer = page.getByRole('button', { name: 'Changer le statut', exact: true })
      if (await changer.count()) await changer.click()
      await page.locator('#statut-tva-numero').waitFor({ timeout: 10000 })
    },
  },
  { dossier: 'd2', onglet: 'tva', nom: 'statut/à-préciser' },
  { dossier: 'd2', onglet: 'checklist', nom: 'statut/vue-d-ensemble' },
  {
    dossier: 'd7', onglet: 'tva', nom: 'statut/changer',
    apres: async (page) => {
      await page.getByRole('button', { name: 'Changer le statut', exact: true }).click()
      await page.getByRole('button', { name: 'Exonéré (art. 261 à 261 E du CGI)', exact: true }).click()
    },
  },
  { dossier: 'd7', onglet: 'ecritures', nom: 'assujetti/ecritures' },
  { dossier: 'd7', onglet: 'checklist', nom: 'assujetti/checklist' },
  // Sa TVA LIQUIDÉE (lib/liquidationTva.ts) : la fiche du prélèvement rapproché de la déclaration du deuxième trimestre,
  // et celle du complément, à traiter, qui propose la même déclaration dont il paie exactement le reste. Une fiche ne
  // s'ouvre que sur un clic.
  {
    dossier: 'd7', onglet: 'banque', nom: 'assujetti/paiement-tva',
    apres: async (page) => {
      await page.getByRole('button', { name: 'Tous', exact: true }).click()
      await page.locator('tr.clickable', { hasText: 'DGFIP TVA 2T2026' }).first().click()
    },
  },
  // La page ne se recharge pas d'une visite à l'autre : la fiche du prélèvement est encore ouverte, et sous 1 280 pixels
  // le volet se pose sur le relevé. On la ferme d'abord, comme on le ferait à la main.
  {
    dossier: 'd7', onglet: 'banque', nom: 'assujetti/complément-tva',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'DGFIP COMPLEMENT TVA' }).first().click()
    },
  },
  // Sa Clôture : la concordance de la 2035 avec les écritures, dont le bien sans nature est l'écart.
  { dossier: 'd7', onglet: 'cloture', nom: 'assujetti/cloture' },
  // Le registre des immobilisations déplié : le tableau d'amortissement d'un bien, le formulaire qui le
  // modifie et celui d'une nature n'apparaissent qu'après un clic. Puis un bien sans nature et plusieurs
  // candidates (dossier assujetti), et une dotation d'un exercice fini qui manque (engagement).
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/tableau',
    apres: (page) => page.getByRole('button', { name: 'Tableau', exact: true }).first().click(),
  },
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/modifier',
    apres: (page) => page.getByRole('button', { name: 'Modifier', exact: true }).first().click(),
  },
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/nature',
    apres: (page) => page.getByRole('button', { name: '+ Nature', exact: true }).first().click(),
  },
  { dossier: 'd7', onglet: 'immobilisations', nom: 'assujetti/immobilisations' },
  { dossier: 'd8', onglet: 'immobilisations', nom: 'engagement/immobilisations' },
  // La VALIDATION d'un exercice : la kinésithérapeute, dont 2025 est validé — la carte de l'exercice validé et son
  // empreinte vérifiée, puis ce que la validation fige dans chaque écran — et 2026 en cours ; l'ostéopathe, dont 2025
  // est validable ; la société en engagement, que sa dotation 2025 manquante bloque. L'exercice 2025 se choisit dans
  // l'en-tête du dossier.
  { dossier: 'd9', onglet: 'cloture', nom: 'validation/en-cours' },
  { dossier: 'd9', onglet: 'cloture', nom: 'validation/validé', apres: exercice('2025') },
  {
    dossier: 'd9', onglet: 'cloture', nom: 'validation/empreinte',
    apres: async (page) => {
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Vérifier l’empreinte', exact: true }).click()
    },
  },
  { dossier: 'd10', onglet: 'cloture', nom: 'validation/validable', apres: exercice('2025') },
  { dossier: 'd8', onglet: 'cloture', nom: 'validation/bloquée', apres: exercice('2025') },
  { dossier: 'd9', onglet: 'ecritures', nom: 'figé/ecritures', apres: exercice('2025') },
  {
    dossier: 'd9', onglet: 'banque', nom: 'figé/banque',
    apres: async (page) => {
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Tous', exact: true }).click()
    },
  },
  {
    dossier: 'd9', onglet: 'pieces', nom: 'figé/fiche',
    apres: async (page) => {
      await exercice('2025')(page)
      await page.getByRole('cell', { name: 'Assurance Pro Santé' }).first().click()
    },
  },
  {
    dossier: 'd9', onglet: 'immobilisations', nom: 'figé/immobilisations',
    apres: (page) => page.getByRole('button', { name: 'Tableau', exact: true }).first().click(),
  },
  // La carte Véhicules suit l'exercice du dossier, que les visites précédentes ont déjà mis sur 2025 (la page ne se
  // recharge pas d'une visite à l'autre) ; sinon, elle propose elle-même « 2025 · 1 ».
  {
    dossier: 'd9', onglet: 'informations', nom: 'figé/véhicules',
    apres: async (page) => {
      const bouton = page.getByRole('button', { name: /^2025 ·/ })
      if (await bouton.count()) await bouton.first().click()
    },
  },
  { dossier: 'd9', onglet: 'cotisations', nom: 'figé/cotisations' },
  // L'ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL (ligne 26.6, phase C) : la fenêtre de l'appel d'octobre, une date saisie —
  // la phrase de confirmation, la plus longue, qui nomme l'échéance, les comptes et l'exercice. Mesurée contre sa carte.
  {
    dossier: 'd1', onglet: 'cotisations', nom: 'cotisations/compte-personnel', fenetre: 'div[role="dialog"]',
    apres: async (page) => {
      await page.getByRole('button', { name: 'Payée depuis le compte personnel…' }).first().click()
      await page.getByLabel('Date du paiement').fill('2026-10-06')
      await page.getByRole('button', { name: 'Déclarer le paiement' }).waitFor({ timeout: 10000 })
    },
  },
  { dossier: 'd9', onglet: 'virements', nom: 'figé/virements' },
  // Le REPORT DES SOLDES (ligne 34) : l'ouverture que la validation de l'ostéopathe écrira, ses soldes dépliés dans la
  // carte ; puis l'exercice 2026 de la kinésithérapeute, ouvert par ses soldes reportés, et celui de l'ostéopathe, qui
  // attend la validation de 2025.
  {
    dossier: 'd10', onglet: 'cloture', nom: 'report/aperçu',
    apres: async (page) => {
      await exercice('2025')(page)
      await page.getByText('Voir les soldes reportés').first().click()
    },
  },
  { dossier: 'd9', onglet: 'ecritures', nom: 'report/écritures', apres: exercice('2026') },
  { dossier: 'd9', onglet: 'statistiques', nom: 'report/balance', apres: exercice('2026') },
  { dossier: 'd10', onglet: 'ecritures', nom: 'report/en-attente', apres: exercice('2026') },
  { dossier: 'd10', onglet: 'statistiques', nom: 'report/en-attente-balance', apres: exercice('2026') },
  // LE BILAN (ligne 33, lib/bilan.ts) : celui de la société en engagement pour 2025, son premier exercice — l'écran de studio
  // et sa dette au 404000 —, celui de la kinésithérapeute pour 2026, ouvert par ses soldes reportés, l'exercice de l'ostéopathe
  // qui attend la validation de 2025, et le détail par compte du cabinet infirmier, déplié — ses listes, ses libellés longs.
  { dossier: 'd8', onglet: 'bilan', nom: 'bilan/engagement-2025', apres: exercice('2025') },
  // LA RÉVISION DES SOLDES (ligne 41, étape R3) : la kinésithérapeute, dont 2025 est validé et porte trois décisions — un solde
  // accepté sur motif, un bien justifié par sa facture, une anomalie à revoir — ; le panneau « justifier » de la banque, puis
  // celui du bien, son historique et sa citation ; l'ostéopathe, dont 2025 attend ses décisions, et son 2026 en cours.
  { dossier: 'd9', onglet: 'revision', nom: 'revision/validé', apres: exercice('2025') },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/panneau',
    apres: async (page) => {
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Ouvrir le compte 512000', exact: true }).click()
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/historique',
    apres: async (page) => {
      // La page ne se recharge pas : le panneau de la visite précédente est encore ouvert, et sous 1 280 pixels il se pose
      // sur les cartes. On le ferme d'abord, comme on le ferait à la main.
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Ouvrir le compte 218300', exact: true }).click()
    },
  },
  // LES CYCLES DE LA RÉVISION (étape R4, phase C) : le panneau d'un cycle conclu et revu — son programme exécuté, son
  // journal, sa revue —, puis celui de la synthèse, dont la conclusion est longue et que les autres cycles retiennent.
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/cycle',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Ouvrir le cycle Trésorerie', exact: true }).click()
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/cycle-ensemble',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Ouvrir le cycle Ensemble', exact: true }).click()
    },
  },
  // LA REVUE ANALYTIQUE (étape R5, phase C) : la section de la kinésithérapeute — un seuil remplacé, son tableau face aux repères
  // de 2024, les recettes mois par mois —, le panneau d'une ligne expliquée, puis celui d'une ligne « à revoir » (ses chiffres ont
  // changé depuis son explication).
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/revue-ligne',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Ouvrir la ligne Total des recettes', exact: true }).click()
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/revue-à-revoir',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Revoir la ligne Résultat', exact: true }).click()
    },
  },
  { dossier: 'd10', onglet: 'revision', nom: 'revision/à-justifier', apres: exercice('2025') },
  { dossier: 'd10', onglet: 'revision', nom: 'revision/en-cours', apres: exercice('2026') },
  // LE DOSSIER PERMANENT (étape R7, phase C) : la section de la kinésithérapeute — une lettre de mission en deux versions au titre
  // LONG, un bail dont la citation a perdu son empreinte, une description sans date, un contrat retiré, l'information sur
  // l'organisation comptable —, puis les deux volets : « Consigner une entrée » (avec la recherche d'une pièce à citer) et la
  // « Nouvelle version » de la lettre au long titre.
  { dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent', apres: exercice('2025') },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent-consigner',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: 'Consigner une entrée', exact: true }).click()
      await page.getByPlaceholder('Chercher un justificatif, un document…').fill('SCI')
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent-version',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await exercice('2025')(page)
      await page.getByRole('button', { name: /^Nouvelle version de Lettre de mission reconduite/ }).click()
    },
  },
  // R7C2 : le dossier permanent sous « Toutes » (aucun exercice choisi : la partie annuelle demande d'en choisir un, la section
  // s'offre et regarde AUJOURD'HUI), puis la « Nouvelle version » du contrat dont la citation a CHANGÉ (l'état de la citation, le
  // dire avant le clic, le bouton grisé tant que rien ne diffère), puis le même volet une fois le titre modifié.
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent-toutes',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('tab', { name: 'Toutes', exact: true }).first().click()
      await page.waitForTimeout(400)
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent-version-changee',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('tab', { name: 'Toutes', exact: true }).first().click()
      await page.getByRole('button', { name: /^Nouvelle version de Contrat d’assurance/ }).click()
    },
  },
  {
    dossier: 'd9', onglet: 'revision', nom: 'revision/dossier-permanent-version-changee-modifiee',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('tab', { name: 'Toutes', exact: true }).first().click()
      await page.getByRole('button', { name: /^Nouvelle version de Contrat d’assurance/ }).click()
      await page.getByLabel('Titre').fill('Contrat d’assurance de responsabilité civile professionnelle, avenant de 2026')
    },
  },
  { dossier: 'd9', onglet: 'bilan', nom: 'bilan/report', apres: exercice('2026') },
  // La COLONNE DE L'EXERCICE PRÉCÉDENT (2025 validé ouvre 2026) : une colonne de plus à chaque tableau, et le détail par
  // compte déplié, où chaque montant porte celui de 2025 entre parenthèses.
  {
    dossier: 'd9', onglet: 'bilan', nom: 'bilan/report-détail',
    apres: async (page) => {
      await exercice('2026')(page)
      await page.getByText('Détail par compte').click()
    },
  },
  { dossier: 'd10', onglet: 'bilan', nom: 'bilan/en-attente', apres: exercice('2026') },
  {
    dossier: 'd1', onglet: 'bilan', nom: 'bilan/détail',
    apres: async (page) => {
      await exercice('2026')(page)
      await page.getByText('Détail par compte').click()
    },
  },
  // Le LETTRAGE FAIT À LA MAIN dans les comptes de tiers de la société en engagement : la barre qui lettre ensemble
  // n'apparaît qu'une pièce cochée — seule, elle demande la suivante ; à deux, elle dit le reste et offre le bouton.
  // L'exercice en cours se rechoisit : les visites de la validation ont laissé 2025 dans l'en-tête.
  {
    dossier: 'd8', onglet: 'statistiques', nom: 'lettrage/une-pièce',
    apres: async (page) => {
      await exercice('2026')(page)
      await page.getByRole('checkbox', { name: /Cocher corsaire-facture-0828/ }).first().check()
    },
  },
  {
    dossier: 'd8', onglet: 'statistiques', nom: 'lettrage/deux-pièces',
    apres: async (page) => {
      await exercice('2026')(page)
      await page.getByRole('checkbox', { name: /Cocher corsaire-facture-0828/ }).first().check()
      await page.getByRole('checkbox', { name: /Cocher corsaire-avoir-0920/ }).first().check()
    },
  },
  // La PLATEFORME DU CLIENT (ligne 28.5) : sa fenêtre après une recherche — le plan d'import, un nom de fichier long,
  // l'avertissement de double import —, puis le formulaire qui relie celle d'un dossier sans SIRET, prérempli pour
  // Super PDP, et la fiche d'une facture reçue. La fenêtre est SUPERPOSÉE à l'écran : elle se mesure contre sa propre
  // carte (`fenetre`), pas contre le panneau central, qu'elle n'a pas à tenir. Les deux visites changent de dossier
  // entre elles, ce qui referme la fenêtre.
  {
    dossier: 'd1', onglet: 'pieces', nom: 'plateforme/recherche', fenetre: '.plateforme-client',
    apres: async (page) => {
      await page.getByRole('button', { name: 'Plateforme du client', exact: true }).click()
      await page.getByRole('button', { name: 'Chercher les nouvelles factures', exact: true }).click()
    },
  },
  {
    dossier: 'd2', onglet: 'pieces', nom: 'plateforme/relier', fenetre: '.plateforme-client',
    apres: async (page) => {
      await page.getByRole('button', { name: 'Plateforme du client', exact: true }).click()
      await page.getByRole('button', { name: 'Relier la plateforme du client', exact: true }).click()
      await page.getByRole('button', { name: 'Préremplir pour Super PDP', exact: true }).click()
    },
  },
  {
    dossier: 'd1', onglet: 'pieces', nom: 'plateforme/fiche',
    apres: (page) => page.getByRole('cell', { name: 'Laboratoire Biosanté Provence' }).first().click(),
  },
  // LA VENTE COMPTÉE DEUX FOIS (ligne 28.6) : la fiche d'une pièce jumelle de F2026-0013 que porte aussi une autre pièce —
  // sa pastille, ce qu'elle veut dire, et le nom de fichier long de l'autre pièce. La fiche de la visite d'avant est encore
  // ouverte (même route), et sur téléphone elle couvre la liste : on la ferme d'abord.
  {
    dossier: 'd1', onglet: 'pieces', nom: 'jumelle/fiche',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('cell', { name: 'Résidence Les Cèdres SAS' }).first().click()
    },
  },
  // LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » (ligne 28.5, e-reporting, étape e3) : celle d'un abonnement en dollars,
  // deux versions, l'identifiant et la ventilation ; puis la SAISIE de celle d'un studio établi au Portugal — ses
  // propositions et leurs extraits, ses champs en rangées, le refus dit avant le clic —, qui ne paraît qu'au clic.
  {
    dossier: 'd1', onglet: 'pieces', nom: 'hors-de-france/fiche',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('cell', { name: 'Nuage Logiciel Ltd' }).first().click()
      await page.getByText('Versions précédentes (1)').first().click()
    },
  },
  {
    dossier: 'd1', onglet: 'pieces', nom: 'hors-de-france/saisie',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('cell', { name: 'Studio Lumière Lisboa' }).first().click()
      await page.getByRole('button', { name: 'Saisir la fiche', exact: true }).click()
      await page.getByLabel('Pays du fournisseur').selectOption('US')
    },
  },
  // LES FACTURES ÉMISES (ligne 28.5, étape c4) : le tableau de l'onglet est mesuré par la visite ordinaire, mais ce que
  // l'étape a ajouté ne paraît qu'à un clic, dans une fenêtre. Chacune est SUPERPOSÉE : elle se mesure contre sa propre carte
  // (`fenetre`), pas contre le panneau central. Les quatre visites du cabinet infirmier restent sur la MÊME route, que la page ne recharge pas :
  // la fenêtre de l'une serait encore ouverte à l'arrivée de la suivante, et son voile interceptant le clic, celui-ci
  // expirerait. Chacune commence donc par fermer ce qui est ouvert (`fermerLesFenetres`), comme on le ferait à la main.
  //
  // Le formulaire d'une facture neuve, tous ses champs ouverts : un organisme public (SIREN, adresse de facturation
  // électronique, code service, numéro d'engagement), des biens et des services sur une période, livrés ailleurs
  // (adresse, code postal, ville, pays). Laissé vide, il montre aussi ce qu'il refuse et ce qui empêcherait la facture de partir.
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/nouvelle', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
      await page.locator('select#type-client').selectOption('organisme_public')
      await page.locator('select#nature-operation').selectOption('mixte')
      await page.locator('select#prestation').selectOption('periode')
      await page.locator('#livraison-ailleurs').check()
      await page.locator('#livraison-pays').waitFor({ timeout: 10000 })
    },
  },
  // L'aperçu imprimable de la facture à l'organisme public : son nom très long, ses mentions (SIREN, opérations, période, code
  // service, numéro d'engagement) et son tableau de lignes.
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/apercu', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0012', 'Aperçu').click()
      await page.getByRole('cell', { name: /Soins infirmiers à domicile/ }).waitFor({ timeout: 10000 })
    },
  },
  // La transmission de la même facture : son dépôt refusé, au détail long, et son envoi par Super PDP sans issue connue
  // depuis plus d'un quart d'heure — le bouton « Abandonner », que seule cette transmission-là offre.
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/transmettre', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0012', 'Transmettre').click()
      await page.getByRole('button', { name: 'Abandonner', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  // Et celle d'une facture partie par Super PDP : l'historique de ses statuts, et « Actualiser le statut Super PDP ».
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/super-pdp', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0013', 'Transmettre').click()
      await page.getByText('Facture acceptée par le destinataire').waitFor({ timeout: 10000 })
    },
  },
  // LA FACTURE D'UN REDEVABLE QUE RIEN N'A TRANSMISE (dossier d7, 08/10/2026). Toutes celles du cabinet infirmier sont à 0 %,
  // exonérées, et déjà parties ou refusées : le banc ne voyait ni un aperçu qui imprime le numéro de TVA de l'émetteur, ni ce
  // que la fenêtre de transmission offre à une facture jamais envoyée. La route change de dossier : la fenêtre de la visite
  // précédente est refermée, mais `fermerLesFenetres` ne coûte rien.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/apercu-redevable', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Aperçu').click()
      await page.getByText(/N° TVA intracommunautaire FR/).waitFor({ timeout: 10000 })
    },
  },
  // Sa fenêtre de transmission : aucune transmission à lister, ses deux canaux reliés — « Envoyer par Super PDP » et
  // « Déposer sur… » s'ajoutent à « Fermer » dans la rangée du bas, la plus chargée de la fenêtre. On attend le DERNIER
  // des boutons, qui n'apparaît qu'une fois les deux canaux relus.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/transmettre-neuve', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Transmettre').click()
      await page.getByRole('button', { name: /^Déposer sur / }).waitFor({ timeout: 10000 })
    },
  },
  // LES ENCAISSEMENTS DE LA MÊME FACTURE (ligne 28.5, étape d3) : la pastille « Encaissée en partie — … sur … » de la liste,
  // puis la fenêtre — l'obligation refusée d'une facture mixte, le reste par taux, deux encaissements dont un retiré (huit
  // colonnes repliées en fiches), la saisie, ses deux tableaux et le refus dit avant le clic. On attend le bouton
  // d'enregistrement, le dernier à paraître, une fois tout relu.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/encaissements', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Encaissements').click()
      await page.getByRole('button', { name: 'Enregistrer l’encaissement', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  // LA DÉCLARATION DE SES ENCAISSEMENTS (ligne 28.5, étape d4), sur F2026-0008, acceptée par la plateforme du client : la
  // colonne « Déclaration » — déclaré avec une note longue, contre-passé, une contre-passation et un chèque à déclarer —,
  // puis l'étape « Déclaré sur la plateforme » du chèque (ce qu'il faut saisir, la vérification du refus de l'acheteur,
  // la note), celle de la contre-passation (ses montants négatifs, son motif en commentaire), et le formulaire
  // « Contre-passer » du virement déclaré. On attend le bouton de l'étape, le dernier à paraître.
  ...[
    { nom: 'factures/declarer', bouton: 'Déclaré sur la plateforme', rang: 'last', attendu: 'Inscrire la déclaration' },
    { nom: 'factures/declarer-contre-passation', bouton: 'Déclaré sur la plateforme', rang: 'first', attendu: 'Inscrire la déclaration' },
    { nom: 'factures/contre-passer', bouton: 'Contre-passer', rang: 'first', attendu: 'Enregistrer la contre-passation' },
  ].map(({ nom, bouton, rang, attendu }) => ({
    dossier: 'd7', onglet: 'factures', nom, fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0008', 'Encaissements').click()
      await page.getByRole('button', { name: bouton, exact: true })[rang]().click()
      await page.getByRole('button', { name: attendu, exact: true }).waitFor({ timeout: 10000 })
    },
  })),
  // LE CYCLE DE VIE DES FACTURES ÉMISES (ligne 28.5, étape d7, phase C). L'onglet après « Lire les statuts de la
  // plateforme » : la rangée qui nomme la plateforme, le bilan du relevé — un refus en tête, ses données écartées, un 601
  // et son détail long, un échec —, et les pastilles « Cycle de vie · … » des factures. Puis F2026-0009, refusée par
  // l'acheteur : sa transmission refusée avant le clic, et ses encaissements (ses statuts, le refus en tête). Enfin la
  // fenêtre de la plateforme du cabinet infirmier après « Relire les statuts depuis le début », dont la confirmation est
  // acceptée comme on l'accepterait à la main.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/statuts-relevés',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Lire les statuts de la plateforme', exact: true }).click()
      await page.getByRole('heading', { name: /^Statuts lus sur / }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/refusée-transmettre', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0009', 'Transmettre').click()
      await page.getByText(/^Refusée sur la plateforme du client/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/refusée-encaissements', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0009', 'Encaissements').click()
      await page.getByText('Statuts lus sur la plateforme du client', { exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd1', onglet: 'pieces', nom: 'plateforme/relire-statuts', fenetre: '.plateforme-client',
    apres: async (page) => {
      page.once('dialog', (d) => d.accept())
      await page.getByRole('button', { name: 'Plateforme du client', exact: true }).click()
      await page.getByRole('button', { name: 'Relire les statuts depuis le début', exact: true }).click()
      await page.getByRole('heading', { name: /^Statuts lus sur / }).waitFor({ timeout: 10000 })
    },
  },
  // « MA BANQUE », CÔTÉ CABINET (espace client, étape P9b) : la fiche d'un mouvement du cabinet infirmier pour lequel le
  // client a proposé une pièce — en tête, ses signaux, une proposition retirée —, le fil (une question, une réponse longue)
  // et « Demander au client » ; plein écran sur téléphone. Puis le relevé filtré sur « Proposés par le client ». La page ne
  // se recharge pas d'une visite à l'autre : un volet resté ouvert se ferme d'abord.
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/proposé-par-le-client',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'PRLV SEPA GARAGE DU CENTRE' }).first().click()
      await page.getByRole('heading', { name: 'Pièce proposée par le client' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/filtre-proposés',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('checkbox', { name: 'Proposés par le client' }).check()
    },
  },
  // « RÈGLEMENTS » (espace client, étape A3) : la vue de l'onglet Factures de l'atelier — ses filtres, ses totaux par moyen et
  // par mois, et la liste de tous ses encaissements (neuf colonnes repliées en fiches), la contre-passation négative, le
  // retiré, la déclaration et son détail long. On attend le tableau, le dernier à paraître, une fois tout lu.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/règlements',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Règlements', exact: true }).click()
      await page.getByRole('table', { name: 'Règlements' }).waitFor({ timeout: 10000 })
    },
  },
  // « ARTICLES » (espace client, étape A2a) : le catalogue de l'atelier (d7) dans la vue « Articles » de l'onglet Factures — six
  // articles fictifs dont un prix à six décimales, une désignation et une description longues, une référence absente —, avec
  // « par le client » sur ceux que son titulaire a créés ou retirés en dernier ; puis le filtre « Retirés » ; puis la saisie
  // d'un article neuf (une désignation longue, une référence refusée, le refus du module dit avant le clic) et celle d'un
  // article lu à modifier. Chaque visite choisit sa vue : la page ne se recharge pas entre deux visites du même onglet.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/articles',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.getByRole('table', { name: 'Articles' }).waitFor({ timeout: 10000 })
      // Les accès du dossier se lisent à part : « par le client » paraît quand ils sont revenus.
      await page.getByText('par le client').first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/articles-retirés',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.getByRole('table', { name: 'Articles' }).waitFor({ timeout: 10000 })
      await page.getByRole('checkbox', { name: 'Retirés', exact: true }).check()
      await page.getByText(/^Retiré le /).first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/articles-nouveau', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.getByRole('button', { name: '+ Nouvel article', exact: true }).click()
      await page.locator('#article-designation').fill('Intervention de dépannage en urgence, déplacement, main-d’œuvre et fournitures courantes comprises, le soir et le week-end')
      await page.locator('#article-reference').fill('CONS-H')
      await page.locator('#article-prix').fill('douze')
      await page.getByText(/^La référence « CONS-H » est déjà celle/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/articles-modifier', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.locator('tr', { hasText: 'AUDIT-FORFAIT' }).getByRole('button', { name: 'Modifier', exact: true }).click()
      await page.getByRole('heading', { name: 'Modifier l’article' }).waitFor({ timeout: 10000 })
    },
  },
  // « CLIENTS » (espace client, étape A4b1) : le fichier des clients de l'atelier (d7) dans la vue « Clients » de l'onglet Factures —
  // sept clients fictifs en cours ou retirés (une entreprise à l'e-mail long, un organisme public à code service, une association avec
  // son SIREN seul, un particulier au nom très long, un client établi hors de France, deux retirés) et UN EFFACÉ qui ne doit paraître
  // nulle part —, avec « par le client » sur ceux que son titulaire a créés ou retirés en dernier ; puis le filtre « Retirés » ; puis la
  // saisie d'un client neuf (un organisme public, le SIRET d'un autre refusé, le refus du module dit avant le clic), celle d'un client lu
  // à modifier, et la confirmation de l'effacement. Chaque visite choisit sa vue : la page ne se recharge pas entre deux visites du même
  // onglet — la visite suivante qui veut les factures (`ouvrirLaFacture`) reprend la vue « Factures ».
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      // Les accès du dossier se lisent à part : « par le client » paraît quand ils sont revenus.
      await page.getByText('par le client').first().waitFor({ timeout: 10000 })
      // Un contact effacé ne se montre jamais.
      if ((await page.getByText(/Contact effacé/).count()) > 0) throw new Error('un contact effacé paraît dans la liste des clients')
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-retirés',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      await page.getByRole('checkbox', { name: 'Retirés', exact: true }).check()
      await page.getByText(/^Retiré le /).first().waitFor({ timeout: 10000 })
      if ((await page.getByText(/Contact effacé/).count()) > 0) throw new Error('un contact effacé paraît sous « Retirés »')
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-nouveau', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('button', { name: '+ Nouveau client', exact: true }).click()
      await page.locator('#contact-nom').fill('Service des achats d’une communauté de communes fictive, nom volontairement long pour éprouver le passage à la ligne')
      await page.locator('#contact-type').selectOption('organisme_public')
      await page.locator('#contact-adresse').fill('Hôtel de la communauté, place de la Mairie, 13999 Démoville')
      await page.locator('#contact-siren').fill('123456782')
      await page.locator('#contact-siret').fill('12345678200010')
      await page.getByText(/^Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-modifier', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.locator('tr', { hasText: 'Commune de Démoville' }).getByRole('button', { name: 'Modifier', exact: true }).click()
      await page.getByRole('heading', { name: 'Modifier le client' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-effacer', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.locator('tr', { hasText: 'Commune de Démoville' }).getByRole('button', { name: 'Effacer', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('heading', { name: /^Effacer le client/ }).waitFor({ timeout: 10000 })
    },
  },
  // Le cabinet infirmier (d1), dossier de SOINS : la ligne d'information au-dessus de la liste, le signalement d'un particulier et
  // d'un client établi hors de France rangés avant le passage aux soins (A4-Q4), « Effacer » offert ; puis, sous « Retirés », un
  // particulier retiré dont « Reprendre » est grisé ; puis la fenêtre d'un particulier rangé avant, qui dit son refus avant le clic.
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/clients-soins',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      await page.getByText(/^Ce dossier dispense des soins exonérés/).waitFor({ timeout: 10000 })
      await page.getByText(/^Rangé avant que le dossier passe aux soins exonérés/).first().waitFor({ timeout: 10000 })
      await page.getByRole('checkbox', { name: 'Retirés', exact: true }).check()
      await page.getByText(/^Retiré le /).first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/clients-soins-modifier', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.locator('tr', { hasText: 'Particulier fictif rangé avant les soins' }).getByRole('button', { name: 'Modifier', exact: true }).click()
      await page.getByText(/^Un dossier qui dispense des soins exonérés/).waitFor({ timeout: 10000 })
    },
  },
  // « UN CLIENT DANS LA FACTURE » (espace client, étape A4b2), sur l'atelier (d7, redevable) et son fichier de clients : le choix ouvert
  // (cinq clients en cours, dont un au nom très long, chacun avec l'échéance que son délai donnerait), le formulaire rempli par un
  // organisme public (code service, échéance, provenance) puis la date d'émission changée (l'échéance qui se propose, jamais
  // appliquée), la confirmation d'un client déjà saisi, et « Enregistrer ce client » (la saisie préremplie, le SIRET d'un autre refusé
  // et NOMMÉ avant le clic) ; puis le cabinet infirmier (d1, dossier de SOINS) : l'information sous le type « particulier », le bouton
  // refusé, et le choix, qui n'offre pas ceux que la règle refuse et le dit. Les fenêtres de client se mesurent contre leur propre
  // carte (`FENETRE_ARTICLE` désigne toute fenêtre à rôle posée par-dessus celle de la facture) ; le formulaire, contre la sienne.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/client-choix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.getByRole('button', { name: 'Choisir un client', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choisir un client' }).getByRole('button', { name: /^Société Alpha Conseil/ }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/client-ligne', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await choisirUnClient(page, /^Commune de Démoville/)
      await page.locator('#date-emission').fill('2026-12-01')
      await page.getByRole('button', { name: 'Recalculer l’échéance', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/client-remplacer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.locator('#tiers-nom').fill('Cliente saisie à la main, au nom volontairement long pour éprouver le passage à la ligne de la confirmation')
      await page.locator('#tiers-siret').fill('10000020700017')
      await page.locator('#tiers-adresse').fill('Une adresse saisie à la main, 13999 Démoville')
      await choisirUnClient(page, /^Société Alpha Conseil/)
      await page.getByRole('alertdialog', { name: 'Remplacer le client de la facture ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/client-enregistrer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.locator('#tiers-nom').fill('Cliente saisie à la main, au nom volontairement long pour éprouver le passage à la ligne de la fenêtre')
      await page.locator('#tiers-siren').fill('123456782')
      await page.locator('#tiers-siret').fill('12345678200010')
      await page.locator('#type-client').selectOption('assujetti')
      await page.locator('#tiers-adresse').fill('Une adresse saisie à la main, 13999 Démoville')
      await page.getByRole('button', { name: 'Enregistrer ce client', exact: true }).click()
      await page.getByRole('heading', { name: 'Nouveau client' }).waitFor({ timeout: 10000 })
      await page.getByText(/^Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/client-soins', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.locator('#tiers-nom').fill('Particulier fictif saisi à la main')
      await page.locator('#type-client').selectOption('non_assujetti')
      await page.getByRole('note').filter({ hasText: /^Ce dossier dispense des soins exonérés/ }).waitFor({ timeout: 10000 })
      if (!(await page.getByRole('button', { name: 'Enregistrer ce client', exact: true }).isDisabled())) {
        throw new Error('« Enregistrer ce client » n’est pas refusé avant le clic sur un particulier d’un dossier de soins')
      }
    },
  },
  {
    dossier: 'd1', onglet: 'factures', nom: 'factures/client-soins-choix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.getByRole('button', { name: 'Choisir un client', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choisir un client' }).getByRole('note').filter({ hasText: /clients rangés avant que le dossier passe aux soins/ })
        .waitFor({ timeout: 10000 })
    },
  },
  // « ADRESSE DE RÉCEPTION » (espace client, étape A6b1), côté cabinet : le bouton de Justificatifs ouvre la fenêtre — l'adresse
  // courante à venir de l'atelier (d7), son historique de trois versions (un identifiant et un nom de plateforme LONGS, « par le
  // client »), le lien du portail —, puis le formulaire d'une nouvelle adresse (un identifiant qui s'écrit de deux façons : la maille
  // reste à choisir) ; le cabinet infirmier (d1) n'a qu'une version non vérifiée, et le dossier sans SIRET (d4) dit pourquoi rien
  // ne se déclare. Chaque fenêtre se mesure contre sa propre carte.
  {
    dossier: 'd7', onglet: 'pieces', nom: 'pieces/adresse-réception', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Adresse de réception', exact: true }).click()
      await page.getByRole('table', { name: 'Historique des adresses' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'pieces', nom: 'pieces/adresse-réception-nouvelle', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Adresse de réception', exact: true }).click()
      await page.getByRole('button', { name: 'Déclarer une nouvelle adresse', exact: true }).click()
      await page.locator('#adresse-identifiant').fill('987654324_98765432400019')
      await page.getByText(/^Cet identifiant s’écrit de 2 façons/).waitFor({ timeout: 10000 })
      await page.getByRole('radio', { name: /Vérifiée sur le portail/ }).check()
      await page.locator('#adresse-verifiee-le').waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd1', onglet: 'pieces', nom: 'pieces/adresse-réception-seule', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Adresse de réception', exact: true }).click()
      await page.getByText('Non vérifiée : simple déclaration').first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd4', onglet: 'pieces', nom: 'pieces/adresse-réception-sans-siret', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Adresse de réception', exact: true }).click()
      await page.getByRole('button', { name: 'Déclarer l’adresse', exact: true }).click()
      await page.getByText(/^Le dossier n'a pas de SIREN/).waitFor({ timeout: 10000 })
    },
  },
  // LA CARTE « FACTURE ÉLECTRONIQUE » de la Vue d'ensemble (espace client, étape A6b2), aux mots du cabinet : le cabinet infirmier
  // (d1) a sa plateforme et une adresse non vérifiée, « Active » ; l'atelier (d7) une adresse à venir, « À compléter » ; un dossier
  // sans rien relié ni déclaré (d2) dit ce qui manque. Chaque visite attend l'état : la carte lit en base, après la Vue d'ensemble.
  ...[['d1', 'Active'], ['d7', 'À compléter : 1 point'], ['d2', 'À compléter : 2 points']].map(([dossier, etat]) => ({
    dossier, onglet: 'checklist', nom: `checklist/facture-électronique-${dossier}`,
    apres: (page) => page.locator('section.encart-fe .widget-sous-titre', { hasText: etat }).waitFor({ timeout: 10000 }),
  })),
  // L'AVIS DU DERNIER CHANGEMENT DU RIB, en tête de la Vue d'ensemble (espace client, étape A5b3b), aux mots du cabinet : un RIB proposé
  // depuis un accès client, il y a trois jours sur l'atelier (d7) et il y a quarante jours sur le cabinet infirmier (d1 : il attend
  // toujours son geste) ; un RIB posé par le cabinet (d2) ; un retrait (d3) et son conseil ; une réponse illisible, la ligne
  // discrète (d4) ; le dernier jour des trente (d5) ; le trente et unième, qui ne dit plus rien (d6). Chaque visite attend l'avis (ou,
  // pour d6, la carte qui se lit après lui).
  ...[['d7', 'section.avis-rib-attente'], ['d1', 'section.avis-rib-attente'], ['d2', 'section.avis-rib'], ['d3', 'section.avis-rib'],
    ['d4', 'section.avis-rib-discret'], ['d5', 'section.avis-rib']].map(([dossier, avis]) => ({
    dossier, onglet: 'checklist', nom: `checklist/avis-rib-${dossier}`,
    apres: (page) => page.locator(avis).first().waitFor({ timeout: 10000 }),
  })),
  {
    dossier: 'd6', onglet: 'checklist', nom: 'checklist/avis-rib-d6-rien',
    apres: (page) => page.locator('section.encart-fe .widget-sous-titre', { hasNotText: 'Chargement' }).waitFor({ timeout: 10000 }),
  },
  // LES RIB PROPOSÉS QUI ATTENDENT LE CABINET, en tête de son tableau de bord (espace client, étape A5b3d) : trois dossiers (un archivé au
  // nom long, le cabinet infirmier depuis quarante jours, l'atelier depuis trois), leur conseil dit une fois ; puis, par le levier
  // `banc-rib-liste` de la doublure (localStorage, lu à chaque appel), la fonction qui REFUSE et la valeur illisible — la ligne
  // discrète, le motif en infobulle —, et la liste vide, qui ne dit rien. La première visite remet la liste complète (le levier survit
  // aux visites dans le contexte du navigateur).
  {
    chemin: '#/dossiers', nom: 'tableau-de-bord/rib-a-confirmer', sansAssistant: true,
    apres: async (page) => {
      await page.evaluate(() => localStorage.removeItem('banc-rib-liste'))
      await page.reload()
      await page.locator('section.ribs-a-confirmer-tete.avis-rib-attente').waitFor({ timeout: 10000 })
    },
  },
  ...['refusee', 'illisible'].map((levier) => ({
    chemin: '#/dossiers', nom: `tableau-de-bord/rib-a-confirmer-${levier}`, sansAssistant: true,
    apres: async (page) => {
      await page.evaluate((l) => localStorage.setItem('banc-rib-liste', l), levier)
      await page.reload()
      await page.locator('section.ribs-a-confirmer-tete.avis-rib-discret').waitFor({ timeout: 10000 })
    },
  })),
  {
    chemin: '#/dossiers', nom: 'tableau-de-bord/rib-a-confirmer-vide', sansAssistant: true,
    apres: async (page) => {
      await page.evaluate(() => localStorage.setItem('banc-rib-liste', 'vide'))
      await page.reload()
      await page.getByText('Dossiers suivis').waitFor({ timeout: 10000 })
      await page.waitForTimeout(600)
      if ((await page.locator('section.ribs-a-confirmer-tete').count()) > 0) throw new Error('une liste vide ne doit rien dire')
      await page.evaluate(() => localStorage.removeItem('banc-rib-liste'))
    },
  },
  // « UN ARTICLE DANS LA FACTURE » (espace client, étape A2b), sur l'atelier (d7, redevable) et son catalogue : le choix ouvert (cinq
  // articles en cours, la recherche), une ligne remplie par un article à la désignation longue (sa provenance, « Mettre l'article à
  // ce prix » dès que le prix change), la confirmation d'une ligne déjà saisie, celle du nouveau prix d'un article au prix à six
  // décimales, et la saisie d'un article tiré d'une ligne. Les fenêtres d'article se mesurent contre leur propre carte
  // (`FENETRE_ARTICLE`) ; la ligne remplie, contre celle du formulaire.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/article-choix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await page.getByRole('button', { name: 'Choisir un article, ligne 1', exact: true }).click()
      await page.getByRole('button', { name: /^Joint torique de remplacement/ }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/article-ligne', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await choisirUnArticle(page, /^Audit de l’organisation commerciale/)
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('1300')
      await page.getByRole('button', { name: 'Mettre l’article à ce prix, ligne 1', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/article-remplacer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await ligneDuFormulaire(page, 0).locator('input').first().fill('Intervention de dépannage en urgence, déplacement et main-d’œuvre, le soir')
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('12.5')
      await choisirUnArticle(page, /^Séance de conseil en gestion/)
      await page.getByRole('alertdialog', { name: 'Remplacer le contenu de la ligne ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/article-prix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await choisirUnArticle(page, /^Joint torique de remplacement/)
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('0.2')
      await page.getByRole('button', { name: 'Mettre l’article à ce prix, ligne 1', exact: true }).click()
      await page.getByRole('alertdialog', { name: 'Mettre l’article à ce prix ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/article-enregistrer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await ligneDuFormulaire(page, 0).locator('input').first().fill('Intervention de dépannage en urgence, déplacement et main-d’œuvre, le soir')
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('0.123456')
      await page.getByRole('button', { name: 'Enregistrer comme article, ligne 1', exact: true }).click()
      await page.getByRole('heading', { name: 'Nouvel article' }).waitFor({ timeout: 10000 })
    },
  },
  // « IMPORTER DES CLIENTS » (espace client, étape A4b3b), sur l'atelier (d7) : la fenêtre ouverte, avant tout fichier ; un fichier
  // dont deux colonnes restent à choisir et dont la colonne du type porte une valeur non reconnue (l'aperçu attend) ; un fichier
  // dont des lignes sont refusées (le SIRET d'un client déjà rangé, une adresse absente, un délai en mots, un nom très long) ; un
  // fichier prêt. Les fichiers sont FICTIFS et donnés à la page par Playwright : rien ne part, la fenêtre ne fait que lire.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-import', fenetre: FENETRE_FACTURE,
    apres: async (page) => { await ouvrirLImport(page, null) },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-import-correspondance', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_CORRESPONDANCE)
      await page.getByText(/^L’aperçu attend : les colonnes/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-import-refus', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_REFUS)
      await page.locator('#contacts-import-type-unique').selectOption('assujetti')
      await page.getByText(/^Ligne 1 : Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-import-prêt', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_PRET)
      await page.locator('#contacts-import-type-unique').selectOption('assujetti')
      await page.getByRole('button', { name: 'Importer 3 clients', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  // « EXPORTER LA FICHE » (espace client, étape A4b3c), sur l'atelier (d7) : la liste des clients avec le geste sur chaque ligne (quatre
  // boutons par ligne : la rangée passe à la ligne), la phrase unique au-dessus d'elle, puis, après le clic, le message qui nomme le
  // fichier. Le fichier se compose dans le navigateur (rien ne part) et Chromium le télécharge sans fenêtre.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/clients-exporter',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      await page.getByText(/^« Exporter la fiche » télécharge toute la fiche d’un contact/).waitFor({ timeout: 10000 })
      await page.locator('tr', { hasText: 'Commune de Démoville' }).getByRole('button', { name: 'Exporter la fiche', exact: true }).click()
      await page.getByText(/^Fiche de « Commune de Démoville[^»]*» exportée : fiche-client-commune-de-demoville-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv\./).waitFor({ timeout: 10000 })
      // Le clic a fait défiler jusqu'à la ligne : la capture montre aussi la phrase et le message, au-dessus de la liste.
      await page.getByText(/^« Exporter la fiche » télécharge/).scrollIntoViewIfNeeded()
    },
  },
  // « PARAMÈTRES » (espace client, étape A5b1) : les paramètres de facturation de l'atelier (d7) dans la cinquième vue de l'onglet
  // Factures — le sélecteur à cinq boutons, qui passe à la ligne ; la courante, dont le RIB n'est que PROPOSÉ par son titulaire
  // (« par le client »), le RIB confirmé d'avant en vigueur, l'historique ; puis le formulaire « Modifier les paramètres », et la
  // confirmation du RIB, qui le nomme.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/parametres',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByText('Paramètres en cours', { exact: true }).waitFor({ timeout: 10000 })
      await page.getByText(/^Proposé par le client le /).first().waitFor({ timeout: 10000 })
      await page.getByRole('table', { name: 'Historique des paramètres' }).waitFor({ timeout: 10000 })
      // Le logo des factures (étape A5c2a) : le fichier relu dans le seau, son empreinte recalculée, puis l'image.
      await page.getByAltText('Logo des factures', { exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/parametres-modifier', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByRole('button', { name: 'Modifier les paramètres', exact: true }).click()
      await page.getByRole('heading', { name: 'Modifier les paramètres' }).waitFor({ timeout: 10000 })
      await page.locator('#parametres-delai').fill('61')
      await page.getByText('Le délai de paiement est un nombre entier de jours, de 0 à 60.').waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/parametres-confirmer', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByRole('button', { name: 'Confirmer le RIB', exact: true }).click()
      await page.getByRole('alertdialog').getByText('FR12 9999 9000 0100 0000 0000 200').waitFor({ timeout: 10000 })
    },
  },
  // Le retrait du logo des factures (étape A5c2a) : la confirmation dans la page, qui dit ce qui change, ce qui reste (le fichier
  // dans l'espace du dossier, la trace dans l'historique) et que les factures ne l'impriment pas encore.
  {
    dossier: 'd7', onglet: 'factures', nom: 'factures/parametres-retirer-logo', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByAltText('Logo des factures', { exact: true }).waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Retirer le logo', exact: true }).click()
      await page.getByRole('alertdialog').getByText(/^Le fichier reste dans l’espace du dossier/).waitFor({ timeout: 10000 })
    },
  },
  // L'IDENTITÉ LÉGALE du dossier (espace client, étape A5b2), dans la carte « Identité du dossier » de l'onglet Informations : une
  // société (forme et capital), un entrepreneur individuel (la dénomination PROPOSÉE avec sa raison, le capital absent), la forme
  // dont le libellé de l'INSEE est le plus long (141 caractères, dans le `<select>`) avec un capital de treize chiffres, un capital
  // illisible (le refus dit, « Enregistrer » grisé), et un dossier dont la lecture n'a pas porté les quatre colonnes.
  {
    dossier: 'd8', onglet: 'informations', nom: 'informations/identite',
    apres: async (page) => {
      await page.locator('#identite-capital').waitFor({ timeout: 10000 })
      await page.locator('#identite-forme').scrollIntoViewIfNeeded()
    },
  },
  {
    dossier: 'd1', onglet: 'informations', nom: 'informations/identite-ei',
    apres: async (page) => {
      await page.getByRole('button', { name: /^Utiliser « /u }).waitFor({ timeout: 10000 })
      await page.locator('#identite-forme').scrollIntoViewIfNeeded()
    },
  },
  {
    dossier: 'd5', onglet: 'informations', nom: 'informations/identite-longue',
    apres: async (page) => {
      await page.locator('#identite-forme').waitFor({ timeout: 10000 })
      await page.locator('#identite-capital').scrollIntoViewIfNeeded()
    },
  },
  {
    dossier: 'd8', onglet: 'informations', nom: 'informations/identite-refus',
    apres: async (page) => {
      await page.locator('#identite-capital').fill('12,345')
      await page.getByText(/^Le capital n’est pas un montant que l’écran sait lire/u).waitFor({ timeout: 10000 })
      await page.getByText(/^Le capital n’est pas un montant que l’écran sait lire/u).scrollIntoViewIfNeeded()
    },
  },
  {
    dossier: 'd6', onglet: 'informations', nom: 'informations/identite-non-lue',
    apres: async (page) => {
      await page.getByText(/n’ont pas été lus avec ce dossier/u).waitFor({ timeout: 10000 })
    },
  },
  // LE RELEVÉ D'UN DOSSIER BASCULÉ (ligne 28.65, chantier EC-Q3, étape VF5a1), sur la consultante d12 — archivé, il n'est vu
  // que de ces visites : la pastille d'un mouvement RÉSERVÉ à l'encaissement d'une facture, « proposé par le client », puis le
  // relevé entier et celle, verte, d'un mouvement CLASSÉ par ses encaissements ; enfin la fiche de chacun, sans section de
  // classement — une carte, ses encaissements, les mots de la garde —, mesurée contre le corps de la fiche (`fenetre`) : la
  // fiche entière n'a pas de marge, et ses bords tombent exactement sur les siens. La page ne se recharge pas
  // d'une visite à l'autre : un volet resté ouvert se ferme d'abord. Avant les visites de l'e-reporting, qui figent l'horloge.
  ...[
    { nom: 'banque-basculee/releve', fenetre: undefined, tous: false, mouvement: null, attendu: /^Réservé à l’encaissement de la facture F2026-0022/ },
    { nom: 'banque-basculee/tous', fenetre: undefined, tous: true, mouvement: null, attendu: /^Encaissements de factures — F2026-0021/ },
    // Étape VF5a2 : la carte des règles d'affectation dit le virement réservé qu'elle écarte, dépliée sur les mots de la garde.
    {
      nom: 'banque-basculee/lot-des-regles', fenetre: undefined, tous: false, mouvement: null,
      ouvrir: /^Affectation par les règles — 1 mouvement écarté/, attendu: /: Ce mouvement justifie un encaissement de la facture F2026-0022/,
    },
    {
      nom: 'banque-basculee/fiche-reserve', fenetre: '.fiche-mouvement-corps', tous: false, mouvement: 'VIR SEPA SARL HORIZON LOGISTIQUE',
      attendu: /^Réservé à des encaissements de factures$/,
    },
    {
      nom: 'banque-basculee/fiche-classe', fenetre: '.fiche-mouvement-corps', tous: true, mouvement: 'VIR SEPA CABINET DURAND',
      attendu: /^Classé par ses encaissements de factures$/,
    },
  ].map(({ nom, fenetre, tous, mouvement, ouvrir, attendu }) => ({
    dossier: 'd12', onglet: 'banque', nom, fenetre,
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      if (tous) await page.getByRole('button', { name: 'Tous', exact: true }).click()
      if (ouvrir) await page.locator('summary', { hasText: ouvrir }).first().click()
      if (mouvement) await page.locator('tr.clickable', { hasText: mouvement }).first().click()
      await page.getByText(attendu).first().waitFor({ timeout: 10000 })
    },
  })),
  // LA FICHE D'UN CRÉDIT : « ENCAISSEMENT D'UNE FACTURE » (étape VF5c). Les deux fiches ci-dessus portent désormais leur geste —
  // « Classer par ses encaissements », « Retirer ce classement ». Puis un crédit LIBRE, la remise du chèque de F2026-0023 :
  // l'encaissement enregistré sans mouvement à lui rattacher, choisi, et la facture qui reste à encaisser ; enfin la fenêtre
  // des encaissements de F2026-0024, ouverte depuis cette fiche sur ce crédit, IMPOSÉ — mesurée contre sa carte.
  {
    dossier: 'd12', onglet: 'banque', nom: 'banque-basculee/fiche-credit-libre', fenetre: '.fiche-mouvement-corps',
    apres: async (page) => {
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'REMISE DE CHEQUES 0057' }).first().click()
      await page.getByText(/^Rattacher un encaissement enregistré sans mouvement$/).first().waitFor({ timeout: 10000 })
      await page.getByLabel('Encaissement à rattacher', { exact: true }).selectOption('eb3')
      await page.getByLabel('Facture à encaisser', { exact: true }).selectOption('fb4')
    },
  },
  // LES CANDIDATS DU RELEVÉ (étape VF5e) : le virement de la maison de santé, un crédit LIBRE dont la fiche propose EN TÊTE
  // la facture source qui l'attend, F2026-0024 — ses deux signaux, son bouton —, mesurée contre le corps de la fiche.
  {
    dossier: 'd12', onglet: 'banque', nom: 'banque-basculee/fiche-credit-candidat', fenetre: '.fiche-mouvement-corps',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'VIR SEPA MAISON DE SANTE DES COTEAUX' }).first().click()
      await page.getByText(/^Proposés par ses ventes facturées$/).first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd12', onglet: 'banque', nom: 'banque-basculee/encaissement-impose', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'REMISE DE CHEQUES 0057' }).first().click()
      await page.getByLabel('Facture à encaisser', { exact: true }).selectOption('fb4')
      await page.getByRole('button', { name: 'Enregistrer…', exact: true }).click()
      await page.getByText(/^Imposé par la fiche du mouvement/).waitFor({ timeout: 10000 })
    },
  },
  // LA FENÊTRE DES ENCAISSEMENTS D'UNE FACTURE SOURCE (ligne 28.65, chantier EC-Q3, étape VF5b), sur la consultante d12 :
  // F2026-0024 et son avoir validé — le reste net de l'avoir, la colonne qui le dit, la phrase de l'avoir —, puis la
  // contre-passation de son chèque déclaré, qui cite le retour du chèque impayé : la liste des débits libres, et le débit
  // qu'elle dépasserait de 0,50 €, dit « ne pourra pas se classer ». Avant les visites de l'e-reporting, qui figent l'horloge.
  {
    dossier: 'd12', onglet: 'factures', nom: 'factures-basculees/encaissements', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0024', 'Encaissements').click()
      await page.getByText(/la base plafonne ses encaissements au total net de ses avoirs validés/).waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd12', onglet: 'factures', nom: 'factures-basculees/contre-passer-debit', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0024', 'Encaissements').click()
      await page.getByRole('button', { name: 'Contre-passer', exact: true }).first().click()
      await page.locator('#contre-passation-date').fill('2026-10-14')
      await page.locator('#contre-passation-motif').fill('Chèque revenu impayé : provision insuffisante, rejeté par la banque du client')
      await page.locator('#contre-passation-debit').selectOption('b5')
      await page.getByText(/^Ce mouvement ne pourra pas se classer par ses encaissements/).waitFor({ timeout: 10000 })
    },
  },
  // LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE (étape VF5d). Le retour du chèque impayé de F2026-0024, un débit
  // LIBRE : la contre-passation sans mouvement à lui rattacher et l'encaissement déclaré à contre-passer, choisis ; le
  // retour de deux chèques, RÉSERVÉ par une contre-passation qui ne le fait pas encore, et de quoi le compléter ;
  // l'acompte rendu, CLASSÉ ; enfin la fenêtre des encaissements de F2026-0024, ouverte depuis la fiche du débit libre
  // sur la contre-passation de son chèque, ce débit IMPOSÉ, le motif saisi — mesurée contre sa carte. Après les visites
  // de l'onglet Factures : la fenêtre que la visite d'avant laisse ouverte sur l'onglet Banque, posée sur le corps du
  // document, couvrirait sinon le bouton « Assistant » de la première.
  ...[
    {
      nom: 'banque-basculee/fiche-debit-libre', tous: false, mouvement: 'RETOUR CHEQUE IMPAYE REMISE 0042',
      attendu: /^Contre-passer l’encaissement d’une facture$/, choix: [['Contre-passation à rattacher', 'cb7'], ['Encaissement à contre-passer', 'eb4']],
    },
    {
      nom: 'banque-basculee/fiche-debit-reserve', tous: false, mouvement: 'RETOUR DE 2 CHEQUES IMPAYES REMISE 0049',
      attendu: /^Classer par ses contre-passations$/, choix: [['Contre-passation à rattacher', 'cb7'], ['Encaissement à contre-passer', 'eb4']],
    },
    {
      nom: 'banque-basculee/fiche-debit-classe', tous: true, mouvement: 'VIR SEPA RESTITUTION ACOMPTE LIBRAIRIE DES ARCADES',
      attendu: /^Retirer ce classement$/, choix: [],
    },
  ].map(({ nom, tous, mouvement, attendu, choix }) => ({
    dossier: 'd12', onglet: 'banque', nom, fenetre: '.fiche-mouvement-corps',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      if (tous) await page.getByRole('button', { name: 'Tous', exact: true }).click()
      await page.locator('tr.clickable', { hasText: mouvement }).first().click()
      await page.getByText(attendu).first().waitFor({ timeout: 10000 })
      for (const [liste, valeur] of choix) await page.getByLabel(liste, { exact: true }).selectOption(valeur)
    },
  })),
  {
    dossier: 'd12', onglet: 'banque', nom: 'banque-basculee/contre-passation-imposee', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr.clickable', { hasText: 'RETOUR CHEQUE IMPAYE REMISE 0042' }).first().click()
      await page.getByLabel('Encaissement à contre-passer', { exact: true }).selectOption('eb4')
      await page.getByRole('button', { name: 'Contre-passer…', exact: true }).click()
      await page.getByText(/^Imposé par la fiche du débit/).waitFor({ timeout: 10000 })
      await page.locator('#contre-passation-motif').fill('Chèque revenu impayé : provision insuffisante, rejeté par la banque du client')
    },
  },
  // LA PAIRE QUI NE SE DÉCLARE PAS (étape VF5d2) ET LA VUE D'ENSEMBLE D'UN DOSSIER BASCULÉ (étape VF5f), sur la consultante
  // d12 : la fenêtre des encaissements de F2026-0028, facture d'une particulière, dont le chèque jamais déclaré a été
  // contre-passé en citant le débit de son retour — l'encaissement, la contre-passation, la phrase de la paire —, mesurée
  // contre sa carte ; puis la Vue d'ensemble, ses deux points en « attention » (les mouvements réservés à classer, les
  // encaissements sans mouvement du relevé, nommés dans leur détail). Avant les visites de l'e-reporting, qui figent l'horloge.
  {
    dossier: 'd12', onglet: 'factures', nom: 'factures-basculees/paire-non-declaree', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0028', 'Encaissements').click()
      await page.getByText(/^Contre-passé avant d’être déclaré : ni l’encaissement ni sa contre-passation ne se déclarent\.$/).first()
        .waitFor({ timeout: 10000 })
    },
  },
  // LES LOTS DEVANT LA JUMELLE INVERSÉE (ligne 28.65, chantier EC-Q3, étape VF6d), sur la consultante d12 : la sélection des
  // Justificatifs, qui écarte la pièce de vente que la garde G3 refuserait de valider et le dit, dépliée ; puis la carte
  // « Valider et rapprocher » du relevé, qui écarte la même pièce, dépliée sur les mots de la garde.
  {
    dossier: 'd12', onglet: 'pieces', nom: 'justificatifs-bascules/validation-en-lot',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      // La liste du dossier d'abord : la page ne se recharge pas, et celle de la visite d'avant paraît un instant.
      await page.locator('tr', { hasText: 'Verrerie Tournon' }).first().waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Tout sélectionner', exact: true }).click()
      await page.locator('summary', { hasText: /ne se valid(?:e|ent) pas en lot/ }).first().click()
      await page.getByText(/^Valider la sélection \(\d+ sur \d+\)$/).first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd12', onglet: 'banque', nom: 'banque-basculee/validation-en-lot',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('summary', { hasText: /^Validation en lot — 1 pièce écartée/ }).first().click()
      await page.getByText(/avant de la valider : les factures de ce dossier sont la source de leurs ventes\.$/).first()
        .waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd12', onglet: 'checklist', nom: 'checklist-basculee/vue-d-ensemble',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByText(/^3 mouvement\(s\) réservé\(s\) à des encaissements de factures, à classer$/).waitFor({ timeout: 10000 })
      await page.getByText(/^5 encaissement\(s\) de factures par virement, prélèvement, chèque, carte ou effet sans mouvement du relevé$/)
        .scrollIntoViewIfNeeded()
    },
  },
  // CE QUE CETTE PIÈCE EST (ligne 28.65, chantier EC-Q3, étape VF6c), sur la consultante d12 : la fiche de l'original de
  // F2026-0021 que le pont reconnaît (à désigner : la déclaration refusée, la facture nommée, « Valider » retenu par G3), celle
  // du PDF désigné de F2026-0022 (son journal), celle de la formation déclarée hors des factures (son journal, et deux gestes
  // restés dans le dossier d'où elle vient). Avant l'e-reporting, qui fige l'horloge.
  ...[
    ['pieces-basculees/a-designer', 'Cabinet Durand, original rendu par la plateforme', /^Cette pièce est la facture F2026-0021 émise/],
    ['pieces-basculees/exemplaire', 'SARL Horizon Logistique, PDF déposé', /^Désignée exemplaire de la facture F2026-0022/],
    ['pieces-basculees/declaree', 'Formation inter-entreprises facturée ailleurs', /^2 gestes du journal de cette pièce sont restés/],
  ].map(([nom, tiers, attendu]) => ({
    dossier: 'd12', onglet: 'pieces', nom,
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.getByRole('cell', { name: tiers }).first().click()
      await page.getByText(attendu).first().waitFor({ timeout: 10000 })
    },
  })),
  // LE PONT PAR RÉGIME (ligne 28.65, chantier EC-Q3, étape VF6e), sur la consultante d12 : la liste des Justificatifs et ses
  // marques — « À désigner », « Exemplaire de la facture », « Vente hors des factures », « Comptée deux fois » d'une facture
  // source —, puis la Vue d'ensemble, sur les deux points neufs (la pièce à désigner, la vente déclarée à vérifier). Avant
  // l'e-reporting, qui fige l'horloge.
  {
    dossier: 'd12', onglet: 'pieces', nom: 'justificatifs-bascules/marques',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      await page.locator('tr', { hasText: 'Maison de santé des Coteaux, original validé' }).first().waitFor({ timeout: 10000 })
      await page.getByText('Comptée deux fois', { exact: true }).first().waitFor({ timeout: 10000 })
      await page.getByText('À désigner : c’est la facture F2026-0021', { exact: true }).first().waitFor({ timeout: 10000 })
    },
  },
  {
    dossier: 'd12', onglet: 'checklist', nom: 'checklist-basculee/jumelle-inversee',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      const aDesigner = page.getByText(/^\d+ pièce\(s\) de vente que le pont rattache à une facture émise, à désigner exemplaire de cette facture$/)
      await aDesigner.waitFor({ timeout: 10000 })
      await page.getByText(/^1 pièce\(s\) déclarée\(s\) vente hors des factures dont le montant est celui d’une facture source/)
        .waitFor({ timeout: 10000 })
      await aDesigner.scrollIntoViewIfNeeded()
    },
  },
  // LA VALIDATION D'UN DOSSIER BASCULÉ (ligne 28.65, chantier EC-Q3, étape VF7c), sur la consultante d12 : la carte « Valider
  // l'exercice » de Clôture dit, sous les mots de la base, le premier mouvement réservé, le premier virement sans son
  // mouvement et la première vente facturée pas écrite à jour, chacun suivi de la liste qui les nomme — les phrases les plus
  // longues de la carte. Avant l'e-reporting, qui fige l'horloge.
  {
    dossier: 'd12', onglet: 'cloture', nom: 'cloture-basculee/validation',
    apres: async (page) => {
      await fermerLesFenetres(page)
      const fermer = page.getByRole('button', { name: 'Fermer le panneau', exact: true })
      if (await fermer.count()) await fermer.first().click()
      const reserve = page.getByText(/porte un mouvement du \d\d\/\d\d\/\d{4} réservé à l'encaissement de la facture/)
      await reserve.first().waitFor({ timeout: 10000 })
      await page.getByText(/porte une vente facturée|porte l'écriture proposée d'une vente facturée/).first().waitFor({ timeout: 10000 })
      await reserve.first().scrollIntoViewIfNeeded()
    },
  },
  // L'E-REPORTING (ligne 28.5, étape e5c), sur l'atelier (d7, redevable) : la fenêtre « Régime, périodes et déclarations » de
  // la carte de l'onglet TVA — le régime et son histoire, les trois objets, leurs périodes —, puis le détail d'un achat
  // DÉCLARÉ dont la fiche a changé (« À rectifier » et ses causes, la rectificative à déclarer), celui d'une vente déclarée à
  // jour, celui de paiements à déclarer (le formulaire, rempli d'une note longue), et le formulaire d'un nouveau régime. Les
  // données du banc sont de novembre 2027 (voir `EREPORTING_D7`) : ces visites, les DERNIÈRES, posent l'horloge au 5 novembre
  // 2027 — un temps figé reste posé pour la suite —, et la carte des visites précédentes se mesure à la date réelle.
  ...[
    { nom: 'ereporting/fenetre', pas: async () => {}, attendu: null },
    {
      nom: 'ereporting/rectifier',
      pas: async (page) => {
        await page.getByRole('button', { name: /^Achats/ }).click()
        await page.locator('tr', { hasText: 'octobre 2027' }).getByRole('button', { name: 'Détail', exact: true }).click()
      },
      attendu: 'Déclarer la rectificative',
    },
    {
      nom: 'ereporting/ventes-a-jour',
      pas: async (page) => {
        await page.getByRole('button', { name: /^Ventes/ }).click()
        await page.locator('tr', { hasText: 'octobre 2027' }).getByRole('button', { name: 'Détail', exact: true }).click()
      },
      attendu: /Empreinte du contenu figé/,
    },
    {
      nom: 'ereporting/declarer-paiements',
      pas: async (page) => {
        await page.getByRole('button', { name: /^Paiements/ }).click()
        await page.locator('tr', { hasText: 'octobre 2027' }).getByRole('button', { name: 'Détail', exact: true }).click()
        await page.getByLabel('Plateforme sur laquelle la période a été déclarée').fill('Plateforme fictive de démonstration')
        await page.getByLabel('Note (facultative)').fill(
          'Déposée sur la plateforme du dossier le 5 novembre 2027 à 10 h 12, accusé de réception conservé avec la référence de l’envoi',
        )
      },
      attendu: 'Déclarée sur la plateforme',
    },
    {
      nom: 'ereporting/confirmer-regime',
      pas: async (page) => {
        await page.getByRole('button', { name: 'Confirmer un régime…', exact: true }).click()
      },
      attendu: 'Confirmer le régime',
    },
  ].map(({ nom, pas, attendu }) => ({
    dossier: 'd7', onglet: 'tva', nom, fenetre: 'div[role="dialog"]',
    apres: async (page) => {
      await page.clock.setFixedTime(new Date('2027-11-05T10:00:00+01:00'))
      if ((await page.locator('div[role="dialog"]').count()) > 0) {
        await page.locator('div[role="dialog"]').getByRole('button', { name: 'Fermer', exact: true }).last().click()
        await page.waitForTimeout(200)
      }
      await page.getByRole('button', { name: 'Régime, périodes et déclarations', exact: true }).click()
      await page.getByRole('heading', { name: 'E-reporting du dossier' }).waitFor({ timeout: 10000 })
      await page.getByRole('table', { name: /^Périodes : / }).waitFor({ timeout: 10000 })
      await pas(page)
      if (attendu !== null) await page.getByRole('button', { name: attendu }).or(page.getByText(attendu)).first().waitFor({ timeout: 10000 })
    },
  })),
]

// « MES VENTES › FACTURES » (espace client, étape P4a) : l'onglet Factures en mode client, sur l'atelier de conseil (d7), et
// ses fenêtres — celles du cabinet, aux mots du client : une facture neuve (l'adresse de l'émetteur sans la case du cabinet),
// la transmission, les encaissements (sans « Banque », le relevé n'est pas lu et la fenêtre le dit), la déclaration et la
// contre-passation, l'avoir, l'aperçu. Puis l'accueil et « Mes pièces », pour la barre du bas du téléphone et ses cinq
// entrées (`nav`). La page ne se recharge pas d'une visite à l'autre : chacune ferme d'abord ce qui est ouvert.
const VISITES_CLIENT = [
  { chemin: '#/mes-ventes', nom: 'client/mes-ventes', nav: true },
  // L'étape P4b : l'accueil et ses tuiles « À encaisser » et « À déclarer », puis les fenêtres que « Tes plateformes »
  // ouvre en mode client — la plateforme agréée de l'atelier (reliée), sa modification, et Super PDP (configuré).
  // L'accueil sans `nav` : sur téléphone, il cache la barre du bas (ses tuiles en tiennent lieu, `app-nav-accueil-client`
  // dans index.css), et la barre se mesure sur les autres écrans du client.
  // L'encart « Facture électronique » (étape A6b2) s'y ajoute : il ne lit son état qu'une fois les ventes lues, donc la visite
  // l'attend — sur téléphone, sa tuile (le titre et l'état en une ligne), sur ordinateur sa carte entière.
  {
    chemin: '#/accueil', nom: 'client/accueil',
    apres: (page) => page.locator('section.encart-fe .widget-sous-titre', { hasText: /^(Active|À compléter)/ }).waitFor({ timeout: 10000 }),
  },
  // L'avis du dernier changement du RIB de ses factures (étape A5b3a/b), sous la salutation : un RIB proposé depuis un accès de son
  // dossier, il y a trois jours (d7) — « Ventes » dans les deux passes, avec ou sans « Banque » — et son lien vers « Mes ventes ».
  {
    chemin: '#/accueil', nom: 'client/accueil-avis-rib',
    apres: (page) => page.locator('section.avis-rib-attente').waitFor({ timeout: 10000 }),
  },
  {
    chemin: '#/mes-ventes', nom: 'client/plateforme', fenetre: '.plateforme-client',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Gérer ta plateforme', exact: true }).click()
      await page.getByRole('button', { name: 'Tester la connexion', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/plateforme-modifier', fenetre: '.plateforme-client',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Gérer ta plateforme', exact: true }).click()
      await page.getByRole('button', { name: 'Modifier', exact: true }).click()
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/superpdp', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: 'Gérer Super PDP', exact: true }).click()
      await page.getByRole('button', { name: 'Changer les identifiants', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/nouvelle', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
      await page.locator('select#type-client').selectOption('organisme_public')
      await page.locator('select#nature-operation').selectOption('mixte')
      await page.locator('#tiers-nom').waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/transmettre', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Transmettre').click()
      await page.getByRole('button', { name: /^Déposer sur / }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/encaissements', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Encaissements').click()
      await page.getByRole('button', { name: 'Enregistrer l’encaissement', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  ...[
    { nom: 'client/declarer', bouton: 'Déclaré sur la plateforme', rang: 'last', attendu: 'Inscrire la déclaration' },
    { nom: 'client/contre-passer', bouton: 'Contre-passer', rang: 'first', attendu: 'Enregistrer la contre-passation' },
  ].map(({ nom, bouton, rang, attendu }) => ({
    chemin: '#/mes-ventes', nom, fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0008', 'Encaissements').click()
      await page.getByRole('button', { name: bouton, exact: true })[rang]().click()
      await page.getByRole('button', { name: attendu, exact: true }).waitFor({ timeout: 10000 })
    },
  })),
  {
    chemin: '#/mes-ventes', nom: 'client/avoir', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Avoir').click()
      await page.getByRole('button', { name: /^Valider l.avoir$/ }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/apercu', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0007', 'Aperçu').click()
      await page.getByText(/N° TVA intracommunautaire FR/).waitFor({ timeout: 10000 })
    },
  },
  { chemin: '#/mes-pieces', nom: 'client/mes-pieces', nav: true },
  { chemin: '#/ma-simulation', nom: 'client/ma-simulation', nav: true },
  // « Mes ventes › Règlements » (étape A3) : la même vue, aux mots du client ; sans « Banque », le mouvement du virement
  // de F2026-0008 se dit sans être nommé.
  {
    chemin: '#/mes-ventes', nom: 'client/règlements', nav: true,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Règlements', exact: true }).click()
      await page.getByRole('table', { name: 'Règlements' }).waitFor({ timeout: 10000 })
    },
  },
  // « Ton adresse de réception » (étape A6b1) : le bloc de « Tes plateformes » (mesuré avec « Mes ventes », plus haut), sa fenêtre aux
  // mots du client — l'adresse à venir, l'historique sans « par le client » — et le formulaire d'une nouvelle adresse.
  {
    chemin: '#/mes-ventes', nom: 'client/adresse-réception', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      // La visite d'avant a pu laisser « Règlements » ou « Articles » : « Tes plateformes » est au-dessus des factures.
      const vue = page.getByRole('tab', { name: 'Factures', exact: true })
      if ((await vue.count()) > 0) await vue.first().click()
      await page.getByRole('button', { name: 'Gérer ton adresse', exact: true }).click()
      await page.getByRole('table', { name: 'Historique des adresses' }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/adresse-réception-nouvelle', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      // La visite d'avant a pu laisser « Règlements » ou « Articles » : « Tes plateformes » est au-dessus des factures.
      const vue = page.getByRole('tab', { name: 'Factures', exact: true })
      if ((await vue.count()) > 0) await vue.first().click()
      await page.getByRole('button', { name: 'Gérer ton adresse', exact: true }).click()
      await page.getByRole('button', { name: 'Déclarer une nouvelle adresse', exact: true }).click()
      await page.locator('#adresse-identifiant').fill('987654324_98765432400019')
      await page.getByText(/^Cet identifiant s’écrit de 2 façons/).waitFor({ timeout: 10000 })
      await page.getByRole('radio', { name: /Confirmée par la plateforme/ }).check()
      await page.locator('#adresse-verifiee-le').waitFor({ timeout: 10000 })
    },
  },
  // « Mes ventes › Articles » (étape A2a) : le même catalogue aux mots du client — sans « par le client », ton cabinet le lit
  // aussi —, puis la saisie d'un article neuf, aux libellés du client.
  {
    chemin: '#/mes-ventes', nom: 'client/articles', nav: true,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.getByRole('table', { name: 'Articles' }).waitFor({ timeout: 10000 })
      await page.getByRole('checkbox', { name: 'Retirés', exact: true }).check()
      await page.getByText(/^Retiré le /).first().waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/articles-nouveau', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Articles', exact: true }).click()
      await page.getByRole('button', { name: '+ Nouvel article', exact: true }).click()
      await page.locator('#article-designation').fill('Intervention de dépannage en urgence, déplacement, main-d’œuvre et fournitures courantes comprises')
      await page.locator('#article-reference').fill('CONS-H')
      await page.getByText(/^La référence « CONS-H » est déjà celle/).waitFor({ timeout: 10000 })
    },
  },
  // « Mes ventes › Clients » (étape A4b1) : le même fichier aux mots du client — sans « par le client », ton cabinet le lit aussi —,
  // sous « Retirés » ; puis la saisie d'un client neuf aux libellés du client (le SIRET d'un autre refusé) ; puis la confirmation de
  // l'effacement, aux mots du client (« Tes factures… »).
  {
    chemin: '#/mes-ventes', nom: 'client/clients', nav: true,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      await page.getByRole('checkbox', { name: 'Retirés', exact: true }).check()
      await page.getByText(/^Retiré le /).first().waitFor({ timeout: 10000 })
      if ((await page.getByText(/Contact effacé/).count()) > 0) throw new Error('un contact effacé paraît dans la liste des clients')
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/clients-nouveau', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('button', { name: '+ Nouveau client', exact: true }).click()
      await page.locator('#contact-nom').fill('Service des achats d’une communauté de communes fictive, nom volontairement long pour éprouver le passage à la ligne')
      await page.locator('#contact-type').selectOption('assujetti')
      await page.locator('#contact-adresse').fill('Hôtel de la communauté, place de la Mairie, 13999 Démoville')
      await page.locator('#contact-siren').fill('123456782')
      await page.locator('#contact-siret').fill('12345678200010')
      await page.getByText(/^Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/clients-effacer', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.locator('tr', { hasText: 'Commune de Démoville' }).getByRole('button', { name: 'Effacer', exact: true }).click()
      await page.getByRole('alertdialog').getByText(/^Tes factures qui le nomment gardent leur copie/).waitFor({ timeout: 10000 })
    },
  },
  // « Un client dans la facture » (étape A4b2), aux mots du client : le choix, la ligne remplie puis l'échéance proposée après une date
  // d'émission changée, la confirmation d'un client déjà saisi, et « Enregistrer ce client » (le SIRET d'un autre refusé, nommé).
  {
    chemin: '#/mes-ventes', nom: 'client/client-choix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.getByRole('button', { name: 'Choisir un client', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choisir un client' }).getByRole('button', { name: /^Société Alpha Conseil/ }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/client-ligne', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await choisirUnClient(page, /^Commune de Démoville/)
      await page.locator('#date-emission').fill('2026-12-01')
      await page.getByRole('button', { name: 'Recalculer l’échéance', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/client-remplacer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.locator('#tiers-nom').fill('Cliente saisie à la main, au nom volontairement long pour éprouver le passage à la ligne de la confirmation')
      await page.locator('#tiers-siret').fill('10000020700017')
      await page.locator('#tiers-adresse').fill('Une adresse saisie à la main, 13999 Démoville')
      await choisirUnClient(page, /^Société Alpha Conseil/)
      await page.getByRole('alertdialog', { name: 'Remplacer le client de la facture ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/client-enregistrer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFactureDesClients(page)
      await page.locator('#tiers-nom').fill('Cliente saisie à la main, au nom volontairement long pour éprouver le passage à la ligne de la fenêtre')
      await page.locator('#tiers-siren').fill('123456782')
      await page.locator('#tiers-siret').fill('12345678200010')
      await page.locator('#type-client').selectOption('assujetti')
      await page.locator('#tiers-adresse').fill('Une adresse saisie à la main, 13999 Démoville')
      await page.getByRole('button', { name: 'Enregistrer ce client', exact: true }).click()
      await page.getByRole('heading', { name: 'Nouveau client' }).waitFor({ timeout: 10000 })
      await page.getByText(/^Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  // « Un article dans la facture » (étape A2b), aux mots du client : le choix, la ligne remplie, la confirmation d'une ligne déjà
  // saisie, celle du nouveau prix, et la saisie d'un article tiré d'une ligne.
  {
    chemin: '#/mes-ventes', nom: 'client/article-choix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await page.getByRole('button', { name: 'Choisir un article, ligne 1', exact: true }).click()
      await page.getByRole('button', { name: /^Joint torique de remplacement/ }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/article-ligne', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await choisirUnArticle(page, /^Audit de l’organisation commerciale/)
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('1300')
      await page.getByRole('button', { name: 'Mettre l’article à ce prix, ligne 1', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/article-remplacer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await ligneDuFormulaire(page, 0).locator('input').first().fill('Intervention de dépannage en urgence, déplacement et main-d’œuvre, le soir')
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('12.5')
      await choisirUnArticle(page, /^Séance de conseil en gestion/)
      await page.getByRole('alertdialog', { name: 'Remplacer le contenu de la ligne ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/article-prix', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await choisirUnArticle(page, /^Joint torique de remplacement/)
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('0.2')
      await page.getByRole('button', { name: 'Mettre l’article à ce prix, ligne 1', exact: true }).click()
      await page.getByRole('alertdialog', { name: 'Mettre l’article à ce prix ?' }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/article-enregistrer', fenetre: FENETRE_ARTICLE,
    apres: async (page) => {
      await ouvrirLaFacture(page)
      await ligneDuFormulaire(page, 0).locator('input').first().fill('Intervention de dépannage en urgence, déplacement et main-d’œuvre, le soir')
      await ligneDuFormulaire(page, 0).locator('input[type="number"]').nth(1).fill('0.123456')
      await page.getByRole('button', { name: 'Enregistrer comme article, ligne 1', exact: true }).click()
      await page.getByRole('heading', { name: 'Nouvel article' }).waitFor({ timeout: 10000 })
    },
  },
  // « Importer des clients » (étape A4b3b), aux mots du client : la fenêtre, la correspondance, les refus, l'aperçu prêt.
  {
    chemin: '#/mes-ventes', nom: 'client/clients-import', fenetre: FENETRE_FACTURE,
    apres: async (page) => { await ouvrirLImport(page, null) },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/clients-import-correspondance', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_CORRESPONDANCE)
      await page.getByText(/^L’aperçu attend : les colonnes/).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/clients-import-refus', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_REFUS)
      await page.locator('#contacts-import-type-unique').selectOption('assujetti')
      await page.getByText(/^Ligne 1 : Le SIRET « 12345678200010 » est déjà celui du contact « Société Alpha Conseil »/).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/clients-import-prêt', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await ouvrirLImport(page, IMPORT_PRET)
      await page.locator('#contacts-import-type-unique').selectOption('assujetti')
      await page.getByRole('button', { name: 'Importer 3 clients', exact: true }).waitFor({ timeout: 10000 })
    },
  },
  // « Exporter la fiche » (étape A4b3c), aux mots du client : la phrase tutoyée, le geste sur chaque ligne, le message après le clic.
  {
    chemin: '#/mes-ventes', nom: 'client/clients-exporter',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Clients', exact: true }).click()
      await page.getByRole('table', { name: 'Clients' }).waitFor({ timeout: 10000 })
      await page.getByText(/^« Exporter la fiche » télécharge toute la fiche d’un de tes clients/).waitFor({ timeout: 10000 })
      await page.locator('tr', { hasText: 'Commune de Démoville' }).getByRole('button', { name: 'Exporter la fiche', exact: true }).click()
      await page.getByText(/^Fiche de « Commune de Démoville[^»]*» exportée : fiche-client-commune-de-demoville-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv\./).waitFor({ timeout: 10000 })
      await page.getByText(/^« Exporter la fiche » télécharge/).scrollIntoViewIfNeeded()
    },
  },
  // « Paramètres » (étape A5b1), aux mots du client : son RIB proposé « en attente de la confirmation de ton cabinet », sans
  // « Confirmer le RIB » ; puis le formulaire, qui dit ce que deviendra le RIB changé.
  {
    chemin: '#/mes-ventes', nom: 'client/parametres',
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByText('Paramètres en cours', { exact: true }).waitFor({ timeout: 10000 })
      await page.getByText(/en attente de la confirmation de ton cabinet\.$/).first().waitFor({ timeout: 10000 })
      if ((await page.getByRole('button', { name: 'Confirmer le RIB' }).count()) > 0) throw new Error('« Confirmer le RIB » paraît chez le client')
      // Le logo des factures (étape A5c2a), aux mots du client : la passe du client voit la courante sans logo (fauxSupabase.ts dit
      // pourquoi), le bloc dit qu'aucun n'est posé et offre le choix d'un fichier.
      await page.getByText('Ton cabinet voit ce logo et peut le changer, comme toi.', { exact: false }).waitFor({ timeout: 10000 })
      await page.getByText('Aucun logo n’est posé.', { exact: true }).waitFor({ timeout: 10000 })
    },
  },
  {
    chemin: '#/mes-ventes', nom: 'client/parametres-modifier', fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      await fermerLesFenetres(page)
      await page.getByRole('tab', { name: 'Paramètres', exact: true }).click()
      await page.getByRole('button', { name: 'Modifier les paramètres', exact: true }).click()
      await page.getByRole('heading', { name: 'Modifier les paramètres' }).waitFor({ timeout: 10000 })
      await page.locator('#parametres-iban').fill('FR93 9999 9000 0100 0000 0000 100')
      await page.getByText(/^Le RIB change : il ne sera que proposé/).waitFor({ timeout: 10000 })
    },
  },
]

// « Ma banque » (espace client, étape P9), pour la seule passe `client-banque` : le relevé, puis le détail d'un mouvement
// sur lequel le cabinet a posé une question (le fil, la précision à écrire, les pièces à envoyer), puis celui d'un
// mouvement pour lequel une pièce est déjà envoyée.
const VISITES_BANQUE_CLIENT = [
  { chemin: '#/ma-banque', nom: 'client/ma-banque', nav: true },
  ...[
    { nom: 'client/ma-banque-question', libelle: 'VIR SEPA EMIS LOYER BUREAU SEPTEMBRE' },
    { nom: 'client/ma-banque-envoi', libelle: 'CB RESTAURANT LE COMPTOIR DES HALLES' },
  ].map(({ nom, libelle }) => ({
    chemin: '#/ma-banque', nom, nav: true,
    apres: async (page) => {
      await page.locator('tr', { hasText: libelle }).getByRole('button', { name: 'Ouvrir', exact: true }).click()
      await page.getByRole('button', { name: 'Envoyer la précision', exact: true }).waitFor({ timeout: 10000 })
    },
  })),
  // LA FENÊTRE DES ENCAISSEMENTS D'UNE FACTURE SOURCE, CHEZ LE CLIENT (ligne 28.65, étape VF5b), sur le dossier basculé (d12),
  // que la clé `banc-client-basculee` donne au compte du banc avec « Ventes » et « Banque » — EN DERNIER : la page se recharge
  // pour la lire, et le compte n'a plus que cette société. Les exercices validés, qu'il ne lit pas, se disent jugés par la base ;
  // puis la contre-passation qui cite son débit, et le débit qu'elle dépasserait, dit « ne pourra pas se classer ».
  ...[
    { nom: 'client/encaissements-facture-source', contrePasser: false, attendu: /^Les exercices que ton cabinet a validés ne se lisent pas/ },
    { nom: 'client/contre-passer-debit', contrePasser: true, attendu: /^Ce mouvement ne pourra pas se classer par ses encaissements/ },
  ].map(({ nom, contrePasser, attendu }) => ({
    chemin: '#/mes-ventes', nom, fenetre: FENETRE_FACTURE,
    apres: async (page) => {
      if ((await page.evaluate(() => localStorage.getItem('banc-client-basculee'))) !== '1') {
        await page.evaluate(() => localStorage.setItem('banc-client-basculee', '1'))
        await page.reload()
        await page.waitForTimeout(900)
      }
      await fermerLesFenetres(page)
      await boutonDeFacture(page, 'F2026-0024', 'Encaissements').click()
      if (contrePasser) {
        await page.getByRole('button', { name: 'Contre-passer', exact: true }).first().click()
        await page.locator('#contre-passation-date').fill('2026-10-14')
        await page.locator('#contre-passation-motif').fill('Chèque revenu impayé : provision insuffisante')
        await page.locator('#contre-passation-debit').selectOption('b5')
      }
      await page.getByText(attendu).waitFor({ timeout: 10000 })
    },
  })),
  // « MA BANQUE » D'UN CLIENT « VENTES » (ligne 28.65, étape VF5g), sur le même dossier basculé : le relevé, où un virement
  // réservé se dit « Encaissement enregistré — ton cabinet le classe » et un virement classé « Encaissement de tes
  // factures » ; puis le détail du crédit réservé, sans pièce à envoyer, et celui du débit réservé par une contre-passation.
  // Étape VF8h : le détail du virement mixte classé, qui nomme la facture d'avant avec la facture source, sur la même ligne.
  ...[
    { nom: 'client/ma-banque-ventes', libelle: null, attendu: 'Encaissement enregistré — ton cabinet le classe' },
    { nom: 'client/ma-banque-credit-reserve', libelle: 'VIR SEPA SARL HORIZON LOGISTIQUE', attendu: /Facture\(s\) : F2026-0022\.$/ },
    { nom: 'client/ma-banque-debit-reserve', libelle: 'RETOUR DE 2 CHEQUES IMPAYES', attendu: /est enregistré sur ce débit : ton cabinet le classera/ },
    { nom: 'client/ma-banque-virement-mixte', libelle: 'VIR SEPA BUREAU ETUDES DU CANAL', attendu: /Facture\(s\) : F2026-0012, F2026-0029\.$/ },
  ].map(({ nom, libelle, attendu }) => ({
    chemin: '#/ma-banque', nom, nav: true,
    apres: async (page) => {
      if ((await page.evaluate(() => localStorage.getItem('banc-client-basculee'))) !== '1') {
        await page.evaluate(() => localStorage.setItem('banc-client-basculee', '1'))
        await page.reload()
        await page.waitForTimeout(900)
      }
      if (libelle) await page.locator('tr', { hasText: libelle }).getByRole('button', { name: 'Ouvrir', exact: true }).click()
      await page.getByText(attendu).first().waitFor({ timeout: 10000 })
    },
  })),
]


// Le bouton d'une ligne du tableau des factures, désignée par son numéro.
function boutonDeFacture(page, numero, nom) {
  return page.locator('tr', { hasText: numero }).getByRole('button', { name: nom, exact: true })
}

// Ferme les fenêtres de facturation qu'une visite précédente a laissées ouvertes : « Annuler » sur le formulaire, « Fermer »
// sur l'aperçu et sur la transmission. Une fenêtre qui n'a ni l'un ni l'autre est une faute du banc, dite plutôt que
// attendue jusqu'à l'expiration d'un clic.
async function fermerLesFenetres(page) {
  // Les fenêtres d'ARTICLE (étape A2b), posées par-dessus celle de la facture, se ferment d'abord : leur voile intercepterait le
  // clic sur le « Annuler » du formulaire. Chacune a le sien.
  const dialogues = page.locator('[role="dialog"], [role="alertdialog"]')
  for (let i = 0; i < 3 && (await dialogues.count()) > 0; i++) {
    const annuler = dialogues.first().getByRole('button', { name: 'Annuler', exact: true })
    if ((await annuler.count()) === 0) break
    await annuler.first().click()
    await page.waitForTimeout(200)
  }
  const voile = page.locator(VOILE_FACTURE)
  for (let i = 0; i < 5 && (await voile.count()) > 0; i++) {
    const fermer = voile.first().getByRole('button', { name: /^(Annuler|Fermer)$/ })
    if ((await fermer.count()) === 0) throw new Error('une fenêtre de facturation est ouverte sans bouton « Annuler » ni « Fermer »')
    await fermer.first().click()
    await page.waitForTimeout(200)
  }
}

// Le formulaire d'une facture neuve, ouvert une fois les articles du dossier lus (« Choisir un article » n'existe qu'alors). Dans
// « Mes ventes », la vue « Factures » du sélecteur est reprise d'abord : la visite d'avant a pu laisser « Articles ».
async function ouvrirLaFacture(page) {
  await fermerLesFenetres(page)
  const vue = page.getByRole('tab', { name: 'Factures', exact: true })
  if ((await vue.count()) > 0) await vue.first().click()
  await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
  await page.locator('#tiers-nom').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Choisir un article, ligne 1', exact: true }).waitFor({ timeout: 10000 })
}

// Le formulaire d'une facture neuve, ouvert une fois les clients du dossier lus (« Choisir un client » n'existe qu'alors ; étape A4b2).
// Même reprise de la vue « Factures » que `ouvrirLaFacture` : une visite d'avant a pu laisser « Clients ».
async function ouvrirLaFactureDesClients(page) {
  await fermerLesFenetres(page)
  const vue = page.getByRole('tab', { name: 'Factures', exact: true })
  if ((await vue.count()) > 0) await vue.first().click()
  await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
  await page.locator('#tiers-nom').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Choisir un client', exact: true }).waitFor({ timeout: 10000 })
}

// Choisit un client dans la fenêtre du choix.
async function choisirUnClient(page, nom) {
  await page.getByRole('button', { name: 'Choisir un client', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choisir un client' }).getByRole('button', { name: nom }).click()
}

// « Importer des clients » (étape A4b3b) : la vue « Clients », la fenêtre, et un fichier FICTIF donné à la page, ou aucun.
async function ouvrirLImport(page, texte) {
  await fermerLesFenetres(page)
  await page.getByRole('tab', { name: 'Clients', exact: true }).click()
  await page.getByRole('button', { name: 'Importer des clients', exact: true }).click()
  await page.getByRole('heading', { name: 'Importer des clients' }).waitFor({ timeout: 10000 })
  if (texte == null) return
  await page.locator('#contacts-import-fichier').setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(texte, 'utf8') })
  await page.getByRole('table', { name: 'Colonnes du fichier' }).waitFor({ timeout: 10000 })
}

// Les trois fichiers de l'import, FICTIFS : des noms longs pour le passage à la ligne, des identifiants des essais du dépôt.
const IMPORT_CORRESPONDANCE = 'Nom;Type;Adresse;SIREN;SIRET;Téléphone portable du contact principal;Courriel de facturation\n'
  + 'Société Bêta Ingénierie;une entreprise établie en France;3 rue des Essais, 13999 Démoville;;;06 00 00 00 00;compta@beta.example\n'
  + 'Établissement public fictif de coopération intercommunale, nom volontairement long;Collectivité;Hôtel de la communauté;;;;\n'
  + 'Association Gamma;Particulier;1 place Fictive;987654324;;;\n'
const IMPORT_REFUS = 'Nom;Adresse;SIREN;SIRET;E-mail;Délai\n'
  + 'Doublon fictif de la société Alpha;Zone d’activité des Essais;123456782;12345678200010;;30\n'
  + 'Client sans adresse;;;;;\n'
  + 'Client au délai écrit en mots, nom volontairement long pour éprouver le passage à la ligne de l’aperçu;Rue Fictive;;;;trente jours\n'
  + 'Client prêt;Rue Fictive;;;client.pret@exemple.example;45\n'
const IMPORT_PRET = 'Nom;Adresse;SIREN;SIRET;E-mail;Délai;Observations\n'
  + 'Société Delta Services, nom volontairement long pour éprouver le passage à la ligne de l’aperçu;4 rue Fictive, 13999 Démoville;;;delta@exemple.example;30;Relance au trentième jour\n'
  + 'Société Epsilon;5 rue Fictive;;;;0;\n'
  + 'Société Zêta;6 rue Fictive;;;;60;\n'

// Une ligne du formulaire de facture : la page porte, derrière lui, le tableau des factures, dont les lignes sont aussi des `tr`.
function ligneDuFormulaire(page, n) {
  return page.locator(`${FENETRE_FACTURE} tbody tr`).nth(n)
}

// Choisit un article dans la fenêtre du choix : la ligne 1 s'ouvre sur lui.
async function choisirUnArticle(page, nom) {
  await page.getByRole('button', { name: 'Choisir un article, ligne 1', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choisir un article' }).getByRole('button', { name: nom }).click()
}

// Choisit un exercice dans le sélecteur de l'en-tête du dossier, dont les boutons sont des onglets.
function exercice(annee) {
  return async (page) => {
    await page.getByRole('tab', { name: annee, exact: true }).first().click()
    await page.waitForTimeout(400)
  }
}

// LES BOUTONS D'UNE FENÊTRE SUPERPOSÉE NE SONT RECOUVERTS PAR RIEN (14/10/2026, ligne 34.93 ; voir l'en-tête). La fenêtre est celle de
// la visite (`fenetre`), sinon toute fenêtre `[aria-modal="true"]` ; s'il y en a plusieurs, celle DU DESSUS — le plus grand `z-index` de
// son voile, à égalité la dernière du document : les boutons de celle qu'une autre recouvre le sont à bon droit. La carte est défilée
// de bout en bout, par pas d'une carte moins 60 px (une rangée de boutons tient toujours en entier dans une des positions), la
// dernière étant le bas — là où est la dernière rangée. À chaque position, chaque bouton et chaque lien dont le centre est VISIBLE
// (dans la boîte de tous les ancêtres qui rognent, `overflow`, carte comprise) est sondé au centre et au milieu de ses quatre
// bords, à 2 px du bord : `elementFromPoint` doit rendre le bouton lui-même, l'un de ses descendants ou l'un de ses ancêtres (la
// carte, le voile : ce que le bouton traverse est son propre défilement, pas un recouvrement). Un bouton est ATTEIGNABLE s'il est
// dégagé à une position au moins ; sinon c'est UN RECOUVREMENT, cité avec ce qui recouvre (un point hors de l'écran, `null`, aussi).
// Un seul point ne verrait pas la barre du bas qui mord sur le bas d'un bouton : son centre reste dégagé. Une fenêtre où aucun bouton
// n'est visible est une faute : ce serait une mesure aveugle.
async function mesurerLesBoutons(page, fenetre) {
  return page.evaluate((fenetre) => {
    const cartes = [...document.querySelectorAll(fenetre ?? '[aria-modal="true"]')]
    if (cartes.length === 0) return { fautes: [], fenetres: 0, boutons: 0, recouverts: 0 }
    const zDe = (c) => Number.parseInt(getComputedStyle(c.parentElement).zIndex, 10) || 0
    const carte = cartes.reduce((haut, c) => {
      if (zDe(c) !== zDe(haut)) return zDe(c) > zDe(haut) ? c : haut
      return haut.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? c : haut
    })
    const libelle = (b) => (b.getAttribute('aria-label') || b.innerText || b.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const etiquette = (e) => `<${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${[...e.classList].slice(0, 2).map((c) => `.${c}`).join('')}>`
    // Ce qui rogne un bouton avant qu'il atteigne l'écran : un ancêtre dont `overflow` n'est pas `visible`, jusqu'à la carte.
    const rogne = (b, x, y) => {
      for (let p = b.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p)
        if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
          const r = p.getBoundingClientRect()
          if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true
        }
        if (p === carte) break
      }
      return false
    }
    const defilementInitial = carte.scrollTop
    const bas = Math.max(carte.scrollHeight - carte.clientHeight, 0)
    const pas = Math.max(carte.clientHeight - 60, 40)
    const positions = []
    for (let p = 0; p < bas; p += pas) positions.push(p)
    positions.push(bas)
    // Pour chaque bouton : vu (visible à une position au moins), degage (dégagé à une position au moins), cause (le dernier recouvrement).
    const etat = new Map()
    for (const position of positions) {
      carte.scrollTop = position
      for (const b of carte.querySelectorAll('button, a[href]')) {
        const r = b.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || getComputedStyle(b).visibility === 'hidden') continue
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (rogne(b, cx, cy)) continue
        const e = etat.get(b) ?? { degage: false, cause: null }
        etat.set(b, e)
        let cause = null
        for (const [x, y] of [[cx, cy], [cx, r.top + 2], [cx, r.bottom - 2], [r.left + 2, cy], [r.right - 2, cy]]) {
          const dessus = document.elementFromPoint(x, y)
          if (dessus === b || (dessus && (b.contains(dessus) || dessus.contains(b)))) continue
          const barre = dessus?.closest('.sidebar nav, .nav-groupes')
          const par = dessus === null ? 'le bord de l’écran' : barre ? `la barre du bas (${etiquette(barre)})` : etiquette(dessus)
          cause = `${par} à ${Math.round(x)}, ${Math.round(y)}`
          break
        }
        if (cause === null) e.degage = true
        else e.cause = cause
      }
    }
    carte.scrollTop = defilementInitial
    const fautes = []
    let recouverts = 0
    for (const [b, e] of etat) {
      if (e.degage) continue
      fautes.push(`bouton « ${libelle(b)} » recouvert par ${e.cause} — à aucune position de la fenêtre défilée de bout en bout`)
      recouverts++
    }
    if (etat.size === 0) fautes.push('aucun bouton visible dans la fenêtre : la mesure ne voit rien')
    return { fautes, fenetres: 1, boutons: etat.size, recouverts }
  }, fenetre)
}
const largeur = Number(process.argv[2] ?? 1440)
// La passe du client : `client` (la case « Ventes » seule) ou `client-banque` (et « Banque »).
const passeClient = process.argv.slice(3).find((a) => a === 'client' || a === 'client-banque') ?? null
const avecPanneau = process.argv[3] !== 'sans' && passeClient === null
// LE PANNEAU DE DROITE N'EST OUVERT QUE LÀ OÙ IL RÉTRÉCIT LE PANNEAU CENTRAL (08/10/2026). Sous 1 280 pixels
// (`SEUIL_VOLET_EN_LIGNE`, lib/largeurVolets.ts) il se SUPERPOSE à la page (voir CLAUDE.md, « Le panneau de droite ») :
// il n'enlève rien au panneau mesuré, et son voile intercepte les clics des visites à `apres` — à 1 024 pixels, la
// première expirait. Sur téléphone, le bouton « Assistant » est masqué (celui du mobile s'appelle « Ouvrir l'assistant ») :
// le chercher plantait le banc dès la première visite. Le total dit ce qui a été fait, pour qu'un « fermé » demandé et un
// « fermé » imposé ne se confondent pas.
const LARGEUR_DU_PANNEAU_A_COTE = 1280
const panneauOuvert = avecPanneau && largeur >= LARGEUR_DU_PANNEAU_A_COTE
const choisies = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=')).filter(([, v]) => /^\d+$/.test(v ?? '')))

const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)

const BASE = 'http://127.0.0.1:5199/'
const navigateur = await chromium.launch({ executablePath: executable })
const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 } })
await contexte.addInitScript(({ barre, panneau, client }) => {
  if (barre) localStorage.setItem('jd-precompta-largeur-barre', barre)
  if (panneau) localStorage.setItem('jd-precompta-largeur-panneau', panneau)
  // Le compte du banc en client, rattaché à l'atelier avec « Ventes » (voir fauxSupabase.ts), qui est la société affichée.
  if (client) {
    localStorage.setItem('banc-client', '1')
    localStorage.setItem('banc-client-ventes', client === 'client-banque' ? 'banque' : 'sans-banque')
    localStorage.setItem('jd-precompta-dossier-actif', 'd7')
  }
}, { barre: choisies.barre ?? null, panneau: choisies.panneau ?? null, client: passeClient })
// Aucune requête hors du serveur local (voir le piège du mandataire dans vitrine.mjs).
await contexte.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))
const page = await contexte.newPage()
let total = 0
let fenetresSondees = 0
let boutonsSondes = 0
let boutonsRecouverts = 0
const visitesDuClient = passeClient === 'client-banque' ? [...VISITES_CLIENT, ...VISITES_BANQUE_CLIENT] : VISITES_CLIENT
for (const { dossier, onglet, chemin, nom, apres, fenetre, nav, sansAssistant } of passeClient ? visitesDuClient : VISITES) {
  await page.goto(`${BASE}${chemin ?? `#/dossiers/${dossier}/${onglet}`}`)
  await page.waitForTimeout(900)
  // Le bouton « Assistant » est celui d'un dossier : le tableau de bord n'en a pas (`sansAssistant`), son volet de droite reste fermé.
  if (panneauOuvert && !sansAssistant) {
    const bouton = page.getByRole('button', { name: 'Assistant', exact: true })
    if ((await bouton.getAttribute('aria-pressed')) !== 'true') await bouton.click()
  }
  await page.waitForTimeout(300)
  if (apres) {
    await apres(page)
    await page.waitForTimeout(300)
  }
  const fautes = await page.evaluate(({ fenetre, nav }) => {
    // Une fenêtre SUPERPOSÉE se mesure contre sa propre carte : centrée sur l'écran, elle n'a pas à tenir dans le
    // panneau central, mais rien ne doit en sortir. Sa carte défile (overflow-y), donc le défilement ne se cherche
    // qu'à l'intérieur : sinon tout son contenu passerait pour « dans un conteneur qui défile », et rien n'y serait vu.
    // Et une fenêtre qui ne s'est pas ouverte est une faute : mesurer un écran sans elle ne prouverait rien.
    const cadre = document.querySelector(fenetre ?? '.main')
    if (!cadre) return [`la fenêtre ${fenetre} ne s’est pas ouverte`]
    const main = cadre.getBoundingClientRect()
    const contenu = fenetre ? `${fenetre} *` : '.main-contenu *'
    const defile = (e) => {
      for (let p = e.parentElement; p && p !== cadre && !p.classList.contains('main'); p = p.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return true
      }
      return false
    }
    const extrait = (e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    // Un élément en `position: fixed` — avec tout ce qu'il porte — n'est pas posé DANS le panneau : il se place contre la
    // fenêtre du navigateur. Sur téléphone, la barre du bas (`div.nav-groupes`) est exactement aussi large que l'écran, donc
    // que le panneau, et chaque visite la citait à « 0 px hors du panneau » (64 fois à 390 px) : des fautes qui n'en étaient
    // pas, parmi lesquelles les vraies passaient inaperçues. Les mesurer contre `.main` n'a pas de sens. Mais la visite d'une
    // FENÊTRE mesure la sienne contre sa carte, et le voile de cette fenêtre est lui-même fixe : l'exclusion y viderait la mesure.
    const fixes = fenetre ? [] : [...document.querySelectorAll(contenu)].filter((e) => getComputedStyle(e).position === 'fixed')
    const trouvees = []
    for (const e of document.querySelectorAll(contenu)) {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || defile(e)) continue
      if (fixes.some((f) => f.contains(e))) continue
      // La carte ou la case de grille qui le porte : le premier ancêtre qui en est une.
      const carte = e.parentElement?.closest('.card, .kpi, .widget, .cockpit, .bento > *')
      const bord = carte ? carte.getBoundingClientRect().right : null
      const horsPanneau = r.right > main.right - 1
      const horsCarte = bord !== null && r.right > bord + 1
      if (!horsPanneau && !horsCarte) continue
      if (trouvees.some((t) => t.el.contains(e))) continue
      const ecart = Math.round(horsPanneau ? r.right - main.right : r.right - bord)
      trouvees.push({ el: e, texte: `${ecart} px ${horsPanneau ? 'hors du panneau' : 'hors de sa carte'} — <${e.tagName.toLowerCase()}> ${extrait(e)}` })
    }
    // Un texte plus large que sa boîte : la boîte tient dans sa carte, le mot trop long en sort. Seul l'élément qui
    // porte le texte compte — ses ancêtres débordent avec lui.
    const textes = []
    for (const e of document.querySelectorAll(contenu)) {
      if (e.clientWidth === 0 || defile(e)) continue
      const style = getComputedStyle(e)
      if (style.overflowX !== 'visible' || style.display === 'inline' || e.scrollWidth <= e.clientWidth + 1) continue
      if (![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue
      if (trouvees.some((t) => t.el.contains(e))) continue
      textes.push(`${e.scrollWidth - e.clientWidth} px de texte hors de sa boîte — <${e.tagName.toLowerCase()}> ${extrait(e)}`)
    }
    // Un mot coupé au milieu (voir l'en-tête). Le même cadre et la même exclusion des éléments fixes que ci-dessus, mais PAS
    // celle des conteneurs qui défilent : un mot coupé dans un `.table-scroll` l'est aussi. Un jeton est une suite sans espace
    // ORDINAIRE — `\s` compterait aussi les insécables, qui doivent rester dans le morceau —, et il se recoupe après un trait
    // d'union ou un tiret, et après une barre oblique sauf entre deux chiffres : le navigateur n'y propose aucune coupure.
    const estChiffre = (c) => c !== undefined && c >= '0' && c <= '9'
    const morceauxDe = (jeton) => {
      const bornes = []
      let debut = 0
      for (let i = 0; i < jeton.length - 1; i++) {
        const c = jeton[i]
        if ('-‐–—'.includes(c) || (c === '/' && !(estChiffre(jeton[i - 1]) && estChiffre(jeton[i + 1])))) {
          bornes.push([debut, i + 1])
          debut = i + 1
        }
      }
      bornes.push([debut, jeton.length])
      return bornes
    }
    // Le morceau tel que l'écran le coupe : une barre verticale devant chaque caractère qui tombe plus bas que le précédent.
    const rangee = document.createRange()
    const coupureDe = (n, debut, fin) => {
      let sortie = ''
      let haut = null
      let i = debut
      for (const car of n.nodeValue.slice(debut, fin)) {
        rangee.setStart(n, i)
        rangee.setEnd(n, i + car.length)
        const r = [...rangee.getClientRects()].find((x) => x.width > 0)
        if (r) {
          if (haut !== null && r.top - haut > 3) sortie += '|'
          haut = r.top
        }
        sortie += car
        i += car.length
      }
      return sortie
    }
    const coupes = []
    const marche = document.createTreeWalker(cadre, NodeFilter.SHOW_TEXT)
    for (let n = marche.nextNode(); n; n = marche.nextNode()) {
      const parent = n.parentElement
      if (!parent || !n.nodeValue.trim() || fixes.some((f) => f.contains(parent))) continue
      for (const jeton of n.nodeValue.matchAll(/[^ \t\n\r]+/g)) {
        for (const [debut, fin] of morceauxDe(jeton[0])) {
          // De 2 à 24 caractères : au-delà (adresse électronique, IBAN, référence longue), couper est admis.
          const longueur = [...jeton[0].slice(debut, fin)].length
          if (longueur < 2 || longueur > 24) continue
          rangee.setStart(n, jeton.index + debut)
          rangee.setEnd(n, jeton.index + fin)
          const sommets = [...rangee.getClientRects()].filter((r) => r.width > 0).map((r) => r.top).sort((a, b) => a - b)
          if (!sommets.some((s, i) => i > 0 && s - sommets[i - 1] > 3)) continue
          coupes.push(`mot coupé au milieu — « ${coupureDe(n, jeton.index + debut, jeton.index + fin)} » dans <${parent.tagName.toLowerCase()}> (${Math.round(parent.getBoundingClientRect().width)} px)`)
        }
      }
    }
    // LA NAVIGATION DU CLIENT (`nav`) : posée en `position: fixed` sur téléphone, elle échappe aux règles ci-dessus. Chacune
    // de ses entrées doit tenir dans sa case, et la barre dans la largeur de l'écran — cinq entrées avec « Mes ventes ».
    const entrees = []
    if (nav) {
      const barreNav = document.querySelector('.sidebar nav')
      if (!barreNav) entrees.push('la navigation du client est absente')
      else {
        const visible = getComputedStyle(barreNav).display !== 'none'
        if (visible && barreNav.scrollWidth > barreNav.clientWidth + 1) {
          entrees.push(`${barreNav.scrollWidth - barreNav.clientWidth} px de navigation hors de la barre`)
        }
        for (const a of barreNav.querySelectorAll('a')) {
          if (!visible || a.clientWidth === 0) continue
          if (a.scrollWidth > a.clientWidth + 1) entrees.push(`entrée « ${a.getAttribute('title')} » : ${a.scrollWidth - a.clientWidth} px hors de sa case`)
          const r = a.getBoundingClientRect()
          if (r.right > window.innerWidth + 1 || r.left < -1) entrees.push(`entrée « ${a.getAttribute('title')} » hors de l’écran`)
        }
        if (!visible) entrees.push('la navigation du client est cachée sur cet écran')
        // La passe du client ne mesure rien si le compte n'est pas celui qui porte « Ventes » : l'entrée doit être là.
        if (!barreNav.querySelector('a[title="Mes ventes"]')) entrees.push('l’entrée « Mes ventes » manque à la navigation')
      }
    }
    return [...trouvees.map((t) => t.texte), ...textes, ...coupes, ...entrees]
  }, { fenetre: fenetre ?? null, nav: nav ?? false })
  // Les boutons de la fenêtre ouverte, APRÈS le reste : la carte y est défilée jusqu'en bas, ce qui déplace ce que les règles
  // ci-dessus mesurent.
  const sondage = await mesurerLesBoutons(page, fenetre ?? null)
  fautes.push(...sondage.fautes)
  fenetresSondees += sondage.fenetres
  boutonsSondes += sondage.boutons
  boutonsRecouverts += sondage.recouverts
  total += fautes.length
  console.log(`${nom} : ${fautes.length ? '\n   ' + fautes.join('\n   ') : 'rien ne déborde'}`)
}
await navigateur.close()
const volets = Object.entries(choisies).map(([k, v]) => `${k} ${v}`).join(', ')
const etatDuPanneau = panneauOuvert ? 'ouvert'
  : avecPanneau ? `fermé (sous ${LARGEUR_DU_PANNEAU_A_COTE} px il se superpose au lieu de rétrécir le panneau central : l’ouvrir ne mesurerait rien de plus)`
  : 'fermé'
console.log(`\n${boutonsRecouverts} bouton(s) de fenêtre superposée recouvert(s), sur ${boutonsSondes} sondés dans ${fenetresSondees} fenêtre(s).`)
console.log(`\n${total} débordement(s) à ${largeur} px, panneau de droite ${etatDuPanneau}${volets ? ` (largeurs choisies : ${volets})` : ''}${passeClient ? `, passe du client (${passeClient})` : ''}.`)
process.exitCode = total > 0 ? 1 : 0
