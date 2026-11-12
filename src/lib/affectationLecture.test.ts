import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLAffectation, lireLesComptesDeLAffectation } from './affectationLecture'
import { decisionEnVigueur } from './affectationEcran'

// LA LECTURE DE L'AFFECTATION (AFF4) : lue EN ENTIER ou « incomplète » avec son motif, jamais rejetée, jamais un compte supposé.
// Le faux client APPLIQUE `.eq` et `.gte`, ne rend que les colonnes demandées, annonce son compte et peut cesser de rendre une
// table au-delà d'une position, tout en annonçant le vrai total (lecture partielle). Données FICTIVES.

const monde = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  plan: { data: null, error: null } as { data: unknown; error: unknown },
  leve: false,
  demandes: [] as string[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string) => {
      monde.demandes.push(`rpc:${nom}`)
      if (monde.leve) return Promise.reject(new Error('réseau coupé'))
      return Promise.resolve(monde.plan)
    },
    from: (table: string) => {
      const filtres: ((l: Record<string, unknown>) => boolean)[] = []
      let colonnes: string[] = []
      const chaine: Record<string, unknown> = {
        select: (liste: string) => { colonnes = liste === '*' ? [] : liste.split(',').map((c) => c.trim()); monde.demandes.push(`${table}: ${liste}`); return chaine },
        eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return chaine },
        gte: (c: string, v: string) => { filtres.push((l) => String(l[c]) >= v); return chaine },
        order: () => chaine,
        range: (debut: number, fin: number) => {
          if (monde.refus[table]) return Promise.resolve({ data: null, error: { message: monde.refus[table] }, count: null })
          const lignes = (monde.tables[table] ?? []).filter((l) => filtres.every((f) => f(l)))
          const rendues = lignes.slice(debut, Math.min(fin + 1, monde.muetApres[table] ?? Infinity))
            .map((l) => (colonnes.length === 0 ? l : Object.fromEntries(colonnes.map((c) => [c, l[c]]))))
          return Promise.resolve({ data: rendues, error: null, count: lignes.length })
        },
      }
      return chaine
    },
  },
}))

const ROLES = ['resultat_benefice', 'resultat_perte', 'reserve_legale', 'reserves_statutaires', 'autres_reserves',
  'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer']
const COMPTES = ['120000', '129000', '106100', '106300', '106800', '110000', '119000', '457000']
const planComplet = () => ({ data: [...ROLES.map((role, i) => ({ role, compte: COMPTES[i], libelle: null, prefixe_auxiliaire: null, origine: 'application' })),
  { role: 'banque', compte: '512000', libelle: 'Banque', prefixe_auxiliaire: null, origine: 'application' }], error: null })

const SOLDES_FIGES = {
  capitalAuxComptes: 1_000_050, primes: 0, ecartsDeReevaluation: 0, reserveLegale: 0, reservesIndisponibles: 0, reservesStatutaires: 0,
  reservesReglementees: 0, autresReserves: 0, reportCrediteur: 0, pertesAnterieures: 0, acomptesSurDividendes: 0,
}
const FIGEE = { resultat_centimes: 10_000, forme_juridique: '5499', capital_centimes: 1_000_050, soldes_lus: SOLDES_FIGES }

function poser() {
  monde.tables = {
    dossiers: [{ id: 'd1', nom: 'Dossier fictif', denomination_imprimee: 'Société Fictive SARL', siret: '12345678900011', adresse: '1 rue Fictive, 75001 Paris', rcs_ville: 'Paris', forme_juridique: '5499', capital: 10000.5 },
      { id: 'd2', nom: 'Autre', denomination_imprimee: null, siret: null, adresse: null, rcs_ville: null, forme_juridique: '1000', capital: null }],
    exercices_valides: [{ dossier_id: 'd1', annee: 2026 }, { dossier_id: 'd2', annee: 2020 }],
    soldes_reportes: [{ id: 's1', dossier_id: 'd1', date: '2027-01-01', compte: '101000', sens: 'credit', montant: 10000, libelle: 'x', source_nom: 'x', source_empreinte: 'x' }],
    a_nouveaux: [{ id: 'n0', dossier_id: 'd1', date: '2025-01-01', compte: '110000', sens: 'credit', montant: 5 },
      { id: 'n1', dossier_id: 'd1', date: '2027-01-01', compte: '110000', sens: 'credit', montant: 7 }],
    ecritures_brouillon: [
      { id: 'e1', dossier_id: 'd1', date: '2026-06-01', compte: '706000', sens: 'credit', montant: 100, statut: 'validee', affectation_id: null },
      { id: 'e2', dossier_id: 'd1', date: '2025-06-01', compte: '706000', sens: 'credit', montant: 999, statut: 'validee', affectation_id: null },
      { id: 'e3', dossier_id: 'd2', date: '2026-06-01', compte: '706000', sens: 'credit', montant: 888, statut: 'validee', affectation_id: null },
    ],
    affectations_du_resultat: [
      { id: 'a2', dossier_id: 'd1', exercice_affecte: 2026, version: 2, etat: 'en_vigueur', organe: 'assemblee', nombre_d_associes_declare: 'plusieurs',
        date_decision: '2027-05-15', comptes_approuves: true, date_mise_en_paiement: null, reserves_statutaires_distribuables: false, fin_le: null, ...FIGEE,
        document_chemin: 'd1/affectations/a2.pdf', document_empreinte: 'ab'.repeat(32) },
      { id: 'a1', dossier_id: 'd1', exercice_affecte: 2026, version: 1, etat: 'remplacee', organe: 'associe_unique', nombre_d_associes_declare: 'un',
        date_decision: '2027-04-01', comptes_approuves: false, date_mise_en_paiement: null, reserves_statutaires_distribuables: true, fin_le: '2027-05-15T22:30:00Z', ...FIGEE, document_chemin: null, document_empreinte: null },
      { id: 'x1', dossier_id: 'd1', exercice_affecte: 2025, version: 1, etat: 'en_vigueur', organe: 'assemblee', nombre_d_associes_declare: 'plusieurs',
        date_decision: '2026-05-15', comptes_approuves: false, date_mise_en_paiement: null, reserves_statutaires_distribuables: true, fin_le: null, ...FIGEE, document_chemin: null, document_empreinte: null },
    ],
    lignes_d_affectation: [
      { affectation_id: 'a2', dossier_id: 'd1', rang: 2, origine: 'benefice', destination: 'report_crediteur', montant_centimes: 900 },
      { affectation_id: 'a2', dossier_id: 'd1', rang: 1, origine: 'benefice', destination: 'reserve_legale', montant_centimes: 100 },
    ],
  }
  monde.muetApres = {}
  monde.refus = {}
  monde.plan = planComplet()
  monde.leve = false
  monde.demandes = []
}
beforeEach(poser)

describe('lireLAffectation', () => {
  it('lit en entier, pour ce dossier et cet exercice : le dossier, les validations, les écritures de l’année, les versions et leurs lignes dans l’ordre', async () => {
    const l = await lireLAffectation('d1', 2026)
    if (l.etat !== 'lue') throw new Error(l.motif)
    expect(l).toMatchObject({ dossierId: 'd1', annee: 2026, formeJuridique: '5499', capitalCentimes: 1_000_050, anneesValidees: [2026] })
    expect(l.comptes).toEqual(Object.fromEntries(ROLES.map((r, i) => [r, COMPTES[i]])))
    expect(l.brouillon).toEqual([{ date: '2026-06-01', compte: '706000', sens: 'credit', montant: 100, statut: 'validee', affectationId: null }])
    expect(l.aNouveaux).toEqual([{ date: '2027-01-01', compte: '110000', sens: 'credit', montant: 7 }])
    expect(l.reportes).toEqual([{ date: '2027-01-01', compte: '101000', sens: 'credit', montant: 10000 }])
    expect(l.decisions.map((d) => [d.version, d.etat])).toEqual([[1, 'remplacee'], [2, 'en_vigueur']])
    expect(decisionEnVigueur(l)?.lignes).toEqual([
      { origine: 'benefice', destination: 'reserve_legale', centimes: 100 }, { origine: 'benefice', destination: 'report_crediteur', centimes: 900 },
    ])
    // La version remplacée a pris fin le jour de Paris de l'instant (22h30 UTC en mai : déjà le lendemain à Paris).
    expect(l.decisions[0].finLe).toBe('2027-05-16')
    expect(l.decisions[1].reservesStatutairesDistribuables).toBe(false)
    // Ce que la base a figé avec chaque version, et le document joint (AFF5) : le procès-verbal ne lit que cela.
    expect(l.decisions[1].figee).toEqual({ resultatCentimes: 10_000, formeJuridique: '5499', capitalCentimes: 1_000_050, soldes: SOLDES_FIGES })
    expect(l.decisions[1].document).toEqual({ chemin: 'd1/affectations/a2.pdf', empreinte: 'ab'.repeat(32) })
    expect(l.decisions[0].document).toBeNull()
    expect(l.identite).toEqual({ denomination: 'Société Fictive SARL', siret: '12345678900011', adresse: '1 rue Fictive, 75001 Paris', rcsVille: 'Paris' })
  })

  it('sans dénomination imprimée, le nom du dossier ; une colonne d’identité absente ne se croit pas (jamais nulle)', async () => {
    const l = await lireLAffectation('d2', 2020)
    expect(l.etat === 'lue' && l.identite).toEqual({ denomination: 'Autre', siret: null, adresse: null, rcsVille: null })
    delete (monde.tables.dossiers[0] as Record<string, unknown>).rcs_ville
    const absente = await lireLAffectation('d1', 2026)
    expect(absente.etat === 'incomplete' && absente.motif).toBe('le dossier : son identité ne se croit pas')
  })

  it.each([
    ['des soldes figés incomplets', { soldes_lus: { capitalAuxComptes: 1 } }],
    ['un résultat figé décimal', { resultat_centimes: 10.5 }],
    ['un chemin sans empreinte', { document_empreinte: null }],
    ['une empreinte qui n’en a pas la forme', { document_empreinte: 'ABC' }],
  ])('%s : la version ne se croit pas, rien n’est jugé', async (_cas, ecart) => {
    Object.assign(monde.tables.affectations_du_resultat[0], ecart)
    const l = await lireLAffectation('d1', 2026)
    expect(l.etat === 'incomplete' && l.motif).toBe('les décisions : ce qu’une version a figé ne se croit pas')
  })

  it('un dossier sans décision : aucune version, et un capital nul reste nul (jamais zéro)', async () => {
    const l = await lireLAffectation('d2', 2020)
    if (l.etat !== 'lue') throw new Error(l.motif)
    expect(l.decisions).toEqual([])
    expect(l.capitalCentimes).toBeNull()
    expect(l.formeJuridique).toBe('1000')
  })

  it.each([
    'dossiers', 'exercices_valides', 'soldes_reportes', 'a_nouveaux', 'ecritures_brouillon', 'affectations_du_resultat', 'lignes_d_affectation',
  ])('une lecture partielle de %s : incomplète, avec son motif, rien n’est jugé', async (table) => {
    monde.muetApres[table] = 0
    const l = await lireLAffectation('d1', 2026)
    expect(l.etat).toBe('incomplete')
    expect(l.etat === 'incomplete' && l.motif).toMatch(/lecture|total|ligne/)
  })

  it('une table refusée dit son refus ; le plan refusé, absent, incomplet ou qui lève : incomplet, jamais un compte par défaut', async () => {
    monde.refus.ecritures_brouillon = 'column affectation_id does not exist'
    const refus = await lireLAffectation('d1', 2026)
    expect(refus.etat === 'incomplete' && refus.motif).toContain('column affectation_id does not exist')
    poser()
    monde.plan = { data: null, error: { message: 'permission denied' } }
    const plan = await lireLAffectation('d1', 2026)
    expect(plan.etat === 'incomplete' && plan.motif).toContain('permission denied')
    poser()
    monde.plan = { data: (planComplet().data as { role: string }[]).filter((r) => r.role !== 'dividendes_a_payer'), error: null }
    const absent = await lireLAffectation('d1', 2026)
    expect(absent.etat === 'incomplete' && absent.motif).toContain('dividendes_a_payer')
    poser()
    monde.leve = true
    const leve = await lireLAffectation('d1', 2026)
    expect(leve.etat === 'incomplete' && leve.motif).toContain('réseau coupé')
  })

  it.each([
    ['une version illisible', (t: typeof monde.tables) => { t.affectations_du_resultat[0].organe = 'tribunal' }, 'les décisions'],
    ['une date de décision illisible', (t: typeof monde.tables) => { t.affectations_du_resultat[0].date_decision = '15/05/2027' }, 'les décisions'],
    ['deux fois la même version', (t: typeof monde.tables) => { t.affectations_du_resultat[1].version = 2 }, 'deux fois la version 2'],
    ['deux décisions en vigueur', (t: typeof monde.tables) => { t.affectations_du_resultat[1].etat = 'en_vigueur' }, 'deux décisions en vigueur'],
    ['une ligne d’un couple non admis', (t: typeof monde.tables) => { t.lignes_d_affectation[0].destination = 'dividendes'; t.lignes_d_affectation[0].origine = 'perte' }, 'les lignes des décisions'],
    ['une ligne à zéro', (t: typeof monde.tables) => { t.lignes_d_affectation[0].montant_centimes = 0 }, 'les lignes des décisions'],
    ['un montant du brouillon qui n’est pas un nombre', (t: typeof monde.tables) => { t.ecritures_brouillon[0].montant = '100' }, 'le brouillon'],
    ['un statut absent', (t: typeof monde.tables) => { delete t.ecritures_brouillon[0].statut }, 'le brouillon'],
    ['un capital qui n’est pas un nombre', (t: typeof monde.tables) => { t.dossiers[0].capital = 'dix mille' }, 'le capital'],
    ['un dossier absent', (t: typeof monde.tables) => { t.dossiers = [] }, 'le dossier'],
    ['une année validée qui n’est pas un entier', (t: typeof monde.tables) => { t.exercices_valides[0].annee = '2026' }, 'les exercices validés'],
  ])('%s : incomplète, jamais devinée', async (_nom, abimer, motif) => {
    abimer(monde.tables)
    const l = await lireLAffectation('d1', 2026)
    expect(l.etat).toBe('incomplete')
    expect(l.etat === 'incomplete' && l.motif).toContain(motif)
  })
})

describe('lireLesComptesDeLAffectation', () => {
  it('rend les huit comptes, et ignore un rôle que l’affectation ne lit pas', async () => {
    const r = await lireLesComptesDeLAffectation(Promise.resolve(planComplet()))
    expect(r.comptes).toMatchObject({ reserve_legale: '106100', dividendes_a_payer: '457000', resultat_perte: '129000' })
    expect(Object.keys(r.comptes ?? {}).sort()).toEqual([...ROLES].sort())
  })
  it('un rôle deux fois, une ligne qui n’est pas un objet, une réponse qui n’est pas une liste : un motif, jamais un compte', async () => {
    const deux = await lireLesComptesDeLAffectation(Promise.resolve({ data: [...planComplet().data, { role: 'banque', compte: '512100' }], error: null }))
    expect(deux.comptes).toBeNull()
    expect(deux.motif).toContain('deux fois')
    expect((await lireLesComptesDeLAffectation(Promise.resolve({ data: [null], error: null }))).comptes).toBeNull()
    expect((await lireLesComptesDeLAffectation(Promise.resolve({ data: {}, error: null }))).motif).toBe('plan comptable illisible')
  })
})
