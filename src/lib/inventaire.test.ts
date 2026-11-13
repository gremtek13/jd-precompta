import { describe, expect, it } from 'vitest'
import {
  GENRES_DE_PROVISION, MOTS_DES_REFUS, NATURES_A_EXTOURNER, NATURES_D_INVENTAIRE, NATURES_REPRISES, RACINES_DES_CHARGES_A_PAYER,
  RACINES_DES_FNP_HORS_ROLE, RACINES_DES_PRODUITS_A_RECEVOIR, ROLES_D_INVENTAIRE, composerEvaluation, composerRegularisation,
  composerRegularisationReprise, compteDeLaRepriseAdmis, compteDuRole, estEquilibree, extourneDe, prorataApresLaCloture,
  refusDeLaRegularisation, refusDeLaRegularisationReprise, refusDeLaVentilation, refusDuPlan, repriseALaPlace,
  type ComptesDInventaire, type ContexteDEvaluation, type ContexteDeLaReprise, type ContexteDeRegularisation, type EcritureDInventaire,
  type NatureDInventaire, type SaisieDEvaluation, type SaisieDeRegularisation,
} from './inventaire'

// Les comptes d'un plan d'essai : des sous-comptes du cabinet, pas les défauts du catalogue, pour qu'aucun test ne passe
// parce qu'un compte en dur coïncide avec le plan.
const COMPTES: ComptesDInventaire = {
  charges_constatees_avance: '486100',
  produits_constates_avance: '487100',
  factures_non_parvenues: '408110',
  factures_a_etablir: '418110',
  tva_factures_non_parvenues: '445861',
  tva_factures_a_etablir: '445871',
  provisions_risques: '151110',
  depreciation_clients: '491100',
  dotations_provisions_exploitation: '681510',
  dotations_depreciations_actif_circulant: '681740',
  reprises_provisions_exploitation: '781510',
  reprises_depreciations_actif_circulant: '781740',
}

const contexte = (p: Partial<ContexteDeRegularisation> = {}): ContexteDeRegularisation => ({
  modeComptable: 'engagement', assujettiTva: true, comptes: COMPTES,
  exercice: { exercice: 2026, valide: false, anneeEnCours: 2027, premierExercice: 2025 },
  tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
  ...p,
})

const saisie = (p: Partial<SaisieDeRegularisation> = {}): SaisieDeRegularisation => ({
  nature: 'cca', compteResultat: '616000', libelleCompteResultat: 'Primes d’assurance', compteRegularisation: '486100',
  montantCentimes: 60_000, tvaCentimes: 0, objet: 'Multirisque du local, juillet 2026 à juin 2027', ...p,
})

const cles = (r: { ok: false; refus: { cle: string }[] } | { ok: true }) => (r.ok ? [] : r.refus.map((x) => x.cle))

function constatee(s: SaisieDeRegularisation, c = contexte()): { constatation: EcritureDInventaire; extourne: EcritureDInventaire } {
  const r = composerRegularisation(s, c)
  if (!r.ok) throw new Error(r.refus.map((x) => x.message).join(' / '))
  return r
}

describe('les listes fermées', () => {
  it('extourne toutes les natures sauf la provision', () => {
    expect(NATURES_A_EXTOURNER).toEqual(NATURES_D_INVENTAIRE.filter((n) => n !== 'provision'))
    expect(GENRES_DE_PROVISION).toEqual(['risque', 'depreciation_creance'])
  })

  it('porte les douze rôles de la conception, chacun sous sa racine', () => {
    expect(ROLES_D_INVENTAIRE.map((r) => r.role)).toEqual(Object.keys(COMPTES))
    for (const r of ROLES_D_INVENTAIRE) expect(r.racines.some((x) => COMPTES[r.role]!.startsWith(x))).toBe(true)
  })

  it('ne range jamais une charge à payer ni un produit à recevoir au 467 ni au 468 (INV-Q2)', () => {
    for (const racine of [...RACINES_DES_CHARGES_A_PAYER, ...RACINES_DES_PRODUITS_A_RECEVOIR, ...RACINES_DES_FNP_HORS_ROLE]) {
      expect(racine.startsWith('467') || racine.startsWith('468')).toBe(false)
    }
  })
})

describe('compteDuRole', () => {
  it('rend le compte du plan, et refuse un rôle absent, hors de sa racine ou mal formé', () => {
    expect(compteDuRole(COMPTES, 'charges_constatees_avance')).toBe('486100')
    expect(compteDuRole({}, 'charges_constatees_avance')).toBeNull()
    expect(compteDuRole({ charges_constatees_avance: '487100' }, 'charges_constatees_avance')).toBeNull()
    expect(compteDuRole({ charges_constatees_avance: '48610' }, 'charges_constatees_avance')).toBeNull()
    expect(compteDuRole({ charges_constatees_avance: '4861000' }, 'charges_constatees_avance')).toBeNull()
  })

  it('nomme le rôle et sa racine dans le refus du plan', () => {
    expect(refusDuPlan('tva_factures_a_etablir')).toEqual({
      cle: 'plan:tva_factures_a_etablir', code: '22023',
      message: expect.stringContaining('« TVA sur factures à établir » sous le 44587'),
    })
  })
})

describe('la constatation au 31 décembre et son extourne au 1er janvier (INV-Q1 (A))', () => {
  it('écrit une CCA au débit du 486, la charge au crédit, et la contre-passe le 1er janvier suivant', () => {
    const { constatation, extourne } = constatee(saisie())
    expect(constatation).toEqual({
      date: '2026-12-31', journal: 'OD',
      libelle: 'CCA 31/12/2026 — Primes d’assurance — Multirisque du local, juillet 2026 à juin 2027',
      lignes: [{ compte: '486100', sens: 'debit', centimes: 60_000 }, { compte: '616000', sens: 'credit', centimes: 60_000 }],
    })
    expect(extourne).toEqual({
      date: '2027-01-01', journal: 'OD',
      libelle: 'Extourne — CCA 31/12/2026 — Primes d’assurance — Multirisque du local, juillet 2026 à juin 2027',
      lignes: [{ compte: '486100', sens: 'credit', centimes: 60_000 }, { compte: '616000', sens: 'debit', centimes: 60_000 }],
    })
    expect(extourneDe(constatation, 2026)).toEqual(extourne)
  })

  it('passe le 1er janvier d’une année bissextile et le 31 décembre d’une autre sans fuseau', () => {
    const { constatation, extourne } = constatee(saisie(), contexte({ exercice: { exercice: 2027, valide: false, anneeEnCours: 2027, premierExercice: null } }))
    expect([constatation.date, extourne.date]).toEqual(['2027-12-31', '2028-01-01'])
  })

  it('se passe du libellé du compte quand le plan n’en donne pas, et garde l’objet sans ses blancs de bord', () => {
    const { constatation } = constatee(saisie({ libelleCompteResultat: '  ', objet: '  Loyer de janvier  ' }))
    expect(constatation.libelle).toBe('CCA 31/12/2026 — Loyer de janvier')
    expect(constatee(saisie({ libelleCompteResultat: null })).constatation.libelle).toBe(
      'CCA 31/12/2026 — Multirisque du local, juillet 2026 à juin 2027')
  })

  it.each<[NatureDInventaire, string, string, [string, string]]>([
    ['pca', '706000', '487100', ['706000', '487100']],
    ['charge_a_payer', '641100', '428200', ['641100', '428200']],
    ['charge_a_payer', '661100', '168800', ['661100', '168800']],
    ['produit_a_recevoir', '708800', '448200', ['448200', '708800']],
    ['produit_a_recevoir', '791000', '439100', ['439100', '791000']],
  ])('écrit %s %s / %s au bon sens', (nature, compteResultat, regul, [auDebit, auCredit]) => {
    const s = saisie({ nature, compteResultat, compteRegularisation: regul, libelleCompteResultat: null, objet: 'x' })
    const { constatation, extourne } = constatee(s)
    expect(constatation.lignes.map((l) => [l.compte, l.sens])).toEqual([[auDebit, 'debit'], [auCredit, 'credit']])
    expect(estEquilibree(constatation) && estEquilibree(extourne)).toBe(true)
  })

  it('écrit une FNP d’un assujetti toutes taxes comprises, la TVA au 44586 (INV-Q3 (A))', () => {
    const { constatation, extourne } = constatee(saisie({
      nature: 'fnp', compteResultat: '606100', libelleCompteResultat: 'Électricité', compteRegularisation: '408110',
      montantCentimes: 10_001, tvaCentimes: 2_000, objet: 'Facture de décembre, reçue en janvier',
    }))
    expect(constatation.libelle).toBe('FNP 31/12/2026 — Électricité — Facture de décembre, reçue en janvier')
    expect(constatation.lignes).toEqual([
      { compte: '606100', sens: 'debit', centimes: 10_001 },
      { compte: '445861', sens: 'debit', centimes: 2_000 },
      { compte: '408110', sens: 'credit', centimes: 12_001 },
    ])
    expect(estEquilibree(constatation) && estEquilibree(extourne)).toBe(true)
    expect(extourne.lignes.map((l) => l.sens)).toEqual(['credit', 'credit', 'debit'])
  })

  it('écrit une FAE au débit du 418 toutes taxes comprises, le produit et la TVA au 44587 au crédit', () => {
    const { constatation } = constatee(saisie({
      nature: 'fae', compteResultat: '706000', compteRegularisation: '418110', montantCentimes: 50_000, tvaCentimes: 10_000,
    }))
    expect(constatation.lignes).toEqual([
      { compte: '418110', sens: 'debit', centimes: 60_000 },
      { compte: '706000', sens: 'credit', centimes: 50_000 },
      { compte: '445871', sens: 'credit', centimes: 10_000 },
    ])
  })

  it('n’écrit aucune ligne de TVA nulle, et n’exige pas alors le compte de TVA d’attente', () => {
    const comptes = { ...COMPTES, tva_factures_non_parvenues: undefined }
    const { constatation } = constatee(saisie({ nature: 'fnp', compteResultat: '606100', compteRegularisation: '408110' }), contexte({ comptes }))
    expect(constatation.lignes.map((l) => l.compte)).toEqual(['606100', '408110'])
  })

  it('écrit la FNP d’un exonéré toutes taxes comprises à la charge, sans TVA', () => {
    const { constatation } = constatee(
      saisie({ nature: 'fnp', compteResultat: '606100', compteRegularisation: '408110', montantCentimes: 12_001 }),
      contexte({ assujettiTva: false }))
    expect(constatation.lignes).toEqual([
      { compte: '606100', sens: 'debit', centimes: 12_001 }, { compte: '408110', sens: 'credit', centimes: 12_001 },
    ])
  })

  it('refuse l’avoir à obtenir du 4098, dont la contrepartie est au 609 (INV1-Q1)', () => {
    for (const compteResultat of ['609000', '708000']) {
      expect(cles(composerRegularisation(
        saisie({ nature: 'produit_a_recevoir', compteResultat, compteRegularisation: '409800' }), contexte())))
        .toEqual(compteResultat === '609000' ? ['compteResultat', 'compteRegularisation'] : ['compteRegularisation'])
    }
  })

  it('admet la FNP des intérêts courus sous le 4088, jamais un 408 hors du plan ni le 4084 (INV1-Q1)', () => {
    expect(composerRegularisation(saisie({ nature: 'fnp', compteResultat: '661100', compteRegularisation: '408800' }), contexte()).ok).toBe(true)
    for (const compte of ['408100', '408400', '401000']) {
      expect(cles(composerRegularisation(saisie({ nature: 'fnp', compteResultat: '606100', compteRegularisation: compte }), contexte())))
        .toEqual(['compteRegularisation'])
    }
  })
})

describe('les refus de la régularisation', () => {
  it('refuse un dossier en trésorerie, seul refus dit (INV-Q10 (A))', () => {
    const r = refusDeLaRegularisation(saisie({ montantCentimes: 0, objet: '' }), contexte({ modeComptable: 'tresorerie' }))
    expect(r).toEqual([{ cle: 'tresorerie', code: '22023', message: MOTS_DES_REFUS.tresorerie }])
  })

  it('refuse un exercice validé en 23514, un exercice à venir, un exercice d’avant l’ouverture, une année illisible', () => {
    const avec = (e: Partial<ContexteDeRegularisation['exercice']>) =>
      refusDeLaRegularisation(saisie(), contexte({ exercice: { ...contexte().exercice, ...e } }))
    expect(avec({ valide: true })).toEqual([{ cle: 'exerciceFige', code: '23514', message: MOTS_DES_REFUS.exerciceFige }])
    expect(avec({ exercice: 2028 }).map((x) => x.cle)).toEqual(['exerciceAVenir'])
    expect(avec({ exercice: 2027 })).toEqual([])
    expect(avec({ exercice: 2025 })).toEqual([])
    expect(avec({ exercice: 2024 }).map((x) => x.cle)).toEqual(['avantLOuverture'])
    expect(avec({ exercice: 2024, premierExercice: null })).toEqual([])
    expect(avec({ exercice: 2026.5 }).map((x) => x.cle)).toEqual(['exercice'])
    expect(avec({ exercice: 1999 }).map((x) => x.cle)).toEqual(['exercice'])
  })

  it('renvoie la provision à son évaluation et refuse une nature inconnue', () => {
    expect(cles(composerRegularisation(saisie({ nature: 'provision' }), contexte()))).toEqual(['provisionParSonEvaluation'])
    expect(cles(composerRegularisation(saisie({ nature: 'stock' as NatureDInventaire }), contexte()))).toEqual(['nature'])
  })

  it('refuse un compte de résultat de la mauvaise classe ou mal formé', () => {
    expect(refusDeLaRegularisation(saisie({ compteResultat: '706000' }), contexte())).toEqual([
      { cle: 'compteResultat', code: '22023', message: MOTS_DES_REFUS.compteDeCharge },
    ])
    expect(refusDeLaRegularisation(saisie({ nature: 'pca', compteResultat: '616000', compteRegularisation: '487100' }), contexte())
      .map((x) => x.message)).toEqual([MOTS_DES_REFUS.compteDeProduit])
    expect(cles(composerRegularisation(saisie({ compteResultat: '61A000' }), contexte()))).toEqual(['compteResultat'])
  })

  it('refuse le 467 et le 468 pour une charge à payer comme pour un produit à recevoir (INV-Q2 (A))', () => {
    for (const compte of ['467000', '468000', '468600', '467100']) {
      expect(cles(composerRegularisation(saisie({ nature: 'charge_a_payer', compteRegularisation: compte }), contexte())))
        .toEqual(['compteRegularisation'])
      expect(cles(composerRegularisation(
        saisie({ nature: 'produit_a_recevoir', compteResultat: '708800', compteRegularisation: compte }), contexte())))
        .toEqual(['compteRegularisation'])
    }
  })

  it('refuse une CCA ailleurs qu’au compte du plan, et un plan qui ne porte pas le rôle', () => {
    expect(cles(composerRegularisation(saisie({ compteRegularisation: '486000' }), contexte()))).toEqual(['compteRegularisation'])
    const sansRole = contexte({ comptes: { ...COMPTES, charges_constatees_avance: undefined } })
    expect(cles(composerRegularisation(saisie(), sansRole))).toEqual(['plan:charges_constatees_avance', 'compteRegularisation'])
    const faeSansTva = contexte({ comptes: { ...COMPTES, tva_factures_a_etablir: '445660' } })
    expect(cles(composerRegularisation(
      saisie({ nature: 'fae', compteResultat: '706000', compteRegularisation: '418110', tvaCentimes: 100 }), faeSansTva)))
      .toEqual(['plan:tva_factures_a_etablir'])
  })

  it.each([0, -100, 12.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN])('refuse le montant %s', (montantCentimes) => {
    expect(cles(composerRegularisation(saisie({ montantCentimes }), contexte()))).toEqual(['montant'])
  })

  it('refuse un total qui dépasse les entiers sûrs', () => {
    expect(cles(composerRegularisation(saisie({
      nature: 'fnp', compteResultat: '606100', compteRegularisation: '408110',
      montantCentimes: Number.MAX_SAFE_INTEGER - 1, tvaCentimes: 10,
    }), contexte()))).toEqual(['montant'])
  })

  it('refuse une TVA illisible, hors d’une facture attendue, d’un exonéré, ou sous la règle hors taxes (INV-Q3 (B))', () => {
    const fnp = saisie({ nature: 'fnp', compteResultat: '606100', compteRegularisation: '408110', tvaCentimes: 200 })
    expect(refusDeLaRegularisation(saisie({ tvaCentimes: -1 }), contexte()).map((x) => x.message)).toEqual([MOTS_DES_REFUS.tvaIllisible])
    expect(refusDeLaRegularisation(saisie({ tvaCentimes: 0.5 }), contexte()).map((x) => x.message)).toEqual([MOTS_DES_REFUS.tvaIllisible])
    expect(refusDeLaRegularisation(saisie({ tvaCentimes: 200 }), contexte()).map((x) => x.message)).toEqual([MOTS_DES_REFUS.tvaHorsFacture])
    expect(refusDeLaRegularisation(fnp, contexte({ assujettiTva: false })).map((x) => x.message)).toEqual([MOTS_DES_REFUS.tvaNonAssujetti])
    expect(refusDeLaRegularisation(fnp, contexte({ tvaDesFacturesAttendues: 'hors_taxes' })).map((x) => x.message))
      .toEqual([MOTS_DES_REFUS.tvaHorsTaxes])
    // Sous la règle hors taxes, une FNP sans TVA s'écrit comme sous la règle recommandée.
    const sansTva = { ...fnp, tvaCentimes: 0 }
    expect(composerRegularisation(sansTva, contexte({ tvaDesFacturesAttendues: 'hors_taxes' })))
      .toEqual(composerRegularisation(sansTva, contexte()))
  })

  it.each(['', '   ', 'a'.repeat(201), 'ligne\nautre', 'ligne\rautre'])('refuse l’objet %j', (objet) => {
    expect(cles(composerRegularisation(saisie({ objet }), contexte()))).toEqual(['objet'])
  })

  it('compte l’objet en caractères, comme la base : deux cents signes hors du plan de base passent', () => {
    expect(composerRegularisation(saisie({ objet: '𝔸'.repeat(200) }), contexte()).ok).toBe(true)
    expect(composerRegularisation(saisie({ objet: 'a'.repeat(200) }), contexte()).ok).toBe(true)
  })

  it('dit tous les refus de la saisie, dans l’ordre des contrôles de la fonction', () => {
    expect(cles(composerRegularisation(
      saisie({ compteResultat: '706000', compteRegularisation: '467000', montantCentimes: 0, tvaCentimes: 5, objet: '' }),
      contexte({ comptes: {} }),
    ))).toEqual(['plan:charges_constatees_avance', 'compteResultat', 'compteRegularisation', 'montant', 'tva', 'objet'])
  })
})

describe('l’évaluation d’une provision (INV-Q4)', () => {
  const ctx = (p: Partial<ContexteDEvaluation> = {}): ContexteDEvaluation => ({
    modeComptable: 'engagement', comptes: COMPTES, exercice: contexte().exercice, ciblePrecedenteCentimes: 0,
    reajustement: 'par_difference', ...p,
  })
  const prov = (p: Partial<SaisieDEvaluation> = {}): SaisieDEvaluation => ({
    genre: 'risque', compteProvision: '151110', cibleCentimes: 100_000, objet: 'Litige prud’homal', ...p,
  })
  const ecriture = (s: SaisieDEvaluation, c: ContexteDEvaluation) => {
    const r = composerEvaluation(s, c)
    if (!r.ok) throw new Error(r.refus.map((x) => x.message).join(' / '))
    return r
  }

  it('dote une provision nouvelle de toute sa cible, au 31 décembre, sans extourne', () => {
    expect(ecriture(prov(), ctx())).toEqual({
      ok: true, ecart: 100_000,
      ecriture: {
        date: '2026-12-31', journal: 'OD', libelle: 'Dotation 31/12/2026 — Provision pour risques — Litige prud’homal',
        lignes: [{ compte: '681510', sens: 'debit', centimes: 100_000 }, { compte: '151110', sens: 'credit', centimes: 100_000 }],
      },
    })
  })

  it('reprend l’écart quand la provision baisse, et tout quand elle tombe à zéro', () => {
    const baisse = ecriture(prov({ cibleCentimes: 40_001 }), ctx({ ciblePrecedenteCentimes: 100_000 }))
    expect(baisse.ecart).toBe(-59_999)
    expect(baisse.ecriture!.libelle.startsWith('Reprise 31/12/2026')).toBe(true)
    expect(baisse.ecriture!.lignes).toEqual([
      { compte: '151110', sens: 'debit', centimes: 59_999 }, { compte: '781510', sens: 'credit', centimes: 59_999 },
    ])
    expect(ecriture(prov({ cibleCentimes: 0 }), ctx({ ciblePrecedenteCentimes: 100_000 })).ecriture!.lignes[0].centimes).toBe(100_000)
  })

  it('n’écrit rien quand la provision ne change pas', () => {
    expect(ecriture(prov(), ctx({ ciblePrecedenteCentimes: 100_000 }))).toEqual({ ok: true, ecart: 0, ecriture: null })
    expect(ecriture(prov({ cibleCentimes: 0 }), ctx())).toEqual({ ok: true, ecart: 0, ecriture: null })
  })

  it('déprécie une créance au 491, par le 6817 et le 7817', () => {
    const s = prov({ genre: 'depreciation_creance', compteProvision: '491100', objet: 'Facture F2026-014' })
    expect(ecriture(s, ctx()).ecriture!.lignes.map((l) => l.compte)).toEqual(['681740', '491100'])
    expect(ecriture({ ...s, cibleCentimes: 1 }, ctx({ ciblePrecedenteCentimes: 2 })).ecriture!.lignes.map((l) => l.compte))
      .toEqual(['491100', '781740'])
  })

  it('sous la reprise intégrale puis la dotation (INV-Q4 (B)), une écriture de quatre lignes, équilibrée', () => {
    const r = ecriture(prov({ cibleCentimes: 70_000 }), ctx({ ciblePrecedenteCentimes: 100_000, reajustement: 'reprise_puis_dotation' }))
    expect(r.ecart).toBe(-30_000)
    expect(r.ecriture!.libelle.startsWith('Réajustement 31/12/2026')).toBe(true)
    expect(r.ecriture!.lignes).toEqual([
      { compte: '151110', sens: 'debit', centimes: 100_000 }, { compte: '781510', sens: 'credit', centimes: 100_000 },
      { compte: '681510', sens: 'debit', centimes: 70_000 }, { compte: '151110', sens: 'credit', centimes: 70_000 },
    ])
    expect(estEquilibree(r.ecriture!)).toBe(true)
    expect(ecriture(prov(), ctx({ reajustement: 'reprise_puis_dotation' })).ecriture!.lignes).toHaveLength(2)
    expect(ecriture(prov({ cibleCentimes: 0 }), ctx({ reajustement: 'reprise_puis_dotation' })).ecriture).toBeNull()
  })

  it('refuse la trésorerie, un exercice validé, un genre inconnu, un compte hors de la racine du genre, des montants illisibles', () => {
    expect(cles(composerEvaluation(prov(), ctx({ modeComptable: 'tresorerie' })))).toEqual(['tresorerie'])
    expect(composerEvaluation(prov(), ctx({ exercice: { ...contexte().exercice, valide: true } })))
      .toEqual({ ok: false, refus: [{ cle: 'exerciceFige', code: '23514', message: MOTS_DES_REFUS.exerciceFige }] })
    expect(cles(composerEvaluation(prov({ genre: 'stock' as SaisieDEvaluation['genre'] }), ctx()))).toEqual(['genre'])
    expect(cles(composerEvaluation(prov({ compteProvision: '152000' }), ctx()))).toEqual(['compteProvision'])
    expect(cles(composerEvaluation(prov({ genre: 'depreciation_creance', compteProvision: '151110' }), ctx()))).toEqual(['compteProvision'])
    expect(cles(composerEvaluation(prov({ cibleCentimes: -1 }), ctx({ ciblePrecedenteCentimes: 0.5 })))).toEqual(['cible', 'ciblePrecedente'])
    expect(cles(composerEvaluation(prov({ objet: '' }), ctx({ comptes: { ...COMPTES, reprises_provisions_exploitation: undefined } }))))
      .toEqual(['plan:reprises_provisions_exploitation', 'objet'])
  })
})

describe('la ventilation d’une provision reprise d’une balance (INV-Q11)', () => {
  it('exige la somme exacte du solde repris, au centime', () => {
    expect(refusDeLaVentilation(100_000, [60_000, 40_000])).toBeNull()
    expect(refusDeLaVentilation(100_000, [100_000])).toBeNull()
    expect(refusDeLaVentilation(0, [])).toBeNull()
    expect(refusDeLaVentilation(100_000, [60_000, 39_999])?.cle).toBe('ventilation')
    expect(refusDeLaVentilation(100_000, [])?.cle).toBe('ventilation')
    expect(refusDeLaVentilation(100_000, [100_001, -1])?.cle).toBe('ventilation')
    expect(refusDeLaVentilation(0.5, [0.5])?.cle).toBe('ventilation')
  })
})

describe('le prorata après la clôture (INV-Q6)', () => {
  const ok = (r: ReturnType<typeof prorataApresLaCloture>) => {
    if (!r.ok) throw new Error(r.refus.map((x) => x.message).join(' / '))
    return r
  }
  const annuel = { montantCentimes: 120_000, debut: '2026-07-01', fin: '2027-06-30', exercice: 2026 }

  it('propose en jours réels la part d’une assurance annuelle qui court au-delà du 31 décembre', () => {
    // 181 jours du 1er janvier au 30 juin 2027, sur 365 : 120 000 × 181 ÷ 365 = 59 506,85 → 59 507.
    expect(ok(prorataApresLaCloture(annuel, 'jours_reels'))).toEqual({
      ok: true, centimes: 59_507, joursApres: 181, joursDeLaPeriode: 365, methode: 'jours_reels',
    })
  })

  it('compte le 29 février d’une année bissextile en jours réels, et l’ignore en mois de trente jours', () => {
    const bissextile = { montantCentimes: 366_000, debut: '2027-07-01', fin: '2028-06-30', exercice: 2027 }
    expect(ok(prorataApresLaCloture(bissextile, 'jours_reels'))).toMatchObject({ joursApres: 182, joursDeLaPeriode: 366, centimes: 182_000 })
    expect(ok(prorataApresLaCloture(bissextile, 'mois_de_trente_jours'))).toMatchObject({ joursApres: 180, joursDeLaPeriode: 360, centimes: 183_000 })
  })

  it('en mois de trente jours, une moitié d’année est une moitié', () => {
    expect(ok(prorataApresLaCloture(annuel, 'mois_de_trente_jours'))).toEqual({
      ok: true, centimes: 60_000, joursApres: 180, joursDeLaPeriode: 360, methode: 'mois_de_trente_jours',
    })
  })

  it('arrondit au demi-centime vers le haut un montant qui ne se divise pas', () => {
    const trois = (fin: string, montantCentimes = 100) =>
      ok(prorataApresLaCloture({ montantCentimes, debut: '2026-12-30', fin, exercice: 2026 }, 'jours_reels')).centimes
    expect(trois('2027-01-01')).toBe(33)
    expect(trois('2027-01-02', 101)).toBe(51) // 101 × 2 ÷ 4 = 50,5 → 51
    expect(ok(prorataApresLaCloture({ montantCentimes: 1, debut: '2026-12-31', fin: '2027-01-01', exercice: 2026 }, 'jours_reels')).centimes).toBe(1)
  })

  it('propose tout le montant d’une période qui commence après la clôture', () => {
    expect(ok(prorataApresLaCloture({ montantCentimes: 9_999, debut: '2027-02-01', fin: '2027-02-28', exercice: 2026 }, 'jours_reels')))
      .toMatchObject({ centimes: 9_999, joursApres: 28, joursDeLaPeriode: 28 })
    expect(ok(prorataApresLaCloture({ montantCentimes: 9_999, debut: '2027-01-01', fin: '2027-01-01', exercice: 2026 }, 'mois_de_trente_jours')).centimes)
      .toBe(9_999)
  })

  it('calcule en entiers un montant que les flottants ne porteraient pas', () => {
    // 3,65 × 10¹⁵ centimes × 364 × 2 dépasse 2⁵³ : le calcul passe par les grands entiers, et rend l'exact.
    expect(ok(prorataApresLaCloture({ montantCentimes: 3_650_000_000_000_000, debut: '2026-12-31', fin: '2027-12-30', exercice: 2026 }, 'jours_reels')))
      .toMatchObject({ centimes: 3_640_000_000_000_000, joursApres: 364, joursDeLaPeriode: 365 })
  })

  it('refuse une période close au 31 décembre, des dates qui n’existent pas ou à l’envers, un montant ou un exercice illisibles', () => {
    const p = (q: Partial<typeof annuel>) => cles(prorataApresLaCloture({ ...annuel, ...q }, 'jours_reels'))
    expect(p({ fin: '2026-12-31' })).toEqual(['periodeAvantLaCloture'])
    expect(p({ fin: '2027-02-29' })).toEqual(['periode'])
    expect(p({ debut: '2026-13-01' })).toEqual(['periode'])
    expect(p({ debut: '1/7/2026' })).toEqual(['periode'])
    expect(p({ debut: '2027-07-01' })).toEqual(['periode'])
    expect(p({ montantCentimes: 0, exercice: 2026.5 })).toEqual(['montant', 'exercice'])
    expect(p({ fin: '2028-02-29' })).toEqual([])
  })
})

// ── La régularisation reprise d'une balance (INV3-Q2 (A)) ──

describe('composerRegularisationReprise : la seule extourne d’une régularisation que la balance reprise porte', () => {
  const ctx = (p: Partial<ContexteDeLaReprise> = {}): ContexteDeLaReprise => ({
    modeComptable: 'engagement', assujettiTva: true, comptes: COMPTES, tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
    exercice: { exercice: 2024, valide: false, anneeEnCours: 2026, ouverture: '2025-01-01' },
    ...p,
  })
  const reprise = (p: Partial<SaisieDeRegularisation> = {}) =>
    saisie({ compteRegularisation: '486000', montantCentimes: 30_000, objet: 'Assurance 2025 reprise', ...p })
  const refusDe = (s: SaisieDeRegularisation, c = ctx()) => refusDeLaRegularisationReprise(s, c).map((r) => r.cle)

  it('une CCA reprise : son extourne seule, au 1er janvier de l’exercice que la balance ouvre, sous le libellé composé', () => {
    const r = composerRegularisationReprise(reprise(), ctx())
    expect(r).toEqual({
      ok: true,
      extourne: {
        date: '2025-01-01', journal: 'OD', libelle: 'Extourne — CCA 31/12/2024 — Primes d’assurance — Assurance 2025 reprise',
        lignes: [{ compte: '486000', sens: 'credit', centimes: 30_000 }, { compte: '616000', sens: 'debit', centimes: 30_000 }],
      },
    })
    // La même extourne que celle de la régularisation que l'ancien logiciel aurait écrite au 31 décembre.
    const ancienne = constatee(reprise(), contexte({ comptes: { ...COMPTES, charges_constatees_avance: '486000' },
      exercice: { exercice: 2024, valide: false, anneeEnCours: 2026, premierExercice: null } }))
    expect(r.ok && r.extourne).toEqual(ancienne.extourne)
  })

  it('une facture non parvenue reprise toutes taxes comprises : le 408 au débit, la charge et la TVA d’attente au crédit', () => {
    const r = composerRegularisationReprise(
      reprise({ nature: 'fnp', compteResultat: '622600', compteRegularisation: '408100', montantCentimes: 10_000, tvaCentimes: 2_000 }), ctx())
    expect(r.ok && r.extourne.lignes).toEqual([
      { compte: '622600', sens: 'credit', centimes: 10_000 }, { compte: '445861', sens: 'credit', centimes: 2_000 },
      { compte: '408100', sens: 'debit', centimes: 12_000 },
    ])
  })

  it('le compte de la balance, sous la racine de sa nature, plutôt que celui du plan ; jamais le 4084', () => {
    expect(refusDe(reprise({ compteRegularisation: '486000' }))).toEqual([])
    expect(refusDe(reprise({ compteRegularisation: '486999' }))).toEqual([])
    expect(refusDe(reprise({ compteRegularisation: '487000' }))).toEqual(['compteRegularisation'])
    expect(refusDe(reprise({ nature: 'fnp', compteResultat: '622600', compteRegularisation: '408800' }))).toEqual([])
    expect(refusDe(reprise({ nature: 'fnp', compteResultat: '622600', compteRegularisation: '408400' }))).toEqual(['compteRegularisation'])
    expect(refusDeLaRegularisationReprise(reprise({ compteRegularisation: '487000' }), ctx())[0].message).toBe(MOTS_DES_REFUS.compteDeLaReprise)
    expect(compteDeLaRepriseAdmis('fae', '418800')).toBe(true)
    expect(compteDeLaRepriseAdmis('pca', '487')).toBe(true)
    expect(compteDeLaRepriseAdmis('pca', '48')).toBe(false)
  })

  it('le plan ne fournit que la TVA d’attente : un plan sans le 486 ni le 418 n’empêche pas la reprise, un plan sans TVA d’attente si', () => {
    const sansRoles: ComptesDInventaire = Object.fromEntries(Object.entries(COMPTES)
      .filter(([role]) => role !== 'charges_constatees_avance' && role !== 'factures_a_etablir'))
    expect(refusDe(reprise(), ctx({ comptes: sansRoles }))).toEqual([])
    expect(refusDe(reprise({ nature: 'fae', compteResultat: '706000', compteRegularisation: '418000' }), ctx({ comptes: sansRoles }))).toEqual([])
    const sansTva: ComptesDInventaire = Object.fromEntries(Object.entries(COMPTES).filter(([role]) => role !== 'tva_factures_non_parvenues'))
    expect(refusDe(reprise({ nature: 'fnp', compteResultat: '622600', compteRegularisation: '408100', tvaCentimes: 2_000 }), ctx({ comptes: sansTva })))
      .toEqual(['plan:tva_factures_non_parvenues'])
  })

  it('l’exercice : celui que la balance reprise clôt, l’année qui précède son 1er janvier', () => {
    expect(repriseALaPlace({ exercice: 2024, ouverture: '2025-01-01' })).toBe(true)
    expect(repriseALaPlace({ exercice: 2025, ouverture: '2025-01-01' })).toBe(false)
    expect(repriseALaPlace({ exercice: 2024, ouverture: '2025-03-01' })).toBe(false)
    expect(repriseALaPlace({ exercice: 2024, ouverture: null })).toBe(false)
    expect(refusDe(reprise(), ctx({ exercice: { exercice: 2024, valide: false, anneeEnCours: 2026, ouverture: null } }))).toEqual(['repriseHorsDeLOuverture'])
    expect(refusDe(reprise(), ctx({ exercice: { exercice: 2024, valide: true, anneeEnCours: 2026, ouverture: '2025-01-01' } }))).toEqual(['exerciceFige'])
    expect(refusDe(reprise(), ctx({ exercice: { exercice: 2027, valide: false, anneeEnCours: 2026, ouverture: '2028-01-01' } }))).toEqual(['exerciceAVenir'])
  })

  it('la nature : celle d’un compte 486, 487, 408 ou 418 ; ni une charge à payer, ni une provision', () => {
    expect(NATURES_REPRISES).toEqual(['cca', 'pca', 'fnp', 'fae'])
    expect(refusDe(reprise({ nature: 'charge_a_payer', compteResultat: '641200', compteRegularisation: '428200' }))).toEqual(['natureReprise'])
    expect(refusDe(reprise({ nature: 'provision' }))).toEqual(['provisionParSonEvaluation'])
    expect(refusDe(reprise({ nature: 'stock' as NatureDInventaire }))).toEqual(['nature'])
  })

  it('l’ordre de la base : le mode, l’exercice, sa place, la nature, puis les comptes et les montants', () => {
    const hors = ctx({ exercice: { exercice: 2025, valide: false, anneeEnCours: 2026, ouverture: '2025-01-01' } })
    expect(refusDe(reprise({ nature: 'charge_a_payer' }), hors)).toEqual(['repriseHorsDeLOuverture'])
    expect(refusDe(reprise(), ctx({ modeComptable: 'tresorerie' }))).toEqual(['tresorerie'])
    expect(refusDe(reprise({ compteResultat: '706000', compteRegularisation: '487000', montantCentimes: 0, objet: '' })))
      .toEqual(['compteResultat', 'compteRegularisation', 'montant', 'objet'])
  })
})
