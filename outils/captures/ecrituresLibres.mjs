// LA SECTION « ÉCRITURES DE L'EXPERT-COMPTABLE » DE L'ONGLET ÉCRITURES (EL5 ; `ECRITURES_LIBRES_PREVUES` levé le 23/11/2026), sur le
// cabinet infirmier (d1, en trésorerie) : les gestes que les visites `ecritures-libres/*` de debordements.mjs et les vues
// `*-ecritures-libres*` de vitrine.mjs enchaînent, dans un vrai navigateur, contre le faux Supabase (`rpcDesEcrituresLibres`).
// Les visites de debordements.mjs vivent dans le même document (une adresse qui ne change que par son fragment ne recharge pas la
// page) : une saisie restée ouverte s'abandonne d'abord, et la table du faux garde d'une visite à l'autre ce qui a été passé,
// jusqu'au retrait. Chaque vue de vitrine.mjs a son propre contexte : elle repart de la table vide.
export const SECTION_LIBRE = (page) => page.locator('.card', { has: page.getByRole('heading', { name: 'Écritures de l’expert-comptable' }) })
export async function saisieLibreOuverte(page) {
  const section = SECTION_LIBRE(page)
  await section.waitFor({ timeout: 10000 })
  const abandonner = section.getByRole('button', { name: 'Abandonner', exact: true })
  if ((await abandonner.count()) > 0) await abandonner.click()
  await section.getByRole('button', { name: 'Nouvelle écriture libre', exact: true }).click()
  return section
}
async function ligneLibre(section, n, compte, montant, poste) {
  const ligne = section.getByRole('group', { name: `Ligne ${n}` })
  await ligne.getByLabel('Compte', { exact: true }).fill(compte)
  await ligne.getByLabel('Montant', { exact: true }).fill(montant)
  if (poste) await ligne.getByLabel('Effet sur la 2035').selectOption(poste)
}
// Une part privée de l'électricité du local : le compte de l'exploitant au débit, la charge au crédit sous son poste de la 2035,
// la facture d'Énergie Services (p3, validée) citée — ou, `desequilibre`, un crédit plus faible que le débit.
export async function saisieLibreRemplie(page, { desequilibre = false, piece = true } = {}) {
  const section = await saisieLibreOuverte(page)
  await section.getByLabel('Libellé', { exact: true }).fill('Part privée de l’électricité du local 2026')
  await section.getByLabel(/^Motif/).fill('Usage privé du local évalué à 20 % de la consommation de l’année, au vu du relevé du fournisseur')
  await ligneLibre(section, 1, '108000', '25,26')
  await ligneLibre(section, 2, '606100', desequilibre ? '20,00' : '25,26', 'Chauffage, eau, gaz, électricité')
  if (piece) {
    await section.getByRole('button', { name: 'Choisir une pièce du dossier', exact: true }).click()
    await section.getByRole('button', { name: /^05\/09\/2026 — Énergie Services/ }).click()
  }
  return section
}

/** La saisie remplie passée, la confirmation du navigateur acceptée : l'écriture relue dans la liste, sa pièce citée nommée. */
export async function ecritureLibrePassee(page) {
  const section = await saisieLibreRemplie(page)
  page.once('dialog', (d) => d.accept())
  await section.getByRole('button', { name: 'Passer l’écriture', exact: true }).click()
  await section.getByText('Écriture libre passée.').waitFor({ timeout: 10000 })
  await section.getByRole('cell', { name: /EL\d{4}-0001$/ }).waitFor({ timeout: 10000 })
  return section
}

/** L'écriture de la liste retirée, la confirmation acceptée : le message du retrait. */
export async function ecritureLibreRetiree(page) {
  const section = SECTION_LIBRE(page)
  await section.getByRole('cell', { name: /EL\d{4}-0001$/ }).waitFor({ timeout: 10000 })
  page.once('dialog', (d) => d.accept())
  await section.getByRole('button', { name: 'Retirer', exact: true }).first().click()
  await section.getByText(/^Écriture libre EL\d{4}-0001 retirée\.$/).waitFor({ timeout: 10000 })
  return section
}

// LE DÉTAIL DES COMPTES ET LA RÉVISION (EL6) : deux écritures libres FICTIVES passées par l'écran, que les visites de la Balance, du
// Bilan et de la Révision montrent ensuite — la part privée de l'électricité (le 108000, un compte de bilan, face au 606100), puis
// une charge constatée d'avance du 31 décembre, hors de la 2035 avec son extourne (le 486000 face au 618000). Idempotent dans un même
// document : rien ne se repasse si la seconde est déjà dans la liste (les visites de debordements.mjs partagent la table du faux).
export async function ecrituresLibresSemees(page, dossier = 'd1') {
  await page.goto(`http://127.0.0.1:5199/#/dossiers/${dossier}/ecritures`)
  const section = SECTION_LIBRE(page)
  await section.waitFor({ timeout: 10000 })
  await section.getByText(/^Aucune écriture libre dans l’exercice|EL\d{4}-\d{4}/).first().waitFor({ timeout: 10000 })
  if ((await section.getByRole('cell', { name: /EL2026-0002$/ }).count()) > 0) return
  if ((await section.getByRole('cell', { name: /EL2026-0001$/ }).count()) === 0) await ecritureLibrePassee(page)
  await saisieLibreOuverte(page)
  await section.getByLabel('Date', { exact: true }).fill('2026-12-31')
  await section.getByLabel('Libellé', { exact: true }).fill('Abonnement du logiciel de 2027 payé d’avance')
  await section.getByLabel(/^Motif/).fill('Charge constatée d’avance : l’abonnement de 2027 réglé en décembre 2026')
  await ligneLibre(section, 1, '486000', '300,00')
  const deux = section.getByRole('group', { name: 'Ligne 2' })
  await deux.getByLabel('Compte', { exact: true }).fill('618000')
  // Le nom du choix porte aussi ses options (« Sens Débit Crédit ») : le libellé se cherche par son début.
  await deux.locator('label', { hasText: /^Sens/ }).locator('select').selectOption('credit')
  await deux.getByLabel('Montant', { exact: true }).fill('300,00')
  const regle = section.getByRole('button', { name: 'Passer hors de la 2035, avec son extourne', exact: true })
  if ((await regle.count()) > 0) await regle.click()
  else await section.getByLabel(/^Extourner au 1er janvier suivant/).check()
  page.once('dialog', (d) => d.accept())
  await section.getByRole('button', { name: 'Passer l’écriture', exact: true }).click()
  await section.getByRole('cell', { name: /EL2026-0002$/ }).waitFor({ timeout: 10000 })
}

// La fiche d'un compte de la visite d'avant reste dans le panneau de droite (l'adresse ne change que par son fragment) : sous
// 1 280 px il se superpose au panneau central et recouvre le bouton suivant. On le ferme d'abord.
export async function panneauFerme(page) {
  const fermer = page.locator('#panneau-droit').getByRole('button', { name: 'Fermer le panneau', exact: true })
  if ((await fermer.count()) > 0) await fermer.first().click()
}

// LE PROGRAMME DE L'ENSEMBLE (EL6) ne se propose que sur un exercice TERMINÉ : au banc, celui de 2025 de la société tenue en
// engagement (d8). Une écriture libre fictive du 30 juin 2025 — des honoraires reclassés face au fournisseur —, passée par l'écran,
// puis la Révision de 2025 et la fiche du cycle « Ensemble ». Idempotent dans un même document, comme `ecrituresLibresSemees`.
export async function ensembleDeLExerciceClos(page) {
  await panneauFerme(page)
  await page.goto('http://127.0.0.1:5199/#/dossiers/d8/ecritures')
  const section = SECTION_LIBRE(page)
  await section.waitFor({ timeout: 10000 })
  await page.getByText('2025', { exact: true }).first().click()
  await section.getByText(/^Aucune écriture libre dans l’exercice 2025|EL2025-\d{4}/).first().waitFor({ timeout: 10000 })
  if ((await section.getByRole('cell', { name: /EL2025-0001$/ }).count()) === 0) {
    await saisieLibreOuverte(page)
    await section.getByLabel('Date', { exact: true }).fill('2025-06-30')
    await section.getByLabel('Libellé', { exact: true }).fill('Honoraires du graphiste reclassés')
    await section.getByLabel(/^Motif/).fill('Facture du graphiste passée en sous-traitance au lieu d’honoraires')
    for (const [n, compte, sens] of [[1, '622600', 'debit'], [2, '401000', 'credit']]) {
      const ligne = section.getByRole('group', { name: `Ligne ${n}` })
      await ligne.getByLabel('Compte', { exact: true }).fill(compte)
      await ligne.locator('label', { hasText: /^Sens/ }).locator('select').selectOption(sens)
      await ligne.getByLabel('Montant', { exact: true }).fill('120,00')
    }
    page.once('dialog', (d) => d.accept())
    await section.getByRole('button', { name: 'Passer l’écriture', exact: true }).click()
    await section.getByRole('cell', { name: /EL2025-0001$/ }).waitFor({ timeout: 10000 })
  }
  await page.goto('http://127.0.0.1:5199/#/dossiers/d8/revision')
  const ouvrir = page.getByRole('button', { name: /^Ouvrir le cycle Ensemble/ })
  await ouvrir.waitFor({ timeout: 10000 })
  await ouvrir.click()
  const travail = page.getByText(/^Relire les écritures libres de l’exercice/).first()
  await travail.waitFor({ timeout: 10000 })
  await travail.scrollIntoViewIfNeeded()
}
