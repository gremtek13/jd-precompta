import { describe, expect, it } from 'vitest'
import { contenuADeclarer } from './declarationsEreporting'
import type { LigneDePeriode } from './ereportingEcran'
import {
  CODE_OPTION_DEBITS_DU_FICHIER, FUSEAU_DU_FICHIER, PAIEMENTS_NEGATIFS_DU_FICHIER, choixDuFichier, declarationDuFichierInscrit,
  donneesDuFichier, fichierADeposer, fichierDeLaDeclaration, nomDuFichierFrr, phraseDuFichierTire, refusDuFichier,
} from './fichierEreporting'
import { fichierFrr } from './fluxEreporting'
import { periodeDe } from './periodesEreporting'
import type { DeclarationEreportingHorsApplication } from './types'
import {
  CINQ_NOVEMBRE, DECLARATION_PAIEMENTS, MATRICULE_PLATEFORME_FRR, NOM_A, PLATEFORME_FRR, choixFrr,
} from '../test/fluxEreporting'

// LE FICHIER D'UNE DÉCLARATION, À L'ÉCRAN (étape e6b). Les attendus viennent des décisions du cabinet du 18/10/2026
// (E6-Q1 à E6-Q6, E6-Q8 ; HISTORIQUE.md, « LE FICHIER D'UNE DÉCLARATION D'E-REPORTING ») et du module du fichier, dont
// fluxEreporting.test.ts éprouve chaque règle : ici, ce que l'écran lui donne, et rien de recalculé.

const IDENTIFIANT = '0b6f6c1e-8a2a-4c1f-9d3e-5a7b9c1d2e3f'
const SAISIE = { matricule: ` ${MATRICULE_PLATEFORME_FRR} `, plateforme: ` ${PLATEFORME_FRR.nom} ` }
const DOSSIER = { denomination_imprimee: NOM_A }

/** La déclaration des paiements d'octobre 2027, telle que la base la garderait, avec l'identifiant de son fichier. */
function inscrite(o: Partial<DeclarationEreportingHorsApplication> = {}): DeclarationEreportingHorsApplication {
  return {
    id: DECLARATION_PAIEMENTS.id, dossier_id: 'd', objet: 'paiements', periode_debut: DECLARATION_PAIEMENTS.periode_debut,
    periode_fin: DECLARATION_PAIEMENTS.periode_fin, regime_id: 'r', type_transmission: 'IN', remplace_id: null, canal: 'manuel',
    plateforme: PLATEFORME_FRR.nom, contenu: DECLARATION_PAIEMENTS.contenu as Record<string, unknown>, empreinte: 'e', nb_operations: 1,
    etat: 'declaree', note: null, cree_par: null, cree_le: '2027-11-04T10:00:00Z', identifiant_fichier: IDENTIFIANT, ...o,
  }
}

describe('les choix du cabinet (18/10/2026)', () => {
  it('l’émetteur est la plateforme du dossier, sous son matricule saisi (E6-Q1) ; Paris, le code 5, le signe gardé', () => {
    expect(choixDuFichier(SAISIE)).toEqual(choixFrr())
    expect([FUSEAU_DU_FICHIER, CODE_OPTION_DEBITS_DU_FICHIER, PAIEMENTS_NEGATIFS_DU_FICHIER]).toEqual(['Europe/Paris', '5', 'ecrits_avec_leur_signe'])
  })

  it('sans matricule, ou sans raison sociale, le fichier se refuse avant le clic, avec où le corriger', () => {
    const d = declarationDuFichierInscrit(inscrite())
    if (d == null) throw new Error('la déclaration porte son identifiant')
    expect(refusDuFichier(donneesDuFichier(d, DOSSIER, SAISIE, CINQ_NOVEMBRE))).toEqual([])
    const sansMatricule = refusDuFichier(donneesDuFichier(d, DOSSIER, { ...SAISIE, matricule: '' }, CINQ_NOVEMBRE))
    expect(sansMatricule[0]).toContain('quatre chiffres, ceux de l’annuaire')
    const sansNom = refusDuFichier(donneesDuFichier(d, { denomination_imprimee: null }, SAISIE, CINQ_NOVEMBRE))
    expect(sansNom[0]).toContain('onglet Informations')
  })
})

describe('le fichier d’une déclaration inscrite : son contenu FIGÉ, sous l’identifiant qu’elle garde', () => {
  it('le XML est celui du module sur la ligne de la base, l’identifiant du fichier en TT-1 ; la raison sociale telle quelle', () => {
    const d = declarationDuFichierInscrit(inscrite())
    if (d == null) throw new Error('la déclaration porte son identifiant')
    const r = fichierDeLaDeclaration(donneesDuFichier(d, DOSSIER, SAISIE, CINQ_NOVEMBRE))
    expect(r.refus).toEqual([])
    expect(r.xml).toBe(fichierFrr({ declaration: { ...DECLARATION_PAIEMENTS, id: IDENTIFIANT }, nomDuDeclarant: NOM_A, maintenant: CINQ_NOVEMBRE, choix: choixFrr() }).xml)
    expect(r.xml).toContain(`>${IDENTIFIANT}<`)
    expect(r.xml).not.toContain(`>${DECLARATION_PAIEMENTS.id}<`)
  })

  it('inscrite sans fichier tiré d’ici : aucun fichier ; remplacée : refusée (E6-Q6)', () => {
    expect(declarationDuFichierInscrit(inscrite({ identifiant_fichier: null }))).toBeNull()
    expect(declarationDuFichierInscrit(inscrite({ identifiant_fichier: undefined }))).toBeNull()
    const remplacee = declarationDuFichierInscrit(inscrite({ etat: 'remplacee' }))
    if (remplacee == null) throw new Error('la déclaration porte son identifiant')
    expect(refusDuFichier(donneesDuFichier(remplacee, DOSSIER, SAISIE, CINQ_NOVEMBRE))[0]).toContain('remplacée par une rectificative')
  })
})

describe('le fichier d’une période à déclarer : le contenu qu’elle figera, sous l’identifiant tiré (E6-Q8)', () => {
  const periode = periodeDe('2027-10-01', 'mois')
  if (periode == null) throw new Error('octobre 2027 est une période')
  const calcul = {
    objet: 'paiements' as const, obligation: 'due' as const, frequence: { frequence: 'mois' as const, certitude: 'confirmee' as const, raison: null },
    periode,
    regime: null, etat: 'a_declarer' as const, refus: [], contenu: null, ecartees: [],
  }
  const contenu = DECLARATION_PAIEMENTS.contenu as Record<string, unknown>
  const { version: _v, objet: _o, debut: _d, fin: _f, ...duCalcul } = contenu
  const ligne = (o: Partial<LigneDePeriode> = {}): LigneDePeriode => ({
    objet: 'paiements', periode: calcul.periode, calcul: { ...calcul, contenu: duCalcul } as unknown as LigneDePeriode['calcul'],
    chaine: [], active: null, etat: null, resume: { code: 'a_declarer', libelle: '', ton: 'attention', detail: null }, ...o,
  })

  it('une initiale : IN, rien de remplacé, le contenu sous sa forme figée — celui que la déclaration gardera', () => {
    const f = fichierADeposer(ligne(), IDENTIFIANT)
    expect(f?.declaration).toEqual({
      id: IDENTIFIANT, objet: 'paiements', periode_debut: '2027-10-01', periode_fin: '2027-10-31', type_transmission: 'IN',
      remplace_id: null, etat: 'declaree', contenu: contenuADeclarer(ligne().calcul),
    })
    expect(f?.declaration.contenu).toEqual(contenu)
    const r = fichierDeLaDeclaration(donneesDuFichier(f?.declaration ?? inscrite(), DOSSIER, SAISIE, CINQ_NOVEMBRE))
    expect(r.refus).toEqual([])
  })

  it('une rectificative : RE, l’active remplacée ; une ligne qui ne se déclare pas n’a pas de fichier', () => {
    const active = inscrite()
    const etat = { etat: 'a_rectifier' as const, differences: [], causes: [], refus: [], motifs: [] }
    expect(fichierADeposer(ligne({ active, etat }), IDENTIFIANT)?.declaration).toMatchObject({ type_transmission: 'RE', remplace_id: active.id })
    expect(fichierADeposer(ligne({ active, etat: { ...etat, etat: 'a_jour' } }), IDENTIFIANT)).toBeNull()
    expect(fichierADeposer(ligne({ calcul: { ...ligne().calcul, etat: 'rien_a_declarer' } }), IDENTIFIANT)).toBeNull()
  })
})

describe('le nom du fichier : l’objet et la période, jamais le dossier', () => {
  it('initiale et rectificative', () => {
    expect(nomDuFichierFrr('paiements', { debut: '2027-10-01', fin: '2027-10-31' }, 'IN')).toBe('e-reporting-paiements-2027-10-01-2027-10-31.xml')
    expect(nomDuFichierFrr('achats', { debut: '2027-10-01', fin: '2027-10-10' }, 'RE')).toBe('e-reporting-achats-2027-10-01-2027-10-10-rectificative.xml')
  })

  it('la phrase du fichier tiré dit ce que la déclaration gardera, et un calcul changé depuis', () => {
    expect(phraseDuFichierTire('f.xml', IDENTIFIANT, false)).toContain(`identifiant ${IDENTIFIANT}`)
    expect(phraseDuFichierTire('f.xml', IDENTIFIANT, false)).not.toContain('à rectifier')
    expect(phraseDuFichierTire('f.xml', IDENTIFIANT, true)).toContain('« à rectifier »')
  })
})
