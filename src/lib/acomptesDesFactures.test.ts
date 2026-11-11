import { describe, expect, it } from 'vitest'
import { REFUS_ACOMPTE, enTaux } from './acompteDevis'
import {
  LIGNES_D_ACOMPTE_FIGEES, REFUS_FINALE_ACOMPTE_EN_BROUILLON, SANS_ACOMPTE, acompteDeLaFacture, confirmationDeLaValidation,
  marqueDeLaFacture, motsDeLaMarque, refusAcompteRepris, refusAvoirPartielDAcompte, refusCumulDesAcomptes, refusDeLAvoir,
  refusDeLaValidationDeLAcompte, refusDeLaValidationDeLaFinale, refusLigneHorsDuDevis, refusRepriseDefaite,
  refusRepriseHorsVigueur, refusRepriseInexacte, type AcompteDeLaFacture, type AcomptesDesFacturesLus, type LectureDesAcomptesDesFactures,
} from './acomptesDesFactures'
import type { FactureDuDevis } from './acomptesDuDevis'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA FACTURE D'ACOMPTE ET LA FINALE DANS L'ONGLET DES FACTURES (lib/acomptesDesFactures.ts, étape P5b5b). Ce que ces cas
// gardent : les refus que le module dit avant le clic sont ceux d'`enregistrer_facture` REMPLACÉE par la migration préparée,
// à la lettre et dans son ordre (P5B2-Q3) ; l'avoir d'un acompte se refuse tant qu'une finale validée et non créditée le
// reprend, et se permet une fois la finale créditée en entier (P5B2-Q2, P5B-Q4) ; une lecture qui manque ne se dit jamais
// « pas d'acompte » ; la marque de la liste et la confirmation nomment ce qu'est la facture. Données FICTIVES.

// La migration, préparée (supabase/preparees/) ou dans l'export sous la version de son application : le même texte.
const SQL = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_acomptes_des_devis\.sql$/.test(f.chemin))?.texte ?? ''
const ENREGISTRER = SQL.slice(SQL.indexOf('FUNCTION public.enregistrer_facture('), SQL.indexOf('-- ══ 7. Les droits'))

/** Le message tel qu'un `raise exception` l'écrit : chaque valeur passée devient `%`. */
const gabarit = (texte: string, valeurs: string[]) => valeurs.reduce((t, v) => t.replace(v, '%'), texte)

describe('les refus confrontés à enregistrer_facture remplacée', () => {
  const dans = (message: string) => ENREGISTRER.indexOf(`'${message}'`)
  const refus = [
    gabarit(refusAcompteRepris('§A', '§F'), ['§A', '§F']),
    gabarit(refusAvoirPartielDAcompte('§A', 360), ['§A', '360,00']),
    gabarit(refusRepriseDefaite('§F'), ['§F']),
    LIGNES_D_ACOMPTE_FIGEES,
    gabarit(refusLigneHorsDuDevis(5.5, '§D'), [enTaux(5.5), '§D']),
    gabarit(refusCumulDesAcomptes('§D', 20), ['§D', enTaux(20)]),
    REFUS_FINALE_ACOMPTE_EN_BROUILLON,
    gabarit(refusRepriseInexacte('§A'), ['§A']),
    gabarit(refusRepriseHorsVigueur('§A'), ['§A']),
  ]

  it('chaque refus figure dans le corps de la fonction, à la lettre', () => {
    for (const r of refus) expect(dans(r), r).toBeGreaterThan(0)
  })

  it('dans l’ordre de la fonction : l’avoir, le brouillon d’acompte, la validation de l’acompte, puis celle de la finale', () => {
    const positions = refus.map(dans)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('la finale laissée par un acompte (P5B-Q5) : les mots du module, que la fonction d’appoint redit', () => {
    expect(SQL).toContain(`'${REFUS_ACOMPTE.couvreToutLeDevis}'`)
    expect(ENREGISTRER).toContain('acompte_refus_de_la_finale_laissee(v_devis_lien')
  })
})

// ── Les jeux ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const facture = (p: Partial<FactureDuDevis>): FactureDuDevis => ({
  id: 'f', numero: null, statut: 'validee', type: 'facture', date_emission: '2026-10-01', montant_ttc: 360, acompte: false,
  facture_origine_id: null, ...p,
})
const lien = (id: string, devis: string, factureId: string, role: 'acompte' | 'finale', cree_le = '2026-10-01T08:00:00Z') =>
  ({ id, devis_id: devis, facture_id: factureId, cree_le, role })

// Un devis de 1 000 € HT à 20 %, un acompte validé de 300 € HT, sa finale (brouillon ou validée) qui le reprend.
const DEVIS = { id: 'dv1', numero: 'D2026-0001', lignes: [{ designation: 'Mission', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] }
const ACOMPTE = facture({ id: 'fa1', numero: 'F2026-0010', date_emission: '2026-10-10', acompte: true })
const REPRISE = { facture_id: 'ff1', ordre: 1, quantite: -1, prix_unitaire_ht: 300, taux_tva: 20, nature: null, reprise_facture_id: 'fa1' }

function lus(p: { finale?: Partial<FactureDuDevis>; brouillon?: boolean; avoirs?: FactureDuDevis[]; autres?: Partial<AcomptesDesFacturesLus> } = {}): LectureDesAcomptesDesFactures {
  const factures = [ACOMPTE, facture({ id: 'ff1', numero: null, statut: 'brouillon', montant_ttc: 840, ...p.finale }), ...(p.avoirs ?? [])]
  const liens = [lien('l1', 'dv1', 'fa1', 'acompte'), lien('l2', 'dv1', 'ff1', 'finale', '2026-10-20T08:00:00Z')]
  if (p.brouillon) {
    factures.push(facture({ id: 'fb1', statut: 'brouillon', acompte: true }))
    liens.push(lien('l3', 'dv1', 'fb1', 'acompte'))
  }
  return {
    dossierId: 'd1', etat: 'lue', liens, factures, mode: 'tresorerie', devis: [DEVIS],
    lignes: [{ facture_id: 'fa1', ordre: 0, quantite: 1, prix_unitaire_ht: 300, taux_tva: 20, nature: null }],
    versements: [{ facture_id: 'fa1', date_versement_acompte: '2026-10-05' }, { facture_id: 'fb1', date_versement_acompte: null }],
    lignesDesFinales: [{ ...REPRISE, ordre: 0, quantite: 1, prix_unitaire_ht: 1000, reprise_facture_id: null }, REPRISE],
    ...p.autres,
  }
}
const de = <E extends AcompteDeLaFacture['etat']>(a: AcompteDeLaFacture, etat: E) => {
  expect(a.etat).toBe(etat)
  return a as Extract<AcompteDeLaFacture, { etat: E }>
}

describe('ce qu’est une facture', () => {
  it('pas encore lue, ou illisible : retenue, jamais « sans acompte »', () => {
    expect(acompteDeLaFacture(null, 'fa1').etat).toBe('retenu')
    const illisible = acompteDeLaFacture({ dossierId: 'd1', etat: 'illisible', motif: 'refus de la base' }, 'fa1')
    expect(de(illisible, 'retenu').avis).toContain('refus de la base')
    expect(acompteDeLaFacture({ dossierId: 'd1', etat: 'sans' }, 'fa1')).toBe(SANS_ACOMPTE)
  })

  it('l’acompte et sa date du versement, la finale ; leur marque, et les mots que la recherche lit', () => {
    const a = de(acompteDeLaFacture(lus(), 'fa1'), 'acompte')
    expect(a.dateVersement).toBe('2026-10-05')
    expect(marqueDeLaFacture(a)).toBe('Acompte')
    const f = acompteDeLaFacture(lus(), 'ff1')
    expect(marqueDeLaFacture(f)).toBe('Finale')
    expect(motsDeLaMarque('Finale')).toContain('facture finale')
    expect(motsDeLaMarque('Acompte')).toContain('facture d’acompte')
  })

  it('la facture tirée d’un devis sans acompte n’est pas marquée ; une facture absente de la lecture est retenue', () => {
    const sansAcompte = lus({ autres: { liens: [lien('l2', 'dv1', 'ff1', 'finale')] } })
    expect(marqueDeLaFacture(acompteDeLaFacture(sansAcompte, 'ff1'))).toBeNull()
    expect(acompteDeLaFacture(lus(), 'inconnue').etat).toBe('retenu')
  })
})

describe('la validation', () => {
  const acompteBrouillon = () => de(acompteDeLaFacture(lus({ brouillon: true }), 'fb1'), 'acompte')
  const ligne = (prix: number, taux = 20) => ({ quantite: 1, prix_unitaire_ht: prix, taux_tva: taux, nature: null })

  it('un acompte : hors du devis, puis le cumul, puis la finale qu’il laisserait (P5B-Q5)', () => {
    expect(refusDeLaValidationDeLAcompte(acompteBrouillon(), [ligne(100, 5.5)])).toBe(refusLigneHorsDuDevis(5.5, 'D2026-0001'))
    expect(refusDeLaValidationDeLAcompte(acompteBrouillon(), [ligne(800)])).toBe(refusCumulDesAcomptes('D2026-0001', 20))
    expect(refusDeLaValidationDeLAcompte(acompteBrouillon(), [ligne(700)])).toBe(REFUS_ACOMPTE.couvreToutLeDevis)
    expect(refusDeLaValidationDeLAcompte(acompteBrouillon(), [ligne(200)])).toBeNull()
  })

  it('une finale : un acompte en brouillon, une reprise inexacte, une reprise hors vigueur, puis un taux négatif', () => {
    const finale = (l: LectureDesAcomptesDesFactures) => de(acompteDeLaFacture(l, 'ff1'), 'finale')
    const devis = { quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20, nature: null }
    const reprise = { quantite: -1, prix_unitaire_ht: 300, taux_tva: 20, nature: null, reprise_facture_id: 'fa1' }
    expect(refusDeLaValidationDeLaFinale(finale(lus({ brouillon: true })), [devis, reprise])).toBe(REFUS_FINALE_ACOMPTE_EN_BROUILLON)
    expect(refusDeLaValidationDeLaFinale(finale(lus()), [devis])).toBe(refusRepriseInexacte('F2026-0010'))
    expect(refusDeLaValidationDeLaFinale(finale(lus()), [devis, { ...reprise, prix_unitaire_ht: 299 }])).toBe(refusRepriseInexacte('F2026-0010'))
    // L'acompte crédité depuis le tirage de la finale : il n'est plus en vigueur, sa reprise se refuse.
    const credite = lus({ avoirs: [facture({ id: 'av1', type: 'avoir', facture_origine_id: 'fa1', montant_ttc: -360 })] })
    expect(refusDeLaValidationDeLaFinale(finale(credite), [devis, reprise])).toBe(refusRepriseHorsVigueur('F2026-0010'))
    expect(refusDeLaValidationDeLaFinale(finale(lus()), [{ ...devis, prix_unitaire_ht: 200 }, reprise]))
      .toBe('La facture finale serait négative à 20 % : les acomptes repris dépassent le devis.')
    expect(refusDeLaValidationDeLaFinale(finale(lus()), [devis, reprise])).toBeNull()
  })

  it('la confirmation nomme la facture d’acompte, ou la finale, ses acomptes repris et le net', () => {
    expect(confirmationDeLaValidation(acompteBrouillon(), [ligne(200)])).toMatch(/^C’est une FACTURE D’ACOMPTE sur le devis D2026-0001, de 240,00\s€ TTC\./)
    const f = acompteDeLaFacture(lus(), 'ff1')
    const texte = confirmationDeLaValidation(f, [
      { quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }, { quantite: -1, prix_unitaire_ht: 300, taux_tva: 20, reprise_facture_id: 'fa1' },
    ])?.replace(/\s/g, ' ')
    expect(texte).toBe('C’est la FACTURE FINALE du devis D2026-0001. Elle reprend en déduction l’acompte F2026-0010 du 10/10/2026 '
      + '(360,00 € TTC) : net à payer 840,00 € TTC.')
    expect(confirmationDeLaValidation(SANS_ACOMPTE, [])).toBeNull()
  })
})

describe('l’avoir', () => {
  const ORIGINE = { id: 'fa1', nature_operation: 'services' as const, type: 'facture' as const, statut: 'validee' as const, numero: 'F2026-0010', date_emission: '2026-10-10', montant_ttc: 360 }
  const toutes = [{ designation: 'Acompte', quantite: 1, prix_unitaire_ht: 300, taux_tva: 20 }]
  const finaleValidee = { numero: 'F2026-0020', statut: 'validee' as const, date_emission: '2026-10-20' }

  it('un acompte que la finale validée et active reprend : refusé (P5B2-Q2) ; la finale créditée en entier : permis (P5B-Q4)', () => {
    const repris = acompteDeLaFacture(lus({ finale: finaleValidee }), 'fa1')
    expect(refusDeLAvoir(ORIGINE, repris, '2026-11-04', toutes, 0, null)).toBe(refusAcompteRepris('F2026-0010', 'F2026-0020'))
    const annulee = lus({ finale: finaleValidee, avoirs: [facture({ id: 'av2', type: 'avoir', facture_origine_id: 'ff1', montant_ttc: -840 })] })
    expect(refusDeLAvoir(ORIGINE, acompteDeLaFacture(annulee, 'fa1'), '2026-11-04', toutes, 0, null)).toBeNull()
  })

  it('un acompte se crédite en entier et en une fois', () => {
    const a = acompteDeLaFacture(lus(), 'fa1')
    expect(refusDeLAvoir(ORIGINE, a, '2026-11-04', [{ ...toutes[0], prix_unitaire_ht: 100 }], 0, null)).toBe(refusAvoirPartielDAcompte('F2026-0010', 360))
    expect(refusDeLAvoir(ORIGINE, a, '2026-11-04', toutes, 0, null)).toBeNull()
  })

  it('une finale : sa reprise se défait à −1, une fois ; une seconde fois se refuse', () => {
    const FINALE = { ...ORIGINE, id: 'ff1', numero: 'F2026-0020', date_emission: '2026-10-20', montant_ttc: 840 }
    const lignes = [
      { designation: 'Mission', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
      { designation: 'Reprise', quantite: -1, prix_unitaire_ht: 300, taux_tva: 20, nature: null, reprise_facture_id: 'fa1' },
    ]
    expect(refusDeLAvoir(FINALE, acompteDeLaFacture(lus({ finale: finaleValidee }), 'ff1'), '2026-11-04', lignes, 0, null)).toBeNull()
    const dejaDefaite = lus({
      finale: finaleValidee,
      avoirs: [facture({ id: 'av3', type: 'avoir', facture_origine_id: 'ff1', montant_ttc: -360 })],
      autres: { lignesDesFinales: [REPRISE, { ...REPRISE, facture_id: 'av3', quantite: 1 }] },
    })
    expect(refusDeLAvoir(FINALE, acompteDeLaFacture(dejaDefaite, 'ff1'), '2026-11-04', lignes, 0, null)).toBe(refusRepriseDefaite('F2026-0020'))
  })
})
