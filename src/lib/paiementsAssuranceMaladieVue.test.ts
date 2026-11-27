import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import type { ImportAEnvoyer, LectureDesPaiements } from './paiementsAssuranceMaladie'
import {
  PRESENTATION_AU_CLIENT, SANS_LA_CASE_BANQUE, VIDE_DIT, confirmationDeLImport, confirmationDuRetrait, ecartsDits, genreDit,
  organismeDit, organismeDuPaiementDit, phraseApresLImport, refusDeLaTailleDesPaiements, reglageChoisi, reglageVide, rejetsDits,
  rejetsDuFichierDits,
} from './paiementsAssuranceMaladieVue'

// Les mots et les règles de l'écran d'import (NOE4) : rien n'est deviné (le réglage part vide, ce qui manque se dit) ; une
// colonne de noms se dit « texte » ; la confirmation nomme ce qui part et ce qui reste ; la phrase d'après l'import (NOE3-Q1) ;
// les phrases du client sans les mots du cabinet ; aucun écart ne porte une valeur.

const imp: ImportAEnvoyer = {
  version: 1,
  paiements: [
    { date_journee_comptable: '2026-11-02', regime: 1, caisse: 691, organisme_complementaire: null, part: 'obligatoire', montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2 },
    { date_journee_comptable: '2026-11-03', regime: 1, caisse: 691, organisme_complementaire: null, part: 'obligatoire', montant_centimes: -500, regularisations_centimes: -500, nombre_de_factures: 0 },
  ],
  rejets: { nombre: 2, montant_centimes: 1500 },
}

describe('le réglage des colonnes, à l’écran', () => {
  it('part vide : aucune part retenue, aucune colonne ; ce qui manque se dit, dans les deux espaces', () => {
    const vide = reglageVide()
    expect(vide.map((p) => [p.part, p.retenue, Object.values(p.colonnes).every((c) => c === null)]))
      .toEqual([['obligatoire', false, true], ['complementaire', false, true]])
    expect(reglageChoisi(vide, 'client').manque).toMatch(/^Coche la part obligatoire/)
    expect(reglageChoisi(vide, 'cabinet').manque).toMatch(/^Cocher la part obligatoire/)
    const sansMontant = vide.map((p, i) => (i === 0 ? { ...p, retenue: true, colonnes: { ...p.colonnes, journee: 3 } } : p))
    expect(reglageChoisi(sansMontant, 'client').manque).toBe('Choisis la colonne « Montant payé » de la part obligatoire.')
  })

  it('une part retenue avec sa journée et son montant donne le réglage du module, les colonnes au choix comprises', () => {
    const parts = reglageVide().map((p, i) => (i === 1 ? { ...p, retenue: true, colonnes: { ...p.colonnes, journee: 0, montant: 2, caisse: 4 } } : p))
    expect(reglageChoisi(parts, 'cabinet')).toEqual({
      manque: null,
      reglage: { parts: [{ part: 'complementaire', journee: 0, montant: 2, statut: null, regime: null, caisse: 4 }] },
    })
  })
})

describe('les mots de l’aperçu', () => {
  it('une colonne de noms se dit « texte », jamais « montant »', () => {
    expect(genreDit({ vide: false, date: false, montant: false, code: false, statut: false })).toBe('texte')
    expect(genreDit({ vide: true, date: false, montant: false, code: false, statut: false })).toBe('vide')
    expect(genreDit({ vide: false, date: false, montant: true, code: true, statut: false })).toBe('montant ou code en chiffres')
  })

  it('l’organisme et les rejets : un non-dit n’est jamais zéro', () => {
    expect(organismeDit(null, null)).toBe('non dit')
    expect(organismeDit(1, 691)).toBe('régime 1, caisse 691')
    // L'organisme complémentaire, dit quand il l'est (la migration amendée le 19/11/2026).
    expect(organismeDuPaiementDit({ regime: 1, caisse: 691, organisme_complementaire: null })).toBe('régime 1, caisse 691')
    expect(organismeDuPaiementDit({ regime: 1, caisse: 691, organisme_complementaire: 1234567890 })).toBe('régime 1, caisse 691, organisme complémentaire 1234567890')
    expect(organismeDuPaiementDit({ regime: null, caisse: null, organisme_complementaire: 1234567890 })).toBe('organisme complémentaire 1234567890')
    expect(organismeDuPaiementDit({ regime: null, caisse: null, organisme_complementaire: null })).toBe('non dit')
    expect(rejetsDits(null)).toBe('les rejets ne sont pas dits par le fichier')
    expect(rejetsDits({ nombre: null, montant_centimes: null })).toBe('les rejets ne sont pas dits par le fichier')
    expect(rejetsDits({ nombre: 0, montant_centimes: 0 })).toBe('aucun rejet')
    // NOE4R-Q1 (A) : la confirmation dit les rejets DU FICHIER, comme la base les garde.
    expect(rejetsDuFichierDits(null)).toBe('les rejets ne sont pas dits par le fichier')
    expect(rejetsDuFichierDits({ nombre: 0, montant_centimes: 0 })).toBe('aucun rejet dans le fichier')
    expect(rejetsDuFichierDits({ nombre: 2, montant_centimes: 1500 })).toMatch(/^rejets du fichier : 2 rejets, 15,00\s€$/)
  })

  it('les écarts se comptent par raison et par ligne, jamais avec une valeur', () => {
    const lecture: LectureDesPaiements = {
      paiements: [], periode: null, rejets: null, lignes: 5, sansMontant: 1, enAttente: 2,
      ecartees: [{ ligne: 3, part: 'obligatoire', raison: 'montant' }, { ligne: 3, part: 'complementaire', raison: 'montant' }, { ligne: 7, part: 'obligatoire', raison: 'journee' }],
    }
    expect(ecartsDits(lecture)).toEqual([
      '2 parts écartées — montant illisible (ligne 3 du fichier).',
      '1 part écartée — journée comptable illisible (ligne 7 du fichier).',
      '1 part sans montant : ce n’est pas un paiement.',
      '2 parts en attente : pas encore des paiements.',
    ])
  })

  it('un fichier trop lourd se refuse avant toute lecture', () => {
    expect(refusDeLaTailleDesPaiements(10 * 1024 * 1024, 'client')).toBeNull()
    expect(refusDeLaTailleDesPaiements(10 * 1024 * 1024 + 1, 'client')).toMatch(/Vérifie/)
  })
})

describe('la confirmation et la phrase d’après l’import', () => {
  it('la confirmation nomme ce qui part (nombre, journées, total, rejets, déjà importés) et ce qui reste dans le fichier', () => {
    const tous = confirmationDeLImport(imp, [], 'cabinet')
    expect(tous).toContain('2 paiements de l’assurance maladie partent en base')
    expect(tous).toContain('journées comptables du 02/11/2026 au 03/11/2026')
    expect(tous).toMatch(/pour 40,50\s€ au total ; rejets du fichier : 2 rejets, 15,00\s€\./)
    expect(tous).toContain('restent dans le fichier, sur cet ordinateur')
    const texte = confirmationDeLImport(imp, [imp.paiements[1]], 'client')
    expect(texte).toContain('1 paiement de l’assurance maladie part en base')
    expect(texte).toContain('restent dans ton fichier')
  })

  it('relecture du 27/11/2026 : la confirmation compte le total et les journées de ce qui PART, jamais des paiements passés', () => {
    // Le paiement du 03/11 est déjà en base aux mêmes chiffres : la base le passe, il ne part pas. Avant, le total nommé
    // était celui du fichier entier (40,50 €), sous « 1 paiement part en base ».
    const texte = confirmationDeLImport(imp, [imp.paiements[1]], 'client')
    expect(texte).toContain('1 paiement de l’assurance maladie part en base, journée comptable du 02/11/2026, ')
    expect(texte).toMatch(/pour 45,50\s€ au total ; rejets du fichier : 2 rejets, 15,00\s€\./)
    expect(texte).toContain('1 paiement déjà importé aux mêmes chiffres est passé : journée comptable du 03/11/2026, -5,00')
    // NOE4R-Q1 (A) : les rejets restent ceux du fichier entier, journées passées comprises, et la phrase le dit.
    expect(texte).toContain('les rejets comptés restent ceux du fichier entier, ces journées comprises.')
    // Un paiement en base à d'autres chiffres n'est pas « passé » : il n'est pas compté ici (la base refuserait l'import).
    const autre = { ...imp.paiements[0], montant_centimes: 1 }
    expect(confirmationDeLImport(imp, [autre], 'cabinet')).toContain('2 paiements de l’assurance maladie partent en base')
  })

  it('NOE3-Q1 : seuls les chiffres ont été gardés, et le conseil de supprimer le fichier', () => {
    for (const espace of ['client', 'cabinet'] as const) {
      expect(phraseApresLImport(espace)).toContain('Seuls les chiffres ont été gardés')
      expect(phraseApresLImport(espace)).toMatch(/supprimer ce fichier|être supprimé/)
    }
  })

  it('le retrait nomme ce qui part avec l’import', () => {
    const importLu = { id: 'i1', dossier_id: 'd1', periode_du: '2026-11-02', periode_au: '2026-11-03', nombre_de_rejets: null, montant_rejete_centimes: null, importe_par: 'u1', importe_le: '2026-11-16T10:00:00Z' }
    const lus = [{ id: 'p1', dossier_id: 'd1', import_id: 'i1', ...imp.paiements[0] }, { id: 'p2', dossier_id: 'd1', import_id: 'autre', ...imp.paiements[1] }]
    const texte = confirmationDuRetrait(importLu, lus, 'client', 0)
    expect(texte).toMatch(/^Retirer l’import des journées du 02\/11\/2026 au 03\/11\/2026 : 1 paiement, 45,50\s€ au total, part avec lui\./)
    expect(texte).not.toContain('remplacé')
    // NOE4R-Q2 : un import qui a remplacé des paiements d'un import antérieur le dit — ils ne reviennent pas.
    expect(confirmationDuRetrait(importLu, lus, 'client', 2)).toContain('Il avait remplacé 2 paiements d’un import antérieur : ils ne reviendront pas')
    expect(confirmationDuRetrait(importLu, lus, 'cabinet', 1)).toContain('Il avait remplacé 1 paiement d’un import antérieur : il ne reviendra pas')
  })

  it('les phrases du client ne portent aucun mot du cabinet', () => {
    const textes = [
      PRESENTATION_AU_CLIENT, SANS_LA_CASE_BANQUE, VIDE_DIT.client, phraseApresLImport('client'), confirmationDeLImport(imp, [imp.paiements[1]], 'client'),
      reglageChoisi(reglageVide(), 'client').manque ?? '', refusDeLaTailleDesPaiements(1e9, 'client') ?? '',
    ]
    for (const t of textes) expect(motsDuCabinet(t)).toEqual([])
  })
})
