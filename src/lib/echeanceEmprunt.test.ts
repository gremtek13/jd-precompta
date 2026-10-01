import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import { caseDuPoste } from './cases2035'
import { COMPTE_ASSURANCE_EMPRUNT, COMPTE_BANQUE, COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT, LIBELLES_COMPTES } from './comptes'
import {
  capitalDeLEcheance, couvertureDuReleve, decoupageDuMouvement, decoupagePourEcheance, echeanceProposee, echeancesDesynchronisees,
  echeancesNonRapprochees, echeancesOccupees, ecritureDeLEcheance, empruntPlausible, estDeblocage, idsDeblocagesEmprunt,
  JOURS_DEBLOCAGE_PLAUSIBLE, LIBELLE_ASSURANCE_EMPRUNT, LIBELLE_INTERETS_EMPRUNT, MARGE_PRELEVEMENT_JOURS, montantAttendu,
  partsDesEcheances, POSTE_ASSURANCE_EMPRUNT, POSTE_INTERETS_EMPRUNT, raisonEmpruntPlausible, refusDecoupage, refusEcheanceEmprunt,
} from './echeanceEmprunt'
import { genererEcheancier, type Emprunt } from './emprunts'
import { partsDuReleve } from './partsDuReleve'
import type { Categorie, EcritureBrouillon } from './types'
import { fichiersDuSchema } from '../test/schema'

const EMPRUNT: Emprunt = {
  id: 'emp1', dossier_id: 'd1', nom: 'Prêt matériel', organisme_preteur: 'Banque', capital_initial: 12000,
  taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
}
const ECHEANCIER = genererEcheancier(EMPRUNT)

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2025-02-06', libelle: 'PRLV ECHEANCE PRET', libelle_brut: null, montant: -540,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: 'releve-fevrier.csv', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, ...o,
  }
}

// Un mouvement tel que la base le garde une fois rapproché : c'est de lui que la 2035 lit le découpage.
function rapproche(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return mouvement({ statut: 'rapprochee', emprunt_id: 'emp1', emprunt_echeance: 1, emprunt_interets: 36, emprunt_assurance: 21.03, ...o })
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2025-02-06', compte: '512000',
    libelle: 'PRLV ECHEANCE PRET', montant: 540, sens: 'credit', statut: 'proposee', created_at: '2025-02-06T10:00:00Z',
    ...o,
  }
}

const aucune = new Map<number, string>()

describe('les comptes et les postes de l’échéance', () => {
  // La base vérifie ces numéros EXACTEMENT : un compte renommé d'un seul côté ferait refuser chaque
  // rapprochement, avec « L'écriture proposée ne correspond pas », sans que rien dise pourquoi.
  it('sont ceux que la fonction SQL exportée attend', () => {
    const definitions = fichiersDuSchema().filter((f) => /function public\.rapprocher_echeance_emprunt\(/.test(f.texte))
    expect(definitions.length).toBeGreaterThan(0)
    const derniere = definitions[definitions.length - 1].texte
    expect(derniere).toContain(`('${COMPTE_BANQUE}', case when v_ligne.montant > 0 then 'debit' else 'credit' end, v_total)`)
    expect(derniere).toContain(`('${COMPTE_EMPRUNT}', case when v_ligne.montant > 0 then 'credit' else 'debit' end, v_capital)`)
    expect(derniere).toContain(`('${COMPTE_INTERETS_EMPRUNT}', 'debit', v_interets)`)
    expect(derniere).toContain(`('${COMPTE_ASSURANCE_EMPRUNT}', 'debit', v_assurance)`)
  })

  it('portent un libellé, que la balance et le FEC reprennent', () => {
    for (const compte of [COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT, COMPTE_ASSURANCE_EMPRUNT]) {
      expect(LIBELLES_COMPTES[compte]).toBeTruthy()
    }
  })

  // Un renommage d'un côté ferait tomber les intérêts dans « sans case », donc hors du formulaire.
  it('les intérêts vont ligne 31 (BN), l’assurance dans le total BH', () => {
    expect(caseDuPoste(POSTE_INTERETS_EMPRUNT)?.code).toBe('BN')
    expect(caseDuPoste(POSTE_ASSURANCE_EMPRUNT)?.code).toBe('BH')
  })
})

describe('refusEcheanceEmprunt — dit avant d’écrire ce que la base refuserait', () => {
  it('un mouvement rapproché d’une pièce ou d’une cotisation, affecté, ventilé ou personnel', () => {
    for (const o of [
      { statut: 'rapprochee' as const, piece_id: 'p1' },
      { statut: 'rapprochee' as const, cotisation_id: 'c1' },
      { statut: 'rapprochee' as const, categorie_id: 'cat-frais' },
      { statut: 'rapprochee' as const, ventilee: true },
      { statut: 'ignoree' as const, prelevement_personnel: true },
    ]) {
      expect(refusEcheanceEmprunt(mouvement(o)))
        .toBe('Ce mouvement est rapproché d’une pièce ou d’une cotisation, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.')
    }
  })

  it('un mouvement de zéro euro', () => {
    expect(refusEcheanceEmprunt(mouvement({ montant: 0 }))).toBe('Un mouvement de zéro euro n’a rien à écrire.')
  })

  it('rien à redire d’un mouvement à traiter, ignoré par une règle, ou déjà rapproché d’un emprunt', () => {
    expect(refusEcheanceEmprunt(mouvement())).toBeNull()
    expect(refusEcheanceEmprunt(mouvement({ statut: 'ignoree' }))).toBeNull()
    // Un nouveau rapprochement REMPLACE le précédent : ce n'est pas un refus.
    expect(refusEcheanceEmprunt(rapproche())).toBeNull()
  })
})

describe('refusDecoupage — les refus de la base, dans le même ordre', () => {
  const echeance = (o: Partial<{ echeance: number | null; interets: number; assurance: number }> = {}) =>
    ({ echeance: 1, interets: 36, assurance: 21.03, ...o })

  it('accepte un découpage qui tient dans le prélèvement, capital nul compris', () => {
    expect(refusDecoupage(mouvement(), EMPRUNT, echeance(), aucune)).toBeNull()
    expect(refusDecoupage(mouvement(), EMPRUNT, echeance({ interets: 500, assurance: 40 }), aucune)).toBeNull()
  })

  it('refuse une échéance absente, hors de la durée ou qui n’est pas un entier', () => {
    for (const n of [null, 0, 25, 1.5]) {
      expect(refusDecoupage(mouvement(), EMPRUNT, echeance({ echeance: n }), aucune))
        .toBe('L’échéance doit être comprise entre 1 et 24 pour cet emprunt.')
    }
  })

  it('refuse des intérêts ou une assurance négatifs, pas au centime, ou qui dépassent le prélèvement', () => {
    for (const o of [{ interets: -1 }, { assurance: -0.01 }, { interets: 36.005 }, { interets: 520, assurance: 20.01 }]) {
      expect(refusDecoupage(mouvement(), EMPRUNT, echeance(o), aucune))
        .toBe('Découpage impossible : les intérêts et l’assurance sont positifs, au centime, et ne dépassent pas le prélèvement.')
    }
  })

  it('refuse une échéance qu’un autre mouvement paie déjà, en disant lequel', () => {
    expect(refusDecoupage(mouvement(), EMPRUNT, echeance(), new Map([[1, '2025-02-05']])))
      .toBe('L’échéance n° 1 de cet emprunt est déjà rapprochée du mouvement du 05/02/2025.')
    expect(refusDecoupage(mouvement(), EMPRUNT, echeance({ echeance: 2 }), new Map([[1, '2025-02-05']]))).toBeNull()
  })

  it('un déblocage n’a ni échéance, ni intérêts, ni assurance', () => {
    const deblocage = mouvement({ montant: 12000 })
    expect(refusDecoupage(deblocage, EMPRUNT, { echeance: null, interets: 0, assurance: 0 }, aucune)).toBeNull()
    for (const d of [{ echeance: 1, interets: 0, assurance: 0 }, { echeance: null, interets: 1, assurance: 0 }, { echeance: null, interets: 0, assurance: 1 }]) {
      expect(refusDecoupage(deblocage, EMPRUNT, d, aucune))
        .toBe('Un encaissement rattaché à un emprunt en est le déblocage : ni échéance, ni intérêts, ni assurance.')
    }
  })
})

describe('ecritureDeLEcheance — une ligne par compte non nul, face à la banque', () => {
  const lignes = (l: ReturnType<typeof ecritureDeLEcheance>) => l.map((x) => `${x.compte}:${x.sens}:${x.montant}`).sort()

  it('une échéance : le capital au 164, les intérêts au 661, l’assurance au 616, la banque au crédit', () => {
    expect(lignes(ecritureDeLEcheance(mouvement(), { echeance: 1, interets: 36, assurance: 21.03 }))).toEqual([
      '164000:debit:482.97', '512000:credit:540', '616800:debit:21.03', '661100:debit:36',
    ])
  })

  it('le libellé du relevé sur chaque ligne, pour retrouver le mouvement', () => {
    for (const l of ecritureDeLEcheance(mouvement(), { echeance: 1, interets: 36, assurance: 0 })) {
      expect(l.libelle).toBe('PRLV ECHEANCE PRET')
    }
  })

  it('sans assurance, sans capital : les lignes à zéro n’existent pas — la base les refuserait', () => {
    expect(lignes(ecritureDeLEcheance(mouvement(), { echeance: 1, interets: 36, assurance: 0 })))
      .toEqual(['164000:debit:504', '512000:credit:540', '661100:debit:36'])
    expect(lignes(ecritureDeLEcheance(mouvement(), { echeance: 1, interets: 540, assurance: 0 })))
      .toEqual(['512000:credit:540', '661100:debit:540'])
  })

  it('s’équilibre au centime, là où l’addition des flottants ne le ferait pas', () => {
    const m = mouvement({ montant: -300.3 })
    const e = ecritureDeLEcheance(m, { echeance: 1, interets: 0.1, assurance: 0.2 })
    expect(capitalDeLEcheance(m, { echeance: 1, interets: 0.1, assurance: 0.2 })).toBe(300)
    const debit = e.filter((l) => l.sens === 'debit').reduce((s, l) => s + Math.round(l.montant * 100), 0)
    const credit = e.filter((l) => l.sens === 'credit').reduce((s, l) => s + Math.round(l.montant * 100), 0)
    expect(debit).toBe(credit)
  })

  it('un déblocage : la banque au débit, le 164 au crédit', () => {
    const deblocage = mouvement({ montant: 12000 })
    expect(estDeblocage(deblocage)).toBe(true)
    expect(lignes(ecritureDeLEcheance(deblocage, { echeance: null, interets: 0, assurance: 0 })))
      .toEqual(['164000:credit:12000', '512000:debit:12000'])
  })
})

describe('echeanceProposee — ce que le cabinet valide ou corrige', () => {
  it('la plus proche du mouvement, intérêts de l’échéancier, le surplus en assurance', () => {
    const p = echeanceProposee(EMPRUNT, mouvement(), aucune)
    const premiere = ECHEANCIER[0]
    expect(p?.echeance?.numero).toBe(1)
    expect(p?.ecartJours).toBe(1)
    const attendu = Math.round((premiere.interets + premiere.capitalRembourse) * 100)
    expect(p?.decoupage).toEqual({ echeance: 1, interets: premiere.interets, assurance: (54000 - attendu) / 100 })
    // Et le capital proposé est bien celui de l'échéancier.
    expect(capitalDeLEcheance(mouvement(), p!.decoupage)).toBe(premiere.capitalRembourse)
  })

  it('saute une échéance déjà payée par un autre mouvement', () => {
    const p = echeanceProposee(EMPRUNT, mouvement(), new Map([[1, '2025-02-05']]))
    expect(p?.echeance?.numero).toBe(2)
    expect(p?.ecartJours).toBe(27)
  })

  it('à égalité de distance, la plus ancienne', () => {
    // Le 19 février est à 14 jours du 5 février (échéance 1) comme du 5 mars (échéance 2) ; un jour
    // plus tard, c'est la seconde qui est la plus proche.
    expect(echeanceProposee(EMPRUNT, mouvement({ date: '2025-02-19' }), aucune)?.echeance?.numero).toBe(1)
    expect(echeanceProposee(EMPRUNT, mouvement({ date: '2025-02-20' }), aucune)?.echeance?.numero).toBe(2)
  })

  it('un prélèvement plus court que prévu : pas d’assurance, et des intérêts qui y tiennent', () => {
    const p = echeanceProposee(EMPRUNT, mouvement({ montant: -20 }), aucune)
    expect(p?.decoupage).toEqual({ echeance: 1, interets: 20, assurance: 0 })
    const q = echeanceProposee(EMPRUNT, mouvement({ montant: -100 }), aucune)
    expect(q?.decoupage).toEqual({ echeance: 1, interets: ECHEANCIER[0].interets, assurance: 0 })
  })

  it('rien quand toutes les échéances sont déjà payées', () => {
    const toutes = new Map(ECHEANCIER.map((l) => [l.numero, l.date] as [number, string]))
    expect(echeanceProposee(EMPRUNT, mouvement(), toutes)).toBeNull()
  })

  it('un déblocage : ni échéance ni découpage', () => {
    const p = echeanceProposee(EMPRUNT, mouvement({ montant: 12000, date: '2025-01-07' }), aucune)
    expect(p).toEqual({ echeance: null, decoupage: { echeance: null, interets: 0, assurance: 0 }, ecartJours: 2 })
  })
})

describe('decoupagePourEcheance — le découpage d’une échéance choisie par son numéro', () => {
  it('les intérêts de CE mois-là, et le surplus en assurance', () => {
    const cinquieme = ECHEANCIER[4]
    const d = decoupagePourEcheance(cinquieme, mouvement())
    expect(d.echeance).toBe(5)
    expect(d.interets).toBe(cinquieme.interets)
    expect(Math.round((d.interets + d.assurance + capitalDeLEcheance(mouvement(), d)) * 100)).toBe(54000)
    expect(capitalDeLEcheance(mouvement(), d)).toBe(cinquieme.capitalRembourse)
  })

  it('la dernière échéance solde le capital : ce qu’elle attend n’est pas la mensualité', () => {
    const derniere = ECHEANCIER[ECHEANCIER.length - 1]
    expect(montantAttendu(derniere)).toBe(Math.round((derniere.interets + derniere.capitalRembourse) * 100) / 100)
    expect(montantAttendu(derniere)).not.toBe(derniere.mensualite)
    // Payée pile, elle ne porte aucune assurance.
    expect(decoupagePourEcheance(derniere, mouvement({ montant: -montantAttendu(derniere) })).assurance).toBe(0)
  })
})

describe('empruntPlausible — de quoi déplier la fiche et écarter le mouvement du lot, jamais de quoi écrire', () => {
  const premiere = ECHEANCIER[0]
  const attendue = montantAttendu(premiere)

  it('un prélèvement à quelques jours d’une échéance libre, de son montant ou un peu plus', () => {
    expect(empruntPlausible(mouvement(), [EMPRUNT], [])).toEqual({ emprunt: EMPRUNT, echeance: premiere })
    expect(empruntPlausible(mouvement({ montant: -attendue }), [EMPRUNT], [])?.echeance?.numero).toBe(1)
  })

  it('les bornes : 90 % et une fois et demie de ce que l’échéancier prévoit, à la marge près en date', () => {
    const a90 = Math.ceil(attendue * 90) / 100
    expect(empruntPlausible(mouvement({ montant: -a90 }), [EMPRUNT], [])).not.toBeNull()
    expect(empruntPlausible(mouvement({ montant: -(a90 - 0.01) }), [EMPRUNT], [])).toBeNull()
    const a150 = Math.floor(attendue * 150) / 100
    expect(empruntPlausible(mouvement({ montant: -a150 }), [EMPRUNT], [])).not.toBeNull()
    expect(empruntPlausible(mouvement({ montant: -(a150 + 0.01) }), [EMPRUNT], [])).toBeNull()
    // L'échéance 1 tombe le 5 février : à la marge près, oui ; un jour de plus, non — et l'échéance 2,
    // le 5 mars, est alors trop loin elle aussi.
    expect(empruntPlausible(mouvement({ date: '2025-02-15' }), [EMPRUNT], [])).not.toBeNull()
    expect(empruntPlausible(mouvement({ date: '2025-02-16' }), [EMPRUNT], [])).toBeNull()
    expect(MARGE_PRELEVEMENT_JOURS).toBe(10)
  })

  it('pas une échéance qu’un autre mouvement paie déjà : la suivante, si elle est assez proche', () => {
    const payee = rapproche({ id: 'autre', date: '2025-02-05', emprunt_echeance: 1 })
    expect(empruntPlausible(mouvement(), [EMPRUNT], [payee])).toBeNull()
    expect(empruntPlausible(mouvement({ date: '2025-03-01' }), [EMPRUNT], [payee])?.echeance?.numero).toBe(2)
    // Le mouvement lui-même ne s'occupe pas : déjà rapproché de l'échéance 1, il y ressemble toujours.
    expect(empruntPlausible(mouvement(), [EMPRUNT], [rapproche({ emprunt_echeance: 1 })])?.echeance?.numero).toBe(1)
  })

  it('de deux emprunts, celui dont l’échéance est la plus proche en date', () => {
    const autre: Emprunt = { ...EMPRUNT, id: 'emp2', nom: 'Prêt travaux', date_debut: '2025-01-03' }
    expect(empruntPlausible(mouvement({ date: '2025-02-04' }), [EMPRUNT, autre], [])?.emprunt.id).toBe('emp1')
    expect(empruntPlausible(mouvement({ date: '2025-02-03' }), [EMPRUNT, autre], [])?.emprunt.id).toBe('emp2')
    // À égalité, le premier de la liste — l'ordre de lecture, par date de début.
    expect(empruntPlausible(mouvement({ date: '2025-02-04' }), [autre, EMPRUNT], [])?.emprunt.id).toBe('emp2')
  })

  it('un déblocage : un encaissement près du début, d’au moins un dixième du capital, dans ce qui reste à débloquer', () => {
    const encaissement = (o: Partial<MouvementBancaire> = {}) => mouvement({ montant: 12000, date: '2025-01-07', ...o })
    expect(empruntPlausible(encaissement(), [EMPRUNT], [])).toEqual({ emprunt: EMPRUNT, echeance: null })
    expect(empruntPlausible(encaissement({ montant: 1200 }), [EMPRUNT], [])).not.toBeNull()
    expect(empruntPlausible(encaissement({ montant: 1199.99 }), [EMPRUNT], [])).toBeNull()
    expect(empruntPlausible(encaissement({ montant: 12000.01 }), [EMPRUNT], [])).toBeNull()
    expect(empruntPlausible(encaissement({ date: '2025-02-05' }), [EMPRUNT], [])).not.toBeNull()
    expect(empruntPlausible(encaissement({ date: '2025-02-06' }), [EMPRUNT], [])).toBeNull()
    expect(JOURS_DEBLOCAGE_PLAUSIBLE).toBe(31)
    // Une première tranche déjà rapprochée : il ne reste que 4 000 € à débloquer.
    const tranche = rapproche({ id: 't1', montant: 8000, emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 })
    expect(empruntPlausible(encaissement({ montant: 4000 }), [EMPRUNT], [tranche])).not.toBeNull()
    expect(empruntPlausible(encaissement({ montant: 4000.01 }), [EMPRUNT], [tranche])).toBeNull()
    // Ce qui ne compte pas dans le déjà-débloqué : une échéance, un autre emprunt, le mouvement lui-même.
    expect(empruntPlausible(encaissement({ id: 't1' }), [EMPRUNT], [tranche])).not.toBeNull()
    expect(empruntPlausible(encaissement(), [EMPRUNT], [{ ...tranche, emprunt_id: 'autre' }, rapproche({ id: 'e1' })])).not.toBeNull()
    // Une tranche encore à traiter n'est pas débloquée.
    expect(empruntPlausible(encaissement({ montant: 4000.01 }), [EMPRUNT], [{ ...tranche, statut: 'non_rapprochee', emprunt_id: null }])).not.toBeNull()
  })

  it('rien pour un mouvement de zéro euro, ni sans emprunt', () => {
    expect(empruntPlausible(mouvement({ montant: 0 }), [EMPRUNT], [])).toBeNull()
    expect(empruntPlausible(mouvement(), [], [])).toBeNull()
  })

  it('la raison que le lot des règles affiche, échéance ou déblocage', () => {
    expect(raisonEmpruntPlausible({ emprunt: EMPRUNT, echeance: premiere }))
      .toBe('Il ressemble à l’échéance n° 1 de l’emprunt « Prêt matériel » : à rapprocher de l’emprunt, pas à affecter — son capital compterait en charge.')
    expect(raisonEmpruntPlausible({ emprunt: EMPRUNT, echeance: null })).toMatch(/déblocage de l’emprunt « Prêt matériel ».*pas une recette/)
  })
})

describe('echeancesOccupees et decoupageDuMouvement', () => {
  it('les échéances de CET emprunt payées par un AUTRE mouvement', () => {
    const lignes = [
      rapproche({ id: 'a', date: '2025-02-06', emprunt_echeance: 1 }),
      rapproche({ id: 'b', date: '2025-03-06', emprunt_echeance: 2 }),
      rapproche({ id: 'c', date: '2025-03-06', emprunt_id: 'autre', emprunt_echeance: 3 }),
      rapproche({ id: 'd', montant: 12000, emprunt_echeance: null }),
    ]
    expect([...echeancesOccupees(lignes, 'emp1', null)]).toEqual([[1, '2025-02-06'], [2, '2025-03-06']])
    expect([...echeancesOccupees(lignes, 'emp1', 'a')]).toEqual([[2, '2025-03-06']])
  })

  it('le découpage gardé sur le mouvement, nul sans emprunt', () => {
    expect(decoupageDuMouvement(rapproche())).toEqual({ echeance: 1, interets: 36, assurance: 21.03 })
    expect(decoupageDuMouvement(mouvement())).toBeNull()
  })
})

describe('partsDesEcheances — ce que la 2035 compte d’une échéance', () => {
  it('les intérêts en frais financiers, l’assurance en primes, jamais le capital', () => {
    expect(partsDesEcheances([rapproche()]).map((p) => [p.libelle, p.poste, p.montantPoste])).toEqual([
      [LIBELLE_INTERETS_EMPRUNT, POSTE_INTERETS_EMPRUNT, 36],
      [LIBELLE_ASSURANCE_EMPRUNT, POSTE_ASSURANCE_EMPRUNT, 21.03],
    ])
  })

  it('pas de part à zéro, rien pour un déblocage ni pour un mouvement qui n’est pas rapproché', () => {
    expect(partsDesEcheances([rapproche({ emprunt_assurance: 0 })]).map((p) => p.poste)).toEqual([POSTE_INTERETS_EMPRUNT])
    expect(partsDesEcheances([rapproche({ montant: 12000, emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 })])).toEqual([])
    expect(partsDesEcheances([rapproche({ statut: 'non_rapprochee' }), mouvement()])).toEqual([])
  })

  it('partsDuReleve réunit les affectations et les échéances', () => {
    const categorie: Categorie = {
      id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
      compte_comptable: '627000', poste_2035: 'Frais financiers',
    }
    const parts = partsDuReleve([
      mouvement({ id: 'frais', statut: 'rapprochee', categorie_id: 'cat-frais', montant: -8.5 }),
      rapproche({ id: 'pret' }),
    ], [categorie], [], false)
    expect(parts.map((p) => [p.origine, p.ligne.id, p.libelle, p.poste, p.nature, p.montantPoste])).toEqual([
      ['affectation', 'frais', 'Frais bancaires', 'Frais financiers', 'depense', 8.5],
      ['emprunt', 'pret', LIBELLE_INTERETS_EMPRUNT, POSTE_INTERETS_EMPRUNT, 'depense', 36],
      ['emprunt', 'pret', LIBELLE_ASSURANCE_EMPRUNT, POSTE_ASSURANCE_EMPRUNT, 'depense', 21.03],
    ])
  })
})

describe('idsDeblocagesEmprunt — ce que la moyenne des encaissements ne doit pas compter', () => {
  it('le déblocage rapproché d’un emprunt, pas son échéance ni un encaissement ordinaire', () => {
    const lignes = [
      rapproche({ id: 'fonds', montant: 12000, emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 }),
      rapproche({ id: 'echeance' }),
      mouvement({ id: 'cpam', montant: 250, statut: 'rapprochee', categorie_id: 'c-recettes' }),
      mouvement({ id: 'a-traiter', montant: 12000 }),
    ]
    expect([...idsDeblocagesEmprunt(lignes)]).toEqual(['fonds'])
  })
})

describe('echeancesNonRapprochees — ce que l’échéancier prévoit et qu’aucun mouvement ne paie', () => {
  it('dans les bornes, sauf les échéances payées, reconnues à leur numéro', () => {
    const manquantes = echeancesNonRapprochees([EMPRUNT], [rapproche({ emprunt_echeance: 2, date: '2025-02-06' })], '2025-02-01', '2025-05-10')
    expect(manquantes.map((m) => m.echeance.numero)).toEqual([1, 3, 4])
  })

  it('les bornes sont incluses, et vides à l’envers', () => {
    expect(echeancesNonRapprochees([EMPRUNT], [], '2025-02-05', '2025-02-05').map((m) => m.echeance.numero)).toEqual([1])
    expect(echeancesNonRapprochees([EMPRUNT], [], '2025-03-01', '2025-02-01')).toEqual([])
  })

  it('par date, puis par nom d’emprunt', () => {
    const autre: Emprunt = { ...EMPRUNT, id: 'emp2', nom: 'Aménagement', date_debut: '2025-01-05' }
    const manquantes = echeancesNonRapprochees([EMPRUNT, autre], [], '2025-02-01', '2025-02-28')
    expect(manquantes.map((m) => m.emprunt.nom)).toEqual(['Aménagement', 'Prêt matériel'])
  })

  it('un autre emprunt au même numéro ne paie pas celui-ci', () => {
    const manquantes = echeancesNonRapprochees([EMPRUNT], [rapproche({ emprunt_id: 'emp2', emprunt_echeance: 1 })], '2025-02-01', '2025-02-28')
    expect(manquantes.map((m) => m.echeance.numero)).toEqual([1])
  })
})

describe('couvertureDuReleve — ce que le relevé importé couvre', () => {
  it('du premier au dernier mouvement, moins la marge laissée au prélèvement', () => {
    expect(MARGE_PRELEVEMENT_JOURS).toBe(10)
    expect(couvertureDuReleve([mouvement({ date: '2025-03-31' }), mouvement({ date: '2025-01-02' }), mouvement({ date: '2025-02-14' })]))
      .toEqual({ debut: '2025-01-02', fin: '2025-03-21' })
  })

  it('rien sans mouvement', () => {
    expect(couvertureDuReleve([])).toBeNull()
  })
})

describe('echeancesDesynchronisees — l’écriture que le découpage produirait', () => {
  const justes = [
    ecriture({ id: 'e1', compte: '164000', sens: 'debit', montant: 482.97 }),
    ecriture({ id: 'e2', compte: '661100', sens: 'debit', montant: 36 }),
    ecriture({ id: 'e3', compte: '616800', sens: 'debit', montant: 21.03 }),
    ecriture({ id: 'e4', compte: '512000', sens: 'credit', montant: 540 }),
  ]

  it('se tait quand l’écriture est celle attendue, et sur un mouvement sans emprunt', () => {
    expect(echeancesDesynchronisees(justes, [rapproche()])).toEqual([])
    expect(echeancesDesynchronisees([], [mouvement()])).toEqual([])
  })

  it('signale une écriture absente, amputée, d’un autre montant ou à une autre date', () => {
    const cas: EcritureBrouillon[][] = [
      [],
      justes.slice(0, 3),
      justes.map((e) => (e.compte === '661100' ? { ...e, montant: 30 } : e)),
      justes.map((e) => ({ ...e, date: '2025-02-07' })),
    ]
    for (const ecritures of cas) expect(echeancesDesynchronisees(ecritures, [rapproche()]).map((l) => l.id)).toEqual(['l1'])
  })

  it('les lignes d’une pièce qui désignent le même mouvement n’en sont pas', () => {
    const avecPiece = [...justes, ecriture({ id: 'e5', piece_id: 'p1', compte: '606100', sens: 'debit', montant: 10 })]
    expect(echeancesDesynchronisees(avecPiece, [rapproche()])).toEqual([])
  })
})
