import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import type { ImportAEnvoyer, LectureDesPaiements } from './paiementsAssuranceMaladie'
import {
  PRESENTATION_AU_CLIENT, SANS_LA_CASE_BANQUE, VIDE_DIT, confirmationDeLImport, confirmationDuRetrait, ecartsDits, genreDit,
  organismeDit, phraseApresLImport, refusDeLaTailleDesPaiements, reglageChoisi, reglageVide, rejetsDits,
} from './paiementsAssuranceMaladieVue'

// Les mots et les règles de l'écran d'import (NOE4) : rien n'est deviné (le réglage part vide, ce qui manque se dit) ; une
// colonne de noms se dit « texte » ; la confirmation nomme ce qui part et ce qui reste ; la phrase d'après l'import (NOE3-Q1) ;
// les phrases du client sans les mots du cabinet ; aucun écart ne porte une valeur.

const imp: ImportAEnvoyer = {
  version: 1,
  paiements: [
    { date_journee_comptable: '2026-11-02', regime: 1, caisse: 691, part: 'obligatoire', montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2 },
    { date_journee_comptable: '2026-11-03', regime: 1, caisse: 691, part: 'obligatoire', montant_centimes: -500, regularisations_centimes: -500, nombre_de_factures: 0 },
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
    expect(rejetsDits(null)).toBe('les rejets ne sont pas dits par le fichier')
    expect(rejetsDits({ nombre: null, montant_centimes: null })).toBe('les rejets ne sont pas dits par le fichier')
    expect(rejetsDits({ nombre: 0, montant_centimes: 0 })).toBe('aucun rejet')
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
    const texte = confirmationDeLImport(imp, 1, 'client')
    expect(texte).toContain('1 paiement de l’assurance maladie part en base')
    expect(texte).toContain('du 02/11/2026 au 03/11/2026')
    expect(texte).toMatch(/pour 40,50\s€ au total ; 2 rejets, 15,00\s€\./)
    expect(texte).toContain('1 paiement déjà importé aux mêmes chiffres est passé.')
    expect(texte).toContain('restent dans ton fichier')
    expect(confirmationDeLImport(imp, 0, 'cabinet')).toContain('restent dans le fichier, sur cet ordinateur')
  })

  it('NOE3-Q1 : seuls les chiffres ont été gardés, et le conseil de supprimer le fichier', () => {
    for (const espace of ['client', 'cabinet'] as const) {
      expect(phraseApresLImport(espace)).toContain('Seuls les chiffres ont été gardés')
      expect(phraseApresLImport(espace)).toMatch(/supprimer ce fichier|être supprimé/)
    }
  })

  it('le retrait nomme ce qui part avec l’import', () => {
    const texte = confirmationDuRetrait(
      { id: 'i1', dossier_id: 'd1', periode_du: '2026-11-02', periode_au: '2026-11-03', nombre_de_rejets: null, montant_rejete_centimes: null, importe_par: 'u1', importe_le: '2026-11-16T10:00:00Z' },
      [{ id: 'p1', dossier_id: 'd1', import_id: 'i1', ...imp.paiements[0] }, { id: 'p2', dossier_id: 'd1', import_id: 'autre', ...imp.paiements[1] }],
      'client',
    )
    expect(texte).toMatch(/^Retirer l’import des journées du 02\/11\/2026 au 03\/11\/2026 : 1 paiement, 45,50\s€ au total, part avec lui\./)
  })

  it('les phrases du client ne portent aucun mot du cabinet', () => {
    const textes = [
      PRESENTATION_AU_CLIENT, SANS_LA_CASE_BANQUE, VIDE_DIT.client, phraseApresLImport('client'), confirmationDeLImport(imp, 1, 'client'),
      reglageChoisi(reglageVide(), 'client').manque ?? '', refusDeLaTailleDesPaiements(1e9, 'client') ?? '',
    ]
    for (const t of textes) expect(motsDuCabinet(t)).toEqual([])
  })
})
