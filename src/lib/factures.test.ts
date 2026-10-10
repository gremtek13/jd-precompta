import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fichiersDuSchema } from '../test/schema'

// Le client Supabase est simulé (voir contrepartieBanque.test.ts pour le même motif) : `enregistrerFacture` et
// `creerAvoir` ne sont que des appels RPC, il n'y a pas de calcul pur à extraire d'eux.
const rpc = { data: null as unknown, error: null as { message: string } | null }
const appels: { nom: string; params: Record<string, unknown> }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string, params: Record<string, unknown>) => {
      appels.push({ nom, params })
      return Promise.resolve({ data: rpc.data, error: rpc.error })
    },
  },
}))

const {
  calculerLigne, calculerTotaux, mentionsLegalesParDefaut, trierLignes, lignesSaisies,
  enregistrerFacture, dejaCredite, refusAvoir, creerAvoir, supprimerBrouillon, SUPPRESSION_BROUILLON_EXPORTEE,
} = await import('./factures')

beforeEach(() => {
  rpc.data = null
  rpc.error = null
  appels.length = 0
})

describe('calculerLigne', () => {
  it('arrondit le HT et la TVA au centime, séparément', () => {
    expect(calculerLigne(3, 33.333, 20)).toEqual({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  })

  it('applique le taux au HT déjà arrondi, pas au produit brut', () => {
    // Valeurs choisies parce qu'elles *séparent* réellement les deux règles — un premier jeu
    // « évident » (12,345 × 20 %) donnait le même centime des deux côtés et ne prouvait rien.
    // 1 × 0,175 → HT 0,18 ; 20 % de 0,18 = 0,04, là où 20 % de 0,175 donnerait 0,03.
    expect(calculerLigne(1, 0.175, 20)).toEqual({ montant_ht: 0.18, montant_tva: 0.04, montant_ttc: 0.22 })
  })

  it('rend zéro de TVA sur un taux nul (dossier non assujetti)', () => {
    expect(calculerLigne(2, 50, 0)).toEqual({ montant_ht: 100, montant_tva: 0, montant_ttc: 100 })
  })

  it('gère une quantité décimale', () => {
    expect(calculerLigne(1.5, 10, 20)).toEqual({ montant_ht: 15, montant_tva: 3, montant_ttc: 18 })
  })

  it('arrondit une ligne négative comme la ligne positive, au signe près (une ligne d’avoir)', () => {
    // Math.round arrondit le demi-centime vers +∞ : -0,125 rendait -0,12 là où 0,125 rend 0,13, et l'avoir
    // d'une facture ne la créditait pas au centime. Le module arrondit la valeur absolue.
    expect(calculerLigne(-1, 0.125, 0)).toEqual({ montant_ht: -0.13, montant_tva: 0, montant_ttc: -0.13 })
    const oppose = (x: number) => (x === 0 ? 0 : -x)
    for (const [q, p, t] of [[1, 0.125, 20], [3, 33.335, 5.5], [1, 0.175, 20], [7, 14.285, 10], [2, 0.005, 20]]) {
      const ligne = calculerLigne(q, p, t)
      expect(calculerLigne(-q, p, t)).toEqual({
        montant_ht: oppose(ligne.montant_ht), montant_tva: oppose(ligne.montant_tva), montant_ttc: oppose(ligne.montant_ttc),
      })
    }
  })

  it('ne rend jamais -0 : un montant nul est nul', () => {
    const r = calculerLigne(-1, 0.004, 20)
    expect([r.montant_ht, r.montant_tva, r.montant_ttc].every((x) => Object.is(x, 0))).toBe(true)
  })
})

describe('calculerTotaux', () => {
  it('somme des lignes déjà arrondies, pas des valeurs brutes', () => {
    // Le choix documenté du module : c'est ce que fait tout logiciel de facturation. Trois lignes à
    // 0,005 € valent 0,03 € (chacune arrondie à 0,01) et non 0,02 € (0,015 arrondi une seule fois) —
    // un centime d'écart, qui n'apparaît que sur des valeurs comme celles-ci. Un jeu de test plus
    // « naturel » donnait le même résultat des deux côtés et ne vérifiait donc rien.
    const lignes = Array.from({ length: 3 }, () => ({ quantite: 1, prix_unitaire_ht: 0.005, taux_tva: 20 }))
    expect(calculerTotaux(lignes)).toEqual({ montant_ht: 0.03, montant_tva: 0, montant_ttc: 0.03 })
  })

  it('rend zéro sur une facture sans ligne', () => {
    expect(calculerTotaux([])).toEqual({ montant_ht: 0, montant_tva: 0, montant_ttc: 0 })
  })

  it('additionne des taux de TVA différents sur la même facture', () => {
    const totaux = calculerTotaux([
      { quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
      { quantite: 1, prix_unitaire_ht: 100, taux_tva: 5.5 },
    ])
    expect(totaux).toEqual({ montant_ht: 200, montant_tva: 25.5, montant_ttc: 225.5 })
  })

  it('somme en centimes : 0,07 + 0,14 font 0,21, sans la décimale fantôme des flottants', () => {
    // En flottants, 0.07 + 0.14 === 0.21000000000000002 — envoyé tel quel, la base le stockerait (numeric sans
    // échelle), et le plafond d'un avoir comparé à 0,21 le refuserait.
    const totaux = calculerTotaux([
      { quantite: 1, prix_unitaire_ht: 0.07, taux_tva: 0 },
      { quantite: 1, prix_unitaire_ht: 0.14, taux_tva: 0 },
    ])
    expect(totaux).toEqual({ montant_ht: 0.21, montant_tva: 0, montant_ttc: 0.21 })
    expect(String(totaux.montant_ttc)).toBe('0.21')
    // Et la TVA de même : 0,07 + 0,14 de TVA, sur 0,35 + 0,70 de HT (qui font 1.0499999999999998 en flottants).
    const taxes = calculerTotaux([
      { quantite: 1, prix_unitaire_ht: 0.35, taux_tva: 20 },
      { quantite: 1, prix_unitaire_ht: 0.7, taux_tva: 20 },
    ])
    expect(taxes).toEqual({ montant_ht: 1.05, montant_tva: 0.21, montant_ttc: 1.26 })
  })
})

describe('mentionsLegalesParDefaut', () => {
  it('cite l’article 293 B pour un dossier en franchise, et seulement pour lui', () => {
    expect(mentionsLegalesParDefaut('franchise', null)).toContain('TVA non applicable, art. 293 B du CGI.')
    expect(mentionsLegalesParDefaut('redevable', null)).not.toContain('293 B')
    expect(mentionsLegalesParDefaut(null, null)).not.toContain('293 B')
  })

  it('un dossier de soins exonérés cite l’art. 261, 4, 1°, jamais la franchise — le défaut d’origine', () => {
    const mentions = mentionsLegalesParDefaut('exonere', 'cgi_261_4_1')
    expect(mentions).toContain('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(mentions).not.toContain('293 B')
  })

  it('n’invente aucune mention de TVA quand l’article d’un dossier exonéré manque', () => {
    expect(mentionsLegalesParDefaut('exonere', null)).not.toMatch(/TVA/)
  })

  it('rappelle toujours les pénalités de retard', () => {
    for (const [statut, article] of [['redevable', null], ['franchise', null], ['exonere', 'cgi_261_4_1'], [null, null]] as const) {
      expect(mentionsLegalesParDefaut(statut, article)).toContain('40 €')
    }
  })
})

describe('trierLignes', () => {
  it('trie par ordre croissant sans modifier le tableau reçu', () => {
    const lignes = [{ ordre: 2 }, { ordre: 0 }, { ordre: 1 }]
    expect(trierLignes(lignes).map((l) => l.ordre)).toEqual([0, 1, 2])
    expect(lignes.map((l) => l.ordre)).toEqual([2, 0, 1])
  })
})

describe('enregistrerFacture', () => {
  const lignes = [{ designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]

  it('passe la création avec un id nul et rend l’id créé', async () => {
    rpc.data = [{ facture_id: 'f-neuve', numero: null }]
    expect(await enregistrerFacture('d1', null, { tiers_nom: 'Client' }, lignes, false))
      .toEqual({ id: 'f-neuve', numero: null })
    expect(appels[0]).toMatchObject({ nom: 'enregistrer_facture', params: { p_facture_id: null, p_valider: false } })
  })

  it('rend le numéro quand la validation est demandée', async () => {
    rpc.data = [{ facture_id: 'f1', numero: 'F2026-0007' }]
    expect(await enregistrerFacture('d1', 'f1', { tiers_nom: 'Client' }, lignes, true))
      .toEqual({ id: 'f1', numero: 'F2026-0007' })
    expect(appels[0].params).toMatchObject({ p_valider: true })
  })

  it('remonte l’erreur de la base telle quelle', async () => {
    // Les refus métier viennent de la fonction SQL (facture validée, aucune ligne, accès refusé) :
    // son message est celui que l'utilisateur doit lire.
    rpc.error = { message: 'Une facture validée ne peut plus être modifiée — passer par un avoir.' }
    await expect(enregistrerFacture('d1', 'f1', {}, lignes, false)).rejects.toThrow('validée ne peut plus être modifiée')
  })

  it('lève si la fonction ne renvoie aucune ligne', async () => {
    rpc.data = []
    await expect(enregistrerFacture('d1', null, {}, lignes, false)).rejects.toThrow("n'a rien renvoyé")
  })
})

describe('lignesSaisies', () => {
  const ligne = (designation: string, quantite: number, prix_unitaire_ht = 10) => ({ designation, quantite, prix_unitaire_ht, taux_tva: 20 })

  it('ne retient que les lignes qui portent une désignation et une quantité positive', () => {
    const { valides } = lignesSaisies([ligne('A', 1), ligne('  ', 2), ligne('B', 0), ligne('C', -1), ligne('D', 0.5)])
    expect(valides.map((l) => l.designation)).toEqual(['A', 'D'])
  })

  // Une remise saisie en quantité négative, ou un montant sans désignation, disparaîtraient sans un mot.
  it('compte les lignes écartées qui portent quelque chose, pas une ligne neuve laissée vide', () => {
    expect(lignesSaisies([ligne('A', 1), ligne('Remise', -1)]).ecartees).toBe(1)
    expect(lignesSaisies([ligne('A', 1), ligne('', 1, 25)]).ecartees).toBe(1)
    expect(lignesSaisies([ligne('A', 1), ligne('', 1, 0)]).ecartees).toBe(0)
    expect(lignesSaisies([ligne('A', 1), ligne('B', 0, 0)]).ecartees).toBe(1)
  })
})

describe('dejaCredite', () => {
  const avoir = (origine: string | null, ttc: number) =>
    ({ type: 'avoir' as const, facture_origine_id: origine, montant_ttc: ttc })

  it('somme les avoirs de CETTE facture, en euros positifs', () => {
    expect(dejaCredite('f1', [
      avoir('f1', -40), avoir('f2', -500), avoir('f1', -20.5),
      { type: 'facture', facture_origine_id: null, montant_ttc: 120 },
    ])).toBe(60.5)
  })

  // 0,07 + 0,14 vaut 0,21000000000000002 en flottants, et 0,07 × 100 vaut 7,000000000000001 : seul un compte en
  // centimes ARRONDIS rend 0,21. Des montants plus ronds (0,10) ne distinguent pas les deux calculs.
  it('compte en centimes entiers : 0,07 € et 0,14 € font 0,21 €, pas 0,21000000000000002', () => {
    expect(dejaCredite('f1', [avoir('f1', -0.07), avoir('f1', -0.14)])).toBe(0.21)
  })

  it('rend zéro sur une facture qu’aucun avoir n’a créditée', () => {
    expect(dejaCredite('f1', [avoir('f2', -10)])).toBe(0)
  })
})

describe('refusAvoir', () => {
  const origine = { type: 'facture' as const, statut: 'validee' as const, numero: 'F2026-0001', date_emission: '2026-03-10', montant_ttc: 120 }
  const total = [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]

  it('accepte un avoir total sur une facture que rien n’a créditée', () => {
    expect(refusAvoir(origine, '2026-03-10', total, 0)).toBeNull()
  })

  it('refuse sans ligne, avant tout le reste', () => {
    expect(refusAvoir({ ...origine, statut: 'brouillon' }, '', [], 0)).toBe('Au moins une ligne avec une quantité doit rester à créditer.')
  })

  it('refuse un brouillon et un autre avoir comme origine', () => {
    const message = 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'
    expect(refusAvoir({ ...origine, statut: 'brouillon' }, '2026-03-10', total, 0)).toBe(message)
    expect(refusAvoir({ ...origine, type: 'avoir' }, '2026-03-10', total, 0)).toBe(message)
  })

  it('refuse un avoir sans date, et un avoir daté avant sa facture — pas le même jour', () => {
    expect(refusAvoir(origine, '', total, 0)).toBe("Indique la date d'émission de l'avoir.")
    expect(refusAvoir(origine, '2026-03-09', total, 0))
      .toBe("Un avoir ne précède pas la facture qu'il corrige (émise le 10/03/2026).")
    expect(refusAvoir(origine, '2026-03-10', total, 0)).toBeNull()
  })

  it('refuse une ligne créditée à quantité nulle ou négative', () => {
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], quantite: 0 }], 0))
      .toBe('Chaque ligne créditée porte une quantité positive.')
  })

  it('refuse un avoir dont le total ne crédite rien', () => {
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], prix_unitaire_ht: -100 }], 0))
      .toBe('Un avoir crédite un montant : son total TTC doit être positif.')
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], prix_unitaire_ht: 0.004 }], 0))
      .toBe('Un avoir crédite un montant : son total TTC doit être positif.')
  })

  it('refuse de créditer plus que ce qui reste, au centime', () => {
    expect(refusAvoir(origine, '2026-03-10', total, 0.01))
      .toMatch(/^Cet avoir créditerait 120,00\s€ : la facture F2026-0001 n'a plus que 119,99\s€ à créditer\.$/)
    // 66,67 € HT à 20 % font 80,00 € TTC : exactement ce qui reste après 40 €.
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], prix_unitaire_ht: 66.67 }], 40)).toBeNull()
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], prix_unitaire_ht: 66.68 }], 40)).toMatch(/plus que 80,00/)
  })

  it('dit « 0,00 € » plutôt qu’un reste négatif quand la facture a déjà été trop créditée', () => {
    expect(refusAvoir(origine, '2026-03-10', total, 130)).toMatch(/n'a plus que 0,00\s€/)
  })

  // Liste lue en partie : on ne sait pas, la base juge.
  it('ne juge pas le plafond quand ce qui a été crédité n’est pas connu', () => {
    expect(refusAvoir(origine, '2026-03-10', total, null)).toBeNull()
    // Même au-delà du montant de la facture : sans savoir, ce n'est pas l'écran qui tranche — la base le refusera.
    expect(refusAvoir(origine, '2026-03-10', [{ ...total[0], quantite: 2 }], null)).toBeNull()
  })
})

describe('creerAvoir', () => {
  it('enregistre l’avoir validé par la fonction de la base, montants et quantités négatifs', async () => {
    rpc.data = [{ facture_id: 'a1', numero: 'A2026-0001' }]
    const resultat = await creerAvoir('d1', 'f1', {
      dateEmission: '2026-03-12', motif: '  Remise  ', mentionsLegales: '',
      lignes: [
        { designation: 'Consultation', quantite: 2, prix_unitaire_ht: 50, taux_tva: 20 },
        { designation: 'Déplacement', quantite: 1, prix_unitaire_ht: 10, taux_tva: 0 },
      ],
    })
    expect(resultat).toEqual({ id: 'a1', numero: 'A2026-0001' })
    expect(appels).toEqual([{
      nom: 'enregistrer_facture',
      params: {
        p_dossier_id: 'd1', p_facture_id: null, p_valider: true,
        p_facture: {
          type: 'avoir', facture_origine_id: 'f1', date_emission: '2026-03-12',
          notes: 'Remise', mentions_legales: null,
          montant_ht: -110, montant_tva: -20, montant_ttc: -130,
        },
        p_lignes: [
          { designation: 'Consultation', quantite: -2, prix_unitaire_ht: 50, taux_tva: 20 },
          { designation: 'Déplacement', quantite: -1, prix_unitaire_ht: 10, taux_tva: 0 },
        ],
      },
    }])
  })

  // Un « −0 » s'enregistre comme un zéro, mais se compare mal et s'affiche « -0,00 € » ici ou là.
  it('n’écrit pas de « −0 » quand l’avoir n’a pas de TVA', async () => {
    rpc.data = [{ facture_id: 'a1', numero: 'A2026-0001' }]
    await creerAvoir('d1', 'f1', {
      dateEmission: '2026-03-12', motif: '', mentionsLegales: '',
      lignes: [{ designation: 'Soin', quantite: 1, prix_unitaire_ht: 10, taux_tva: 0 }],
    })
    const facture = appels[0].params.p_facture as { montant_tva: number }
    expect(Object.is(facture.montant_tva, 0)).toBe(true)
  })

  it('remonte le refus de la base tel quel', async () => {
    rpc.error = { message: "Cet avoir créditerait 130,00 € : la facture F2026-0001 n'a plus que 10,00 € à créditer." }
    await expect(creerAvoir('d1', 'f1', {
      dateEmission: '2026-03-12', motif: '', mentionsLegales: '',
      lignes: [{ designation: 'Soin', quantite: 1, prix_unitaire_ht: 10, taux_tva: 0 }],
    })).rejects.toThrow("n'a plus que 10,00")
  })
})

// LA SUPPRESSION D'UN BROUILLON PAR LA BASE (espace client, étape P2) : `supprimer_brouillon_facture` vit dans une
// migration que le cabinet a collée le 10/10/2026, et l'onglet Factures ne l'appelle que lorsque l'export la porte —
// c'est le cas depuis.
describe('supprimerBrouillon', () => {
  it('appelle la fonction avec le dossier annoncé puis la facture, et rend ce qu’elle a supprimé', async () => {
    rpc.data = 'b1'
    await expect(supprimerBrouillon('d1', 'b1')).resolves.toBe('b1')
    expect(appels).toEqual([{ nom: 'supprimer_brouillon_facture', params: { p_dossier_id: 'd1', p_facture_id: 'b1' } }])
  })

  it('remonte le refus de la base tel quel', async () => {
    rpc.error = { message: 'La facture F2026-0001 est validée : elle ne se supprime plus — la corriger passe par un avoir.' }
    await expect(supprimerBrouillon('d1', 'f1')).rejects.toThrow('elle ne se supprime plus')
  })

  it('une réponse qui ne rend pas la facture demandée n’est pas une suppression', async () => {
    rpc.data = null
    await expect(supprimerBrouillon('d1', 'b1')).rejects.toThrow("n'a pas rendu la facture supprimée")
    rpc.data = 'b2'
    await expect(supprimerBrouillon('d1', 'b1')).rejects.toThrow("n'a pas rendu la facture supprimée")
  })

  it('l’export porte la fonction si et seulement si SUPPRESSION_BROUILLON_EXPORTEE le dit', () => {
    const exportee = fichiersDuSchema().some((f) => /create (or replace )?function public\.supprimer_brouillon_facture\(/.test(f.texte))
    expect(exportee, 'SUPPRESSION_BROUILLON_EXPORTEE ne dit plus ce que porte l’export').toBe(SUPPRESSION_BROUILLON_EXPORTEE)
  })
})
