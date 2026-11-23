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
    await section.getByRole('button', { name: 'Choisir une pièce validée', exact: true }).click()
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
