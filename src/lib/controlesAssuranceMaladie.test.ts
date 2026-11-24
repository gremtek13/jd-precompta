import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTROLES_ASSURANCE_MALADIE_PREVUS, citationDesPaiements, citationsDeLaPiste, citerLesPaiementsDansLaPiste, classementDuCredit,
  controlesDeLAssuranceMaladie, detailDesAssociationsARevoir, detailDesCreditsHorsDesImports, detailDesCreditsSansPaiement,
  detailDesExercicesEnEcart, detailDesPaiementsSansCredit, nombresDesControles, phraseDuSilence, retenusDeLaChecklist,
  type ControlesCalcules, type EntreeDesControles, type LectureDesControles, type MouvementControle,
} from './controlesAssuranceMaladie'
import { genererPisteAuditCsv, type LignePisteAudit } from './pisteAudit'
import type { AssociationDuRapprochement, PaiementDuRapprochement } from './rapprochementAssuranceMaladie'

// LES CONTRÔLES DES PAIEMENTS DE L'ASSURANCE MALADIE (NOE6) ET LEUR CITATION DANS LA PISTE D'AUDIT. Données fictives : aucun
// libellé de ces essais ne vient d'un relevé réel ; le nom qui y figure (« PATIENT FICTIF ») sert à prouver qu'aucun mot ne
// le recopie.

const NOM = 'PATIENT FICTIF'

function mouvement(o: Partial<MouvementControle>): MouvementControle {
  return {
    id: 'm1', date: '2026-03-04', libelle: `VIR CPAM 75 REF 260302 ${NOM}`, libelle_brut: null, montant: 123.45, statut: 'rapprochee',
    prelevement_personnel: false, encaissements_de_factures: false, piece_id: null, categorie_id: 'recette', ventilee: false,
    cotisation_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, reglement_groupe: false, ...o,
  }
}

function paiement(o: Partial<PaiementDuRapprochement>): PaiementDuRapprochement {
  return {
    id: 'p1', date_journee_comptable: '2026-03-02', regime: 1, caisse: 751, organisme_complementaire: null, part: 'obligatoire',
    montant_centimes: 12345, nombre_de_factures: 7, ...o,
  }
}

const IMPORT_DE_MARS = { periode_du: '2026-03-01', periode_au: '2026-03-31' }

function lu(o: { paiements?: PaiementDuRapprochement[]; associations?: AssociationDuRapprochement[]; imports?: typeof IMPORT_DE_MARS[]; complets?: Partial<Record<'imports' | 'paiements' | 'associations', boolean>> } = {}): LectureDesControles {
  return {
    etat: 'lus',
    imports: { lignes: o.imports ?? [IMPORT_DE_MARS], complete: o.complets?.imports ?? true, motif: null },
    paiements: { lignes: o.paiements ?? [], complete: o.complets?.paiements ?? true, motif: null },
    associations: { lignes: o.associations ?? [], complete: o.complets?.associations ?? true, motif: null },
  }
}

function entree(o: Partial<EntreeDesControles> = {}): EntreeDesControles {
  return {
    drapeau: true, offre: { codeNaf: '86.90E', moduleOuvert: true }, lu: lu(),
    releve: { lignes: [], complete: true }, retenusParLesVentes: new Set(),
    categories: [{ id: 'recette', compte_comptable: '706000' }, { id: 'charge', compte_comptable: '627000' }],
    ventilations: { lignes: [], complete: true }, anneesValidees: [], jour: '2026-11-20', ...o,
  }
}

const calcules = (e: EntreeDesControles): ControlesCalcules => {
  const r = controlesDeLAssuranceMaladie(e)
  if (r.etat !== 'calcules') throw new Error(`attendu calculé, rendu ${r.etat}`)
  return r
}

describe('ce qui offre les contrôles', () => {
  it('le drapeau de NOE6 est levé depuis la relecture du 24/11/2026', () => {
    expect(CONTROLES_ASSURANCE_MALADIE_PREVUS).toBe(true)
  })

  it('drapeau baissé, module fermé, rien de lu, ou un code hors de la santé sans import : sans objet', () => {
    expect(controlesDeLAssuranceMaladie(entree({ drapeau: false })).etat).toBe('sans_objet')
    expect(controlesDeLAssuranceMaladie(entree({ offre: { codeNaf: '86.90E', moduleOuvert: false } })).etat).toBe('sans_objet')
    expect(controlesDeLAssuranceMaladie(entree({ lu: null })).etat).toBe('sans_objet')
    expect(controlesDeLAssuranceMaladie(entree({ offre: { codeNaf: '62.01Z', moduleOuvert: true }, lu: lu({ imports: [] }) })).etat).toBe('sans_objet')
    expect(controlesDeLAssuranceMaladie(entree({ offre: { codeNaf: undefined, moduleOuvert: true }, lu: lu({ imports: [] }) })).etat).toBe('sans_objet')
  })

  it('un code hors de la santé, mais un import déjà en base : calculés (la règle de la section, NOE4Q1-Q2)', () => {
    expect(controlesDeLAssuranceMaladie(entree({ offre: { codeNaf: '62.01Z', moduleOuvert: true } })).etat).toBe('calcules')
  })
})

describe('muet sur toute lecture partielle', () => {
  it('le relevé, les paiements, les associations, les imports, les ventes, ou une lecture refusée', () => {
    const muets: EntreeDesControles[] = [
      entree({ releve: { lignes: [mouvement({})], complete: false } }),
      entree({ lu: lu({ complets: { paiements: false } }) }),
      entree({ lu: lu({ complets: { associations: false } }) }),
      entree({ lu: lu({ complets: { imports: false } }) }),
      entree({ retenusParLesVentes: null }),
      entree({ lu: { etat: 'echec', motif: 'refus de la base' } }),
    ]
    for (const e of muets) expect(controlesDeLAssuranceMaladie(e).etat).toBe('muet')
    expect(nombresDesControles({ etat: 'muet', raison: 'x' })).toEqual({
      creditsSansPaiement: 0, creditsHorsDesImports: 0, paiementsSansCredit: 0, associationsARevoir: 0, exercicesEnEcart: 0,
    })
  })

  it('les ventilations lues en partie ne taisent que la confrontation de l’exercice', () => {
    const r = calcules(entree({ releve: { lignes: [mouvement({ categorie_id: null, ventilee: true })], complete: true }, ventilations: { lignes: [], complete: false } }))
    expect(r.exercicesEnEcart).toBeNull()
    expect(r.creditsSansPaiement).toHaveLength(1)
  })
})

describe('le contrôle 1 : le crédit sans paiement, le paiement sans crédit, l’association qui ne tient plus', () => {
  it('un crédit de la CPAM dans la période d’un import, sans paiement : « sans paiement » ; hors de toute période : « hors des imports »', () => {
    const r = calcules(entree({
      releve: { lignes: [mouvement({}), mouvement({ id: 'm2', date: '2026-01-10', montant: 50 })], complete: true },
    }))
    expect(r.creditsSansPaiement.map((c) => c.mouvementId)).toEqual(['m1'])
    expect(r.creditsHorsDesImports.map((c) => c.mouvementId)).toEqual(['m2'])
  })

  it('la période d’un import couvre le crédit jusqu’à cinq jours après sa fin', () => {
    const fin = (date: string) => calcules(entree({ releve: { lignes: [mouvement({ date })], complete: true } }))
    expect(fin('2026-04-05').creditsSansPaiement).toHaveLength(1)
    expect(fin('2026-04-06').creditsHorsDesImports).toHaveLength(1)
  })

  it('un crédit qui a son paiement candidat ne manque de rien ; tant qu’il n’est pas associé, la confrontation le dit', () => {
    const r = calcules(entree({ lu: lu({ paiements: [paiement({})] }), releve: { lignes: [mouvement({})], complete: true } }))
    expect(nombresDesControles(r)).toEqual({ creditsSansPaiement: 0, creditsHorsDesImports: 0, paiementsSansCredit: 0, associationsARevoir: 0, exercicesEnEcart: 1 })
    const associe = calcules(entree({
      lu: lu({ paiements: [paiement({})], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }] }), releve: { lignes: [mouvement({})], complete: true },
    }))
    expect(nombresDesControles(associe)).toEqual({ creditsSansPaiement: 0, creditsHorsDesImports: 0, paiementsSansCredit: 0, associationsARevoir: 0, exercicesEnEcart: 0 })
  })

  it('un paiement sans crédit ne se dit que quand le relevé va au-delà de sa date, et jamais dans un exercice validé', () => {
    const autre = mouvement({ id: 'autre', libelle: 'PRLV FICTIF', montant: -10, date: '2026-03-20' })
    const avant = calcules(entree({ lu: lu({ paiements: [paiement({})] }), releve: { lignes: [mouvement({ id: 'x', libelle: 'PRLV FICTIF', montant: -10, date: '2026-03-03' })], complete: true } }))
    expect(avant.paiementsSansCredit).toHaveLength(0)
    const apres = calcules(entree({ lu: lu({ paiements: [paiement({})] }), releve: { lignes: [autre], complete: true } }))
    expect(apres.paiementsSansCredit.map((p) => p.paiementId)).toEqual(['p1'])
    const valide = calcules(entree({ lu: lu({ paiements: [paiement({})] }), releve: { lignes: [autre], complete: true }, anneesValidees: [2026] }))
    expect(valide.paiementsSansCredit).toHaveLength(0)
  })

  it('le paiement du 30 décembre attend encore un crédit de janvier : l’exercice suivant n’étant pas validé, il se dit', () => {
    const p = paiement({ date_journee_comptable: '2026-12-30' })
    const janvier = mouvement({ id: 'j', libelle: 'PRLV FICTIF', montant: -10, date: '2027-01-20' })
    const r = calcules(entree({ lu: lu({ paiements: [p], imports: [{ periode_du: '2026-12-01', periode_au: '2026-12-31' }] }), releve: { lignes: [janvier], complete: true }, anneesValidees: [2026], jour: '2027-02-01' }))
    expect(r.paiementsSansCredit).toHaveLength(1)
  })

  // Le crédit d'un exercice validé ne s'associe plus (la base le refuse) : le paiement qu'il verse resterait libre pour toujours,
  // et se dirait « qu'aucun crédit ne verse » jusqu'à la validation de l'exercice suivant. Il se tait.
  it('le paiement du 29 décembre que verse un crédit du 30, dans un exercice validé : rien ne se dit', () => {
    const p = paiement({ date_journee_comptable: '2026-12-29' })
    const decembre = mouvement({ id: 'd', date: '2026-12-30' })
    const janvier = mouvement({ id: 'j', libelle: 'PRLV FICTIF', montant: -10, date: '2027-01-20' })
    const imports = [{ periode_du: '2026-12-01', periode_au: '2026-12-31' }]
    const r = calcules(entree({ lu: lu({ paiements: [p], imports }), releve: { lignes: [decembre, janvier], complete: true }, anneesValidees: [2026], jour: '2027-02-01' }))
    expect(r.paiementsSansCredit).toHaveLength(0)
    // Le même crédit, un autre montant et un libellé qui ne nomme pas l'assurance maladie : ce n'est pas lui, le paiement se dit.
    const autre = mouvement({ id: 'd', date: '2026-12-30', montant: 99, libelle: 'VIR FICTIF' })
    expect(calcules(entree({ lu: lu({ paiements: [p], imports }), releve: { lignes: [autre, janvier], complete: true }, anneesValidees: [2026], jour: '2027-02-01' }))
      .paiementsSansCredit).toHaveLength(1)
    // L'exercice n'est pas validé : le crédit s'associe, et le paiement a son candidat.
    expect(calcules(entree({ lu: lu({ paiements: [p], imports }), releve: { lignes: [decembre, janvier], complete: true }, jour: '2027-02-01' }))
      .paiementsSansCredit).toHaveLength(0)
  })

  it('un paiement négatif (une reprise de l’assurance maladie) sans débit qui le fasse se dit sous son montant signé', () => {
    const p = paiement({ montant_centimes: -2500, nombre_de_factures: 0, date_journee_comptable: '2026-03-02' })
    const autre = mouvement({ id: 'autre', libelle: 'PRLV FICTIF', montant: -10, date: '2026-03-20' })
    const r = calcules(entree({ lu: lu({ paiements: [p] }), releve: { lignes: [autre], complete: true } }))
    expect(r.paiementsSansCredit.map((c) => c.montantCentimes)).toEqual([-2500])
    expect(detailDesPaiementsSansCredit(r)).toMatch(/[-−]\s?25,00/)
  })

  it('une association d’un crédit écarté, ou dont les paiements ne font plus le montant : à revoir', () => {
    const r = calcules(entree({
      lu: lu({ paiements: [paiement({}), paiement({ id: 'p2', montant_centimes: 999 })], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }, { paiement_id: 'p2', ligne_bancaire_id: 'm2' }] }),
      releve: { lignes: [mouvement({ statut: 'ignoree' }), mouvement({ id: 'm2', montant: 20 })], complete: true },
    }))
    expect(r.associationsARevoir.map((a) => a.genre).sort()).toEqual(['association_contredite', 'association_incoherente'])
  })
})

describe('le contrôle 2 : l’exercice, à la date du crédit', () => {
  it('un crédit associé classé hors des recettes sépare les deux totaux', () => {
    const r = calcules(entree({
      lu: lu({ paiements: [paiement({})], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }] }),
      releve: { lignes: [mouvement({ categorie_id: 'charge' })], complete: true },
    }))
    expect(r.exercicesEnEcart).toEqual([{
      annee: 2026, paiementsAssociesCentimes: 12345, creditsEnRecetteCentimes: 0,
      associesHorsRecette: [{ mouvementId: 'm1', date: '2026-03-04', montantCentimes: 12345 }], enRecetteSansPaiement: [], associesEnEcart: [],
      associesAClasser: 0,
    }])
  })

  it('associé et classé en recette : aucun écart ; un crédit de la CPAM en recette sans paiement associé : un écart', () => {
    const tenu = calcules(entree({
      lu: lu({ paiements: [paiement({})], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }] }),
      releve: { lignes: [mouvement({})], complete: true },
    }))
    expect(tenu.exercicesEnEcart).toEqual([])
    const seul = calcules(entree({ releve: { lignes: [mouvement({})], complete: true } }))
    expect(seul.exercicesEnEcart?.[0]).toMatchObject({ annee: 2026, paiementsAssociesCentimes: 0, creditsEnRecetteCentimes: 12345 })
  })

  it('un crédit associé pas encore classé reste hors de la confrontation, et se compte', () => {
    const r = calcules(entree({
      lu: lu({ paiements: [paiement({}), paiement({ id: 'p2', date_journee_comptable: '2026-03-09', montant_centimes: 500 })], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }, { paiement_id: 'p2', ligne_bancaire_id: 'm2' }] }),
      releve: { lignes: [mouvement({ statut: 'non_rapprochee', categorie_id: null }), mouvement({ id: 'm2', date: '2026-03-10', montant: 5, categorie_id: 'charge' })], complete: true },
    }))
    expect(r.exercicesEnEcart?.[0]).toMatchObject({ paiementsAssociesCentimes: 500, creditsEnRecetteCentimes: 0, associesAClasser: 1 })
  })

  it('la frontière du 31 décembre se juge sur la date du crédit, jamais sur la journée comptable', () => {
    const r = calcules(entree({
      lu: lu({ paiements: [paiement({ date_journee_comptable: '2026-12-30' })], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }], imports: [] }),
      releve: { lignes: [mouvement({ date: '2027-01-02', categorie_id: 'charge' })], complete: true }, jour: '2027-02-01',
    }))
    expect(r.exercicesEnEcart?.map((x) => x.annee)).toEqual([2027])
  })

  it('un exercice validé ne se confronte plus', () => {
    const r = calcules(entree({ releve: { lignes: [mouvement({})], complete: true }, anneesValidees: [2026] }))
    expect(r.exercicesEnEcart).toEqual([])
  })

  it('le classement : la catégorie, la ventilation entière, les autres liens, et ce qui ne se juge pas', () => {
    const categories = new Map([['recette', { compte_comptable: '706000' }], ['charge', { compte_comptable: '627000' }]])
    const parts = new Map([['v', [{ categorie_id: 'recette', part_personnelle: false }, { categorie_id: 'recette', part_personnelle: false }]], ['w', [{ categorie_id: 'recette', part_personnelle: false }, { categorie_id: null, part_personnelle: true }]]])
    expect(classementDuCredit(mouvement({}), categories, parts)).toBe('recette')
    expect(classementDuCredit(mouvement({ categorie_id: 'charge' }), categories, parts)).toBe('hors_recette')
    expect(classementDuCredit(mouvement({ categorie_id: 'inconnue' }), categories, parts)).toBe('non_juge')
    expect(classementDuCredit(mouvement({ id: 'v', categorie_id: null, ventilee: true }), categories, parts)).toBe('recette')
    expect(classementDuCredit(mouvement({ id: 'w', categorie_id: null, ventilee: true }), categories, parts)).toBe('hors_recette')
    expect(classementDuCredit(mouvement({ categorie_id: null, compte_bilan: '455000' }), categories, parts)).toBe('hors_recette')
    expect(classementDuCredit(mouvement({ categorie_id: null, piece_id: 'piece' }), categories, parts)).toBe('non_juge')
    expect(classementDuCredit(mouvement({ statut: 'non_rapprochee', categorie_id: null }), categories, parts)).toBe('a_classer')
    expect(classementDuCredit(mouvement({ prelevement_personnel: true }), categories, parts)).toBe('non_juge')
  })
})

describe('les mots : des dates et des montants, jamais un libellé', () => {
  it('aucun détail ne recopie le libellé du relevé', () => {
    const r = calcules(entree({
      lu: lu({ paiements: [paiement({ id: 'p9', date_journee_comptable: '2026-03-20', montant_centimes: 777 }), paiement({ id: 'p2', montant_centimes: 999 })], associations: [{ paiement_id: 'p2', ligne_bancaire_id: 'm3' }] }),
      releve: { lignes: [mouvement({}), mouvement({ id: 'm2', date: '2026-01-10', montant: 50 }), mouvement({ id: 'm3', montant: 20, categorie_id: 'charge' }), mouvement({ id: 'z', libelle: `PRLV ${NOM}`, montant: -1, date: '2026-04-30' })], complete: true },
    }))
    const details = [detailDesCreditsSansPaiement(r), detailDesCreditsHorsDesImports(r), detailDesPaiementsSansCredit(r), detailDesAssociationsARevoir(r), detailDesExercicesEnEcart(r)]
    expect(details.every((d) => typeof d === 'string' && d.length > 0)).toBe(true)
    for (const d of details) {
      expect(d).not.toContain(NOM)
      expect(d).not.toContain('CPAM 75')
    }
    expect(detailDesCreditsSansPaiement(r)).toContain('04/03/2026')
  })

  it('un seul : « Le crédit du », « La journée comptable du » ; plusieurs : au pluriel, les plus anciennes d’abord', () => {
    const autre = mouvement({ id: 'autre', libelle: 'PRLV FICTIF', montant: -10, date: '2026-03-28' })
    const un = calcules(entree({ lu: lu({ paiements: [paiement({})] }), releve: { lignes: [mouvement({ montant: 50 }), autre], complete: true } }))
    expect(detailDesCreditsSansPaiement(un)).toMatch(/^Le crédit du 04\/03\/2026 /)
    expect(detailDesPaiementsSansCredit(un)).toMatch(/^La journée comptable du 02\/03\/2026 \([^)]*\)\. Un mois/)
    const deux = calcules(entree({
      lu: lu({ paiements: [paiement({}), paiement({ id: 'p2', date_journee_comptable: '2026-03-03', montant_centimes: 333 })] }),
      releve: { lignes: [mouvement({ montant: 50 }), mouvement({ id: 'm2', date: '2026-03-05', montant: 60 }), autre], complete: true },
    }))
    expect(detailDesCreditsSansPaiement(deux)).toMatch(/^Les crédits du 04\/03\/2026 .*, 05\/03\/2026 /)
    expect(detailDesPaiementsSansCredit(deux)).toMatch(/^Les journées comptables du .*, les plus anciennes d’abord\./)
  })
})

describe('le silence se dit, à part', () => {
  it('muet : une phrase qui dit pourquoi ; calculé ou sans objet : rien', () => {
    const muet = controlesDeLAssuranceMaladie(entree({ lu: { etat: 'echec', motif: 'refus de la base' } }))
    expect(phraseDuSilence(muet)).toMatch(/^Les paiements de l’assurance maladie ne se lisent pas \(refus de la base\).*leur silence ne prouve rien/)
    expect(phraseDuSilence(controlesDeLAssuranceMaladie(entree({})))).toBeNull()
    expect(phraseDuSilence({ etat: 'sans_objet' })).toBeNull()
  })
})

describe('la retenue des ventes facturées', () => {
  it('un dossier qui n’a pas basculé n’en retient aucun ; une lecture partielle, nul', () => {
    expect(retenusDeLaChecklist(null)).toEqual(new Set())
    expect(retenusDeLaChecklist({ dossierId: 'd', etat: 'incomplete', motif: 'x' })).toBeNull()
  })
})

describe('la piste d’audit cite le paiement', () => {
  it('« Paiement de l’assurance maladie du JJ/MM/AAAA, N factures », sans organisme ni référence', () => {
    expect(citationDesPaiements([paiement({})])).toBe('Paiement de l’assurance maladie du 02/03/2026, 7 factures')
    expect(citationDesPaiements([paiement({ nombre_de_factures: 1 })])).toBe('Paiement de l’assurance maladie du 02/03/2026, 1 facture')
    expect(citationDesPaiements([paiement({}), paiement({ id: 'p2', part: 'complementaire', nombre_de_factures: 3 })]))
      .toBe('Paiements de l’assurance maladie du 02/03/2026, part complémentaire (3 factures) et part obligatoire (7 factures)')
    expect(citationDesPaiements([paiement({})])).not.toMatch(/751|régime|caisse/)
  })

  it('les citations : sans objet le drapeau baissé ou le module fermé ; refusées sur une lecture partielle', () => {
    const complet = lu({ paiements: [paiement({})], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }] })
    expect(citationsDeLaPiste(false, true, complet).etat).toBe('sans_objet')
    expect(citationsDeLaPiste(true, false, complet).etat).toBe('sans_objet')
    expect(citationsDeLaPiste(true, true, null).etat).toBe('sans_objet')
    expect(citationsDeLaPiste(true, true, lu({ complets: { associations: false } })).etat).toBe('refusee')
    expect(citationsDeLaPiste(true, true, lu({ complets: { paiements: false } })).etat).toBe('refusee')
    expect(citationsDeLaPiste(true, true, { etat: 'echec', motif: 'x' }).etat).toBe('refusee')
    expect(citationsDeLaPiste(true, true, lu({ associations: [{ paiement_id: 'absent', ligne_bancaire_id: 'm1' }] })).etat).toBe('refusee')
    const c = citationsDeLaPiste(true, true, complet)
    expect(c.etat === 'lues' && c.parMouvement.get('m1')).toBe('Paiement de l’assurance maladie du 02/03/2026, 7 factures')
  })

  it('seule la colonne du justificatif d’une écriture justifiée par le relevé change', () => {
    const base: LignePisteAudit = {
      ecritureId: 'e1', date: '2026-03-04', compte: '512000', libelle: 'Crédit du relevé du 04/03/2026', debit: 123.45, credit: 0,
      pieceId: null, pieceTiers: null, pieceDate: '2026-03-04', pieceMontantTtc: null, pieceFichier: 'Relevé du 04/03/2026',
      pieceEmpreinte: null, mouvementDate: '2026-03-04', mouvementLibelle: 'Crédit du relevé du 04/03/2026', mouvementMontant: 123.45, manque: [],
    }
    const avecPiece = { ...base, ecritureId: 'e2', pieceId: 'piece', pieceFichier: 'Pièce déposée le 01/03/2026, empreinte 01234567' }
    const autre = { ...base, ecritureId: 'e3' }
    const citations = citationsDeLaPiste(true, true, lu({ paiements: [paiement({})], associations: [{ paiement_id: 'p1', ligne_bancaire_id: 'm1' }] }))
    const ecritures = [{ id: 'e1', ligne_bancaire_id: 'm1' }, { id: 'e2', ligne_bancaire_id: 'm1' }, { id: 'e3', ligne_bancaire_id: 'm9' }]
    const [a, b, c] = citerLesPaiementsDansLaPiste([base, avecPiece, autre], ecritures, citations)
    expect(a).toEqual({ ...base, pieceFichier: 'Relevé du 04/03/2026 — Paiement de l’assurance maladie du 02/03/2026, 7 factures' })
    expect(b).toEqual(avecPiece)
    expect(c).toEqual(autre)
    expect(citerLesPaiementsDansLaPiste([base], ecritures, { etat: 'sans_objet' })).toEqual([base])
  })

  // Un dossier sans paiement associé (sans import, ou que la section n'offre pas) : le drapeau levé rend la piste d'hier, à
  // l'octet — les lignes à l'égalité stricte, et le CSV.
  it('sans association lue, la piste est celle d’hier, à l’octet', () => {
    const lignes: LignePisteAudit[] = [{
      ecritureId: 'e1', date: '2026-03-04', compte: '512000', libelle: 'Crédit du relevé du 04/03/2026', debit: 123.45, credit: 0,
      pieceId: null, pieceTiers: null, pieceDate: '2026-03-04', pieceMontantTtc: null, pieceFichier: 'Relevé du 04/03/2026',
      pieceEmpreinte: null, mouvementDate: '2026-03-04', mouvementLibelle: 'Crédit du relevé du 04/03/2026', mouvementMontant: 123.45, manque: [],
    }]
    const ecritures = [{ id: 'e1', ligne_bancaire_id: 'm1' }]
    const hier = citerLesPaiementsDansLaPiste(lignes, ecritures, citationsDeLaPiste(false, true, null))
    for (const lecture of [lu({ imports: [] }), lu({ paiements: [paiement({})] })]) {
      const aujourdHui = citerLesPaiementsDansLaPiste(lignes, ecritures, citationsDeLaPiste(true, true, lecture))
      expect(aujourdHui).toStrictEqual(hier)
      expect(genererPisteAuditCsv(aujourdHui)).toBe(genererPisteAuditCsv(hier))
    }
  })
})

// LE FEC NE CHANGE PAS (NOE-Q7, NOE-E3) : aucun module du FEC — ni ceux qu'il remet en forme pour un logiciel — ne lit les
// paiements de l'assurance maladie, ni leur citation. Le relevé part de TOUT `src/lib` : un fichier qui nomme le FEC dans son
// nom est jugé ; un plancher prouve que le relevé n'est pas aveugle.
describe('le FEC ne lit rien des paiements de l’assurance maladie', () => {
  const dossier = resolve(process.cwd(), 'src/lib')
  const modulesDuFec = readdirSync(dossier).filter((f) => /fec|profilsDExport|exportVersUnLogiciel/i.test(f) && !f.includes('.test.'))
  const interdits = /controlesAssuranceMaladie|rapprochementAssuranceMaladie|paiementsAssuranceMaladie|associationsAssuranceMaladie/

  it('aucun import, aucun nom', () => {
    expect(modulesDuFec.length).toBeGreaterThanOrEqual(4)
    expect(modulesDuFec).toContain('fec.ts')
    for (const f of modulesDuFec) expect([f, interdits.test(readFileSync(resolve(dossier, f), 'utf8'))]).toEqual([f, false])
  })

  it('un défaut planté se voit', () => {
    const texte = readFileSync(resolve(dossier, 'fec.ts'), 'utf8')
    expect(interdits.test(`import { citerLesPaiementsDansLaPiste } from './controlesAssuranceMaladie'\n${texte}`)).toBe(true)
  })
})
