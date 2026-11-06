import { describe, expect, it } from 'vitest'
import { REFUS_ACOMPTE } from './acompteDevis'
import {
  REFUS_ACOMPTE_DE_BIENS, REFUS_DEVIS_INTROUVABLE, REFUS_SOLDE_ACOMPTE_EN_BROUILLON, REFUS_VERSEMENT_ILLISIBLE,
  confirmationDeLAcompte, confirmationDuSolde, demandeDeLaSaisie, etatDesAcomptes, jugerLAcompte, libelleDesFacturesDuDevis,
  refusDuSolde, refusDuVersementFutur, type AcomptesLus, type EntreeDeLAcompte, type EtatAcomptesDuDevis, type FactureDuDevis,
} from './acomptesDuDevis'
import { REFUS_FACTURATION_DEVIS } from './devis'
import { devis as devisFictif } from '../test/devis'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// FACTURER UN ACOMPTE ET LE SOLDE DEPUIS UN DEVIS (lib/acomptesDuDevis.ts, étape P5b5a). Ce que ces cas gardent : les refus
// que le module dit avant le clic sont ceux de la migration préparée (`acomptes_des_devis`), à la lettre et dans son ordre —
// celui du devis de biens (P5B3-Q1) et celui du versement à venir (P5B2-Q1) compris ; seules les bornes de la date du
// versement (celles du générateur CII) restent à l'écran ; l'état d'acompte d'un devis suit les fonctions d'appoint de la
// base (`acomptes_en_vigueur`, `finale_active_du_devis`) ; une lecture qui manque ne se dit jamais « pas d'acompte » ; les
// confirmations nomment ce qui part. Données FICTIVES.

// La migration, préparée (supabase/preparees/) ou dans l'export sous la version de son application : le même texte.
const SQL = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_acomptes_des_devis\.sql$/.test(f.chemin))?.texte ?? ''
const ENREGISTRER = SQL.slice(SQL.indexOf('FUNCTION public.enregistrer_facture('), SQL.indexOf('-- ══ 7. Les droits'))
// Le refus du versement à venir tel qu'un `raise exception` l'écrit : le jour de Paris y devient `%`.
const VERSEMENT_FUTUR = refusDuVersementFutur('2026-11-04').replace('04/11/2026', '%')

/** Le corps d'une fonction de la migration, de sa création à la suivante. */
function corps(nom: string): string {
  const debut = SQL.indexOf(`function public.${nom}(`)
  if (debut < 0) throw new Error(`${nom} absente de la migration`)
  const fin = SQL.indexOf('\n$$;', debut)
  return SQL.slice(debut, fin)
}
// Un message tel qu'un `raise exception` l'écrit : `%` s'y double.
const enSql = (message: string) => message.replaceAll('%', '%%')
const position = (texte: string, message: string) => {
  const i = texte.indexOf(`'${enSql(message)}'`)
  return i >= 0 ? i : texte.indexOf(`'${message}'`)
}

describe('les refus confrontés au texte de la migration préparée', () => {
  const acompte = corps('facturer_acompte_devis')
  const finale = corps('facturer_devis')

  it('chaque refus de l’acompte figure dans la migration, à la lettre', () => {
    for (const [cle, message] of Object.entries(REFUS_ACOMPTE)) {
      expect(SQL.includes(`'${enSql(message)}'`) || SQL.includes(`'${message}'`), cle).toBe(true)
    }
  })

  it('facturer_acompte_devis : introuvable, l’état du devis et du dossier, le devis de biens, la saisie, puis la date du versement, dans l’ordre du module', () => {
    const ordre = [
      REFUS_DEVIS_INTROUVABLE, REFUS_ACOMPTE.nonAccepte, REFUS_ACOMPTE.finaleActive, REFUS_ACOMPTE.acompteEnBrouillon,
      REFUS_ACOMPTE.engagement, REFUS_ACOMPTE_DE_BIENS, REFUS_ACOMPTE.pourcentageHorsBornes, REFUS_ACOMPTE.pourcentageTropPrecis,
      REFUS_ACOMPTE.montantNonPositif, REFUS_ACOMPTE.montantTropPrecis, REFUS_ACOMPTE.sansReste, REFUS_ACOMPTE.moinsDUnCentime,
      VERSEMENT_FUTUR,
    ].map((m) => position(acompte, m))
    expect(ordre.every((p) => p >= 0)).toBe(true)
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre)
  })

  it('facturer_devis remplacée : les refus d’hier dans leur ordre, puis l’acompte en brouillon', () => {
    const hier = REFUS_FACTURATION_DEVIS.map((r) => position(finale, r.modele))
    expect(hier.every((p) => p >= 0)).toBe(true)
    expect([...hier].sort((a, b) => a - b)).toEqual(hier)
    expect(position(finale, REFUS_SOLDE_ACOMPTE_EN_BROUILLON)).toBeGreaterThan(Math.max(...hier))
  })

  it('P5B3-Q1 : la base refuse le devis de biens sous la condition du module, « biens » ou « mixte », à sa seule place', () => {
    expect(acompte).toMatch(/if v_devis\.nature_operation in \('biens', 'mixte'\) then\s+raise exception '/)
    expect(SQL.split(`'${REFUS_ACOMPTE_DE_BIENS}'`)).toHaveLength(2)
  })

  it('P5B2-Q1 : le versement à venir, en dernier dans facturer_acompte_devis, et partout où enregistrer_facture pose la date', () => {
    // Après la finale qu'il laisserait (P5B-Q5), avant le brouillon.
    const date = position(acompte, VERSEMENT_FUTUR)
    expect(date).toBeGreaterThan(acompte.indexOf('acompte_refus_de_la_finale_laissee(p_devis_id'))
    expect(date).toBeLessThan(acompte.indexOf('public.enregistrer_facture('))
    // Dans enregistrer_facture, à la lettre, sur un acompte, juste après la date portée hors d'un acompte, avant toute écriture.
    const ici = position(ENREGISTRER, VERSEMENT_FUTUR)
    expect(ici).toBeGreaterThan(position(ENREGISTRER, 'La date du versement ne se porte que sur une facture d’acompte.'))
    expect(ici).toBeLessThan(ENREGISTRER.indexOf('update factures_emises set'))
    // Le jour de Paris, écrit comme `formatDate` (JJ/MM/AAAA), dans les deux fonctions.
    expect(refusDuVersementFutur('2026-11-04')).toBe('Le versement ne se date pas dans l’avenir : nous sommes le 04/11/2026.')
    expect(SQL.match(/v_aujourd_hui date := \(now\(\) at time zone 'Europe\/Paris'\)::date;/g)).toHaveLength(2)
    expect(SQL.match(/'Le versement ne se date pas dans l’avenir : nous sommes le %\.', to_char\(v_aujourd_hui, 'DD\/MM\/YYYY'\)/g)).toHaveLength(2)
    // Les bornes du générateur CII restent à l'écran : la base reçoit une date typée et ne les porte pas.
    expect(SQL).not.toContain(REFUS_VERSEMENT_ILLISIBLE)
  })
})

// ── Les jeux ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const facture = (p: Partial<FactureDuDevis>): FactureDuDevis => ({
  id: 'f', numero: null, statut: 'validee', type: 'facture', date_emission: '2026-10-01', montant_ttc: 360, acompte: false,
  facture_origine_id: null, ...p,
})
const lien = (id: string, factureId: string, role: 'acompte' | 'finale', cree_le = '2026-10-01T08:00:00Z') =>
  ({ id, devis_id: 'dv1', facture_id: factureId, cree_le, role })
const ligneAcompte = (factureId: string, prix: number, ordre = 1) =>
  ({ facture_id: factureId, ordre, quantite: 1, prix_unitaire_ht: prix, taux_tva: 20, nature: null })

const lus = (p: Partial<AcomptesLus>): AcomptesLus => ({ liens: [], factures: [], lignes: [], mode: 'tresorerie', ...p })
const etatDe = (l: AcomptesLus): EtatAcomptesDuDevis => {
  const e = etatDesAcomptes('dv1', l)
  if (!e.ok) throw new Error(e.motif)
  return e.etat
}

const ACCEPTE = devisFictif({ id: 'dv1', numero: 'D2026-0004', statut: 'emis', reponse: 'acceptee', tiers_nom: 'Accepté Fictif', nature_operation: 'services' })
const VIDE: EtatAcomptesDuDevis = { acomptesValides: [], brouillon: null, finaleActive: null }
const entree = (p: Partial<EntreeDeLAcompte>): EntreeDeLAcompte => ({
  dossierId: 'd1', devis: ACCEPTE, etat: VIDE, mode: 'tresorerie',
  saisie: { mode: 'pourcentage', montant: '30', dateVersement: '' }, aujourdHui: '2026-11-04', ...p,
})

describe('l’état d’acompte d’un devis', () => {
  it('les acomptes en vigueur, dans l’ordre de leurs dates puis de leurs numéros ; un acompte crédité n’en est plus', () => {
    const l = lus({
      liens: [lien('l1', 'a2', 'acompte'), lien('l2', 'a1', 'acompte'), lien('l3', 'a3', 'acompte')],
      factures: [
        facture({ id: 'a2', numero: 'F2026-0012', date_emission: '2026-10-05', acompte: true }),
        facture({ id: 'a1', numero: 'F2026-0011', date_emission: '2026-10-05', acompte: true }),
        facture({ id: 'a3', numero: 'F2026-0009', date_emission: '2026-09-01', acompte: true }),
        facture({ id: 'av', numero: 'A2026-0001', type: 'avoir', montant_ttc: -100, facture_origine_id: 'a3' }),
      ],
      lignes: [ligneAcompte('a2', 50), ligneAcompte('a1', 100), ligneAcompte('a3', 30)],
    })
    const e = etatDe(l)
    expect(e.acomptesValides.map((a) => a.numero)).toEqual(['F2026-0011', 'F2026-0012'])
    expect(e.brouillon).toBeNull()
    expect(e.finaleActive).toBeNull()
    expect(libelleDesFacturesDuDevis('dv1', l, e)).toBe('Acompte F2026-0009 (crédité) ; Acompte F2026-0011 ; Acompte F2026-0012')
  })

  it('un acompte en brouillon ; une finale en brouillon, active', () => {
    const e = etatDe(lus({
      liens: [lien('l1', 'b', 'acompte'), lien('l2', 'fin', 'finale')],
      factures: [facture({ id: 'b', statut: 'brouillon', acompte: true }), facture({ id: 'fin', statut: 'brouillon' })],
    }))
    expect(e.brouillon).toEqual({ factureId: 'b' })
    expect(e.finaleActive).toEqual({ factureId: 'fin', numero: null })
  })

  it('P5B-Q4 : une finale créditée en entier n’est plus active ; créditée en partie, elle l’est', () => {
    const avec = (credit: number) => etatDe(lus({
      liens: [lien('l1', 'fin', 'finale')],
      factures: [
        facture({ id: 'fin', numero: 'F2026-0020', montant_ttc: 1200 }),
        facture({ id: 'av', type: 'avoir', montant_ttc: -credit, facture_origine_id: 'fin' }),
      ],
    }))
    expect(avec(1200).finaleActive).toBeNull()
    expect(avec(1199.99).finaleActive).toEqual({ factureId: 'fin', numero: 'F2026-0020' })
  })

  it('un lien dont la facture n’est pas lue, un acompte validé sans ses lignes : un manque, jamais « pas d’acompte »', () => {
    expect(etatDesAcomptes('dv1', lus({ liens: [lien('l1', 'absente', 'acompte')] })).ok).toBe(false)
    expect(etatDesAcomptes('dv1', lus({
      liens: [lien('l1', 'a1', 'acompte')], factures: [facture({ id: 'a1', numero: 'F2026-0011', acompte: true })],
    }))).toEqual({ ok: false, motif: 'les lignes de l’acompte F2026-0011 n’ont pas été lues' })
  })
})

describe('juger l’acompte', () => {
  it('30 % d’un devis de 1 000 € HT à 20 % : 360,00 € TTC, la demande et la date telles qu’elles partent', () => {
    const j = jugerLAcompte(entree({ saisie: { mode: 'pourcentage', montant: '30', dateVersement: '2026-11-02' } }))
    if (!j.ok) throw new Error(j.refus)
    expect(j.prepare.ttc).toBe(36000)
    expect(j.demande).toEqual({ mode: 'pourcentage', pourcentage: 30 })
    expect(j.dateVersement).toBe('2026-11-02')
  })

  it('l’ordre : introuvable, puis l’état de la base, puis le devis de biens, puis la saisie, puis la date du versement', () => {
    const biens = { ...ACCEPTE, nature_operation: 'biens' as const }
    const tout = { mode: 'pourcentage' as const, montant: '', dateVersement: '2030-01-01' }
    expect(jugerLAcompte(entree({ dossierId: 'd2', devis: biens, saisie: tout }))).toEqual({ ok: false, refus: REFUS_DEVIS_INTROUVABLE })
    expect(jugerLAcompte(entree({ devis: biens, etat: { ...VIDE, finaleActive: { factureId: 'f', numero: null } }, saisie: tout })))
      .toEqual({ ok: false, refus: REFUS_ACOMPTE.finaleActive })
    expect(jugerLAcompte(entree({ devis: biens, mode: 'engagement', saisie: tout }))).toEqual({ ok: false, refus: REFUS_ACOMPTE.engagement })
    expect(jugerLAcompte(entree({ devis: biens, saisie: tout }))).toEqual({ ok: false, refus: REFUS_ACOMPTE_DE_BIENS })
    expect(jugerLAcompte(entree({ devis: { ...ACCEPTE, nature_operation: 'mixte' } }))).toEqual({ ok: false, refus: REFUS_ACOMPTE_DE_BIENS })
    expect(jugerLAcompte(entree({ saisie: tout }))).toEqual({ ok: false, refus: REFUS_ACOMPTE.pourcentageHorsBornes })
    expect(jugerLAcompte(entree({ saisie: { ...tout, montant: '30' } })))
      .toEqual({ ok: false, refus: 'Le versement ne se date pas dans l’avenir : nous sommes le 04/11/2026.' })
    expect(jugerLAcompte(entree({ saisie: { ...tout, montant: '30', dateVersement: '1999-12-31' } })))
      .toEqual({ ok: false, refus: REFUS_VERSEMENT_ILLISIBLE })
    expect(jugerLAcompte(entree({ saisie: { ...tout, montant: '30', dateVersement: '2026-02-30' } })))
      .toEqual({ ok: false, refus: REFUS_VERSEMENT_ILLISIBLE })
    expect(jugerLAcompte(entree({ saisie: { ...tout, montant: '30', dateVersement: '2026-11-04' } })).ok).toBe(true)
  })

  it('un devis non accepté, un acompte en brouillon ; 100 % couvre tout le devis', () => {
    expect(jugerLAcompte(entree({ devis: { ...ACCEPTE, reponse: null } }))).toEqual({ ok: false, refus: REFUS_ACOMPTE.nonAccepte })
    expect(jugerLAcompte(entree({ etat: { ...VIDE, brouillon: { factureId: 'b' } } })))
      .toEqual({ ok: false, refus: REFUS_ACOMPTE.acompteEnBrouillon })
    expect(jugerLAcompte(entree({ saisie: { mode: 'pourcentage', montant: '100', dateVersement: '' } })))
      .toEqual({ ok: false, refus: REFUS_ACOMPTE.couvreToutLeDevis })
  })

  it('la saisie telle qu’elle part : la virgule admise, un texte qui n’est pas un nombre jamais zéro, le TTC sur son écriture', () => {
    expect(demandeDeLaSaisie({ mode: 'pourcentage', montant: ' 12,5 ', dateVersement: '' })).toEqual({ mode: 'pourcentage', pourcentage: 12.5 })
    expect(demandeDeLaSaisie({ mode: 'pourcentage', montant: '', dateVersement: '' }).mode).toBe('pourcentage')
    expect(Number.isNaN((demandeDeLaSaisie({ mode: 'pourcentage', montant: 'trente', dateVersement: '' }) as { pourcentage: number }).pourcentage)).toBe(true)
    expect(demandeDeLaSaisie({ mode: 'ttc', montant: '12,3', dateVersement: '' })).toEqual({ mode: 'ttc', ttcCentimes: 1230 })
    expect(demandeDeLaSaisie({ mode: 'ttc', montant: '12.340', dateVersement: '' })).toEqual({ mode: 'ttc', ttcCentimes: 1234 })
    expect(Number.isInteger((demandeDeLaSaisie({ mode: 'ttc', montant: '12,345', dateVersement: '' }) as { ttcCentimes: number }).ttcCentimes)).toBe(false)
    expect(jugerLAcompte(entree({ saisie: { mode: 'ttc', montant: '-5', dateVersement: '' } })))
      .toEqual({ ok: false, refus: REFUS_ACOMPTE.montantNonPositif })
  })

  it('la confirmation nomme le devis, le client, la demande, le TTC exact et la date du versement', () => {
    const j = jugerLAcompte(entree({ saisie: { mode: 'ttc', montant: '100', dateVersement: '2026-11-01' } }))
    if (!j.ok) throw new Error(j.refus)
    const texte = confirmationDeLAcompte(ACCEPTE, j, '2026-11-04').replace(/\s/g, ' ')
    expect(texte).toContain('Facturer un acompte (100,00 € TTC demandés) sur le devis D2026-0004 pour « Accepté Fictif » (1 200,00 € TTC)')
    expect(texte).toContain('daté du 04/11/2026, de 100,00 € TTC exactement (83,33 € HT), en une ligne.')
    expect(texte).toContain('La facture dira l’acompte versé le 01/11/2026.')
    const jour = jugerLAcompte(entree({ saisie: { mode: 'pourcentage', montant: '30', dateVersement: '2026-11-04' } }))
    if (!jour.ok) throw new Error(jour.refus)
    expect(confirmationDeLAcompte(ACCEPTE, jour, '2026-11-04')).toContain('daté du jour de la facture : la facture ne le redit pas')
  })
})

describe('le solde', () => {
  const ACOMPTE = { id: 'a1', numero: 'F2026-0011', date: '2026-10-05', lignes: [{ quantite: 1, prix_unitaire_ht: 300, taux_tva: 20 }] }

  it('les refus d’hier, la finale active seule ; puis l’acompte en brouillon ; puis la finale qui ne se validerait pas', () => {
    expect(refusDuSolde('d1', ACCEPTE, VIDE)).toBeNull()
    expect(refusDuSolde('d1', ACCEPTE, { ...VIDE, finaleActive: { factureId: 'f', numero: 'F2026-0020' } }))
      .toBe('Le devis D2026-0004 a déjà sa facture (F2026-0020) : un devis se transforme une fois.')
    expect(refusDuSolde('d1', ACCEPTE, { ...VIDE, brouillon: { factureId: 'b' } })).toBe(REFUS_SOLDE_ACOMPTE_EN_BROUILLON)
    expect(refusDuSolde('d1', { ...ACCEPTE, reponse: 'refusee' }, VIDE)).toBe('Seul un devis accepté se transforme en facture : le devis D2026-0004 est refusé.')
    const auDela = { ...ACOMPTE, lignes: [{ quantite: 1, prix_unitaire_ht: 1000.01, taux_tva: 20 }] }
    expect(refusDuSolde('d1', ACCEPTE, { ...VIDE, acomptesValides: [auDela] }))
      .toBe('La facture finale serait négative à 20 % : les acomptes repris dépassent le devis.')
  })

  it('la confirmation nomme les acomptes repris et le net à payer, ou dit qu’il n’y en a pas', () => {
    const texte = confirmationDuSolde(ACCEPTE, { ...VIDE, acomptesValides: [ACOMPTE] }, '2026-11-04').replace(/\s/g, ' ')
    expect(texte).toContain('Facturer le solde du devis D2026-0004 pour « Accepté Fictif » (1 200,00 € TTC) ?')
    expect(texte).toContain('l’acompte F2026-0011 du 05/10/2026 (360,00 € TTC), repris au signe opposé : net à payer 840,00 € TTC.')
    expect(confirmationDuSolde(ACCEPTE, VIDE, '2026-11-04')).toContain('Aucun acompte n’est à reprendre : elle porte le devis entier.')
  })
})
