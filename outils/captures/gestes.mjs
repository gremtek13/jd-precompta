// LES GESTES QUI ÉCRIVENT, JOUÉS DANS UN VRAI NAVIGATEUR (28/11/2026) — le parcours du MVP au-delà de la lecture : associer une pièce
// à un mouvement et le défaire, affecter une catégorie et la retirer, ignorer, rapprocher une échéance de cotisation, importer un
// relevé jusqu'au bout, appliquer les règles en lot, valider une pièce puis une sélection, saisir puis retirer une opération de
// caisse, passer puis retirer une écriture libre. Chaque geste joue sur une page RECHARGÉE (le banc d'origine), sous le levier
// `banc-ecritures` du faux Supabase (voir `appliquerEcriture` dans fauxSupabase.ts) : ses écritures s'appliquent aux lignes servies,
// et l'écran relu doit dire l'état d'après. Le banc n'est pas la base : un geste vert dit que l'ÉCRAN envoie, relit et dit juste,
// jamais que la base l'accepterait (ses refus se jouent par `supabase/essais/`).
//
// LA SECONDE PASSE (28/11/2026) ajoute : la facture (brouillon, validation et son numéro, aperçu, avoir, e-mail), l'encaissement et
// sa contre-passation, le devis (émis, envoyé, accepté, l'acompte puis le solde facturés), la facture du client « Ventes » ; les
// autres classements d'un mouvement (ventilation, virement personnel, compte de bilan, règlement groupé, échéance d'emprunt),
// « Écarter cette proposition », le mode de règlement ; « Saisir un mois » (cabinet et praticien), « Remplacer » une opération,
// « Corriger » un paiement en espèces (cabinet et praticien) ; l'identité du dossier, un seuil du chiffre d'affaires, un compte
// bancaire ajouté puis retiré, le statut de TVA, une case d'un accès ; l'import des paiements de l'assurance maladie (cabinet et
// praticien), l'association d'un crédit et son retrait, l'import d'un bordereau FICTIF (src/test/bordereauFictif.ts) ; et le
// refus de chacun. Le faux sert pour cela leurs fonctions (`rpcDesGestes`, `rpcDesVentes`, `send-email`), quelques colonnes que
// le banc ne servait pas (`mentions_identite`, `mode_reglement`, l'identité légale de l'atelier) et ses comptes bancaires lus de
// leur table, sous le seul levier `banc-ecritures`.
//
// HORS DU BANC, À DESSEIN : la validation d'un exercice (`valider_exercice`). Elle fige l'année, numérote le FEC, scelle une empreinte
// et refuse sur des dizaines de filets que seule la base tient : l'imiter dirait juste un écran que la base pourrait refuser, et
// rien de ce qu'elle fige ne se relirait vrai. Elle se joue sur une réplique (`supabase/essais/validationExercice.sql`).
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application (voir vitrine.mjs) ; `BANC_PORT=5200` en sert une
//                                                           # seconde à côté (une autre copie de travail), que ce script suit aussi
//   node outils/captures/gestes.mjs [largeur]               # 1440 par défaut ; 390 joue le téléphone (la fiche flottante)
//   GESTES=gestes/caisse node outils/captures/gestes.mjs    # les seuls gestes dont le nom commence ainsi
//
// Ce qui se relève à chaque geste, et se compte (le script échoue sur la moindre faute) :
//   - le geste lui-même : l'état attendu à l'écran après le clic (« Rapproché », « Validée », la ligne importée…), sinon la faute
//     cite l'attente qui a expiré ;
//   - la console : toute erreur, toute exception de la page, tout avertissement de React ;
//   - les messages bruts : un `window.alert` ou un texte de la page qui porte un message technique (« maquette », « permission
//     denied », « violates », « [object Object] », « undefined », « NaN », une exception JavaScript) ;
//   - un verrou qui ne se relâche pas : un bouton désactivé dont le libellé finit par « … » une seconde et demie après le geste ;
//   - une écriture qui n'est pas partie : le journal du faux (`window.__ecrituresDuBanc`) vide après un geste qui écrit ;
//   - une fenêtre superposée restée ouverte après le geste — déclarée (`aria-modal`) ou un voile fixe qui couvre la vue et porte une
//     carte ; un refus qui garde sa fenêtre et sa saisie le déclare (`fenetreGardee`) ;
//   - les débordements et les boutons recouverts, par les mesures de debordements.mjs (mesures.mjs), sur l'écran d'après.
// Et se dit sans se compter (une remarque) : un filtre d'écriture que le banc n'a pas su appliquer (le journal le nomme) ; le
// focus rendu au document (`<body>`) une fois le geste fini — le bouton cliqué a quitté l'écran sans passer la main.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { BASE_DU_BANC, ecritureLibrePassee, ecritureLibreRetiree, SECTION_LIBRE } from './ecrituresLibres.mjs'
import { mesurerLesBoutons, mesurerLesDebordements } from './mesures.mjs'
import { bordereauFictifEnPdf } from '../../src/test/bordereauFictif.ts'

const largeur = Number(process.argv[2] ?? 1440)
const telephone = largeur <= 720

// Les relevés FICTIFS de l'import : un qui boucle (1 000,00 + 1 250,40 − 45,90 = 2 204,50) et un qui ne boucle pas (il y manque
// 100 € : le solde de clôture dit 2 104,50 pour les mêmes mouvements). Les soldes sont des lignes du relevé, au montant porté dans
// la colonne du crédit, comme un export de banque les écrit — la colonne du solde courant n'alimente pas le contrôle (IMPORT-Q1).
// Les leviers du faux Supabase que la passe `client-caisse` de debordements.mjs pose : le compte du banc est le praticien du
// cabinet infirmier (d1), avec « Caisse », « Ventes » et « Banque ».
const LEVIERS_DU_PRATICIEN = { 'banc-client': '1', 'banc-client-caisse': '1', 'jd-precompta-dossier-actif': 'd1' }

// Le titulaire de l'atelier de conseil (d7), avec « Ventes » et « Banque » : la passe `client-banque` de debordements.mjs.
const LEVIERS_DES_VENTES = { 'banc-client': '1', 'banc-client-ventes': 'banque', 'jd-precompta-dossier-actif': 'd7' }

// UNE FACTURE FICTIVE, SAISIE À LA MAIN dans le formulaire (onglet Factures du cabinet, « Mes ventes › Factures » du client) : un
// client assujetti, des services, une ligne de 2 × 150,00 € HT à 20 %.
async function factureSaisie(page, tiers) {
  await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
  await page.locator('#tiers-nom').fill(tiers)
  await page.locator('#type-client').selectOption('assujetti')
  await page.locator('#tiers-siren').fill('555123454')
  await page.locator('#tiers-adresse').fill('3 rue Fictive\n69003 Lyon')
  await page.locator('#nature-operation').selectOption('services')
  await page.locator('td[data-libelle="Désignation"] input').first().fill('Conseil fictif en organisation')
  await page.locator('td[data-libelle="Qté"] input').first().fill('2')
  await page.locator('td[data-libelle="PU HT"] input').first().fill('150')
  await page.locator('td[data-libelle="TVA %"] input').first().fill('20')
}
// UN DEVIS FICTIF, de la vue « Devis » : 4 séances à 50,00 € HT, sans TVA.
async function devisSaisi(page, tiers) {
  await page.getByRole('tab', { name: 'Devis', exact: true }).click()
  await page.getByRole('button', { name: '+ Nouveau devis', exact: true }).click()
  await page.locator('#devis-client').fill(tiers)
  await page.locator('#devis-type').selectOption('assujetti')
  await page.locator('#devis-siren').fill('555123454')
  await page.locator('#devis-adresse').fill('8 rue Fictive\n13100 Aix-en-Provence')
  await page.locator('#devis-objet').fill('Prestations fictives du premier trimestre')
  await page.locator('#devis-nature').selectOption('services')
  await page.getByLabel('Désignation de la ligne 1').fill('Séance fictive')
  await page.getByLabel('Quantité de la ligne 1').fill('4')
  await page.getByLabel('Prix unitaire HT de la ligne 1').fill('50')
  await page.getByLabel('Taux de TVA de la ligne 1').fill('0')
}
// UN FICHIER DE PAIEMENTS DE L'ASSURANCE MALADIE, FICTIF (l'export CSV d'un logiciel de facturation : une ligne par facture, ni nom
// ni numéro de patient) : trois factures, deux journées comptables ; la part obligatoire réglée colonne par colonne, rien d'avance.
const PAIEMENTS_FICTIFS = 'Facture;Journée AMO;Montant AMO;Régime;Caisse\n1;12/10/2026;23,50;1;131\n2;12/10/2026;31,20;1;131\n3;13/10/2026;18,00;1;131\n'
async function importerDesPaiements(page) {
  await page.getByRole('button', { name: 'Importer un fichier de paiements', exact: true }).click()
  const fenetre = page.getByRole('dialog', { name: 'Importer des paiements de l’assurance maladie' })
  await fenetre.locator('#paiements-am-fichier').setInputFiles({ name: 'paiements-fictifs.csv', mimeType: 'text/csv', buffer: Buffer.from(PAIEMENTS_FICTIFS) })
  const part = fenetre.locator('fieldset', { hasText: 'Part obligatoire' })
  await part.locator('legend input[type=checkbox]').check()
  await part.getByLabel('Journée comptable').selectOption({ label: 'Journée AMO' })
  await part.getByLabel('Montant payé').selectOption({ label: 'Montant AMO' })
  await part.getByLabel('Code du régime (au choix)').selectOption({ label: 'Régime' })
  await part.getByLabel('Numéro de la caisse (au choix)').selectOption({ label: 'Caisse' })
  // L'aperçu : les agrégats par journée, avant tout envoi.
  await fenetre.getByText(/^2 paiements, 72,70\s€ au total/).waitFor({ timeout: 10000 })
  if ((await journal(page)).length > 0) throw new Error('l’aperçu a écrit avant le clic')
  await fenetre.getByRole('button', { name: 'Importer 2 paiements', exact: true }).click()
  await doubleClic(fenetre.getByRole('button', { name: 'Confirmer l’import', exact: true }))
  await page.getByText(/^Importé\. Seuls les chiffres ont été gardés/).first().waitFor({ timeout: 10000 })
  await uneSeuleFois(page, 0, 'rpc importer_paiements_assurance_maladie')
  await page.locator('tr', { hasText: 'du 12/10/2026 au 13/10/2026' }).first().waitFor({ timeout: 10000 })
}
const ligneDeFacture = (page, texte) => page.locator('tr.clickable', { hasText: texte }).first()

const RELEVE = (cloture) => 'Date;Libellé;Débit;Crédit\n'
  + '01/10/2026;SOLDE AU 30/09/2026;;1 000,00\n'
  + '02/10/2026;VIR CPAM REMBOURSEMENTS OCTOBRE;;1 250,40\n'
  + '05/10/2026;CB PHARMACIE CENTRALE;45,90;\n'
  + `31/10/2026;SOLDE AU 31/10/2026;;${cloture}\n`

// La fiche d'un mouvement, ouverte par un clic sur sa ligne (sur téléphone aussi : la ligne repliée en fiche reste cliquable).
async function ouvrirLeMouvement(page, libelle, { tous = false } = {}) {
  if (tous) await page.getByRole('button', { name: 'Tous', exact: true }).first().click()
  await page.locator('tr.clickable', { hasText: libelle }).first().click()
  const fiche = page.locator('.fiche-mouvement').first()
  await fiche.getByText(libelle).first().waitFor({ timeout: 10000 })
  return fiche
}
// Une pastille de la fiche, attendue après la relecture.
const pastille = (fiche, texte) => fiche.locator('.badge', { hasText: texte }).first().waitFor({ timeout: 10000 })
// LE DOUBLE CLIC DU MÊME INSTANT : deux `click()` dans la même tâche du navigateur, avant tout rendu — ce que deux clics rapprochés
// font, et ce que le verrou `useRef` d'un geste doit arrêter. Le journal du faux dit ensuite combien d'écritures sont parties.
const doubleClic = (bouton) => bouton.evaluate((b) => { b.click(); b.click() })
const journal = (page) => page.evaluate(() => (window.__ecrituresDuBanc ?? []).map((e) => `${e.genre}${e.table ? ` ${e.table}` : ''}`))
// Combien de fois l'écriture `quoi` est partie depuis la position `depuis` du journal : une seule, ou le verrou n'a rien arrêté.
async function uneSeuleFois(page, depuis, quoi) {
  const parties = (await journal(page)).slice(depuis).filter((e) => e === quoi).length
  if (parties !== 1) throw new Error(`« ${quoi} » est partie ${parties} fois pour un double clic (le verrou du geste ne l’a pas arrêtée)`)
}

const GESTES = [
  {
    nom: 'gestes/associer-une-piece', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'CB PAPETERIE MODERNE')
      await pastille(fiche, 'Non rapproché')
      await doubleClic(fiche.getByRole('button', { name: 'Associer cette pièce', exact: true }))
      await pastille(fiche, 'Rapproché')
      await uneSeuleFois(page, 0, 'update lignes_bancaires')
      // La liste relue avec la fiche : la ligne du mouvement dit la même chose qu'elle. Sur téléphone, la fiche flotte par-dessus la
      // liste : elle se ferme d'abord, puis se rouvre sur la ligne.
      if (telephone) await page.getByRole('button', { name: 'Fermer le panneau', exact: true }).first().click()
      await page.getByRole('button', { name: 'Tous', exact: true }).first().click()
      await page.locator('tr.clickable', { hasText: 'CB PAPETERIE MODERNE' }).first().locator('.badge', { hasText: 'Rapproché' }).waitFor({ timeout: 10000 })
      if (telephone) await ouvrirLeMouvement(page, 'CB PAPETERIE MODERNE')
      const n = (await journal(page)).length
      await doubleClic(fiche.getByRole('button', { name: 'Annuler le rapprochement', exact: true }))
      await pastille(fiche, 'Non rapproché')
      await uneSeuleFois(page, n, 'update lignes_bancaires')
    },
  },
  {
    nom: 'gestes/affecter-une-categorie', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'VIR CPAM TIERS PAYANT SEPT')
      const choix = fiche.locator('#affecter-categorie')
      const valeur = await choix.locator('option').evaluateAll((os) => os.map((o) => o.value).find((v) => v !== ''))
      await choix.selectOption(valeur)
      await doubleClic(fiche.getByRole('button', { name: 'Affecter', exact: true }))
      await pastille(fiche, 'Affecté')
      await uneSeuleFois(page, 0, 'rpc affecter_mouvement_bancaire')
      // L'écriture de l'affectation, relue par l'onglet Écritures (le même document : le faux garde ce qui a été écrit), sous le
      // libellé composé d'un crédit du relevé (JJ1-Q1), jamais celui de la banque.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/ecritures`)
      await page.getByText('Crédit du relevé du 22/09/2026').first().waitFor({ timeout: 10000 })
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/banque`)
      const relue = await ouvrirLeMouvement(page, 'VIR CPAM TIERS PAYANT SEPT', { tous: true })
      await relue.getByRole('button', { name: 'Annuler l’affectation', exact: true }).click()
      await pastille(relue, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/ignorer', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'FRAIS OPPOSITION CHEQUE')
      await doubleClic(fiche.getByRole('button', { name: 'Ignorer', exact: true }))
      await pastille(fiche, 'Ignoré')
      await uneSeuleFois(page, 0, 'update lignes_bancaires')
      await fiche.getByRole('button', { name: 'Remettre à traiter', exact: true }).click()
      await pastille(fiche, 'Non rapproché')
    },
  },
  // « Toujours ignorer ce type… » : la règle née du mouvement (le motif proposé, accepté tel quel), le mouvement ignoré avec elle.
  {
    nom: 'gestes/toujours-ignorer', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV SEPA TELECOM PLUS')
      await fiche.getByRole('button', { name: 'Toujours ignorer ce type…', exact: true }).click()
      await pastille(fiche, 'Ignoré')
      const parties = await journal(page)
      if (!parties.includes('insert regles_bancaires_ignorees')) throw new Error(`la règle n’est pas partie (${parties.join(', ')} ; ${alertes.join(' | ')})`)
    },
  },
  // Les deux lots du relevé : « Tout rapprocher automatiquement » (les paires sans doute possible) et « Valider et rapprocher ».
  {
    nom: 'gestes/tout-rapprocher', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const bouton = page.getByRole('button', { name: /^Tout rapprocher automatiquement \(\d+\)$/ })
      await bouton.waitFor({ timeout: 10000 })
      const avant = Number((await bouton.innerText()).match(/\((\d+)\)/)[1])
      await doubleClic(bouton)
      await page.waitForFunction((n) => {
        const b = [...document.querySelectorAll('button')].find((x) => /^Tout rapprocher automatiquement/.test(x.innerText))
        return !b || Number(b.innerText.match(/\((\d+)\)/)?.[1] ?? n) < n
      }, avant, { timeout: 10000 })
      const ecrits = (await journal(page)).filter((e) => e === 'update lignes_bancaires').length
      if (ecrits !== avant) throw new Error(`${ecrits} mouvement(s) écrit(s) pour ${avant} proposé(s)`)
    },
  },
  {
    nom: 'gestes/valider-et-rapprocher', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const bouton = page.getByRole('button', { name: /^Valider et rapprocher/ }).first()
      await bouton.waitFor({ timeout: 10000 })
      const libelle = await bouton.innerText()
      const n = /cette pièce$/.test(libelle) ? 1 : Number(libelle.match(/les (\d+)$/)?.[1])
      await doubleClic(bouton)
      await bouton.waitFor({ state: 'detached', timeout: 10000 })
      const parties = await journal(page)
      for (const quoi of ['update pieces', 'update lignes_bancaires']) {
        const fois = parties.filter((e) => e === quoi).length
        if (fois !== n) throw new Error(`« ${quoi} » est partie ${fois} fois pour ${n} pièce(s) du lot (« ${libelle} »)`)
      }
    },
  },
  // Une échéance de cotisation saisie dans l'onglet Cotisations, relue dans sa liste.
  {
    nom: 'gestes/ajouter-une-echeance', chemin: '#/dossiers/d1/cotisations', ecrit: true,
    jouer: async (page) => {
      await page.locator('#echeance').fill('2026-11-05')
      await page.locator('#appele').fill('275')
      await doubleClic(page.getByRole('button', { name: 'Ajouter', exact: true }))
      await page.getByText('05/11/2026').first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'insert cotisations_declarees')
      if ((await page.locator('#appele').inputValue()) !== '') throw new Error('le montant saisi reste dans le formulaire après l’ajout')
    },
  },
  {
    nom: 'gestes/echeance-de-cotisation', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV CAISSE RETRAITE ECHEANCE SEPTEMBRE', { tous: true })
      await fiche.getByRole('button', { name: 'Annuler le rapprochement', exact: true }).click()
      await pastille(fiche, 'Non rapproché')
      const choix = fiche.locator('#associer-cotisation')
      if ((await choix.count()) > 0) {
        const valeur = await choix.locator('option').evaluateAll((os) => os.map((o) => o.value).find((v) => v !== ''))
        await choix.selectOption(valeur)
      }
      const n = (await journal(page)).length
      await doubleClic(fiche.getByRole('button', { name: 'Associer cette échéance', exact: true }))
      await fiche.getByRole('button', { name: 'Annuler le rapprochement', exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc rapprocher_cotisation')
      // L'échéance relue par l'onglet Cotisations : son versement lu au relevé.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/cotisations`)
      await page.getByText('310,00 € (relevé)').first().waitFor({ timeout: 10000 })
    },
  },
  {
    nom: 'gestes/importer-un-releve', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page, alertes) => {
      const carte = page.locator('.card', { hasText: 'Importer un relevé bancaire' }).first()
      await carte.locator('input[type=file]').first().setInputFiles({
        name: 'releve-fictif-octobre.csv', mimeType: 'text/csv', buffer: Buffer.from(RELEVE('2 204,50')),
      })
      await carte.getByText('Ce que l’import lira').waitFor({ timeout: 10000 })
      await doubleClic(carte.getByRole('button', { name: /^Importer \d+ ligne\(s\)$/ }))
      // Les lignes du relevé (`tr.clickable`) : la carte des règles porte aussi des lignes de tableau, dépliées ou non.
      await page.locator('tr.clickable', { hasText: 'CB PHARMACIE CENTRALE' }).first().waitFor({ timeout: 10000 })
      await page.locator('tr.clickable', { hasText: 'VIR CPAM REMBOURSEMENTS OCTOBRE' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'insert lignes_bancaires')
      await uneSeuleFois(page, 0, 'upsert controles_releves_bancaires')
      if (!alertes.some((a) => /2 ligne\(s\) importée\(s\)/.test(a))) throw new Error(`l’import n’a pas dit « 2 ligne(s) importée(s) » (${alertes.join(' | ') || 'aucune alerte'})`)
      // Le même fichier redéposé : le dédoublonnage le dit, rien ne repart.
      const n = (await journal(page)).length
      await carte.locator('input[type=file]').first().setInputFiles({
        name: 'releve-fictif-octobre-bis.csv', mimeType: 'text/csv', buffer: Buffer.from(RELEVE('2 204,50')),
      })
      await carte.getByText('Ce que l’import lira').waitFor({ timeout: 10000 })
      await carte.getByRole('button', { name: /^Importer \d+ ligne\(s\)$/ }).click()
      await page.getByText('Ce relevé semble déjà importé (mêmes date, libellé et montant).').waitFor({ timeout: 10000 })
      if ((await journal(page)).length !== n) throw new Error('le relevé redéposé a écrit quelque chose')
    },
  },
  {
    nom: 'gestes/importer-un-releve-qui-ne-boucle-pas', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page, alertes) => {
      const carte = page.locator('.card', { hasText: 'Importer un relevé bancaire' }).first()
      await carte.locator('input[type=file]').first().setInputFiles({
        name: 'releve-fictif-octobre-incomplet.csv', mimeType: 'text/csv', buffer: Buffer.from(RELEVE('2 104,50')),
      })
      await carte.getByText('Ce que l’import lira').waitFor({ timeout: 10000 })
      await carte.getByRole('button', { name: /^Importer \d+ ligne\(s\)$/ }).click()
      await page.getByText('Un relevé ne boucle pas').first().waitFor({ timeout: 10000 })
      if (!alertes.some((a) => a.includes('Ce relevé ne boucle pas'))) throw new Error('l’import n’a pas dit que le relevé ne boucle pas')
    },
  },
  {
    nom: 'gestes/regles-en-lot', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const carte = page.locator('.card', { hasText: 'Affectations proposées par vos règles' }).first()
      await carte.waitFor({ timeout: 10000 })
      await doubleClic(carte.getByRole('button', { name: /^Affecter/ }).first())
      await carte.waitFor({ state: 'detached', timeout: 10000 }).catch(async () => {
        if ((await carte.getByRole('button', { name: /^Affecter/ }).count()) > 0) throw new Error('la carte des règles propose encore ses affectations après le lot')
      })
      await uneSeuleFois(page, 0, 'rpc affecter_mouvements_bancaires')
    },
  },
  {
    nom: 'gestes/valider-une-piece', chemin: '#/dossiers/d1/pieces', ecrit: true,
    jouer: async (page) => {
      await page.getByRole('cell', { name: 'Télécom Plus' }).first().click()
      await doubleClic(page.getByRole('button', { name: 'Valider', exact: true }).first())
      await page.locator('tr', { hasText: 'Télécom Plus' }).first().getByText(/Validée/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'update pieces')
    },
  },
  {
    nom: 'gestes/valider-la-selection', chemin: '#/dossiers/d1/pieces', ecrit: true,
    jouer: async (page) => {
      for (const tiers of ['Pharma Distrib Sud', 'Garage du Centre']) {
        await page.locator('tr', { hasText: tiers }).first().locator('input[type=checkbox]').check()
      }
      await doubleClic(page.getByRole('button', { name: /^Valider la sélection/ }).first())
      for (const tiers of ['Pharma Distrib Sud', 'Garage du Centre']) {
        await page.locator('tr', { hasText: tiers }).first().getByText(/Validée/).waitFor({ timeout: 10000 })
      }
      await uneSeuleFois(page, 0, 'update pieces')
      // La sélection se vide avec la relecture : plus rien à valider.
      if ((await page.getByRole('button', { name: /^Valider la sélection/ }).count()) > 0) throw new Error('« Valider la sélection » s’offre encore après la validation')
    },
  },
  {
    nom: 'gestes/operation-de-caisse', chemin: '#/dossiers/d1/caisse', ecrit: true,
    jouer: async (page) => {
      const formulaire = page.getByRole('form', { name: 'Saisie d’une opération' })
      await formulaire.waitFor({ timeout: 10000 })
      await formulaire.locator('#caisse-genre').selectOption('apport')
      await formulaire.locator('#caisse-date').fill('2026-09-24')
      await formulaire.locator('#caisse-montant').fill('50,00')
      await doubleClic(formulaire.getByRole('button', { name: 'Enregistrer', exact: true }))
      // Le journal range chaque jour sous une ligne de titre (« 24/09/2026 — solde… »), ses opérations dessous.
      await page.getByText('Opération enregistrée le 24/09/2026.').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_operation_caisse')
      const jour = page.locator('tr', { hasText: '24/09/2026 — solde de la caisse en fin de journée : 493,00 €' })
      await jour.first().waitFor({ timeout: 10000 })
      // Le formulaire se vide pour la saisie suivante.
      if ((await formulaire.locator('#caisse-montant').inputValue()) !== '') throw new Error('le montant saisi reste dans le formulaire après l’enregistrement')
      const ligne = page.locator('tr', { hasText: 'Apport en caisse de l’exploitant' }).filter({ hasText: '50,00 €' }).last()
      await ligne.getByRole('button', { name: 'Retirer', exact: true }).click()
      await jour.first().waitFor({ state: 'detached', timeout: 10000 })
    },
  },
  // « Saisir un mois » (C12A-Q1) : deux apports d'un coup, tout ou rien ; puis « Remplacer » une opération du journal.
  {
    nom: 'gestes/caisse-un-mois', chemin: '#/dossiers/d1/caisse', ecrit: true,
    jouer: async (page) => {
      await page.getByRole('button', { name: 'Saisir un mois…', exact: true }).click()
      await page.getByLabel('Nature de la ligne 1').selectOption('apport')
      await page.getByLabel('Jour de la ligne 1').fill('2026-09-24')
      await page.getByLabel('Montant de la ligne 1').fill('30,00')
      await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click()
      await page.getByLabel('Nature de la ligne 2').selectOption('apport')
      await page.getByLabel('Jour de la ligne 2').fill('2026-09-25')
      await page.getByLabel('Montant de la ligne 2').fill('20,00')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer le mois (2 opérations)', exact: true }))
      await page.locator('tr', { hasText: '25/09/2026 — solde de la caisse en fin de journée' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_operations_de_caisse')
      await page.locator('tr', { hasText: '24/09/2026 — solde de la caisse en fin de journée : 473,00 €' }).first().waitFor({ timeout: 10000 })
      // Le mois saisi se vide : rien ne repartirait d'un second clic.
      if ((await page.getByLabel('Montant de la ligne 2').count()) > 0 && (await page.getByLabel('Montant de la ligne 2').inputValue()) !== '') {
        throw new Error('le mois enregistré reste dans le formulaire')
      }
    },
  },
  {
    nom: 'gestes/caisse-remplacer', chemin: '#/dossiers/d1/caisse', ecrit: true,
    jouer: async (page) => {
      const ligne = page.locator('tr', { hasText: '59,50 €' }).filter({ has: page.getByRole('button', { name: 'Remplacer', exact: true }) }).first()
      await ligne.getByRole('button', { name: 'Remplacer', exact: true }).click()
      const formulaire = page.getByRole('form', { name: 'Saisie d’une opération' })
      await formulaire.locator('#caisse-montant').fill('61,50')
      await doubleClic(formulaire.getByRole('button', { name: 'Remplacer', exact: true }))
      await page.locator('tr', { hasText: '61,50 €' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc remplacer_operation_caisse')
      if ((await page.locator('tr', { hasText: '59,50 €' }).filter({ has: page.getByRole('button', { name: 'Remplacer', exact: true }) }).count()) > 0) {
        throw new Error('l’opération remplacée s’offre encore au remplacement')
      }
    },
  },
  // « Corriger » un paiement par la caisse (C12B-Q1), depuis la fiche d'une pièce : la papeterie réglée en espèces, puis corrigée.
  {
    nom: 'gestes/corriger-un-paiement', chemin: '#/dossiers/d1/pieces', ecrit: true,
    jouer: async (page) => {
      await page.getByRole('cell', { name: 'Papeterie Moderne' }).first().click()
      const caisse = page.locator('section.fiche-hdf', { has: page.locator('#caisse-paiement-date') }).first()
      await caisse.locator('#caisse-paiement-date').fill('2026-09-20')
      await caisse.locator('#caisse-paiement-montant').fill('-27,35')
      await caisse.getByRole('button', { name: 'Régler par la caisse', exact: true }).click()
      const section = page.locator('section.fiche-hdf', { hasText: '20/09/2026' }).first()
      await section.getByRole('button', { name: 'Corriger', exact: true }).click()
      await section.locator('#caisse-correction-date').fill('2026-09-21')
      const n = (await journal(page)).length
      await doubleClic(section.getByRole('button', { name: 'Enregistrer la correction', exact: true }))
      await page.locator('section.fiche-hdf', { hasText: '21/09/2026' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc remplacer_paiement_par_la_caisse')
    },
  },
  {
    nom: 'gestes/client-ma-caisse-un-mois', chemin: '#/ma-caisse', ecrit: true, leviers: LEVIERS_DU_PRATICIEN,
    jouer: async (page) => {
      await page.locator('#caisse-mois').selectOption('9')
      await page.getByRole('button', { name: 'Saisir un mois…', exact: true }).click()
      await page.getByLabel('Quoi, ligne 1').selectOption('apport')
      await page.getByLabel('Jour, ligne 1').fill('2026-09-24')
      await page.getByLabel('Montant, ligne 1').fill('30,00')
      await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click()
      await page.getByLabel('Quoi, ligne 2').selectOption('apport')
      await page.getByLabel('Jour, ligne 2').fill('2026-09-25')
      await page.getByLabel('Montant, ligne 2').fill('20,00')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer le mois (2 opérations)', exact: true }))
      await page.getByText(/25\/09\/2026/).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_operations_de_caisse')
      await page.getByText(/20,00\s€/).first().waitFor({ timeout: 10000 })
    },
  },
  {
    nom: 'gestes/client-corriger-un-paiement', chemin: '#/mes-pieces', ecrit: true, leviers: LEVIERS_DU_PRATICIEN,
    jouer: async (page) => {
      const ligne = page.locator('tr', { hasText: 'p7.pdf' }).first()
      await ligne.getByRole('button', { name: 'Espèces de ta caisse', exact: true }).click()
      await page.getByRole('button', { name: 'Corriger', exact: true }).first().click()
      await page.getByLabel('Jour où tu as vraiment payé').fill('2026-09-22')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer la correction', exact: true }))
      await page.getByText(/^Payée en espèces le 22\/09\/2026/).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc remplacer_paiement_par_la_caisse')
    },
  },
  {
    nom: 'gestes/ecriture-libre', chemin: '#/dossiers/d1/ecritures', ecrit: true,
    jouer: async (page) => {
      await ecritureLibrePassee(page)
      await ecritureLibreRetiree(page)
      await SECTION_LIBRE(page).getByText(/^Aucune écriture libre dans l’exercice/).waitFor({ timeout: 10000 })
    },
  },
  // LE PRATICIEN, DANS SON ESPACE (« Caisse », « Ventes » et « Banque » sur le cabinet infirmier, comme la passe `client-caisse` de
  // debordements.mjs) : une recette du jour saisie dans « Ma caisse », puis retirée ; le paiement en espèces d'une pièce depuis
  // « Mes pièces ».
  {
    nom: 'gestes/client-ma-caisse', chemin: '#/ma-caisse', ecrit: true, leviers: LEVIERS_DU_PRATICIEN,
    jouer: async (page) => {
      await page.getByRole('combobox', { name: 'Mois' }).selectOption('9').catch(() => page.locator('#caisse-mois').selectOption('9'))
      await page.locator('#caisse-genre').selectOption('apport')
      await page.locator('#caisse-date').fill('2026-09-24')
      await page.locator('#caisse-montant').fill('40')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer', exact: true }).first())
      await page.getByText(/24\/09\/2026/).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_operation_caisse')
      await page.getByText(/40,00\s€/).first().waitFor({ timeout: 10000 })
    },
  },
  {
    nom: 'gestes/client-paiement-d-une-piece', chemin: '#/mes-pieces', ecrit: true, leviers: LEVIERS_DU_PRATICIEN,
    jouer: async (page) => {
      await page.locator('tr', { hasText: 'p1.pdf' }).getByRole('button', { name: 'Payée en espèces de ta caisse', exact: true }).click()
      await page.getByLabel('Jour où tu as payé').fill('2026-09-21')
      await page.getByLabel('Montant de tes espèces (€)').fill('39,99')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer', exact: true }).first())
      await page.getByText(/^Payée en espèces le 21\/09\/2026, 39,99\s€ \(par toi\)$/).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc regler_piece_par_la_caisse')
    },
  },
  // LES AUTRES CLASSEMENTS D'UN MOUVEMENT (onglet Banque du cabinet infirmier) : chacun écrit, se relit à la fiche, puis se défait.
  {
    nom: 'gestes/ventiler', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV SEPA GARAGE DU CENTRE')
      await fiche.getByRole('button', { name: 'Ventiler sur plusieurs comptes…', exact: true }).click()
      await fiche.getByLabel('Compte de la part 1').selectOption({ label: 'Entretien du véhicule (615500)' })
      await fiche.getByLabel('Montant de la part 1').fill('100')
      await fiche.getByLabel('Compte de la part 2').selectOption({ label: 'Part personnelle — compte 108000' })
      await fiche.getByLabel('Montant de la part 2').fill('20')
      await doubleClic(fiche.getByRole('button', { name: 'Ventiler', exact: true }))
      await pastille(fiche, 'Ventilé sur 2 comptes')
      await uneSeuleFois(page, 0, 'rpc ventiler_mouvement_bancaire')
      // L'écriture de la ventilation, relue par l'onglet Écritures : la charge et la part de l'exploitant.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/ecritures`)
      await page.getByText('615500').first().waitFor({ timeout: 10000 })
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/banque`)
      const relue = await ouvrirLeMouvement(page, 'PRLV SEPA GARAGE DU CENTRE', { tous: true })
      await relue.getByRole('button', { name: 'Annuler la ventilation', exact: true }).click()
      await pastille(relue, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/virement-personnel', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'FRAIS OPPOSITION CHEQUE')
      await doubleClic(fiche.getByRole('button', { name: 'Virement personnel', exact: true }))
      await fiche.locator('.badge', { hasText: 'Virement personnel' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc classer_virement_personnel')
      await fiche.getByRole('button', { name: 'Remettre à traiter', exact: true }).click()
      await pastille(fiche, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/compte-de-bilan', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'VERSEMENT ESPECES GUICHET')
      await doubleClic(fiche.getByRole('button', { name: 'Versement d’espèces (530000)', exact: true }))
      await fiche.getByRole('heading', { name: 'Écrit sur un compte de bilan' }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc ecrire_mouvement_compte_bilan')
      await fiche.getByRole('button', { name: 'Remettre à traiter', exact: true }).click()
      await pastille(fiche, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/reglement-groupe', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'CB PHARMA DISTRIB SUD')
      await fiche.getByRole('button', { name: 'Régler plusieurs pièces…', exact: true }).click()
      await fiche.getByLabel('Pièce 1', { exact: true }).selectOption({ label: '10/09/2026 — Pharma Distrib Sud — 186,40 € — à valider' })
      await fiche.getByLabel('Part de la pièce 1').fill('159.05')
      await fiche.getByLabel('Pièce 2', { exact: true }).selectOption({ label: '21/08/2026 — Papeterie Moderne — 27,35 €' })
      await fiche.getByLabel('Part de la pièce 2').fill('27.35')
      await doubleClic(fiche.getByRole('button', { name: 'Régler ces pièces', exact: true }))
      await fiche.getByRole('heading', { name: 'Règle plusieurs pièces' }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc regler_pieces_par_mouvement')
      await fiche.getByRole('button', { name: 'Annuler le règlement groupé', exact: true }).click()
      await pastille(fiche, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/echeance-d-emprunt', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV ECHEANCE PRET VEHICULE')
      await doubleClic(fiche.getByRole('button', { name: 'Rapprocher de cette échéance', exact: true }))
      await pastille(fiche, 'Échéance n° 2 — Prêt véhicule')
      await uneSeuleFois(page, 0, 'rpc rapprocher_echeance_emprunt')
      // L'écriture de l'échéance, relue par l'onglet Écritures : le capital au 164000.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/ecritures`)
      await page.getByText('164000').first().waitFor({ timeout: 10000 })
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/banque`)
      const relue = await ouvrirLeMouvement(page, 'PRLV ECHEANCE PRET VEHICULE', { tous: true })
      await relue.getByRole('button', { name: /^Annuler le rapprochement/ }).click()
      await pastille(relue, 'Non rapproché')
    },
  },
  {
    nom: 'gestes/ecarter-la-proposition', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV SEPA GARAGE DU CENTRE')
      await doubleClic(fiche.getByRole('button', { name: 'Écarter cette proposition', exact: true }))
      await fiche.getByText(/^2 propositions retirées : .*Garage du Centre/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc retirer_proposition')
      if (!alertes.some((a) => a.startsWith('Écarter la pièce « Garage du Centre »'))) throw new Error(`la confirmation ne nomme pas la pièce écartée (${alertes.join(' | ')})`)
    },
  },
  {
    nom: 'gestes/mode-de-reglement', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV SEPA GARAGE DU CENTRE')
      await doubleClic(fiche.getByRole('button', { name: 'Poser « Prélèvement »', exact: true }))
      await fiche.getByText(/^Posé : Prélèvement/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc poser_modes_de_reglement')
    },
  },
  // L'ONGLET INFORMATIONS (cabinet infirmier) : l'identité du dossier, un seuil du chiffre d'affaires, un compte bancaire ajouté puis
  // retiré ; l'onglet TVA : le statut d'un dossier à préciser ; l'onglet Accès : une case cochée puis décochée.
  {
    nom: 'gestes/identite-du-dossier', chemin: '#/dossiers/d1/informations', ecrit: true,
    jouer: async (page) => {
      await page.locator('#identite-adresse').fill('12 rue des Mimosas\n13100 Aix-en-Provence')
      const carte = page.locator('.card', { has: page.locator('#identite-adresse') }).first()
      await doubleClic(carte.getByRole('button', { name: 'Enregistrer', exact: true }))
      await carte.getByText('Enregistré ✓').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'update dossiers')
      if ((await page.locator('#identite-adresse').inputValue()) !== '12 rue des Mimosas\n13100 Aix-en-Provence') throw new Error('l’adresse relue n’est pas celle qui est partie')
      // La facture du dossier la propose comme adresse de l'émetteur.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/factures`)
      await page.getByRole('button', { name: '+ Nouvelle facture', exact: true }).click()
      if ((await page.locator('#emetteur-adresse').inputValue()) !== '12 rue des Mimosas\n13100 Aix-en-Provence') throw new Error('la facture ne propose pas l’adresse enregistrée')
      await page.getByRole('button', { name: 'Annuler', exact: true }).last().click()
    },
  },
  {
    nom: 'gestes/seuil-du-chiffre-d-affaires', chemin: '#/dossiers/d1/informations', ecrit: true,
    jouer: async (page) => {
      // Le champ du seuil de hausse, et son « Enregistrer », le premier bouton qui le suit.
      const champ = page.locator('input[id$="-hausse"]').first()
      await champ.fill('20')
      await doubleClic(champ.locator('xpath=following::button[1]'))
      await page.getByText(/20\s%/).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc regler_seuil_du_chiffre_d_affaires')
      if ((await champ.inputValue()) !== '20') throw new Error('le seuil relu n’est pas celui qui est parti')
    },
  },
  {
    nom: 'gestes/compte-bancaire', chemin: '#/dossiers/d1/informations', ecrit: true,
    jouer: async (page, alertes) => {
      await page.getByRole('button', { name: 'Ajouter un compte bancaire', exact: true }).click()
      await page.locator('#compte-bancaire-libelle').fill('Livret fictif de trésorerie')
      await page.locator('#compte-bancaire-compte').fill('512100')
      await page.locator('#compte-bancaire-depuis').fill('2027')
      await page.locator('#compte-bancaire-ouvert').fill('2026-10-01')
      await doubleClic(page.getByRole('button', { name: 'Créer le compte', exact: true }))
      const retirer = page.getByRole('button', { name: 'Retirer « Livret fictif de trésorerie »', exact: true })
      await retirer.waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'insert comptes_bancaires')
      // L'onglet Banque le propose à l'import d'un relevé.
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/banque`)
      await page.locator('option', { hasText: 'Livret fictif de trésorerie' }).first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {
        throw new Error('l’onglet Banque ne propose pas le compte ajouté à l’import d’un relevé')
      })
      await page.goto(`${BASE_DU_BANC}#/dossiers/d1/informations`)
      await retirer.waitFor({ timeout: 10000 })
      const n = (await journal(page)).length
      await doubleClic(retirer)
      await retirer.waitFor({ state: 'detached', timeout: 10000 })
      await uneSeuleFois(page, n, 'delete comptes_bancaires')
      if (!alertes.some((a) => /Livret fictif de trésorerie/.test(a))) throw new Error('le retrait part sans confirmation qui nomme le compte')
    },
  },
  {
    nom: 'gestes/statut-de-tva', chemin: '#/dossiers/d2/tva', ecrit: true,
    jouer: async (page) => {
      const carte = page.locator('.card', { has: page.getByRole('heading', { name: 'Statut de TVA' }) }).first()
      await carte.getByRole('button', { name: 'Franchise en base (art. 293 B du CGI)', exact: true }).click()
      await doubleClic(carte.getByRole('button', { name: 'Enregistrer', exact: true }))
      await carte.getByRole('button', { name: 'Changer le statut', exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'update dossiers')
      await carte.getByText('Franchise en base', { exact: false }).first().waitFor({ timeout: 10000 })
      // La barre du dossier le dit aussi.
      await page.getByRole('button', { name: /^TVA : franchise/ }).first().waitFor({ timeout: 10000 })
    },
  },
  {
    nom: 'gestes/droit-d-un-acces', chemin: '#/dossiers/d7/acces', ecrit: true,
    jouer: async (page) => {
      const caseComptes = page.getByLabel('Droit « Comptes » de bernard@atelier-exemple.fr', { exact: true })
      await caseComptes.waitFor({ timeout: 10000 })
      await doubleClic(caseComptes)
      await page.waitForFunction(() => document.querySelector('input[aria-label="Droit « Comptes » de bernard@atelier-exemple.fr"]')?.checked === true, null, { timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc changer_droits_acces')
      const n = (await journal(page)).length
      await caseComptes.click()
      await page.waitForFunction(() => document.querySelector('input[aria-label="Droit « Comptes » de bernard@atelier-exemple.fr"]')?.checked === false, null, { timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc changer_droits_acces')
    },
  },
  // L'ASSURANCE MALADIE (section de l'onglet Banque du cabinet infirmier) : un fichier de paiements FICTIF, ses colonnes réglées à la
  // main, les agrégats dits avant le clic ; l'association d'un paiement à son crédit, puis son retrait ; un bordereau de
  // télétransmission FICTIF (src/test/bordereauFictif.ts, fabriqué par pdf-lib : aucun document réel, aucun nom de personne).
  {
    nom: 'gestes/paiements-assurance-maladie', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => importerDesPaiements(page),
  },
  {
    nom: 'gestes/association-assurance-maladie', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      const fiche = await ouvrirLeMouvement(page, 'VIR CPAM TIERS PAYANT')
      const section = fiche.locator('section', { has: page.getByRole('heading', { name: 'Paiement de l’assurance maladie' }) }).first()
      await doubleClic(section.getByRole('button', { name: 'Associer', exact: true }))
      const ouvrirLeRetrait = fiche.getByRole('button', { name: 'Défaire l’association…', exact: true })
      await ouvrirLeRetrait.waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc associer_paiements_assurance_maladie')
      await page.getByText('Crédit associé à son paiement de l’assurance maladie.').first().waitFor({ timeout: 10000 })
      const n = (await journal(page)).length
      await ouvrirLeRetrait.click()
      // La confirmation, dans la fiche, nomme le paiement libéré.
      await doubleClic(fiche.getByRole('button', { name: 'Défaire l’association', exact: true }))
      await section.getByRole('button', { name: 'Associer', exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc defaire_association_assurance_maladie')
    },
  },
  {
    nom: 'gestes/bordereau-assurance-maladie', chemin: '#/dossiers/d1/banque', ecrit: true,
    jouer: async (page) => {
      await page.getByRole('button', { name: 'Importer des bordereaux de télétransmission', exact: true }).click()
      const fenetre = page.getByRole('dialog', { name: 'Importer des bordereaux de télétransmission' })
      await fenetre.locator('#facture-am-fichiers').setInputFiles({
        name: 'bordereau-fictif.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await bordereauFictifEnPdf()),
      })
      // Les agrégats avant le clic : par jour de création, organisme et part, jamais une ligne du bordereau.
      await fenetre.getByText(/^1 lot créé le 09\/11\/2026/).waitFor({ timeout: 15000 })
      if ((await fenetre.getByText('BENEFICIAIRE UN').count()) > 0) throw new Error('l’aperçu montre une ligne du bordereau')
      await fenetre.getByRole('button', { name: 'Importer 1 lot', exact: true }).click()
      await doubleClic(fenetre.getByRole('button', { name: 'Confirmer l’import', exact: true }))
      await fenetre.waitFor({ state: 'detached', timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc importer_factures_assurance_maladie')
      await page.locator('tr', { hasText: 'le 09/11/2026' }).filter({ hasText: '4 403,90 €' }).first().waitFor({ timeout: 10000 })
    },
  },
  {
    nom: 'gestes/client-paiements-assurance-maladie', chemin: '#/ma-banque', ecrit: true, leviers: LEVIERS_DU_PRATICIEN,
    jouer: async (page) => importerDesPaiements(page),
  },
  // LA FACTURE (onglet Factures de l'atelier, d7, redevable) : le brouillon, sa validation — le numéro de la série du mandataire et
  // les mentions figées, que l'aperçu imprime —, puis l'avoir qui la crédite, l'e-mail (`send-email` simulée) et l'aperçu relu.
  {
    nom: 'gestes/facture', chemin: '#/dossiers/d7/factures', ecrit: true,
    jouer: async (page, alertes) => {
      await factureSaisie(page, 'Cabinet Fictif Durand SARL')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }))
      await ligneDeFacture(page, 'Cabinet Fictif Durand').getByText('Brouillon', { exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_facture')
      // Le brouillon rouvert garde sa ligne ; « Valider la facture » demande sa confirmation, qui nomme ce qui se fige.
      await ligneDeFacture(page, 'Cabinet Fictif Durand').locator('td').nth(2).click()
      await page.locator('td[data-libelle="PU HT"] input').first().waitFor({ timeout: 10000 })
      if ((await page.locator('td[data-libelle="PU HT"] input').first().inputValue()) !== '150') throw new Error('le brouillon rouvert a perdu le prix de sa ligne')
      const n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Valider la facture', exact: true }))
      await ligneDeFacture(page, 'Cabinet Fictif Durand').getByText('M2026-0001').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc enregistrer_facture')
      if (!alertes.some((a) => /figera/.test(a))) throw new Error(`la confirmation de la validation ne dit pas ce qui se fige (${alertes.join(' | ')})`)
      // L'aperçu imprime le numéro et le mandat du cabinet (P4).
      await ligneDeFacture(page, 'M2026-0001').getByRole('button', { name: 'Aperçu', exact: true }).click()
      await page.getByText('FACTURE M2026-0001').waitFor({ timeout: 10000 })
      await page.getByText(/Facture établie par JD Consult au nom et pour le compte de/).first().waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
      // L'avoir : toute la facture créditée, dans la série des avoirs du mandataire.
      await ligneDeFacture(page, 'M2026-0001').getByRole('button', { name: 'Avoir', exact: true }).click()
      await page.locator('#avoir-motif').fill('Erreur de quantité, avoir fictif')
      const m = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Valider l\'avoir', exact: true }))
      await ligneDeFacture(page, 'MA2026-0001').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, m, 'rpc enregistrer_facture')
      await ligneDeFacture(page, 'MA2026-0001').getByText('-360,00 €').waitFor({ timeout: 10000 })
      // L'e-mail : l'adresse saisie, « Envoyé » ne se dit que sur le `ok` de la fonction.
      await ligneDeFacture(page, 'M2026-0001').getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click()
      await page.locator('#email-destinataire').fill('client.fictif@exemple.fr')
      const e = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Envoyer', exact: true }))
      await page.getByText('Envoyé', { exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, e, 'invoke send-email')
      await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
    },
  },
  // L'ENCAISSEMENT D'UNE FACTURE (F2026-0007, dont 1 443,39 € restent) et son retrait ; LA CONTRE-PASSATION d'un encaissement déclaré (le
  // virement de 900,00 € de F2026-0008), relue dans la fenêtre puis dans la vue « Règlements ».
  {
    nom: 'gestes/encaissement', chemin: '#/dossiers/d7/factures', ecrit: true,
    jouer: async (page) => {
      await ligneDeFacture(page, 'F2026-0007').getByRole('button', { name: 'Encaissements', exact: true }).click()
      await page.locator('#encaissement-date').fill('2026-10-12')
      await page.locator('#encaissement-montant').fill('1443,39')
      await page.locator('#encaissement-moyen').selectOption('virement')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer l’encaissement', exact: true }))
      await page.getByText('Encaissement enregistré : 1 443,39 € le 12/10/2026.').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_encaissement')
      await page.getByText('Reste à encaisser : 0,00 €').first().waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
      await ligneDeFacture(page, 'F2026-0007').getByText(/^Encaissée/).first().waitFor({ timeout: 10000 })
      await ligneDeFacture(page, 'F2026-0007').getByRole('button', { name: 'Encaissements', exact: true }).click()
      const ligne = page.locator('tr', { hasText: '12/10/2026' }).filter({ hasText: '1 443,39 €' }).first()
      await ligne.getByRole('button', { name: 'Retirer', exact: true }).click()
      await page.getByText(/^Encaissement du 12\/10\/2026 retiré/).waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
      // La contre-passation : un encaissement déclaré ne se retire pas.
      await ligneDeFacture(page, 'F2026-0008').getByRole('button', { name: 'Encaissements', exact: true }).click()
      await page.locator('tr', { hasText: '900,00 €' }).first().getByRole('button', { name: 'Contre-passer', exact: true }).click()
      await page.locator('#contre-passation-date').fill('2026-10-15')
      await page.locator('#contre-passation-motif').fill('Virement rendu au client, contre-passation fictive.')
      const n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Enregistrer la contre-passation', exact: true }))
      await page.getByText(/^Contre-passation enregistrée : .*900,00\s€ le 15\/10\/2026/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc annuler_encaissement')
      await page.getByText('-900,00 €').first().waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
      await page.getByRole('tab', { name: 'Règlements', exact: true }).click()
      await page.getByText('-900,00 €').first().waitFor({ timeout: 10000 })
    },
  },
  // LE DEVIS (vue « Devis » du cabinet infirmier, d1, exonéré) : créé et émis d'un geste, envoyé par e-mail, accepté, puis un acompte
  // et le solde facturés — deux brouillons de facture, relus dans la vue « Factures ».
  {
    nom: 'gestes/devis', chemin: '#/dossiers/d1/factures', ecrit: true,
    jouer: async (page, alertes) => {
      await devisSaisi(page, 'Résidence Fictive des Acacias')
      await doubleClic(page.getByRole('button', { name: 'Émettre', exact: true }))
      const ligne = () => page.locator('tr', { hasText: 'Résidence Fictive des Acacias' }).first()
      await ligne().getByText('D2026-0002').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_devis')
      if (!alertes.some((a) => /prochain numéro de la série D2026/.test(a))) throw new Error('l’émission part sans confirmation qui nomme sa série')
      await ligne().getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click()
      await page.locator('#devis-email-destinataire').fill('residence.fictive@exemple.fr')
      let n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Envoyer', exact: true }))
      await page.waitForFunction(() => !document.querySelector('#devis-email-destinataire'), null, { timeout: 10000 })
      await uneSeuleFois(page, n, 'invoke send-email')
      await ligne().getByRole('button', { name: 'Enregistrer la réponse', exact: true }).click()
      await page.locator('input[name="devis-reponse"]').first().check()
      n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Enregistrer la réponse', exact: true }).last())
      await ligne().getByText(/^Accepté/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc decider_devis')
      await ligne().getByRole('button', { name: 'Facturer un acompte', exact: true }).click()
      await page.locator('#devis-acompte-montant').fill('30')
      n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Facturer l’acompte', exact: true }))
      await page.waitForFunction(() => !document.querySelector('#devis-acompte-montant'), null, { timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc facturer_acompte_devis')
      await page.getByRole('tab', { name: 'Factures', exact: true }).click()
      const acompte = page.locator('tr.clickable', { hasText: 'Résidence Fictive des Acacias' }).filter({ hasText: '60,00 €' }).first()
      await acompte.waitFor({ timeout: 10000 })
      // L'acompte validé, le solde se facture : un second brouillon, de ce qui reste du devis.
      await acompte.locator('td').nth(2).click()
      // La mention de l'exonération, que le formulaire propose d'ajouter quand elle manque aux mentions reprises du devis.
      const ajouter = page.getByRole('button', { name: 'Ajouter la mention', exact: true })
      await ajouter.waitFor({ timeout: 4000 }).then(() => ajouter.click(), () => {})
      // Une facture à une entreprise dit le taux des pénalités de retard : le dossier n'en a pas aux paramètres, la mention s'ajoute.
      const mentions = page.locator('#mentions')
      await mentions.fill(`${await mentions.inputValue()}\nPénalités de retard : trois fois le taux d’intérêt légal (mention fictive).`)
      n = (await journal(page)).length
      await page.getByRole('button', { name: 'Valider la facture', exact: true }).click()
      await acompte.getByText(/^M2026-\d{4}/).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc enregistrer_facture')
      await page.getByRole('tab', { name: 'Devis', exact: true }).click()
      n = (await journal(page)).length
      await doubleClic(ligne().getByRole('button', { name: 'Facturer le solde', exact: true }))
      // Le brouillon de la finale s'ouvre de lui-même : il reprend l'acompte validé.
      await page.getByRole('heading', { name: 'Modifier le brouillon' }).waitFor({ timeout: 10000 })
      await page.locator('td[data-libelle="Désignation"] input').nth(1).waitFor({ timeout: 10000 })
      if (!/^Reprise de l’acompte M2026-/.test(await page.locator('td[data-libelle="Désignation"] input').nth(1).inputValue())) {
        throw new Error('la facture finale ne reprend pas l’acompte validé')
      }
      await page.getByRole('button', { name: 'Annuler', exact: true }).last().click()
      await page.getByRole('tab', { name: 'Factures', exact: true }).click()
      await page.locator('tr.clickable', { hasText: 'Résidence Fictive des Acacias' }).filter({ hasText: 'Brouillon' }).first().waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc facturer_devis')
    },
  },
  // LA FACTURE DU CLIENT « VENTES » (« Mes ventes › Factures ») : le brouillon puis la validation, dans la série du client.
  {
    nom: 'gestes/client-facture', chemin: '#/mes-ventes', ecrit: true, leviers: LEVIERS_DES_VENTES,
    jouer: async (page, alertes) => {
      await factureSaisie(page, 'Cabinet Fictif Durand SARL')
      await doubleClic(page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }))
      await ligneDeFacture(page, 'Cabinet Fictif Durand').getByText('Brouillon', { exact: true }).waitFor({ timeout: 10000 })
      await uneSeuleFois(page, 0, 'rpc enregistrer_facture')
      await ligneDeFacture(page, 'Cabinet Fictif Durand').locator('td').nth(2).click()
      await page.locator('td[data-libelle="PU HT"] input').first().waitFor({ timeout: 10000 })
      const n = (await journal(page)).length
      await doubleClic(page.getByRole('button', { name: 'Valider la facture', exact: true }))
      await ligneDeFacture(page, 'Cabinet Fictif Durand').getByText('F2026-0010').waitFor({ timeout: 10000 })
      await uneSeuleFois(page, n, 'rpc enregistrer_facture')
      if (alertes.length === 0) throw new Error('la validation du client part sans confirmation')
    },
  },
  // LE CHEMIN DE L'ÉCHEC (levier `banc-ecritures-refus`) : l'écriture du geste rendue en erreur, comme une fonction de la base qui
  // lève. L'écran doit dire le refus (une alerte ou un message), relâcher son verrou (le bouton se reclique) et ne rien montrer
  // d'écrit ; une saisie garde ce qui a été tapé.
  {
    nom: 'gestes/refus/associer-une-piece', chemin: '#/dossiers/d1/banque', ecrit: true, leviers: { 'banc-ecritures-refus': 'lignes_bancaires' },
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'CB PAPETERIE MODERNE')
      const bouton = fiche.getByRole('button', { name: 'Associer cette pièce', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await pastille(fiche, 'Non rapproché')
      await reclicable(bouton)
    },
  },
  {
    nom: 'gestes/refus/affecter-une-categorie', chemin: '#/dossiers/d1/banque', ecrit: true, leviers: { 'banc-ecritures-refus': 'affecter_mouvement_bancaire' },
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'VIR CPAM TIERS PAYANT SEPT')
      const choix = fiche.locator('#affecter-categorie')
      const valeur = await choix.locator('option').evaluateAll((os) => os.map((o) => o.value).find((v) => v !== ''))
      await choix.selectOption(valeur)
      const bouton = fiche.getByRole('button', { name: 'Affecter', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await pastille(fiche, 'Non rapproché')
      await reclicable(bouton)
    },
  },
  {
    nom: 'gestes/refus/importer-un-releve', chemin: '#/dossiers/d1/banque', ecrit: true, leviers: { 'banc-ecritures-refus': 'lignes_bancaires' },
    jouer: async (page, alertes) => {
      const carte = page.locator('.card', { hasText: 'Importer un relevé bancaire' }).first()
      await carte.locator('input[type=file]').first().setInputFiles({
        name: 'releve-fictif-octobre.csv', mimeType: 'text/csv', buffer: Buffer.from(RELEVE('2 204,50')),
      })
      await carte.getByText('Ce que l’import lira').waitFor({ timeout: 10000 })
      const bouton = carte.getByRole('button', { name: /^Importer \d+ ligne\(s\)$/ })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('tr.clickable', { hasText: 'CB PHARMACIE CENTRALE' }).count()) > 0) throw new Error('un mouvement refusé paraît dans le relevé')
    },
  },
  {
    nom: 'gestes/refus/valider-une-piece', chemin: '#/dossiers/d1/pieces', ecrit: true, leviers: { 'banc-ecritures-refus': 'pieces' },
    jouer: async (page, alertes) => {
      await page.getByRole('cell', { name: 'Télécom Plus' }).first().click()
      const bouton = page.getByRole('button', { name: 'Valider', exact: true }).first()
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
    },
  },
  {
    nom: 'gestes/refus/valider-la-selection', chemin: '#/dossiers/d1/pieces', ecrit: true, leviers: { 'banc-ecritures-refus': 'pieces' },
    jouer: async (page, alertes) => {
      for (const tiers of ['Pharma Distrib Sud', 'Garage du Centre']) {
        await page.locator('tr', { hasText: tiers }).first().locator('input[type=checkbox]').check()
      }
      const bouton = page.getByRole('button', { name: /^Valider la sélection/ }).first()
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
    },
  },
  {
    nom: 'gestes/refus/operation-de-caisse', chemin: '#/dossiers/d1/caisse', ecrit: true, leviers: { 'banc-ecritures-refus': 'enregistrer_operation_caisse' },
    jouer: async (page, alertes) => {
      const formulaire = page.getByRole('form', { name: 'Saisie d’une opération' })
      await formulaire.waitFor({ timeout: 10000 })
      await formulaire.locator('#caisse-genre').selectOption('apport')
      await formulaire.locator('#caisse-date').fill('2026-09-24')
      await formulaire.locator('#caisse-montant').fill('50,00')
      const bouton = formulaire.getByRole('button', { name: 'Enregistrer', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await formulaire.locator('#caisse-montant').inputValue()) !== '50,00') throw new Error('le montant saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/ajouter-une-echeance', chemin: '#/dossiers/d1/cotisations', ecrit: true, leviers: { 'banc-ecritures-refus': 'cotisations_declarees' },
    jouer: async (page, alertes) => {
      await page.locator('#echeance').fill('2026-11-05')
      await page.locator('#appele').fill('275')
      const bouton = page.getByRole('button', { name: 'Ajouter', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#appele').inputValue()) !== '275') throw new Error('le montant saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/client-ma-caisse', chemin: '#/ma-caisse', ecrit: true,
    leviers: { ...LEVIERS_DU_PRATICIEN, 'banc-ecritures-refus': 'enregistrer_operation_caisse' },
    jouer: async (page, alertes) => {
      await page.locator('#caisse-mois').selectOption('9')
      await page.locator('#caisse-genre').selectOption('apport')
      await page.locator('#caisse-date').fill('2026-09-24')
      await page.locator('#caisse-montant').fill('40')
      const bouton = page.getByRole('button', { name: 'Enregistrer', exact: true }).first()
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#caisse-montant').inputValue()) !== '40') throw new Error('le montant saisi s’est perdu avec le refus')
    },
  },
  // Les refus des gestes de la seconde passe (28/11/2026) : chacun dit le refus, relâche son bouton et garde ce qui a été saisi.
  {
    nom: 'gestes/refus/facture', chemin: '#/dossiers/d7/factures', ecrit: true, fenetreGardee: true, leviers: { 'banc-ecritures-refus': 'enregistrer_facture' },
    jouer: async (page, alertes) => {
      await factureSaisie(page, 'Cabinet Fictif Durand SARL')
      const bouton = page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#tiers-nom').inputValue()) !== 'Cabinet Fictif Durand SARL') throw new Error('le client saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/encaissement', chemin: '#/dossiers/d7/factures', ecrit: true, fenetreGardee: true, leviers: { 'banc-ecritures-refus': 'enregistrer_encaissement' },
    jouer: async (page, alertes) => {
      await ligneDeFacture(page, 'F2026-0007').getByRole('button', { name: 'Encaissements', exact: true }).click()
      await page.locator('#encaissement-date').fill('2026-10-12')
      await page.locator('#encaissement-montant').fill('1443,39')
      await page.locator('#encaissement-moyen').selectOption('virement')
      const bouton = page.getByRole('button', { name: 'Enregistrer l’encaissement', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#encaissement-montant').inputValue()) !== '1443,39') throw new Error('le montant saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/envoi-par-e-mail', chemin: '#/dossiers/d7/factures', ecrit: true, fenetreGardee: true, leviers: { 'banc-ecritures-refus': 'send-email' },
    jouer: async (page, alertes) => {
      await ligneDeFacture(page, 'F2026-0007').getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click()
      await page.locator('#email-destinataire').fill('client.fictif@exemple.fr')
      const bouton = page.getByRole('button', { name: 'Envoyer', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.getByText('Envoyé', { exact: true }).count()) > 0) throw new Error('l’envoi refusé se dit « Envoyé »')
    },
  },
  {
    nom: 'gestes/refus/devis', chemin: '#/dossiers/d1/factures', ecrit: true, fenetreGardee: true, leviers: { 'banc-ecritures-refus': 'enregistrer_devis' },
    jouer: async (page, alertes) => {
      await devisSaisi(page, 'Résidence Fictive des Acacias')
      const bouton = page.getByRole('button', { name: 'Émettre', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#devis-client').inputValue()) !== 'Résidence Fictive des Acacias') throw new Error('le client saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/ventiler', chemin: '#/dossiers/d1/banque', ecrit: true, leviers: { 'banc-ecritures-refus': 'ventiler_mouvement_bancaire' },
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'PRLV SEPA GARAGE DU CENTRE')
      await fiche.getByRole('button', { name: 'Ventiler sur plusieurs comptes…', exact: true }).click()
      await fiche.getByLabel('Compte de la part 1').selectOption({ label: 'Entretien du véhicule (615500)' })
      await fiche.getByLabel('Montant de la part 1').fill('100')
      await fiche.getByLabel('Compte de la part 2').selectOption({ label: 'Part personnelle — compte 108000' })
      await fiche.getByLabel('Montant de la part 2').fill('20')
      const bouton = fiche.getByRole('button', { name: 'Ventiler', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await pastille(fiche, 'Non rapproché')
      await reclicable(bouton)
      if ((await fiche.getByLabel('Montant de la part 2').inputValue()) !== '20') throw new Error('la ventilation saisie s’est perdue avec le refus')
    },
  },
  {
    nom: 'gestes/refus/caisse-un-mois', chemin: '#/dossiers/d1/caisse', ecrit: true, leviers: { 'banc-ecritures-refus': 'enregistrer_operations_de_caisse' },
    jouer: async (page, alertes) => {
      await page.getByRole('button', { name: 'Saisir un mois…', exact: true }).click()
      await page.getByLabel('Nature de la ligne 1').selectOption('apport')
      await page.getByLabel('Jour de la ligne 1').fill('2026-09-24')
      await page.getByLabel('Montant de la ligne 1').fill('30,00')
      const bouton = page.getByRole('button', { name: 'Enregistrer le mois (1 opération)', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.getByLabel('Montant de la ligne 1').inputValue()) !== '30,00') throw new Error('le mois saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/corriger-un-paiement', chemin: '#/dossiers/d1/pieces', ecrit: true, leviers: { 'banc-ecritures-refus': 'remplacer_paiement_par_la_caisse' },
    jouer: async (page, alertes) => {
      await page.getByRole('cell', { name: 'Papeterie Moderne' }).first().click()
      const caisse = page.locator('section.fiche-hdf', { has: page.locator('#caisse-paiement-date') }).first()
      await caisse.locator('#caisse-paiement-date').fill('2026-09-20')
      await caisse.locator('#caisse-paiement-montant').fill('-27,35')
      await caisse.getByRole('button', { name: 'Régler par la caisse', exact: true }).click()
      const section = page.locator('section.fiche-hdf', { hasText: '20/09/2026' }).first()
      await section.getByRole('button', { name: 'Corriger', exact: true }).click()
      await section.locator('#caisse-correction-date').fill('2026-09-21')
      const bouton = section.getByRole('button', { name: 'Enregistrer la correction', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await section.locator('#caisse-correction-date').inputValue()) !== '2026-09-21') throw new Error('la correction saisie s’est perdue avec le refus')
    },
  },
  {
    nom: 'gestes/refus/compte-bancaire', chemin: '#/dossiers/d1/informations', ecrit: true, leviers: { 'banc-ecritures-refus': 'comptes_bancaires' },
    jouer: async (page, alertes) => {
      await page.getByRole('button', { name: 'Ajouter un compte bancaire', exact: true }).click()
      await page.locator('#compte-bancaire-libelle').fill('Livret fictif de trésorerie')
      await page.locator('#compte-bancaire-compte').fill('512100')
      await page.locator('#compte-bancaire-depuis').fill('2027')
      await page.locator('#compte-bancaire-ouvert').fill('2026-10-01')
      const bouton = page.getByRole('button', { name: 'Créer le compte', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#compte-bancaire-libelle').inputValue()) !== 'Livret fictif de trésorerie') throw new Error('le compte saisi s’est perdu avec le refus')
    },
  },
  {
    nom: 'gestes/refus/identite-du-dossier', chemin: '#/dossiers/d1/informations', ecrit: true, leviers: { 'banc-ecritures-refus': 'dossiers' },
    jouer: async (page, alertes) => {
      await page.locator('#identite-adresse').fill('12 rue des Mimosas\n13100 Aix-en-Provence')
      const bouton = page.locator('.card', { has: page.locator('#identite-adresse') }).first().getByRole('button', { name: 'Enregistrer', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
      if ((await page.locator('#identite-adresse').inputValue()) !== '12 rue des Mimosas\n13100 Aix-en-Provence') throw new Error('l’adresse saisie s’est perdue avec le refus')
    },
  },
  {
    nom: 'gestes/refus/seuil-du-chiffre-d-affaires', chemin: '#/dossiers/d1/informations', ecrit: true, leviers: { 'banc-ecritures-refus': 'regler_seuil_du_chiffre_d_affaires' },
    jouer: async (page, alertes) => {
      const champ = page.locator('input[id$="-hausse"]').first()
      await champ.fill('20')
      const bouton = champ.locator('xpath=following::button[1]')
      await bouton.click()
      await refusDit(page, alertes)
      // La carte remet à dessein le champ refusé à la valeur RELUE (HausseDuChiffreDAffairesCard.test.tsx, « un refus de la base
      // se dit, et la valeur relue reste ») : le refus le plus probable dit que la base a changé depuis la lecture. La saisie se
      // retape, et le bouton se rend (GESTES-Q2).
      if ((await champ.inputValue()) !== '') throw new Error('le champ refusé ne montre pas la valeur relue')
      await champ.fill('20')
      await reclicable(bouton)
    },
  },
  {
    nom: 'gestes/refus/droit-d-un-acces', chemin: '#/dossiers/d7/acces', ecrit: true, leviers: { 'banc-ecritures-refus': 'changer_droits_acces' },
    jouer: async (page, alertes) => {
      const caseComptes = page.getByLabel('Droit « Comptes » de bernard@atelier-exemple.fr', { exact: true })
      await caseComptes.click()
      await refusDit(page, alertes)
      await reclicable(caseComptes)
      if (await caseComptes.isChecked()) throw new Error('la case refusée reste cochée')
    },
  },
  {
    nom: 'gestes/refus/paiements-assurance-maladie', chemin: '#/dossiers/d1/banque', ecrit: true, fenetreGardee: true, leviers: { 'banc-ecritures-refus': 'importer_paiements_assurance_maladie' },
    jouer: async (page, alertes) => {
      await importerDesPaiements(page).catch(() => {})
      await refusDit(page, alertes)
      const fenetre = page.getByRole('dialog', { name: 'Importer des paiements de l’assurance maladie' })
      await reclicable(fenetre.getByRole('button', { name: 'Confirmer l’import', exact: true }))
    },
  },
  {
    nom: 'gestes/refus/association-assurance-maladie', chemin: '#/dossiers/d1/banque', ecrit: true, leviers: { 'banc-ecritures-refus': 'associer_paiements_assurance_maladie' },
    jouer: async (page, alertes) => {
      const fiche = await ouvrirLeMouvement(page, 'VIR CPAM TIERS PAYANT')
      const section = fiche.locator('section', { has: page.getByRole('heading', { name: 'Paiement de l’assurance maladie' }) }).first()
      const bouton = section.getByRole('button', { name: 'Associer', exact: true })
      await bouton.click()
      await refusDit(page, alertes)
      await reclicable(bouton)
    },
  },
]

// Le refus du banc, dit à l'écran ou par une alerte, sous ses mots (jamais remplacés par un message technique ni tus).
async function refusDit(page, alertes) {
  const MOTS = 'Refus joué par le banc'
  for (let i = 0; i < 50; i++) {
    if (alertes.some((a) => a.includes(MOTS))) return
    if ((await page.getByText(MOTS).count()) > 0) return
    await page.waitForTimeout(200)
  }
  throw new Error(`le refus de l’écriture n’est dit nulle part (alertes : ${alertes.join(' | ') || 'aucune'})`)
}
// Le bouton du geste se reclique : le verrou est relâché après l'échec.
async function reclicable(bouton) {
  for (let i = 0; i < 25; i++) {
    if ((await bouton.count()) > 0 && await bouton.isEnabled()) return
    await bouton.page().waitForTimeout(200)
  }
  throw new Error(`le bouton « ${await bouton.innerText().catch(() => '?')} » reste désactivé après le refus`)
}

// Les messages techniques qui ne doivent jamais parvenir à l'écran : le faux Supabase répond « maquette » à ce qu'il ne sert pas ;
// les autres sont ceux de PostgreSQL, de PostgREST ou de JavaScript ; et un montant écrit à l'anglaise (« 1000.00 € », un
// `toFixed` qui n'est pas passé par `formatMoney`).
const BRUT = /maquette|permission denied|violates|duplicate key|\[object Object\]|\bundefined\b|\bNaN\b|TypeError|ReferenceError|Cannot read prop|PGRST\d|42501|23514|P0001|\d\.\d{2} €/

const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision
  ? ['chrome-linux', 'chrome-linux64'].map((d) => `${RACINE_NAVIGATEURS}/${revision}/${d}/chrome`).find((f) => existsSync(f))
  : undefined)
// Le mandataire de l'environnement n'est JAMAIS donné au navigateur (voir l'en-tête de vitrine.mjs).
const navigateur = await chromium.launch({ executablePath: executable })

const prefixe = process.env.GESTES ?? ''
const joues = GESTES.filter((g) => g.nom.startsWith(prefixe))
let fautesTotales = 0
let remarquesTotales = 0
for (const geste of joues) {
  // UN CONTEXTE NEUF PAR GESTE : le banc d'origine, sans rien de ce qu'un geste d'avant a écrit, sous les seuls leviers du geste.
  // Recharger la même page d'un geste à l'autre épuisait le navigateur (`net::ERR_INSUFFICIENT_RESOURCES` sur les modules que Vite
  // sert un à un), et la console s'en remplissait.
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: telephone ? 844 : 900 } })
  await contexte.addInitScript((leviers) => {
    localStorage.setItem('banc-ecritures', '1')
    for (const [cle, valeur] of Object.entries(leviers)) localStorage.setItem(cle, valeur)
  }, geste.leviers ?? {})
  const page = await contexte.newPage()
  const fautes = []
  const remarques = []
  const alertes = []
  const surConsole = (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /React|Warning:/.test(m.text()))) fautes.push(`console (${m.type()}) : ${m.text().split('\n')[0].slice(0, 200)}`)
    if (m.type() === 'warning' && m.text().startsWith('[banc]')) remarques.push(m.text().slice(0, 200))
  }
  const surErreur = (e) => fautes.push(`exception de la page : ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
  // Un `window.alert` ou un `window.confirm` : retenu, accepté — sauf quand une aide d'ecrituresLibres.mjs l'accepte elle-même.
  const surDialogue = (d) => {
    alertes.push(d.message())
    // Une invite (`window.prompt`) reçoit la valeur qu'elle propose : celle que l'écran juge juste.
    if (page.listenerCount('dialog') === 1) d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined).catch(() => {})
  }
  page.on('console', surConsole)
  page.on('pageerror', surErreur)
  page.on('dialog', surDialogue)
  await page.goto(`${BASE_DU_BANC}${geste.chemin}`)
  await page.waitForTimeout(1200)
  try {
    await geste.jouer(page, alertes)
  } catch (e) {
    // La première ligne de l'erreur, et celle qui nomme ce que Playwright attendait : la faute dit quelle attente a expiré.
    const lignes = String(e?.message ?? e).split('\n')
    const attente = lignes.find((l) => /waiting for|locator\(/.test(l) && l !== lignes[0])
    fautes.push(`le geste n’a pas abouti : ${lignes[0].slice(0, 200)}${attente ? ` — ${attente.trim().slice(0, 200)}` : ''}`)
  }
  await page.waitForTimeout(1500)
  for (const a of alertes) if (BRUT.test(a)) fautes.push(`message brut dans une alerte : « ${a.replace(/\s+/g, ' ').slice(0, 200)} »`)
  const etat = await page.evaluate((brut) => {
    const re = new RegExp(brut)
    const texte = document.querySelector('.main')?.innerText ?? document.body.innerText
    const bruts = texte.split('\n').filter((l) => re.test(l)).map((l) => l.trim().slice(0, 160))
    const bloques = [...document.querySelectorAll('button:disabled')].map((b) => (b.innerText || '').trim()).filter((t) => /…$/.test(t))
    // Une fenêtre superposée : déclarée (`aria-modal`), ou un voile fixe qui couvre la vue et porte une carte (les formulaires de la
    // facture, de l'avoir, de l'e-mail, que rien ne déclare).
    const voiles = [...document.querySelectorAll('body *')].filter((e) => {
      if (getComputedStyle(e).position !== 'fixed' || !e.querySelector('.card')) return false
      const r = e.getBoundingClientRect()
      return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9
    })
    const fenetres = new Set([...document.querySelectorAll('[aria-modal="true"]'), ...voiles.filter((v) => !v.querySelector('[aria-modal="true"]'))]).size
    const journal = (window.__ecrituresDuBanc ?? []).map((e) => ({ ...e }))
    const focus = document.activeElement === document.body
    return { bruts, bloques, fenetres, journal, focus }
  }, BRUT.source)
  for (const b of etat.bruts) fautes.push(`message brut à l’écran : « ${b} »`)
  for (const b of etat.bloques) fautes.push(`verrou qui ne se relâche pas : le bouton « ${b} » reste désactivé`)
  // Un refus garde sa fenêtre ouverte, et la saisie avec elle (`fenetreGardee`) : ce n'est pas une faute.
  if (etat.fenetres > 0 && !geste.fenetreGardee) fautes.push(`${etat.fenetres} fenêtre(s) superposée(s) restée(s) ouverte(s) après le geste`)
  if (geste.ecrit && etat.journal.length === 0) fautes.push('aucune écriture n’est partie vers le faux Supabase')
  for (const e of etat.journal) if (e.filtresNonTenus.length > 0) remarques.push(`${e.genre} sur ${e.table} : filtre(s) non tenu(s) — ${e.filtresNonTenus.join(', ')}`)
  if (etat.focus) remarques.push('le focus est rendu au document après le geste (le bouton cliqué a quitté l’écran sans le passer à un autre)')
  fautes.push(...await mesurerLesDebordements(page, null, false))
  fautes.push(...(await mesurerLesBoutons(page, null)).fautes)
  await contexte.close()
  const ecritures = etat.journal.map((e) => `${e.genre}${e.table ? ` ${e.table}` : ''} (${e.lignes})`).join(', ')
  console.log(`${geste.nom} : ${fautes.length === 0 ? 'joué, rien à redire' : `${fautes.length} faute(s)`}`
    + `${ecritures ? `\n   écritures : ${ecritures}` : ''}`
    + `${alertes.length ? `\n   alertes : ${alertes.map((a) => `« ${a.replace(/\s+/g, ' ').slice(0, 140)} »`).join(' ; ')}` : ''}`
    + fautes.map((f) => `\n   FAUTE ${f}`).join('') + remarques.map((r) => `\n   remarque : ${r}`).join(''))
  fautesTotales += fautes.length
  remarquesTotales += remarques.length
}
await navigateur.close()
console.log(`\n${joues.length} geste(s) joué(s) à ${largeur} px : ${fautesTotales} faute(s), ${remarquesTotales} remarque(s).`)
process.exitCode = fautesTotales > 0 ? 1 : 0
