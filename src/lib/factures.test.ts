import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le client Supabase est simulé (voir contrepartieBanque.test.ts pour le même motif) : les deux
// dernières fonctions de ce module ne sont que des appels RPC, il n'y a pas de calcul pur à extraire.
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
  calculerLigne, calculerTotaux, mentionsLegalesParDefaut, trierLignes,
  attribuerNumeroFacture, enregistrerFacture,
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
})

describe('mentionsLegalesParDefaut', () => {
  it('ajoute l’article 293 B seulement si le dossier n’est pas assujetti', () => {
    expect(mentionsLegalesParDefaut(false)).toContain('293 B')
    expect(mentionsLegalesParDefaut(true)).not.toContain('293 B')
  })

  it('rappelle toujours les pénalités de retard', () => {
    expect(mentionsLegalesParDefaut(true)).toContain('40 €')
    expect(mentionsLegalesParDefaut(false)).toContain('40 €')
  })
})

describe('trierLignes', () => {
  it('trie par ordre croissant sans modifier le tableau reçu', () => {
    const lignes = [{ ordre: 2 }, { ordre: 0 }, { ordre: 1 }]
    expect(trierLignes(lignes).map((l) => l.ordre)).toEqual([0, 1, 2])
    expect(lignes.map((l) => l.ordre)).toEqual([2, 0, 1])
  })
})

describe('attribuerNumeroFacture', () => {
  it('prend l’année sur la date d’émission, jamais sur la date du jour', async () => {
    // Un document antidaté en janvier pour décembre dernier reste dans la suite de l'année passée.
    rpc.data = 'F2025-0012'
    await attribuerNumeroFacture('d1', '2025-12-28')
    expect(appels[0]).toEqual({ nom: 'attribuer_numero_facture', params: { p_dossier_id: 'd1', p_annee: 2025, p_type: 'facture' } })
  })

  it('rend le numéro tel que la base le formate, sans le reconstruire', async () => {
    // Le format vit dans `numero_facture_formate` côté base : le refaire ici rouvrirait la
    // divergence que cette délégation ferme.
    rpc.data = 'A2026-0003'
    expect(await attribuerNumeroFacture('d1', '2026-03-10', 'avoir')).toBe('A2026-0003')
    expect(appels[0].params).toMatchObject({ p_type: 'avoir' })
  })

  it('lève si la base refuse, ou ne rend rien', async () => {
    rpc.error = { message: 'Accès refusé à ce dossier.' }
    await expect(attribuerNumeroFacture('d1', '2026-03-10')).rejects.toThrow('Accès refusé')
    rpc.error = null
    rpc.data = null
    await expect(attribuerNumeroFacture('d1', '2026-03-10')).rejects.toThrow("Échec de l'attribution")
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
