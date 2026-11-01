import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { LigneBancaire } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { COLONNES_ENCAISSEMENTS_ECRITURES } from '../../lib/ecrituresVentesFactureesLecture'

// LA CAISSE SUR LA FICHE D'UN MOUVEMENT (ligne 26.6, étape C4 ; lib/caisseEcran.ts, `caisseDeLaFiche`). La caisse en base
// (`CAISSE_EXPORTEE` levé, joué par un accesseur), « Versement d'espèces » se propose avec le solde de la caisse ce jour-là —
// sans le mouvement, puis avec lui classé — ou le refus de la base sous ses mots ; un crédit dont le libellé dit un versement le
// dit avant qu'on le range en recette ; la caisse ou l'une de ses entrées pas lue en entier, la fiche ne classe rien sur elle et le
// dit ; un mouvement déjà classé sur la caisse ne s'en retire pas si elle passait sous zéro. Le drapeau baissé, la fiche est
// celle d'hier : ni phrase, ni bouton, ni lecture de la reprise. Des jeux FICTIFS.

const D = 'dossier-de-test'
const CAISSE = PLAN_PAR_DEFAUT.caisse

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('../../lib/caisse', async (original) => {
  const vrai = await original<typeof import('../../lib/caisse')>()
  return { ...vrai, get CAISSE_EXPORTEE() { return drapeau.leve } }
})

// Le drapeau de la migration `paiement_par_la_caisse` (étape C9b), joué par un accesseur, et la dérivation qui le lit — BAISSÉ par
// défaut, l'état d'aujourd'hui, que tous les cas d'avant jouent.
const drapeauDuPaiement = vi.hoisted(() => ({ leve: false }))
vi.mock('../../lib/paiementParLaCaisse', async (original) => {
  const vrai = await original<typeof import('../../lib/paiementParLaCaisse')>()
  return {
    ...vrai,
    get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeauDuPaiement.leve },
    paiementsParLaCaisseDuDossier: (...a: Parameters<typeof vrai.paiementsParLaCaisseDuDossier>) =>
      vrai.paiementsParLaCaisseDuDossierSelon(drapeauDuPaiement.leve, ...a),
  }
})

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muet: {} as Record<string, number>,
  tables: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  // La caisse (ses opérations), telle que `lireLaCaisse` la rend ; nulle, la lecture du module.
  caisse: null as null | ((dossierId: string) => unknown),
}))

vi.mock('../../lib/caisseLecture', async (original) => {
  const vrai = await original<typeof import('../../lib/caisseLecture')>()
  return {
    ...vrai,
    lireLaCaisse: (dossierId: string) => (faux.caisse ? Promise.resolve(faux.caisse(dossierId)) : vrai.lireLaCaisse(dossierId)),
  }
})
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    faux.tables.push(table)
    let operation = 'select'
    let unique = false
    let colonnes = '*'
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: (lues?: string) => { if (operation === 'select') colonnes = lues ?? '*'; return c },
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, v: unknown) => {
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === v))
        } else predicats.push(predicatEq(colonne, v))
        return c
      },
      in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: () => { operation = 'update'; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation !== 'select' || unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const toutes = filtrer(faux.parTable[table] ?? [], predicats)
        const muet = faux.muet[`${table}|${colonnes}`]
        return Promise.resolve({
          data: toutes.slice(debut, Math.min(fin + 1, muet ?? Number.MAX_SAFE_INTEGER)), error: null, count: toutes.length,
        }).then(suite, echec)
      },
    })
    return c
  }
  const rpc = (nom: string, args: Record<string, unknown> = {}) => {
    faux.rpcs.push({ nom, args })
    return Promise.resolve({ data: null, error: null })
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      throw new Error(`Appel de fonction non attendu : ${nom}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc, functions } }
})

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-12', montant: -100, libelle: 'PRLV SEPA FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-12T09:00:00Z',
    encaissements_de_factures: false, ...o,
  }
}

function operation(o: Record<string, unknown>) {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}

// 340 € en caisse le 12/03/2026 : 50 € d'ouverture, 100 € d'apport, 190 € de recette.
const OPERATIONS = [
  operation({ id: 'o1', genre: 'apport', date: '2026-03-01', montant: 100 }),
  operation({ id: 'o2', genre: 'recette', date: '2026-03-12', montant: 190, categorie_id: 'c-hon', encaissements_du_jour: [] }),
]
const REPRISE = [{
  id: 'a1', dossier_id: D, date: '2026-01-01', compte: CAISSE, compte_origine: '530', libelle: 'Caisse', sens: 'debit', montant: 50,
  source_nom: 'balance.csv', source_empreinte: 'x', created_at: '2026-01-01T00:00:00Z', compte_lib: null, ecriture_lib: null,
}]
const VIREMENT = mouvement({ id: 'm-vir', montant: 200, libelle: 'VIR CLIENT DIVERS' })
const VERSEMENT = mouvement({ id: 'm-vrst', montant: 200, libelle: 'VERSEMENT ESPECES GUICHET', date: '2026-03-12' })
const GROS = mouvement({ id: 'm-gros', montant: 500, libelle: 'VIR GROS CLIENT' })
const RETRAIT = mouvement({ id: 'm-ret', montant: -80, libelle: 'RETRAIT DAB', date: '2026-03-02', statut: 'rapprochee', compte_bilan: CAISSE })

function poser(o: { releve?: LigneBancaire[]; operations?: unknown[]; reprise?: unknown[]; faux?: Partial<typeof faux> } = {}) {
  faux.muet = {}
  faux.tables = []
  faux.rpcs = []
  faux.caisse = (dossierId) => ({ dossierId, enBase: true, lignes: o.operations ?? OPERATIONS, complete: true, motif: null })
  faux.parTable = {
    lignes_bancaires: (o.releve ?? [VIREMENT, GROS, VERSEMENT]) as unknown as Record<string, unknown>[],
    pieces: [],
    a_nouveaux: (o.reprise ?? REPRISE) as Record<string, unknown>[],
    categories: [{ id: 'c-hon', dossier_id: D, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }],
    factures_emises: [], facture_lignes: [], encaissements_factures: [], encaissements_factures_taux: [], memberships: [],
  }
}

beforeEach(() => { drapeau.leve = true; poser() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); drapeau.leve = false; drapeauDuPaiement.leve = false; faux.caisse = null })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function rendre(ventesParLesFactures = false, modele: ModeleComptable = TRESORERIE) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={[]}>
        <BanqueTab dossierId={D} modele={modele} assujettiTva={false} ventesParLesFactures={ventesParLesFactures} statutTva="redevable" />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const sans = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
// Le relevé s'ouvre sur les mouvements à traiter : un mouvement déjà classé se voit sous « Tous ».
async function toutVoir() { await act(async () => { (await screen.findByRole('button', { name: 'Tous' })).click() }) }
async function ouvrir(libelle: string) {
  const cellule = (await screen.findAllByText(libelle)).find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
  await within(volet()).findByRole('heading', { name: /Sur un compte de bilan|Écrit sur un compte de bilan/ })
}
const boutonVersement = () => within(volet()).queryByRole('button', { name: /^Versement d’espèces/ }) as HTMLButtonElement | null

describe('la caisse en base : « Versement d’espèces » avec le solde de la caisse ce jour-là', () => {
  it('un crédit : la caisse du jour sans lui, puis avec lui classé — aucun refus tant qu’elle tient — et le clic écrit sur le compte de la caisse', async () => {
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 340,00 €'))
    expect(sans(volet().textContent)).toContain('classé « Versement d’espèces », elle serait de 140,00 €.')
    const b = boutonVersement()!
    expect(b.textContent).toBe(`Versement d’espèces (${CAISSE})`)
    expect(b.disabled).toBe(false)
    await act(async () => { b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'ecrire_mouvement_compte_bilan',
      args: {
        p_ligne_bancaire_id: 'm-vir', p_compte: CAISSE,
        p_ecritures: [
          { compte: CAISSE, sens: 'credit', montant: 200, libelle: 'VIR CLIENT DIVERS' },
          { compte: '512000', sens: 'debit', montant: 200, libelle: 'VIR CLIENT DIVERS' },
        ],
      },
    }])
  })

  it('un crédit qui rendrait la caisse négative : le refus de la base, ses mots, le jour et le solde — le bouton grisé, aucun appel', async () => {
    rendre()
    await ouvrir('VIR GROS CLIENT')
    await waitFor(() => expect(sans(volet().textContent)).toContain('elle serait de −160,00 €'))
    expect(sans(volet().textContent)).toContain(
      'Ce versement de 500,00 € rendrait la caisse négative le 12/03/2026 (−160,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.',
    )
    const b = boutonVersement()!
    expect(b.disabled).toBe(true)
    await act(async () => { b.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('un compte tapé qui est celui de la caisse se juge de même, avant le clic', async () => {
    rendre()
    await ouvrir('VIR GROS CLIENT')
    await act(async () => { within(volet()).getByRole('button', { name: 'Autre compte de bilan…' }).click() })
    const champ = within(volet()).getByLabelText('Autre compte de bilan (classe 1 à 5)') as HTMLInputElement
    fireEvent.change(champ, { target: { value: CAISSE } })
    expect(within(volet()).getByRole('button', { name: 'Écrire sur ce compte' }).hasAttribute('disabled')).toBe(true)
    expect(sans(volet().textContent)).toContain('rendrait la caisse négative le 12/03/2026 (−160,00 €)')
  })

  it('un débit (des espèces retirées pour la caisse) l’alimente : la phrase le dit, aucun refus', async () => {
    poser({ releve: [mouvement({ id: 'm-deb', montant: -80, libelle: 'RETRAIT DAB' })] })
    rendre()
    await ouvrir('RETRAIT DAB')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 340,00 € ; classé « Retrait d’espèces pour la caisse », elle serait de 420,00 €.'))
    expect(boutonVersement()!.disabled).toBe(false)
  })

  it('un mouvement déjà classé sur la caisse : « Remettre à traiter » se grise quand le retirer viderait la caisse, et dit pourquoi', async () => {
    // Le retrait de 80 € du 2 mars alimente la caisse ; le prélèvement de 220 € du 3 mars l'a vidée de ce qu'il apportait.
    poser({
      releve: [RETRAIT],
      operations: [...OPERATIONS, operation({ id: 'o3', genre: 'prelevement', date: '2026-03-03', montant: 220 })],
    })
    rendre()
    await toutVoir()
    await ouvrir('RETRAIT DAB')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Dans la caisse : sans ce mouvement, la caisse du 02/03/2026 serait de 150,00 €'))
    expect(sans(volet().textContent)).toContain(
      'Retirer ce retrait d\'espèces de 80,00 € pour la caisse rendrait la caisse négative le 03/03/2026 (−70,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
    )
    expect((within(volet()).getByRole('button', { name: 'Remettre à traiter' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un mouvement classé sur la caisse que rien ne vide : « Remettre à traiter » reste offert', async () => {
    poser({ releve: [RETRAIT] })
    rendre()
    await toutVoir()
    await ouvrir('RETRAIT DAB')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Dans la caisse'))
    expect((within(volet()).getByRole('button', { name: 'Remettre à traiter' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('un crédit dont le libellé dit un versement d’espèces', () => {
  const PHRASE = 'Son libellé dit un versement d’espèces : rangé en recette, il compterait deux fois les espèces que la caisse a déjà comptées.'
  const sansFiche = async () => { await ouvrir('VERSEMENT ESPECES GUICHET') }

  it('le dit avant qu’on le range en recette, dans un dossier qui tient une caisse', async () => {
    rendre()
    await sansFiche()
    expect(sans(volet().textContent)).toContain(PHRASE)
    expect(sans(volet().textContent)).toContain('classe-le « Versement d’espèces »')
  })

  it('un libellé qui n’en dit rien, ou un débit : rien de plus', async () => {
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    expect(sans(volet().textContent)).not.toContain('Son libellé dit un versement')
  })

  it('un dossier sans opération de caisse ni caisse reprise n’en dit rien : le versement est peut-être une recette ordinaire', async () => {
    poser({ operations: [], reprise: [] })
    rendre()
    await sansFiche()
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 0,00 €'))
    expect(sans(volet().textContent)).not.toContain(PHRASE)
  })

  // La relecture du 31/10/2026 : le praticien arrive avec sa caisse dans la balance, le relevé est importé avant le brouillard —
  // aucune opération. Le dossier tient une caisse : la fiche dit le libellé du versement (hier, elle se taisait).
  it('la relecture : sans opération, la caisse reprise dans la balance la dit tenue — la fiche dit le libellé du versement', async () => {
    poser({ operations: [] })
    rendre()
    await sansFiche()
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 50,00 €'))
    expect(sans(volet().textContent)).toContain(PHRASE)
  })

  it('la relecture : sans opération ni reprise, un mouvement déjà classé sur la caisse la dit tenue', async () => {
    poser({ operations: [], reprise: [], releve: [RETRAIT, VERSEMENT] })
    rendre()
    await sansFiche()
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 80,00 €'))
    expect(sans(volet().textContent)).toContain(PHRASE)
  })

  it('la caisse lue en partie : peut-être une caisse — il le dit — et la fiche ne classe rien sur elle', async () => {
    faux.caisse = (dossierId) => ({ dossierId, enBase: true, lignes: [], complete: false, motif: '500 lignes lues sur 900' })
    rendre()
    await sansFiche()
    expect(sans(volet().textContent)).toContain(PHRASE)
    expect(sans(volet().textContent)).toContain('La caisse n’est pas lue en entier (500 lignes lues sur 900)')
    expect(boutonVersement()!.disabled).toBe(true)
  })
})

describe('un dossier qui ne tient pas de caisse — aucune opération, aucune ouverture : la fiche n’en parle pas', () => {
  const DEBIT = mouvement({ id: 'm-dab', montant: -80, libelle: 'RETRAIT DAB' })
  beforeEach(() => { poser({ operations: [], reprise: [], releve: [VIREMENT, VERSEMENT, DEBIT] }) })
  const depot = () => within(volet()).getByRole('button', { name: /^Dépôt de garantie/ })

  it('un crédit que rien ne relie aux espèces : ni solde, ni refus, ni « Versement d’espèces » — les autres comptes restent', async () => {
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    expect(depot()).toBeTruthy()
    expect(sans(volet().textContent)).not.toContain('la caisse du 12/03/2026')
    expect(sans(volet().textContent)).not.toContain('rendrait la caisse négative')
    expect(boutonVersement()).toBeNull()
  })

  it('un compte tapé qui est celui de la caisse se juge toujours, avant le clic', async () => {
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await act(async () => { within(volet()).getByRole('button', { name: 'Autre compte de bilan…' }).click() })
    fireEvent.change(within(volet()).getByLabelText('Autre compte de bilan (classe 1 à 5)'), { target: { value: CAISSE } })
    expect(within(volet()).getByRole('button', { name: 'Écrire sur ce compte' }).hasAttribute('disabled')).toBe(true)
    expect(sans(volet().textContent)).toContain('rendrait la caisse négative le 12/03/2026 (−200,00 €)')
  })

  it('un débit garde le bouton, sans phrase : des espèces retirées peuvent ouvrir la caisse', async () => {
    rendre()
    await ouvrir('RETRAIT DAB')
    expect(depot()).toBeTruthy()
    expect(boutonVersement()!.disabled).toBe(false)
    expect(sans(volet().textContent)).not.toContain('Avant ce mouvement, la caisse')
  })

  it('une ouverture sans opération : la caisse n’est pas vide, la fiche en parle — le solde, le refus, le bouton grisé', async () => {
    poser({ operations: [], reprise: REPRISE, releve: [VIREMENT, VERSEMENT, DEBIT] })
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 50,00 €'))
    expect(sans(volet().textContent)).toContain('Ce versement de 200,00 € rendrait la caisse négative le 12/03/2026 (−150,00 €)')
    expect(boutonVersement()!.disabled).toBe(true)
  })

  it('un crédit dont le libellé dit un versement : le solde et le refus de la base, le bouton grisé', async () => {
    rendre()
    await ouvrir('VERSEMENT ESPECES GUICHET')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 0,00 €'))
    expect(sans(volet().textContent)).toContain('Ce versement de 200,00 € rendrait la caisse négative le 12/03/2026 (−200,00 €)')
    expect(boutonVersement()!.disabled).toBe(true)
  })
})

describe('la caisse ou l’une de ses entrées pas lue en entier : la fiche ne classe rien sur elle, et le dit', () => {
  it('la reprise lue en partie', async () => {
    faux.muet = { 'a_nouveaux|*': 0 }
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('La caisse n’est pas lue en entier (la reprise du dossier : '))
    expect(boutonVersement()!.disabled).toBe(true)
    expect(sans(volet().textContent)).not.toContain('Avant ce mouvement, la caisse')
    await act(async () => { boutonVersement()!.click() })
    expect(faux.rpcs).toEqual([])
    // Les autres comptes de bilan, eux, restent offerts : la caisse seule est retenue.
    expect((within(volet()).getByRole('button', { name: /^Virement entre comptes/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('le relevé lu en partie', async () => {
    // Le serveur ne rend que le premier mouvement du relevé, en annonçant le vrai total.
    faux.muet = { 'lignes_bancaires|*': 1 }
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('La caisse n’est pas lue en entier (le relevé : '))
    expect(boutonVersement()!.disabled).toBe(true)
  })

  it('la caisse d’un autre dossier : l’écran attend sa propre lecture', async () => {
    faux.caisse = () => ({ dossierId: 'autre', enBase: true, lignes: OPERATIONS, complete: true, motif: null })
    rendre()
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('La caisse n’est pas lue en entier (la caisse du dossier n’est pas encore lue)'))
    expect(boutonVersement()!.disabled).toBe(true)
  })
})

describe('un dossier en comptabilité d’engagement : la caisse ne se tient pas, la fiche n’en dit rien', () => {
  it('ni proposition de versement, ni solde, ni alerte sur un libellé de versement, même la caisse en base', async () => {
    rendre(false, ENGAGEMENT)
    const cellule = (await screen.findAllByText('VERSEMENT ESPECES GUICHET')).find((e) => e.closest('tr')?.classList.contains('clickable'))!
    await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
    await within(volet()).findByRole('heading', { name: 'Sans justificatif' })
    expect(boutonVersement()).toBeNull()
    expect(sans(volet().textContent)).not.toMatch(/la caisse|Son libellé dit un versement/i)
  })
})

describe('un dossier basculé : les espèces des factures sources entrent dans la caisse du jour', () => {
  const FACTURE = {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0001', date_emission: '2026-03-01', tiers_nom: 'Client fictif',
    facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false, date_prestation: null, montant_ttc: 30,
  }
  const ESPECES = {
    id: 'e1', facture_id: 'f1', montant: 30, ligne_bancaire_id: null, dossier_id: D, date_encaissement: '2026-03-12', moyen: 'especes', annule_id: null,
    cree_le: '2026-03-12T10:00:00Z', retire_le: null, compte_contrepartie: null, cree_par: 'cabinet-1',
  }
  const baser = () => {
    faux.parTable.factures_emises = [FACTURE]
    faux.parTable.facture_lignes = [{ id: 'fl1', facture_id: 'f1', ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 30, taux_tva: 0 }]
    faux.parTable.encaissements_factures = [ESPECES]
    faux.parTable.encaissements_factures_taux = [{ encaissement_id: 'e1', dossier_id: D, taux: 0, montant: 30 }]
  }

  it('la caisse du jour compte les 30 € reçus en espèces par la facture', async () => {
    baser()
    rendre(true)
    await ouvrir('VIR CLIENT DIVERS')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 370,00 €'))
    expect(sans(volet().textContent)).toContain('elle serait de 170,00 €.')
  })

  // C6-Q1 (réponse du cabinet du 31/10/2026) : sans aucune opération saisie, le dossier tient une caisse dès qu'un encaissement
  // en espèces d'une de ses factures sources y entre — la fiche d'un crédit libellé « VERSEMENT ESPECES » le dit alors.
  it('C6-Q1 : sans opération, les espèces de la facture disent la caisse tenue — la fiche dit le libellé du versement', async () => {
    poser({ operations: [] })
    baser()
    rendre(true)
    await ouvrir('VERSEMENT ESPECES GUICHET')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 80,00 €'))
    expect(sans(volet().textContent)).toContain('Son libellé dit un versement d’espèces : rangé en recette, il compterait deux fois')
  })

  it('C6-Q1, NEUTRE : les espèces retirées, aucune caisse tenue — la fiche n’en dit rien, comme hier', async () => {
    // Ni reprise : une caisse reprise la dirait tenue (la relecture du 31/10/2026).
    poser({ operations: [], reprise: [] })
    baser()
    faux.parTable.encaissements_factures = [{ ...ESPECES, retire_le: '2026-03-13T10:00:00Z' }]
    rendre(true)
    await ouvrir('VERSEMENT ESPECES GUICHET')
    await waitFor(() => expect(sans(volet().textContent)).toContain('Avant ce mouvement, la caisse du 12/03/2026 est de 0,00 €'))
    expect(sans(volet().textContent)).not.toContain('Son libellé dit un versement')
  })

  it('les ventes facturées lues en partie : la fiche n’offre aucun classement (elle le dit déjà), donc rien sur la caisse', async () => {
    baser()
    faux.muet = { [`encaissements_factures|${COLONNES_ENCAISSEMENTS_ECRITURES}`]: 0 }
    rendre(true)
    const cellule = (await screen.findAllByText('VIR CLIENT DIVERS')).find((e) => e.closest('tr')?.classList.contains('clickable'))!
    await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
    await within(volet()).findByText(/Les ventes facturées du dossier n’ont pas pu être lues en entier/)
    expect(boutonVersement()).toBeNull()
    expect(sans(volet().textContent)).not.toContain('Avant ce mouvement, la caisse')
    expect(faux.rpcs).toEqual([])
  })
})

describe('le drapeau baissé : la fiche est celle d’hier, au caractère près', () => {
  beforeEach(() => { drapeau.leve = false; faux.caisse = null })

  it('ni proposition de versement, ni phrase de la caisse, ni lecture de la reprise', async () => {
    rendre()
    await ouvrir('VERSEMENT ESPECES GUICHET')
    expect(boutonVersement()).toBeNull()
    const t = sans(volet().textContent)
    expect(t).not.toMatch(/la caisse|Versement d’espèces|Son libellé dit un versement/i)
    expect(faux.tables).not.toContain('a_nouveaux')
    expect(faux.tables).not.toContain('operations_caisse')
    // Les comptes de bilan d'hier : le virement entre comptes et le dépôt de garantie.
    expect(within(volet()).getByRole('button', { name: /^Virement entre comptes/ })).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: /^Dépôt de garantie/ })).toBeTruthy()
  })
})

// LA FICHE D'UN MOUVEMENT DEVANT UNE CAISSE LUE EN PARTIE (ligne 26.6, étape C9b) : les paiements de pièces par la caisse ne sont
// pas connus — une pièce payée en espèces paraîtrait à payer, et « Associer » la paierait une seconde fois par la banque. La
// migration en base, aucune pièce ne s'associe d'ici et la fiche le dit, comme les lots se suspendent déjà ; sans elle, rien ne
// change.
describe('la fiche d’un mouvement, les paiements par la caisse lus en partie', () => {
  const PIECE = {
    id: 'p-vir', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/v.pdf`, nom_fichier: 'v.pdf', storage_hash: null,
    date_piece: '2026-03-11', tiers: 'CLIENT DIVERS', montant_ht: null, montant_tva: null, montant_ttc: 200, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: 'c-hon', sous_dossier_id: null, type_piece: 'vente', statut: 'validee', notes: null,
    confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-11T08:00:00Z', updated_at: '2026-03-11T08:00:00Z',
  }
  const preparer = (complete: boolean) => {
    poser()
    faux.parTable.pieces = [PIECE]
    faux.caisse = (dossierId) => ({ dossierId, enBase: true, lignes: OPERATIONS, complete, motif: complete ? null : '1 lue sur 2' })
  }
  const ouvrirLeVirement = async () => {
    const cellule = (await screen.findAllByText('VIR CLIENT DIVERS')).find((e) => e.closest('tr')?.classList.contains('clickable'))!
    await act(async () => { (cellule.closest('tr') as HTMLElement).click() })
    await within(volet()).findByRole('heading', { name: /Choisir une (autre )?pièce/ })
  }
  const associer = () => within(volet()).queryAllByRole('button', { name: /^Associer/ }) as HTMLButtonElement[]

  it('levé, la caisse lue en partie : « Associer » grisé partout, la raison dite, et rien ne part', async () => {
    drapeauDuPaiement.leve = true
    preparer(false)
    rendre()
    await ouvrirLeVirement()
    expect(associer().length).toBeGreaterThan(0)
    expect(associer().every((b) => b.disabled)).toBe(true)
    expect(sans(volet().textContent)).toContain('Les paiements de pièces par la caisse n’ont pas pu être lus en entier')
    for (const b of associer()) await act(async () => { b.click() })
    expect(faux.rpcs.filter((r) => /rapproch/.test(r.nom))).toEqual([])
  })

  it('levé, la caisse lue en entier : « Associer » offert, sans la phrase', async () => {
    drapeauDuPaiement.leve = true
    preparer(true)
    rendre()
    await ouvrirLeVirement()
    expect(associer().some((b) => !b.disabled)).toBe(true)
    expect(sans(volet().textContent)).not.toContain('Les paiements de pièces par la caisse n’ont pas pu être lus en entier')
  })

  it('le drapeau baissé, la même caisse lue en partie : la fiche d’hier — « Associer » offert', async () => {
    preparer(false)
    rendre()
    await ouvrirLeVirement()
    expect(associer().some((b) => !b.disabled)).toBe(true)
    expect(sans(volet().textContent)).not.toContain('Les paiements de pièces par la caisse')
  })
})
