import { describe, expect, it } from 'vitest'
import { texteCaisseNegative, type DossierDeLaCaisse } from './caisse'
import { caisseRejouee, dossierDuClient, type DossierDuClient, type JourDeLaCaisseDuClient, type OperationDuClient } from './caisseClient'
import type { LectureDeLaCaisseDuClient } from './caisseClientLecture'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import {
  anneeValidee, auteurDuPaiement, avantLaCaisseLue, caisseDeMesPieces, confirmationDeLaCorrectionDuClient, confirmationDuPaiement,
  confirmationDuRetraitDuPaiement, correctionDuPaiement, correctionDuPaiementSelon, formulaireDeLaCorrectionDuClient, paiementCorrige,
  verdictDeLaCorrectionDuClient, verdictDeLaCorrectionDuClientSelon,
  libelleDuGeste, MONTANT_DU_PAIEMENT_ILLISIBLE, MONTANT_SANS_SIGNE, paiementDansMaCaisse, paiementDit, paiementDuClientOuvert,
  paiementEnregistre, paiementRetire, paiementsDeLaPiece, payableParLaCaisse, pieceVueParLeClient, premiereAnneeLue,
  retraitDuPaiement, saisieDuPaiement, verdictDuPaiement, verdictDuPaiementSelon,
} from './paiementDeMesPieces'
import {
  jugerLeReglementDuClientSelon, jugerLeReglementSelon, MOTS, ORDRE_DU_PAIEMENT, type PieceDuPaiement, type PieceDuPaiementDuClient,
} from './paiementParLaCaisse'
import { CORRECTION_DU_PAIEMENT_EXPORTEE, motsDuRemedeSelon, RIEN_A_CORRIGER } from './correctionDuPaiement'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE DEPUIS « MES PIÈCES » (étape C12b ; CAISSE2-Q4, (A)). Ce que ces cas gardent :
//  1. LA BRANCHE DU CLIENT, CONFRONTÉE À L'EXPORT : chaque phrase qu'elle rend est, à la lettre, un `raise` de
//     `regler_piece_par_la_caisse` (ou le texte de la caisse négative de `texte_caisse_negative`), dans l'ordre de la base ;
//     là où le client lit tout ce que la base lit, elle juge comme la branche du cabinet ; ce qu'il ne lit pas (l'exemplaire
//     d'une facture source, le plafond d'une pièce validée, le reste au centime), elle le laisse à la base — et la phrase
//     du client au reste au centime est celle que la base réserve au client, sans montant ;
//  2. le SENS des espèces tiré du signe du montant de la pièce, comme la base, et jamais ce montant dans un texte ;
//  3. les règles du formulaire, les états de la caisse lue, « par toi » sur ses seules saisies, et les mots du client.

const AUJOURDHUI = '2026-11-02'
const MOI = 'u-client'
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()]
  .sort((a, b) => (a.chemin.split('/').pop()! < b.chemin.split('/').pop()! ? -1 : 1))

/** La dernière définition d'une fonction, dans l'export, dans l'ordre des versions. */
function definition(nom: string): string {
  const motif = new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'g')
  const fichier = MIGRATIONS.filter((f) => new RegExp(motif.source).test(f.texte)).pop()
  if (!fichier) throw new Error(`${nom} introuvable`)
  const debut = [...fichier.texte.matchAll(motif)].pop()!.index
  return fichier.texte.slice(debut, fichier.texte.indexOf('\n$$;', debut))
}

// Les `raise exception` de la fonction, dans l'ordre du texte, en expressions : chaque `%` y vaut une valeur.
const RAISES = [...definition('regler_piece_par_la_caisse').matchAll(/raise exception '((?:[^']|'')*)'/g)]
  .map((m) => sansApostrophes(m[1])).filter((g) => g !== '%')
const enMotif = (g: string) => new RegExp(`^${g.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`)

/** Le rang, dans le corps de la base, du `raise` dont la phrase est celle-ci ; la caisse négative après tous. */
function rangDansLaBase(message: string): number {
  const m = sansApostrophes(message)
  const i = RAISES.findIndex((g) => enMotif(g).test(m))
  if (i >= 0) return i
  if (/^Ce paiement de .+ rendrait la caisse négative le /.test(m)) return RAISES.length
  return -1
}

// ── Une caisse, telle que « Mes pièces » la rejoue ────────────────────────────────────────────────────────────────────

const jour = (o: Partial<JourDeLaCaisseDuClient>): JourDeLaCaisseDuClient => ({
  jour: '2026-01-01', report: 0, ouverture: 0, operations: 0, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
  solde: 0, fige: false, ...o,
})
const operation = (o: Partial<OperationDuClient>): OperationDuClient => ({
  id: 'o1', dossier_id: 'd1', genre: 'paiement', date: '2026-03-12', montant: -80, categorie_id: null, taux_tva: null,
  encaissements_du_jour: null, piece_id: 'p1', origine: 'client', remplace_id: null, cree_le: '2026-03-12T10:00:00Z',
  cree_par: MOI, retire_le: null, ...o,
})
const DOSSIER: DossierDuClient = {
  id: 'd1', statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: null,
}

/** Les jours que `caisse_du_client` rendrait : 100 € reportés au 1er janvier 2025, puis les opérations données, jour par jour. */
function joursDe(operations: readonly OperationDuClient[]): JourDeLaCaisseDuClient[] {
  const parJour = new Map<string, number>()
  for (const o of operations) if (o.retire_le == null) parJour.set(o.date, (parJour.get(o.date) ?? 0) + Math.round(o.montant * 100))
  let solde = 10000
  const jours = [jour({ jour: '2025-01-01', report: 100, solde: 100 })]
  for (const [j, c] of [...parJour].sort((a, b) => a[0].localeCompare(b[0]))) {
    solde += c
    jours.push(jour({ jour: j, operations: c / 100, solde: solde / 100 }))
  }
  return jours
}

/** Le dossier du client sur une caisse rejouée : 100 € reportés au 1er janvier 2025, et les opérations données. */
function dossierRejoue(operations: OperationDuClient[] = []): DossierDeLaCaisse {
  const r = caisseRejouee(joursDe(operations), operations, 2025)
  if (r.etat === null) throw new Error(r.motif)
  return dossierDuClient({ dossier: DOSSIER, moi: MOI, aujourdhui: AUJOURDHUI }, { etat: 'lue', categorie: null }, r.etat)
}

const ACHAT: PieceDuPaiementDuClient = { id: 'p1', type_piece: 'achat', especesEntrent: false }
const VENTE: PieceDuPaiementDuClient = { id: 'p2', type_piece: 'vente', especesEntrent: true }

describe('la branche du client, confrontée à l’export', () => {
  it('la base réserve au client sa phrase du reste au centime, sans montant, et la branche du cabinet la lui dit', () => {
    const corps = sansApostrophes(definition('regler_piece_par_la_caisse'))
    const client = sansApostrophes(MOTS.au_centime_client.gabarit)
    expect(corps).toContain(`if v_origine = 'client' then\n        raise exception '${client}'`)
    expect(client).not.toMatch(/%|€/)
    // Le cabinet qui JUGE pour un client (sa saisie lue en entier) lui rend cette phrase ; la branche du client ne lit pas ce
    // qui la décide (le montant, le relevé) : elle laisse la base en juger.
    const quarante: PieceDuPaiement = {
      id: 'p1', type_piece: 'achat', statut: 'a_valider', montant_ttc: 40, devise: 'EUR', exemplaire: null, paiementsDuReleve: [],
    }
    const saisie = { piece_id: 'p1', date: '2026-03-12', montant: -39.99 }
    const cabinet = jugerLeReglementSelon(true, saisie, dossierRejoue(), [quarante], 'x')
    expect(cabinet).toEqual({ etat: 'refuse', refus: { code: '22023', message: MOTS.au_centime_client.gabarit } })
    expect(jugerLeReglementDuClientSelon(true, saisie, dossierRejoue(), [ACHAT], 'x').etat).toBe('accepte')
  })

  it('ce que le client ne lit pas reste à la base : l’exemplaire d’une source, le plafond d’une pièce validée', () => {
    const saisie = { piece_id: 'p1', date: '2026-03-12', montant: -10 }
    const exemplaire: PieceDuPaiement = {
      id: 'p1', type_piece: 'achat', statut: 'validee', montant_ttc: 5, devise: 'EUR',
      exemplaire: { numero: 'F-1', source_de_la_vente: true }, paiementsDuReleve: [],
    }
    expect(jugerLeReglementSelon(true, saisie, dossierRejoue(), [exemplaire], 'x').etat).toBe('refuse')
    expect(jugerLeReglementSelon(true, saisie, dossierRejoue(), [{ ...exemplaire, exemplaire: null }], 'x').etat).toBe('refuse')
    expect(jugerLeReglementDuClientSelon(true, saisie, dossierRejoue(), [ACHAT], 'x').etat).toBe('accepte')
  })

  it('une batterie tirée : chaque phrase est un `raise` de la base, à la lettre ; l’ordre est le sien ; elle juge comme le cabinet là où il lit autant', () => {
    const t = tirage(20261102)
    const dates = ['', '1999-12-31', '2000-01-01', '2025-02-01', '2026-03-12', '2026-11-02', '2026-11-03']
    const montants = [null, 0, 0.001, 12.345, 10, -10, 80, -80, 150, -150, 1e13, -1e13]
    const types: PieceDuPaiement['type_piece'][] = ['achat', 'vente', 'note_frais', 'autre']
    const vus = new Set<number>()
    let acceptes = 0
    for (let i = 0; i < 4000; i++) {
      const type = types[entierTire(t, types.length)]
      const avoir = entierTire(t, 2) === 1
      // Un montant de pièce si grand que le reste au centime ne la touche jamais : le client et le cabinet lisent autant.
      const ttc = avoir ? -1e9 : 1e9
      const cabinet: PieceDuPaiement = {
        id: 'p1', type_piece: type, statut: 'a_valider', montant_ttc: ttc, devise: 'EUR', exemplaire: null, paiementsDuReleve: [],
      }
      const client = pieceVueParLeClient({ id: 'p1', type_piece: type, montant_ttc: ttc })
      const date = dates[entierTire(t, dates.length)]
      const saisie = {
        piece_id: entierTire(t, 10) === 0 ? 'inconnue' : 'p1', date: date === '' ? null : date,
        montant: montants[entierTire(t, montants.length)],
      }
      const operations = entierTire(t, 2) === 0 ? [] : [operation({ id: 'o9', date: '2025-06-01', montant: -60 })]
      const d = dossierRejoue(operations)
      const duClient = jugerLeReglementDuClientSelon(true, saisie, d, [client], 'x')
      const duCabinet = jugerLeReglementSelon(true, saisie, d, [cabinet], 'x')
      expect(duClient, JSON.stringify(saisie)).toEqual(duCabinet)
      if (duClient.etat === 'refuse') {
        const rang = rangDansLaBase(duClient.refus.message)
        expect(rang, duClient.refus.message).toBeGreaterThanOrEqual(0)
        vus.add(rang)
      } else acceptes++
    }
    // Le plancher : la batterie atteint l'accès à la pièce, le type, la date, le montant, le sens et la caisse négative.
    expect(vus.size).toBeGreaterThanOrEqual(10)
    expect(vus.has(RAISES.length)).toBe(true)
    expect(acceptes).toBeGreaterThan(50)
  })

  it('l’ordre de la branche du client est une suite de celui de la base', () => {
    const cles = ORDRE_DU_PAIEMENT.regler_piece_par_la_caisse
    // Une saisie qui enfreint tout : la pièce inconnue parle la première, puis, la pièce trouvée, le type, puis la date…
    const tout = { piece_id: 'inconnue', date: '1999-01-01', montant: 0.001 }
    const message = (s: typeof tout, p: PieceDuPaiementDuClient) => {
      const j = jugerLeReglementDuClientSelon(true, s, dossierRejoue(), [p], 'x')
      return j.etat === 'refuse' ? j.refus.message : null
    }
    const note = { ...ACHAT, type_piece: 'note_frais' as const }
    const suite = [
      message(tout, ACHAT),
      message({ ...tout, piece_id: 'p1' }, note),
      message({ ...tout, piece_id: 'p1' }, ACHAT),
      message({ ...tout, piece_id: 'p1', date: '2026-03-12' }, ACHAT),
      message({ ...tout, piece_id: 'p1', date: '2026-03-12', montant: 10 }, ACHAT),
    ].map((m) => rangDansLaBase(m ?? ''))
    expect(suite).toEqual([...suite].sort((a, b) => a - b))
    expect(suite.map((r) => RAISES[r])).toEqual(['piece_inconnue', 'note_de_frais', 'date_avant_2000', 'montant_centime', 'sens']
      .map((c) => sansApostrophes(MOTS[c as keyof typeof MOTS].gabarit)))
    expect(cles.indexOf('sens')).toBeGreaterThan(cles.indexOf('montant_centime'))
  })
})

describe('le sens des espèces, tiré du signe du montant de la pièce', () => {
  it('suit la règle de la base : (type = vente) <> (montant < 0)', () => {
    expect(definition('regler_piece_par_la_caisse')).toContain("v_entree := (v_type = 'vente') <> coalesce(v_ttc < 0, false);")
    const cas: [Parameters<typeof pieceVueParLeClient>[0], boolean][] = [
      [{ id: 'a', type_piece: 'achat', montant_ttc: 80 }, false],
      [{ id: 'b', type_piece: 'achat', montant_ttc: -80 }, true],
      [{ id: 'c', type_piece: 'vente', montant_ttc: 80 }, true],
      [{ id: 'd', type_piece: 'vente', montant_ttc: -80 }, false],
      [{ id: 'e', type_piece: 'achat', montant_ttc: null }, false],
      [{ id: 'f', type_piece: 'vente', montant_ttc: null }, true],
    ]
    for (const [p, entrent] of cas) {
      const vue = pieceVueParLeClient(p)
      expect(vue, p.id).toEqual({ id: p.id, type_piece: p.type_piece, especesEntrent: entrent })
      const saisie = saisieDuPaiement({ date: '2026-03-12', montant: '80,00' }, vue)
      expect(saisie, p.id).toEqual({ piece_id: p.id, date: '2026-03-12', montant: entrent ? 80 : -80 })
    }
  })

  it('le montant de la pièce ne passe pas la vue du client, et n’entre dans aucun texte', () => {
    const vue = pieceVueParLeClient({ id: 'p1', type_piece: 'achat', montant_ttc: 123.45 })
    expect(JSON.stringify(vue)).not.toMatch(/123/)
    const d = dossierRejoue()
    const textes: string[] = []
    for (const montant of ['0,001', '-5', 'abc', '500', '30', '0']) {
      for (const date of ['2024-12-31', '2026-03-12', '2026-11-03']) {
        const v = verdictDuPaiement({ date, montant }, vue, d, [], 2025)
        if (v.etat === 'refuse') textes.push(v.message)
        if (v.etat === 'permis') textes.push(confirmationDuPaiement(v.saisie, '2026-03-05T09:00:00Z', v.soldeApres), paiementEnregistre(v.saisie, '2026-03-05T09:00:00Z'))
      }
    }
    expect(textes.length).toBeGreaterThan(10)
    for (const x of textes) expect(x).not.toMatch(/123,45|123\.45/)
  })
})

describe('le formulaire', () => {
  const d = dossierRejoue()

  it('vide, illisible, avec un signe, avant la caisse lue, une année figée : ses propres mots', () => {
    expect(verdictDuPaiement({ date: '', montant: '10' }, ACHAT, d, [], 2025)).toEqual({ etat: 'vide' })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '  ' }, ACHAT, d, [], 2025)).toEqual({ etat: 'vide' })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '8O' }, ACHAT, d, [], 2025)).toEqual({ etat: 'refuse', message: MONTANT_DU_PAIEMENT_ILLISIBLE })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '-10' }, ACHAT, d, [], 2025)).toEqual({ etat: 'refuse', message: MONTANT_SANS_SIGNE })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '-0' }, ACHAT, d, [], 2025)).toEqual({ etat: 'refuse', message: MONTANT_SANS_SIGNE })
    expect(verdictDuPaiement({ date: '2024-12-31', montant: '10' }, ACHAT, d, [], 2025)).toEqual({ etat: 'refuse', message: avantLaCaisseLue(2025) })
    const figes = [jour({ jour: '2025-01-01', report: 100, solde: 100, fige: true })]
    expect(verdictDuPaiement({ date: '2025-06-01', montant: '10' }, ACHAT, d, figes, 2025)).toEqual({ etat: 'refuse', message: anneeValidee(2025) })
    // L'année d'après n'est pas figée par la précédente.
    expect(verdictDuPaiement({ date: '2026-06-01', montant: '10' }, ACHAT, d, figes, 2025).etat).toBe('permis')
  })

  it('les refus de la base, aux mots du client : la date à venir, le montant au centime, la caisse négative', () => {
    expect(verdictDuPaiement({ date: '2026-11-03', montant: '10' }, ACHAT, d, [], 2025))
      .toEqual({ etat: 'refuse', message: pourLEspace('client', 'Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 02/11/2026.') })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '0' }, ACHAT, d, [], 2025))
      .toEqual({ etat: 'refuse', message: 'Une opération de caisse de zéro euro n\'a rien à écrire.' })
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '150' }, ACHAT, d, [], 2025))
      .toEqual({ etat: 'refuse', message: texteCaisseNegative('paiement', -15000, '2026-03-12', -5000) })
    // Une entrée ne vide jamais la caisse.
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '150' }, VENTE, d, [], 2025)).toMatchObject({ etat: 'permis', soldeApres: 25000 })
  })

  it('permis : la saisie qui part, signée, et la caisse du jour après elle', () => {
    expect(verdictDuPaiement({ date: '2026-03-12', montant: '80' }, ACHAT, d, [], 2025)).toEqual({
      etat: 'permis', saisie: { piece_id: 'p1', date: '2026-03-12', montant: -80 }, soldeApres: 2000,
    })
    expect(verdictDuPaiementSelon(false, { date: '2026-03-12', montant: '80' }, ACHAT, d, [], 2025).etat).toBe('refuse')
  })
})

describe('la caisse que « Mes pièces » lit', () => {
  const lue = (o: Partial<Extract<LectureDeLaCaisseDuClient, { etat: 'lue' }>> = {}): LectureDeLaCaisseDuClient => ({
    dossierId: 'd1', annee: 2025, etat: 'lue', dossier: DOSSIER, nature: { etat: 'lue', categorie: null },
    operations: { lignes: [], complete: true, motif: null },
    jours: { lignes: [jour({ jour: '2025-01-01', report: 100, solde: 100 })], complete: true, motif: null }, ...o,
  })
  const entree = (o: Partial<Parameters<typeof caisseDeMesPieces>[0]> = {}) => caisseDeMesPieces({
    ouverte: true, lecture: lue(), dossierId: 'd1', anneeEnCours: 2026, moi: MOI, aujourdhui: AUJOURDHUI, piecesLuesEnEntier: true, ...o,
  })

  it('fermée sans la case ; en attente avant le retour, ou pour une autre société, ou une autre année', () => {
    expect(premiereAnneeLue(2026)).toBe(2025)
    expect(entree({ ouverte: false })).toEqual({ etat: 'fermee' })
    expect(entree({ lecture: null })).toEqual({ etat: 'attente' })
    expect(entree({ lecture: { ...lue(), dossierId: 'd2' } })).toEqual({ etat: 'attente' })
    expect(entree({ lecture: { ...lue(), annee: 2026 } })).toEqual({ etat: 'attente' })
  })

  it('muette sur un échec, sans la case à la base, ou lue en partie', () => {
    expect(entree({ lecture: { dossierId: 'd1', annee: 2025, etat: 'echec', motif: 'panne' } })).toMatchObject({ etat: 'muette', texte: expect.stringContaining('(panne)') })
    expect(entree({ lecture: { dossierId: 'd1', annee: 2025, etat: 'sans_caisse' } })).toMatchObject({ etat: 'muette' })
    expect(entree({ lecture: lue({ operations: { lignes: [], complete: false, motif: 'coupée' } }) }))
      .toMatchObject({ etat: 'muette', texte: expect.stringContaining('(coupée)') })
    expect(entree({ lecture: lue({ jours: { lignes: [], complete: false, motif: 'tronquée' } }) })).toMatchObject({ etat: 'muette' })
  })

  it('lue : les gestes seulement si la caisse se rejoue, si le paiement s’ouvre et si les pièces sont lues en entier', () => {
    const ok = entree()
    expect(ok).toMatchObject({ etat: 'lue', raison: null })
    expect(ok.etat === 'lue' && ok.dossier?.quiEcrit).toBe('client')
    const nonRejouee = entree({ lecture: lue({ operations: { lignes: [operation({ date: '2025-03-12' })], complete: true, motif: null } }) })
    expect(nonRejouee).toMatchObject({ etat: 'lue', dossier: null, raison: expect.stringContaining('ne se recompose pas') })
    expect(entree({ lecture: lue({ dossier: { ...DOSSIER, statut_tva: 'redevable' } }) }))
      .toMatchObject({ etat: 'lue', dossier: null, raison: paiementDuClientOuvert({ statut_tva: 'redevable', mode_comptable: 'tresorerie' }) })
    expect(entree({ lecture: lue({ dossier: { ...DOSSIER, mode_comptable: 'engagement' } }) }))
      .toMatchObject({ etat: 'lue', dossier: null, raison: 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' })
    expect(entree({ piecesLuesEnEntier: false })).toMatchObject({ etat: 'lue', dossier: null, raison: expect.stringContaining('Tes pièces') })
    // Le paiement ne lit pas la nature des recettes : sans elle, il s'ouvre.
    expect(paiementDuClientOuvert({ statut_tva: 'franchise', mode_comptable: 'tresorerie' })).toBeNull()
  })
})

describe('les paiements d’une pièce, et qui les a saisis', () => {
  const miens = operation({ id: 'a' })
  const duCabinet = operation({ id: 'b', origine: 'cabinet', cree_par: 'u-cabinet', date: '2026-03-01' })
  const dUnAutre = operation({ id: 'c', cree_par: 'u-autre', date: '2026-03-20' })
  const retire = operation({ id: 'd', retire_le: '2026-03-13T00:00:00Z' })

  it('ses paiements non retirés, du plus ancien au plus récent', () => {
    expect(paiementsDeLaPiece('p1', [miens, duCabinet, dUnAutre, retire, operation({ id: 'e', piece_id: 'p9' })]).map((o) => o.id))
      .toEqual(['b', 'a', 'c'])
  })

  it('« par toi » pour ses seules saisies', () => {
    expect(paiementDit(miens, MOI)).toBe('Payée en espèces le 12/03/2026, 80,00 € (par toi)')
    expect(paiementDit(duCabinet, MOI)).toBe('Payée en espèces le 01/03/2026, 80,00 € (par ton cabinet)')
    expect(paiementDit(dUnAutre, MOI)).toBe('Payée en espèces le 20/03/2026, 80,00 € (depuis un autre accès)')
    expect(paiementDit({ ...miens, montant: 45 }, MOI)).toBe('Encaissée en espèces le 12/03/2026, 45,00 € (par toi)')
    // Une saisie du client depuis un autre compte n'est pas « par toi » ; une du cabinet sous le même compte non plus.
    expect(auteurDuPaiement({ origine: 'cabinet', cree_par: MOI }, MOI)).toBe('par ton cabinet')
  })

  it('le retrait : les siens seulement, jamais sur une année figée, refusé avant le clic quand la caisse passerait sous zéro', () => {
    const d = dossierRejoue([miens, duCabinet])
    expect(retraitDuPaiement(miens, d, [], MOI, 2025)).toEqual({ offert: true, refus: null })
    expect(retraitDuPaiement(duCabinet, d, [], MOI, 2025)).toEqual({ offert: false })
    expect(retraitDuPaiement(dUnAutre, d, [], MOI, 2025)).toEqual({ offert: false })
    expect(retraitDuPaiement(retire, d, [], MOI, 2025)).toEqual({ offert: false })
    expect(retraitDuPaiement(miens, d, [jour({ jour: '2026-01-01', fige: true })], MOI, 2025)).toEqual({ offert: false })
    // L'encaissement en espèces d'une vente (60 €) dont une sortie (130 €) a dépendu : son retrait viderait la caisse.
    const encaissement = operation({ id: 'v', montant: 60, date: '2026-02-01', piece_id: 'p2' })
    const sortie = operation({ id: 's', montant: -130, date: '2026-02-02', origine: 'cabinet', cree_par: 'u-cabinet' })
    const d2 = dossierRejoue([encaissement, sortie])
    expect(retraitDuPaiement(encaissement, d2, [], MOI, 2025)).toEqual({
      offert: true, refus: pourLEspace('client', texteCaisseNegative('retrait_paiement', 6000, '2026-02-02', -3000)),
    })
  })

  it('le retrait d’un paiement daté d’avant la première année lue : offert mais refusé, avec la phrase qui renvoie au cabinet', () => {
    const ancien = operation({ id: 'z', date: '2024-11-20' })
    const d = dossierRejoue([miens])
    // « Mes pièces » le montre (toutes les années), la caisse rejouée ne le porte pas : jamais le faux motif « relis ta caisse ».
    expect(retraitDuPaiement(ancien, d, [], MOI, 2025)).toEqual({ offert: true, refus: avantLaCaisseLue(2025) })
    // Un paiement du cabinet ou retiré reste sans retrait, ancien ou non.
    expect(retraitDuPaiement({ ...ancien, origine: 'cabinet', cree_par: 'u-cabinet' }, d, [], MOI, 2025)).toEqual({ offert: false })
    expect(retraitDuPaiement({ ...ancien, retire_le: '2026-01-01T00:00:00Z' }, d, [], MOI, 2025)).toEqual({ offert: false })
  })

  it('les confirmations nomment ce qui part, la pièce par son dépôt, et la caisse du jour après', () => {
    const d = dossierRejoue([miens])
    expect(confirmationDuRetraitDuPaiement(miens, '2026-03-05T09:00:00Z', d)).toBe(
      'Retirer le paiement en espèces du 12/03/2026, 80,00 €, de la pièce déposée le 05/03/2026 ? Il reste dans '
      + 'l’historique de ta caisse, retiré, et ta caisse du 12/03/2026 passera à 100,00 €. '
      + motsDuRemedeSelon(CORRECTION_DU_PAIEMENT_EXPORTEE).finDuRetraitDuClient,
    )
    expect(confirmationDuPaiement({ piece_id: 'p1', date: '2026-03-12', montant: -80 }, '2026-03-05T09:00:00Z', 2000)).toBe(
      'Payer en espèces de ta caisse la pièce déposée le 05/03/2026 : 80,00 € sortis le 12/03/2026 ? Ta caisse du '
      + '12/03/2026 passera à 20,00 €. Ton cabinet le voit aussitôt.',
    )
    expect(confirmationDuPaiement({ piece_id: 'p2', date: '2026-03-12', montant: 45 }, '2026-03-05T09:00:00Z', 14500))
      .toMatch(/^Encaisser en espèces dans ta caisse la pièce déposée le 05\/03\/2026 : 45,00\s€ reçus le 12\/03\/2026 \?/)
    expect(paiementRetire(miens)).toBe('Retiré : le paiement en espèces du 12/03/2026, 80,00 €.')
  })
})

describe('les mots', () => {
  it('« Ma caisse » nomme un paiement par le dépôt de sa pièce, sinon par son sens', () => {
    expect(paiementDansMaCaisse({ montant: -80 }, '2026-03-05T09:00:00Z')).toBe('Paiement de la pièce déposée le 05/03/2026')
    expect(paiementDansMaCaisse({ montant: 45 }, '2026-03-05T09:00:00Z')).toBe('Encaissement de la pièce déposée le 05/03/2026')
    expect(paiementDansMaCaisse({ montant: -80 }, null)).toBe('Pièce payée en espèces')
    expect(paiementDansMaCaisse({ montant: 45 }, null)).toBe('Espèces reçues pour une pièce')
  })

  it('le geste, la pièce payable, et aucune forme du cabinet dans ce que le client lit', () => {
    expect(libelleDuGeste(ACHAT)).toBe('Payée en espèces de ta caisse')
    expect(libelleDuGeste(VENTE)).toBe('Encaissée en espèces dans ta caisse')
    expect(['achat', 'vente', 'note_frais', 'autre'].map((t) => payableParLaCaisse({ type_piece: t as PieceDuPaiement['type_piece'] })))
      .toEqual([true, true, false, false])
    const d = dossierRejoue([operation({})])
    const textes = [
      MONTANT_DU_PAIEMENT_ILLISIBLE, MONTANT_SANS_SIGNE, avantLaCaisseLue(2025), anneeValidee(2025), libelleDuGeste(ACHAT),
      libelleDuGeste(VENTE), paiementDit(operation({}), MOI), confirmationDuRetraitDuPaiement(operation({}), '2026-03-05', d),
      confirmationDuPaiement({ piece_id: 'p1', date: '2026-03-12', montant: -80 }, '2026-03-05', 2000),
      paiementEnregistre({ piece_id: 'p1', date: '2026-03-12', montant: -80 }, '2026-03-05'), paiementRetire(operation({})),
      paiementDansMaCaisse({ montant: -1 }, '2026-03-05'),
    ]
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })
})

describe('la correction d’un paiement depuis « Mes pièces » (C12B-Q1)', () => {
  // La caisse : 100 € reportés au 1er janvier 2025 ; le paiement du praticien, 80 € le 12/03/2026 ; celui de son cabinet, 10 €
  // le 01/03/2026.
  const sien = operation({})
  const duCabinet = operation({ id: 'o2', piece_id: 'p4', date: '2026-03-01', montant: -10, origine: 'cabinet', cree_par: 'u-cabinet' })
  const d = () => dossierRejoue([sien, duCabinet])
  const jours = () => joursDe([sien, duCabinet])

  it('le drapeau baissé : rien ne s’offre, et le verdict le dit sans juger', () => {
    expect(correctionDuPaiementSelon(false, sien, d(), jours(), MOI, 2025)).toEqual({ offert: false })
    expect(correctionDuPaiement(sien, d(), jours(), MOI, 2025).offert).toBe(CORRECTION_DU_PAIEMENT_EXPORTEE)
    expect(verdictDeLaCorrectionDuClientSelon(false, { date: '2026-03-10', montant: '80' }, sien, ACHAT, d(), jours(), 2025))
      .toEqual({ etat: 'refuse', message: 'La correction d’un paiement par ta caisse ne s’offre pas encore.' })
    expect(verdictDeLaCorrectionDuClient({ date: '2026-03-10', montant: '80' }, sien, ACHAT, d(), jours(), 2025).etat)
      .toBe(CORRECTION_DU_PAIEMENT_EXPORTEE ? 'permis' : 'refuse')
  })

  it('levé : ses propres paiements seuls, non retirés, sur une année ouverte ; d’avant les années lues, la phrase du formulaire', () => {
    expect(correctionDuPaiementSelon(true, sien, d(), jours(), MOI, 2025)).toEqual({ offert: true, refus: null })
    expect(correctionDuPaiementSelon(true, duCabinet, d(), jours(), MOI, 2025)).toEqual({ offert: false })
    expect(correctionDuPaiementSelon(true, { ...sien, cree_par: 'un-autre' }, d(), jours(), MOI, 2025)).toEqual({ offert: false })
    expect(correctionDuPaiementSelon(true, { ...sien, retire_le: '2026-03-13T00:00:00Z' }, d(), jours(), MOI, 2025)).toEqual({ offert: false })
    expect(correctionDuPaiementSelon(true, { ...sien, genre: 'apport', piece_id: null }, d(), jours(), MOI, 2025)).toEqual({ offert: false })
    const ancien = operation({ date: '2024-11-20' })
    // « Mes pièces » le montre (toutes les années), la caisse rejouée ne le porte pas : la phrase du formulaire, jamais « relis ta
    // caisse ».
    expect(correctionDuPaiementSelon(true, ancien, d(), jours(), MOI, 2025)).toEqual({ offert: true, refus: avantLaCaisseLue(2025) })
    // Une année que la lecture dit figée : rien ne s'offre, comme le retrait.
    const figes = jours().map((j) => ({ ...j, fige: j.jour.startsWith('2026') }))
    expect(correctionDuPaiementSelon(true, sien, d(), figes, MOI, 2025)).toEqual({ offert: false })
  })

  it('le formulaire s’ouvre sur son jour et ses espèces, sans signe', () => {
    expect(formulaireDeLaCorrectionDuClient(sien)).toEqual({ date: '2026-03-12', montant: '80,00' })
    expect(formulaireDeLaCorrectionDuClient(operation({ montant: 45.5 }))).toEqual({ date: '2026-03-12', montant: '45,50' })
    expect(formulaireDeLaCorrectionDuClient(operation({ montant: -0.07 }))).toEqual({ date: '2026-03-12', montant: '0,07' })
  })

  it('les refus avant le clic, dans l’ordre : les règles du formulaire, rien à corriger, puis la base aux mots du client', () => {
    const juger = (date: string, montant: string) => verdictDeLaCorrectionDuClientSelon(true, { date, montant }, sien, ACHAT, d(), jours(), 2025)
    expect(juger('', '80')).toEqual({ etat: 'vide' })
    expect(juger('2026-03-10', 'quatre-vingts')).toEqual({ etat: 'refuse', message: MONTANT_DU_PAIEMENT_ILLISIBLE })
    expect(juger('2026-03-10', '-80')).toEqual({ etat: 'refuse', message: MONTANT_SANS_SIGNE })
    expect(juger('2024-12-31', '80')).toEqual({ etat: 'refuse', message: avantLaCaisseLue(2025) })
    expect(juger('2026-03-12', '80,00')).toEqual({ etat: 'refuse', message: RIEN_A_CORRIGER })
    expect(juger('2026-03-12', '0')).toEqual({ etat: 'refuse', message: pourLEspace('client', MOTS.montant_nul.gabarit) })
    // La caisse négative : 100 € reportés, 10 € payés par le cabinet le 01/03 ; 95 € le 12/03, sans l'ancien, la vident de 5 €.
    expect(juger('2026-03-12', '95')).toEqual({ etat: 'refuse', message: pourLEspace('client', texteCaisseNegative('paiement', -9500, '2026-03-12', -500)) })
    const figes = jours().map((j) => ({ ...j, fige: j.jour.startsWith('2025') }))
    expect(verdictDeLaCorrectionDuClientSelon(true, { date: '2025-06-01', montant: '80' }, sien, ACHAT, d(), figes, 2025))
      .toEqual({ etat: 'refuse', message: anneeValidee(2025) })
  })

  it('permis : ce qui part, signé par le sens de la pièce ; la caisse de ses deux jours', () => {
    const v = verdictDeLaCorrectionDuClientSelon(true, { date: '2026-03-10', montant: '75,50' }, sien, ACHAT, d(), jours(), 2025)
    expect(v).toEqual({ etat: 'permis', saisie: { operation_id: 'o1', date: '2026-03-10', montant: -75.5 }, soldeApres: 1450, soldeDuJourAncien: 1450 })
    const memeJour = verdictDeLaCorrectionDuClientSelon(true, { date: '2026-03-12', montant: '70' }, sien, ACHAT, d(), jours(), 2025)
    expect(memeJour).toEqual({ etat: 'permis', saisie: { operation_id: 'o1', date: '2026-03-12', montant: -70 }, soldeApres: 2000, soldeDuJourAncien: null })
    // Une pièce de vente : les espèces entrent, le montant part positif.
    const encaisse = operation({ piece_id: 'p2', montant: 45 })
    const v2 = verdictDeLaCorrectionDuClientSelon(true, { date: '2026-03-11', montant: '45' }, encaisse, VENTE, dossierRejoue([encaisse]),
      joursDe([encaisse]), 2025)
    expect(v2.etat === 'permis' && v2.saisie.montant).toBe(45)
  })

  it('la confirmation nomme l’ancien et le nouveau, jamais le montant de la pièce ; aucune forme du cabinet', () => {
    const v = verdictDeLaCorrectionDuClientSelon(true, { date: '2026-03-10', montant: '75,50' }, sien, ACHAT, d(), jours(), 2025)
    if (v.etat !== 'permis') throw new Error('permis attendu')
    const confirmation = confirmationDeLaCorrectionDuClient(sien, v, '2026-03-05T09:00:00Z').replace(/\u202f|\u00a0/g, ' ')
    expect(confirmation).toBe('Corriger ton paiement en espèces du 12/03/2026, 80,00 €, de la pièce déposée le 05/03/2026 : 75,50 € '
      + 'sortis le 10/03/2026 à sa place ? L’ancien reste dans l’historique de ta caisse, retiré. Ta caisse du 10/03/2026 passera à '
      + '14,50 €, celle du 12/03/2026 à 14,50 €. Ton cabinet le voit aussitôt.')
    const fait = paiementCorrige(sien, v, '2026-03-05T09:00:00Z').replace(/\u202f|\u00a0/g, ' ')
    expect(fait).toBe('Corrigé : la pièce déposée le 05/03/2026, 75,50 € sortis le 10/03/2026, à la place de 80,00 € sortis le 12/03/2026.')
    for (const t of [confirmation, fait, motsDuRemedeSelon(true).aideDuClient, motsDuRemedeSelon(true).finDuRetraitDuClient,
      RIEN_A_CORRIGER, 'La correction d’un paiement par ta caisse ne s’offre pas encore.']) {
      expect(motsDuCabinet(t), t).toEqual([])
    }
  })
})
