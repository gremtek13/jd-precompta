// LES GESTES QUI ÉCRIVENT, JOUÉS DANS UN VRAI NAVIGATEUR (28/11/2026) — le parcours du MVP au-delà de la lecture : associer une pièce
// à un mouvement et le défaire, affecter une catégorie et la retirer, ignorer, rapprocher une échéance de cotisation, importer un
// relevé jusqu'au bout, appliquer les règles en lot, valider une pièce puis une sélection, saisir puis retirer une opération de
// caisse, passer puis retirer une écriture libre. Chaque geste joue sur une page RECHARGÉE (le banc d'origine), sous le levier
// `banc-ecritures` du faux Supabase (voir `appliquerEcriture` dans fauxSupabase.ts) : ses écritures s'appliquent aux lignes servies,
// et l'écran relu doit dire l'état d'après. Le banc n'est pas la base : un geste vert dit que l'ÉCRAN envoie, relit et dit juste,
// jamais que la base l'accepterait (ses refus se jouent par `supabase/essais/`).
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
//   - une fenêtre superposée restée ouverte après le geste ;
//   - les débordements et les boutons recouverts, par les mesures de debordements.mjs (mesures.mjs), sur l'écran d'après.
// Et se dit sans se compter (une remarque) : un filtre d'écriture que le banc n'a pas su appliquer (le journal le nomme) ; le
// focus rendu au document (`<body>`) une fois le geste fini — le bouton cliqué a quitté l'écran sans passer la main.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { BASE_DU_BANC, ecritureLibrePassee, ecritureLibreRetiree, SECTION_LIBRE } from './ecrituresLibres.mjs'
import { mesurerLesBoutons, mesurerLesDebordements } from './mesures.mjs'

const largeur = Number(process.argv[2] ?? 1440)
const telephone = largeur <= 720

// Les relevés FICTIFS de l'import : un qui boucle (1 000,00 + 1 250,40 − 45,90 = 2 204,50) et un qui ne boucle pas (il y manque
// 100 € : le solde de clôture dit 2 104,50 pour les mêmes mouvements). Les soldes sont des lignes du relevé, au montant porté dans
// la colonne du crédit, comme un export de banque les écrit — la colonne du solde courant n'alimente pas le contrôle (IMPORT-Q1).
// Les leviers du faux Supabase que la passe `client-caisse` de debordements.mjs pose : le compte du banc est le praticien du
// cabinet infirmier (d1), avec « Caisse », « Ventes » et « Banque ».
const LEVIERS_DU_PRATICIEN = { 'banc-client': '1', 'banc-client-caisse': '1', 'jd-precompta-dossier-actif': 'd1' }

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
    const fenetres = document.querySelectorAll('[aria-modal="true"]').length
    const journal = (window.__ecrituresDuBanc ?? []).map((e) => ({ ...e }))
    const focus = document.activeElement === document.body
    return { bruts, bloques, fenetres, journal, focus }
  }, BRUT.source)
  for (const b of etat.bruts) fautes.push(`message brut à l’écran : « ${b} »`)
  for (const b of etat.bloques) fautes.push(`verrou qui ne se relâche pas : le bouton « ${b} » reste désactivé`)
  if (etat.fenetres > 0) fautes.push(`${etat.fenetres} fenêtre(s) superposée(s) restée(s) ouverte(s) après le geste`)
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
