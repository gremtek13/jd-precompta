import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { encaissementVendu, factureVendue, ligneVendue } from '../test/ventesFacturees'
import { motifDeDefinition, finDuCorps } from '../test/schema'
import { banquesDuDossier, type BanquesDuDossier } from './banqueDuMouvement'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { REFUS_BANQUE_INCONNUE, refusChoixCompteContrepartie, refusEcritureVenteFacturee } from './ecritureVenteFacturee'
import {
  LIBELLE_MOTIF_NON_ECRITE, cleFecEncaissement, cleFecMouvementEncaissements, ecrituresDesVentesFacturees, estUnCompteDeBanquePropre,
  refusCompteDeContrepartie, type EcrituresDesVentesFacturees, type MouvementDesEncaissements,
} from './ecrituresVentesFacturees'
import { ecrituresDesVentesPourLa2035, type SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { COLONNES_MOUVEMENTS_ECRITURES, COLONNES_MOUVEMENTS_ECRITURES_PAR_COMPTE } from './ecrituresVentesFactureesLecture'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import type { ModeComptable } from './types'

// LES VENTES FACTURÉES PAR COMPTE BANCAIRE (MCB5, troisième partie ; lib/ecrituresVentesFacturees.ts) : la jambe de banque
// d'un mouvement que ses encaissements classent, et celle d'un encaissement porté par un mouvement de son jour, au 512 de
// CE mouvement, comme `ecriture_attendue_vente_facturee` de la migration `jambe_de_banque_par_compte` ; le 512 propre d'un
// compte jamais contrepartie d'une compensation, quelle que soit sa date ; une banque qui ne se sait pas, un motif du
// module seul, que la 2035 et le refus de l'écran disent. Données FICTIVES.

// La lecture des sources nomme le client de Supabase, qui lève sans variables d'environnement : seules ses colonnes servent ici.
vi.mock('./supabase', () => ({ supabase: {} }))

const RACINE = new URL('../../', import.meta.url)
const MIGRATION = readFileSync(new URL('supabase/preparees/20261111200000_jambe_de_banque_par_compte.sql', RACINE), 'utf8')

const D = 'd1'
const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const PRINCIPAL = compte({ id: 'P', libelle: 'Compte principal', principal: true })
// Le second tient son 512 propre depuis le 1er janvier 2025 ; un troisième, clos, le tiendrait en 2027 seulement.
const SECOND = compte({ id: 'S', libelle: 'Compte bis fictif', compte: '512200', compte_propre_depuis: '2025-01-01' })
const CLOS = compte({ id: 'C', libelle: 'Livret fictif', compte: '512300', compte_propre_depuis: '2027-01-01', clos_le: '2025-06-30' })
const LUS: LectureDesComptes = { etat: 'lus', comptes: [PRINCIPAL, SECOND, CLOS] }
const role = (plan: PlanComptable): BanquesDuDossier => ({ cas: 'role', compte: plan.banque })

const mvt = (o: Partial<MouvementDesEncaissements> & Pick<MouvementDesEncaissements, 'id' | 'date' | 'montant'>): MouvementDesEncaissements => ({
  dossier_id: D, libelle: 'VIREMENT FICTIF', source_fichier: 'releve-fictif.csv', encaissements_de_factures: true, ...o,
})

// Deux virements d'un client fictif, un sur chaque compte : le premier encaissé le jour du mouvement (la banque portée par
// l'encaissement), le second la veille (le 511, que le mouvement solde, et 0,50 € de frais).
const encaissementsDuJeu = () => [
  encaissementVendu({ id: 'e1', facture_id: 'f1', date_encaissement: '2025-11-20', montant: 60, moyen: 'virement', ligne_bancaire_id: 'm1', cree_le: '2025-11-20T10:00:00Z' }, 20),
  encaissementVendu({ id: 'e2', facture_id: 'f1', date_encaissement: '2025-11-21', montant: 60, moyen: 'cheque', ligne_bancaire_id: 'm2', cree_le: '2025-11-21T10:00:00Z' }, 20),
]

function composer(plan: PlanComptable, banques: BanquesDuDossier, o: { compteDuSecond?: string | null; mode?: ModeComptable } = {}): EcrituresDesVentesFacturees {
  const [e1, e2] = encaissementsDuJeu()
  return ecrituresDesVentesFacturees({
    sources: {
      dossierId: D, factures: [factureVendue({ numero: 'F2025-0001', date_emission: '2025-11-10' })], lignes: [ligneVendue('f1', 100, 20)],
      encaissements: [e1.encaissement, e2.encaissement], parts: [e1.part, e2.part],
    },
    mouvements: [
      mvt({ id: 'm1', date: '2025-11-20', montant: 60, compte_bancaire_id: 'P' }),
      // `null` : un mouvement sans compte lu (la colonne absente, jamais nulle : lib/types.ts)
      mvt({ id: 'm2', date: '2025-11-22', montant: 59.5, ...(o.compteDuSecond === null ? {} : { compte_bancaire_id: o.compteDuSecond ?? 'S' }) }),
    ],
    comptesDeContrepartie: new Map(), exemplaires: [], mode: o.mode ?? 'tresorerie', plan, banques,
  })
}

const banqueDe = (r: EcrituresDesVentesFacturees, cle: string, plan: PlanComptable, autres: readonly string[]) =>
  r.ecritures.find((e) => e.cle === cle)?.lignes.filter((l) => [plan.banque, ...autres].includes(l.compte)).map((l) => l.compte)

describe('drapeau baissé : la lecture et la composition d’hier', () => {
  it('le drapeau est baissé ; la lecture demande les colonnes d’hier, la colonne du compte seulement le drapeau levé', () => {
    expect(COMPTES_BANCAIRES_PREVUS).toBe(false)
    expect(COLONNES_MOUVEMENTS_ECRITURES).not.toContain('compte_bancaire_id')
    expect(COLONNES_MOUVEMENTS_ECRITURES_PAR_COMPTE).toBe(`${COLONNES_MOUVEMENTS_ECRITURES}, compte_bancaire_id`)
    expect(banquesDuDossier({ etat: 'sans_objet' }, PLAN_DECALE)).toEqual(role(PLAN_DECALE))
  })

  it('aucun compte qui tienne son 512, ou tous les mouvements au principal : la composition du rôle, à l’identique', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      const hier = composer(plan, role(plan))
      expect(composer(plan, banquesDuDossier({ etat: 'lus', comptes: [PRINCIPAL, compte({ id: 'S' })] }, plan))).toEqual(hier)
      expect(composer(plan, banquesDuDossier(LUS, plan), { compteDuSecond: 'P' })).toEqual(hier)
    }
  })
})

describe('deux comptes, le second à son 512 propre', () => {
  it('le mouvement du second, et l’encaissement de son jour, portent la banque au 512 de son compte ; le principal au rôle', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      for (const mode of ['tresorerie', 'engagement'] as const) {
        const r = composer(plan, banquesDuDossier(LUS, plan), { mode })
        expect(r.nonEcrites).toEqual([])
        expect(banqueDe(r, cleFecEncaissement('e1', '2025-11-20'), plan, ['512200'])).toEqual([plan.banque])
        expect(banqueDe(r, cleFecMouvementEncaissements('m1'), plan, ['512200'])).toBeUndefined()
        expect(banqueDe(r, cleFecMouvementEncaissements('m2'), plan, ['512200'])).toEqual(['512200'])
        // Le reste de l'écriture ne change pas : seule la banque se déplace.
        const hier = composer(plan, role(plan), { mode })
        const sansBanque = (x: EcrituresDesVentesFacturees) => x.ecritures.map((e) => ({ ...e, lignes: e.lignes.map((l) => ({ ...l, compte: l.compte === '512200' ? plan.banque : l.compte })) }))
        expect(sansBanque(r)).toEqual(sansBanque(hier))
      }
    }
  })

  it('un encaissement du jour d’un mouvement du second porte, lui aussi, son 512', () => {
    const e = encaissementVendu({ id: 'e3', facture_id: 'f1', date_encaissement: '2025-12-02', montant: 120, moyen: 'virement', ligne_bancaire_id: 'm3', cree_le: '2025-12-02T10:00:00Z' }, 20)
    const r = ecrituresDesVentesFacturees({
      sources: { dossierId: D, factures: [factureVendue({ numero: 'F2025-0001', date_emission: '2025-11-10' })], lignes: [ligneVendue('f1', 100, 20)], encaissements: [e.encaissement], parts: [e.part] },
      mouvements: [mvt({ id: 'm3', date: '2025-12-02', montant: 120, compte_bancaire_id: 'S' })],
      comptesDeContrepartie: new Map(), exemplaires: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, banques: banquesDuDossier(LUS, PLAN_PAR_DEFAUT),
    })
    const enc = r.ecritures.find((x) => x.cle === cleFecEncaissement('e3', '2025-12-02'))!
    expect(enc.lignes.find((l) => l.sens === 'debit')).toEqual({ compte: '512200', sens: 'debit', centimes: 12000, ligneBancaireId: 'm3' })
  })
})

describe('une banque qui ne se sait pas : `banque_inconnue`, un motif du module seul', () => {
  const lus = banquesDuDossier(LUS, PLAN_PAR_DEFAUT)
  const retenus: BanquesDuDossier[] = [
    banquesDuDossier({ etat: 'en_cours' }, PLAN_PAR_DEFAUT),
    banquesDuDossier({ etat: 'illisible', motif: 'lecture refusée' }, PLAN_PAR_DEFAUT),
  ]

  it('un mouvement d’un compte que la lecture ne rend pas : ni son écriture ni celle de l’encaissement de son jour', () => {
    const r = composer(PLAN_PAR_DEFAUT, lus, { compteDuSecond: 'inconnu' })
    expect(r.nonEcrites.map((n) => [n.source, n.motif])).toEqual([[{ genre: 'mouvement', ligneBancaireId: 'm2' }, 'banque_inconnue']])
    expect(r.nonEcrites[0].detail).toBe(`${LIBELLE_MOTIF_NON_ECRITE.banque_inconnue} (mouvement du 22/11/2025)`)
    expect(r.ecritures.some((e) => e.cle === cleFecMouvementEncaissements('m2'))).toBe(false)
    // Un mouvement sans compte quand le dossier en tient plusieurs : la même chose.
    expect(composer(PLAN_PAR_DEFAUT, lus, { compteDuSecond: null }).nonEcrites.map((n) => n.motif)).toEqual(['banque_inconnue'])
  })

  it('des comptes en cours de lecture ou illisibles : chaque source qui porte une banque, et aucune autre', () => {
    for (const banques of retenus) {
      const r = composer(PLAN_PAR_DEFAUT, banques)
      expect(r.nonEcrites.map((n) => `${n.source.genre}|${n.motif}`).sort()).toEqual(['encaissement|banque_inconnue', 'mouvement|banque_inconnue'])
      // L'encaissement de la veille, au 511, s'écrit : il ne porte aucune banque.
      expect(r.ecritures.map((e) => e.cle)).toEqual([cleFecEncaissement('e2', '2025-11-21')])
    }
  })

  it('la 2035 ne se calcule pas : elle tairait les frais du mouvement', () => {
    const sources = (): SourcesDesEcrituresDeVente => {
      const e2 = encaissementVendu({ id: 'e2', facture_id: 'f1', date_encaissement: '2025-11-21', montant: 60, moyen: 'cheque', ligne_bancaire_id: 'm2', cree_le: '2025-11-21T10:00:00Z' }, 20)
      return {
        dossierId: D, factures: [{ ...factureVendue({ numero: 'F2025-0001', date_emission: '2025-11-10' }), montant_ttc: 120 }],
        lignes: [ligneVendue('f1', 100, 20)], encaissements: [{ ...e2.encaissement, compte_contrepartie: null, cree_par: null }], parts: [e2.part],
        mouvements: [{ ...mvt({ id: 'm2', date: '2025-11-22', montant: 59.5, compte_bancaire_id: 'inconnu' }), statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false }],
        exemplaires: [], reprises: [],
      } as unknown as SourcesDesEcrituresDeVente
    }
    const juger = (banques: BanquesDuDossier) => ecrituresDesVentesPourLa2035({
      dossierId: D, ventesParLesFactures: true, facturesSources: new Set(['f1']), lecture: { dossierId: D, etat: 'lue', sources: sources() },
      mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, banques,
    })
    expect(juger(lus)).toEqual({ etat: 'incomplete', motif: `${LIBELLE_MOTIF_NON_ECRITE.banque_inconnue} (mouvement du 22/11/2025)` })
    expect(juger(role(PLAN_PAR_DEFAUT)).etat).toBe('pret')
  })

  it('l’écran refuse le geste par ses mots à lui, jamais par ceux de la base', () => {
    const r = composer(PLAN_PAR_DEFAUT, lus, { compteDuSecond: 'inconnu' })
    const refus = refusEcritureVenteFacturee({ genre: 'mouvement', ligneBancaireId: 'm2' }, {
      dossierId: D, ventesParLesFactures: true, anneesValidees: [],
      factures: [{ id: 'f1', dossier_id: D, type: 'facture', numero: 'F2025-0001', source_de_la_vente: true, facture_origine_id: null, statut: 'validee' }],
      encaissements: encaissementsDuJeu().map((e) => ({ ...e.encaissement, compte_contrepartie: null })), composition: r, plan: PLAN_PAR_DEFAUT, banques: lus,
      mouvements: [{ id: 'm2', dossier_id: D, statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false, encaissements_de_factures: true }],
    })
    expect(refus).toEqual({ cle: REFUS_BANQUE_INCONNUE.cle, message: REFUS_BANQUE_INCONNUE.modele })
    // Ce refus ne se prête pas à la base : aucune de ses fonctions ne le dit.
    expect(MIGRATION).not.toContain('banque_inconnue')
  })
})

describe('le 512 propre d’un compte n’est jamais la contrepartie d’une compensation (le miroir de `refus_compte_de_contrepartie`)', () => {
  const lus = banquesDuDossier(LUS, PLAN_PAR_DEFAUT)
  const REFUS_BANQUE = 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.'

  it('quelle que soit sa date, clos compris ; un autre compte de bilan reste accepté ; aux mots du rôle', () => {
    for (const c of ['512200', '512300']) {
      expect(estUnCompteDeBanquePropre(c, lus)).toBe(true)
      expect(refusCompteDeContrepartie(c, PLAN_PAR_DEFAUT, lus)).toBe(REFUS_BANQUE)
      // Sans comptes qui tiennent leur 512, la règle d'hier : un 512 qui n'est pas le rôle passe.
      expect(refusCompteDeContrepartie(c, PLAN_PAR_DEFAUT, role(PLAN_PAR_DEFAUT))).toBeNull()
    }
    expect(refusCompteDeContrepartie(PLAN_PAR_DEFAUT.banque, PLAN_PAR_DEFAUT, lus)).toBe(REFUS_BANQUE)
    expect(refusCompteDeContrepartie('467200', PLAN_PAR_DEFAUT, lus)).toBeNull()
    expect(refusCompteDeContrepartie('445710', PLAN_PAR_DEFAUT, lus)).toMatch(/^Un compte de TVA/)
  })

  it('les comptes lus en partie : la règle ne se juge pas, et la composition le dit avant de juger', () => {
    const retenu = banquesDuDossier({ etat: 'en_cours' }, PLAN_PAR_DEFAUT)
    expect(refusCompteDeContrepartie('467200', PLAN_PAR_DEFAUT, retenu)).toBe(retenu.cas === 'retenu' ? retenu.raison : '')
    // Les refus de la forme passent avant : ils ne dépendent pas des comptes.
    expect(refusCompteDeContrepartie('46', PLAN_PAR_DEFAUT, retenu)).toMatch(/^Un compte de contrepartie est un compte de bilan/)
    const e = encaissementVendu({ id: 'e9', facture_id: 'f1', date_encaissement: '2025-11-25', montant: 120, moyen: 'compensation', ligne_bancaire_id: null, cree_le: '2025-11-25T10:00:00Z' }, 20)
    const composer9 = (banques: BanquesDuDossier, choisi: string) => ecrituresDesVentesFacturees({
      sources: { dossierId: D, factures: [factureVendue({ numero: 'F2025-0001', date_emission: '2025-11-10' })], lignes: [ligneVendue('f1', 100, 20)], encaissements: [e.encaissement], parts: [e.part] },
      mouvements: [], comptesDeContrepartie: new Map([['e9', choisi]]), exemplaires: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, banques,
    }).nonEcrites.map((n) => n.motif)
    expect(composer9(retenu, '467200')).toEqual(['banque_inconnue'])
    expect(composer9(lus, '512200')).toEqual(['compte_refuse'])
    expect(composer9(lus, '467200')).toEqual([])
    const contexte = {
      dossierId: D, anneesValidees: [], plan: PLAN_PAR_DEFAUT,
      factures: [{ id: 'f1', dossier_id: D, type: 'facture' as const, numero: 'F2025-0001', source_de_la_vente: true, facture_origine_id: null, statut: 'validee' as const }],
      encaissements: [{ ...e.encaissement, compte_contrepartie: null }],
    }
    expect(refusChoixCompteContrepartie('e9', '467200', { ...contexte, banques: retenu })).toEqual({ cle: 'banque_inconnue', message: REFUS_BANQUE_INCONNUE.modele })
    expect(refusChoixCompteContrepartie('e9', '512200', { ...contexte, banques: lus })?.cle).toBe('compte_refuse')
    expect(refusChoixCompteContrepartie('e9', '467200', { ...contexte, banques: lus })).toBeNull()
  })

  it('confronté au texte de la migration : tout compte bancaire du dossier, sans condition de date', () => {
    const debut = [...MIGRATION.matchAll(motifDeDefinition('refus_compte_de_contrepartie'))].map((m) => m.index)
    expect(debut).toHaveLength(1)
    const corps = MIGRATION.slice(debut[0], finDuCorps(MIGRATION, debut[0], 'refus_compte_de_contrepartie'))
    expect(corps.replace(/\s+/g, ' ')).toContain(
      'or exists (select 1 from public.comptes_bancaires c where c.dossier_id = p_dossier_id and c.compte = p_compte) then')
    expect(corps).not.toMatch(/compte_propre_depuis|clos_le/)
    // Les mots de la base sont ceux du module, dans le même ordre.
    const mots = [...corps.matchAll(/return '([^']*(?:''[^']*)*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    expect(mots).toEqual([
      'Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.',
      'Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.',
      REFUS_BANQUE,
      'Un compte de TVA ne reçoit pas un encaissement : la TVA d’une vente s’écrit avec elle.',
    ])
  })
})
