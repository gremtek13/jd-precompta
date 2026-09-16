import { describe, expect, it } from 'vitest'
import {
  analyserAppariements,
  libelleExploitable,
  motsIdentifiants,
  tiersConfirmeParBanque,
} from './appariementBanque'
import type { LigneBancaire, Piece } from './types'

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p1', type_piece: 'achat', statut: 'a_valider', tiers: 'Transmedical',
    date_piece: '2025-06-01', montant_ttc: 38.4, montant_ht: 32, montant_tva: 6.4,
    ...o,
  }) as Piece

const ligne = (o: Partial<LigneBancaire>): LigneBancaire =>
  ({
    id: 'l1', statut: 'non_rapprochee', date: '2025-06-05', montant: -38.4,
    libelle: 'PRLV SEPA TRANSMEDICAL', libelle_brut: null,
    ...o,
  }) as LigneBancaire

describe('libelleExploitable', () => {
  it('retombe sur la ligne brute quand le libellé est le générique de l’import', () => {
    // Sur le premier relevé réel, 250 lignes sur 385 avaient ce générique parce que la colonne
    // « Libellé » choisie au mapping était vide — le vrai texte de la banque était dans la ligne
    // brute. Sans ce repli, les deux tiers du relevé ne peuvent confirmer aucun fournisseur.
    expect(libelleExploitable({
      libelle: 'Mouvement bancaire',
      libelle_brut: '05/06/2025 | -38,4 | Virement |  | PRLV SEPA TRANSMEDICAL |  |  | ',
    })).toContain('TRANSMEDICAL')
  })

  it('préfère le libellé quand il dit quelque chose', () => {
    expect(libelleExploitable({ libelle: 'PRLV SEPA MACSF', libelle_brut: 'autre chose' })).toBe('PRLV SEPA MACSF')
  })

  it('rend une chaîne vide quand rien n’est exploitable', () => {
    expect(libelleExploitable({ libelle: 'Mouvement bancaire', libelle_brut: null })).toBe('')
  })
})

describe('motsIdentifiants', () => {
  it('écarte les mots trop courts pour identifier quoi que ce soit', () => {
    expect(motsIdentifiants('SA BIO SAS')).toEqual([])
  })

  it('écarte les mots que tout le monde partage', () => {
    // « Cabinet Martin » et « Cabinet Dupont » se confirmeraient l'un l'autre sur « cabinet ».
    expect(motsIdentifiants('Cabinet Martin')).toEqual(['martin'])
    expect(motsIdentifiants('Societe Generale France')).toEqual(['generale'])
  })

  it('ignore accents, casse et ponctuation', () => {
    expect(motsIdentifiants('PRÉVOYANCE Santé-du-Sud')).toEqual(['prevoyance', 'sante'])
  })
})

describe('tiersConfirmeParBanque', () => {
  it('confirme malgré le bruit que l’OCR colle autour du nom', () => {
    // Cas réel : un bout du slogan de la facture recopié dans le champ fournisseur.
    expect(tiersConfirmeParBanque('Transmedical\net soigner redevient', 'PRLV SEPA TRANSMEDICAL')).toBe(true)
  })

  it('refuse le cas qui a motivé ce critère', () => {
    // Pièce réelle à 198 € : bon montant, bonne date, un seul candidat — et un fournisseur lu
    // « DARNIS JEREMY », le nom du client lui-même, alors que la banque dit Transmedical. Les deux
    // premiers critères la validaient avec un fournisseur faux.
    expect(tiersConfirmeParBanque('DARNIS JEREMY', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne confirme rien sans fournisseur lu sur la pièce', () => {
    expect(tiersConfirmeParBanque(null, 'PRLV SEPA TRANSMEDICAL')).toBe(false)
    expect(tiersConfirmeParBanque('  ', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne confirme rien sans libellé bancaire', () => {
    expect(tiersConfirmeParBanque('Transmedical', '')).toBe(false)
  })

  it('confirme malgré un libellé bancaire tronqué', () => {
    expect(tiersConfirmeParBanque('MACSF Assurances', 'PRLV SEPA MACSF-ASSU-')).toBe(true)
    // Troncature en plein milieu d'un mot : les relevés coupent à longueur fixe. Exiger l'égalité
    // stricte ferait passer ce fournisseur, pourtant sans ambiguïté, à l'arbitrage manuel.
    expect(tiersConfirmeParBanque('SwissLife Prévoyance', 'PRLV SEPA SWISSLIFE PREVOYAN')).toBe(true)
    // Et dans l'autre sens : la pièce porte le nom court, la banque le nom complet.
    expect(tiersConfirmeParBanque('Swissl', 'PRLV SEPA SWISSLIFE')).toBe(true)
  })

  it('refuse un fournisseur dont le nom contient celui de la banque, sans être le même', () => {
    // Le sens de la recherche décide ici, et lui seul. On cherche le mot de la PIÈCE dans le libellé
    // de la BANQUE : « transmedical » n'est pas dans « medical service », donc refus.
    // Chercher dans l'autre sens trouverait « medical » À L'INTÉRIEUR de « transmedical » et
    // validerait un prélèvement d'un tout autre fournisseur, au centime et au jour près.
    expect(tiersConfirmeParBanque('Transmedical', 'PRLV SEPA MEDICAL SERVICE')).toBe(false)
    expect(tiersConfirmeParBanque('Medical Service', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne se laisse pas confirmer par un mot générique commun aux deux', () => {
    expect(tiersConfirmeParBanque('Cabinet Dupont', 'PRLV SEPA CABINET MARTIN')).toBe(false)
  })
})

describe('analyserAppariements — ce qui est certain', () => {
  it('retient une pièce dont montant, date et fournisseur concordent', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({})])
    expect(certains).toHaveLength(1)
    expect(certains[0].ecartJours).toBe(4)
    expect(aArbitrer).toEqual([])
  })

  it('n’apparie rien hors de la tolérance de date', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({ date: '2025-06-20' })])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('n’apparie rien sur un montant différent d’un centime', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({ montant: -38.42 })])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('ignore un mouvement déjà rapproché', () => {
    const { certains } = analyserAppariements([piece({})], [ligne({ statut: 'rapprochee' })])
    expect(certains).toEqual([])
  })

  it('ignore une pièce sans montant ou sans date', () => {
    expect(analyserAppariements([piece({ montant_ttc: null })], [ligne({})]).certains).toEqual([])
    expect(analyserAppariements([piece({ date_piece: null })], [ligne({})]).certains).toEqual([])
  })
})

describe('analyserAppariements — ce qui part à l’arbitrage', () => {
  it('refuse quand deux mouvements peuvent convenir à la même pièce', () => {
    const a = analyserAppariements([piece({})], [ligne({ id: 'a' }), ligne({ id: 'b', date: '2025-06-03' })])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer.map((p) => p.motif)).toEqual(['plusieurs mouvements possibles', 'plusieurs mouvements possibles'])
  })

  it('refuse quand deux pièces se disputent le même mouvement', () => {
    // Cas réel : la même facture déposée deux fois, même date et même montant.
    const a = analyserAppariements([piece({ id: 'p1' }), piece({ id: 'p2' })], [ligne({})])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer.every((p) => p.motif === 'plusieurs pièces possibles')).toBe(true)
  })

  it('refuse un fournisseur que la banque ne confirme pas', () => {
    const a = analyserAppariements([piece({ tiers: 'DARNIS JEREMY' })], [ligne({})])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer[0].motif).toBe('fournisseur non confirmé par le libellé bancaire')
  })

  it('refuse une pièce sans fournisseur lu', () => {
    const a = analyserAppariements([piece({ tiers: null })], [ligne({})])
    expect(a.aArbitrer[0].motif).toBe('aucun fournisseur lu sur la pièce')
  })

  it('refuse un achat rapproché d’un encaissement', () => {
    // Même montant, même date, bon fournisseur — mais l'argent est entré alors que la pièce est un
    // achat. C'est un remboursement, pas le paiement de cette facture.
    const a = analyserAppariements([piece({})], [ligne({ montant: 38.4 })])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer[0].motif).toBe('sens contraire au type de pièce')
  })

  it('attend un encaissement pour une vente', () => {
    const vente = piece({ type_piece: 'vente', tiers: 'Transmedical' })
    expect(analyserAppariements([vente], [ligne({ montant: 38.4 })]).certains).toHaveLength(1)
    expect(analyserAppariements([vente], [ligne({ montant: -38.4 })]).aArbitrer[0].motif)
      .toBe('sens contraire au type de pièce')
  })

  it('attend un encaissement pour un avoir sur achat', () => {
    // Un avoir fournisseur est une pièce d'achat à montant négatif : l'argent revient sur le compte.
    const avoir = piece({ montant_ttc: -38.4 })
    expect(analyserAppariements([avoir], [ligne({ montant: 38.4 })]).certains).toHaveLength(1)
  })
})

describe('analyserAppariements — ordre de présentation', () => {
  it('met le plus sûr en premier, puis le plus gros montant', () => {
    const a = analyserAppariements(
      [
        piece({ id: 'loin', date_piece: '2025-06-01', montant_ttc: 38.4 }),
        piece({ id: 'pres', date_piece: '2025-06-04', montant_ttc: 100 }),
        piece({ id: 'gros', date_piece: '2025-06-04', montant_ttc: 900 }),
      ],
      [
        ligne({ id: 'a', montant: -38.4 }),
        ligne({ id: 'b', montant: -100 }),
        ligne({ id: 'c', montant: -900 }),
      ],
    )
    expect(a.certains.map((p) => p.piece.id)).toEqual(['gros', 'pres', 'loin'])
  })
})

describe('le scénario réel qui a servi de référence', () => {
  it('sépare 10 certains, 1 fournisseur faux et 2 doublons', () => {
    // Reconstitution du premier jeu réel : des mensualités Transmedical, une pièce dont l'OCR a lu le
    // nom du client en fournisseur, et une facture déposée deux fois.
    const mois = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']
    const pieces = mois.map((m) => piece({
      id: `ok-${m}`, date_piece: `2025-${m}-01`, montant_ttc: 38.4, tiers: 'Transmedical',
    }))
    const lignes = mois.map((m) => ligne({
      id: `l-${m}`, date: `2025-${m}-05`, montant: -38.4, libelle: 'PRLV SEPA TRANSMEDICAL',
    }))

    pieces.push(piece({ id: 'faux-tiers', date_piece: '2025-11-30', montant_ttc: 198, tiers: 'DARNIS JEREMY' }))
    lignes.push(ligne({ id: 'l-198', date: '2025-12-05', montant: -198, libelle: 'PRLV SEPA TRANSMEDICAL' }))

    pieces.push(piece({ id: 'doublon-a', date_piece: '2025-12-01', montant_ttc: 55, tiers: 'Transmedical' }))
    pieces.push(piece({ id: 'doublon-b', date_piece: '2025-12-01', montant_ttc: 55, tiers: 'Transmedical' }))
    lignes.push(ligne({ id: 'l-55', date: '2025-12-05', montant: -55, libelle: 'PRLV SEPA TRANSMEDICAL' }))

    const { certains, aArbitrer } = analyserAppariements(pieces, lignes)
    expect(certains).toHaveLength(10)
    expect(certains.map((c) => c.piece.id).sort()).toEqual(mois.map((m) => `ok-${m}`).sort())

    const motifs = aArbitrer.map((p) => p.motif).sort()
    expect(motifs).toEqual([
      'fournisseur non confirmé par le libellé bancaire',
      'plusieurs pièces possibles',
      'plusieurs pièces possibles',
    ])
  })
})
