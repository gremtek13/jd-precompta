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
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'

const ONGLETS = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'bilan', 'tva', 'immobilisations',
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
  { dossier: 'd9', onglet: 'bilan', nom: 'bilan/report', apres: exercice('2026') },
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
]

// Le bouton d'une ligne du tableau des factures, désignée par son numéro.
function boutonDeFacture(page, numero, nom) {
  return page.locator('tr', { hasText: numero }).getByRole('button', { name: nom, exact: true })
}

// Ferme les fenêtres de facturation qu'une visite précédente a laissées ouvertes : « Annuler » sur le formulaire, « Fermer »
// sur l'aperçu et sur la transmission. Une fenêtre qui n'a ni l'un ni l'autre est une faute du banc, dite plutôt que
// attendue jusqu'à l'expiration d'un clic.
async function fermerLesFenetres(page) {
  const voile = page.locator(VOILE_FACTURE)
  for (let i = 0; i < 5 && (await voile.count()) > 0; i++) {
    const fermer = voile.first().getByRole('button', { name: /^(Annuler|Fermer)$/ })
    if ((await fermer.count()) === 0) throw new Error('une fenêtre de facturation est ouverte sans bouton « Annuler » ni « Fermer »')
    await fermer.first().click()
    await page.waitForTimeout(200)
  }
}

// Choisit un exercice dans le sélecteur de l'en-tête du dossier, dont les boutons sont des onglets.
function exercice(annee) {
  return async (page) => {
    await page.getByRole('tab', { name: annee, exact: true }).first().click()
    await page.waitForTimeout(400)
  }
}
const largeur = Number(process.argv[2] ?? 1440)
const avecPanneau = process.argv[3] !== 'sans'
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
await contexte.addInitScript(({ barre, panneau }) => {
  if (barre) localStorage.setItem('jd-precompta-largeur-barre', barre)
  if (panneau) localStorage.setItem('jd-precompta-largeur-panneau', panneau)
}, { barre: choisies.barre ?? null, panneau: choisies.panneau ?? null })
// Aucune requête hors du serveur local (voir le piège du mandataire dans vitrine.mjs).
await contexte.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))
const page = await contexte.newPage()
let total = 0
for (const { dossier, onglet, nom, apres, fenetre } of VISITES) {
  await page.goto(`${BASE}#/dossiers/${dossier}/${onglet}`)
  await page.waitForTimeout(900)
  if (panneauOuvert) {
    const bouton = page.getByRole('button', { name: 'Assistant', exact: true })
    if ((await bouton.getAttribute('aria-pressed')) !== 'true') await bouton.click()
  }
  await page.waitForTimeout(300)
  if (apres) {
    await apres(page)
    await page.waitForTimeout(300)
  }
  const fautes = await page.evaluate((fenetre) => {
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
    return [...trouvees.map((t) => t.texte), ...textes, ...coupes]
  }, fenetre ?? null)
  total += fautes.length
  console.log(`${nom} : ${fautes.length ? '\n   ' + fautes.join('\n   ') : 'rien ne déborde'}`)
}
await navigateur.close()
const volets = Object.entries(choisies).map(([k, v]) => `${k} ${v}`).join(', ')
const etatDuPanneau = panneauOuvert ? 'ouvert'
  : avecPanneau ? `fermé (sous ${LARGEUR_DU_PANNEAU_A_COTE} px il se superpose au lieu de rétrécir le panneau central : l’ouvrir ne mesurerait rien de plus)`
  : 'fermé'
console.log(`\n${total} débordement(s) à ${largeur} px, panneau de droite ${etatDuPanneau}${volets ? ` (largeurs choisies : ${volets})` : ''}.`)
process.exitCode = total > 0 ? 1 : 0
