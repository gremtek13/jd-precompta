import { describe, expect, it } from 'vitest'
import {
  comptesDeTiers, comptesDuDirigeant, EXPLICATIONS_MODE, LIBELLES_MODE, auxiliaireDuTiers, compteDeTiers,
  lignesEngagementPourPiece, lignesFactureEngagement, lignesReglementEngagement, modeleDuDossier,
} from './engagement'
import {
  COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_EXPLOITANT, COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_TVA_COLLECTEE,
  COMPTE_TVA_DEDUCTIBLE, COMPTE_TVA_IMMOBILISATIONS, LIBELLES_COMPTES,
} from './comptes'
import { dateLocaleDe } from './format'
import type { CibleComptable, LigneAGenerer } from './ecritures'
import type { LigneBancaire, Piece } from './types'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'

// Les comptes de tiers et les trois comptes du dirigeant sous le plan par défaut : ceux d'avant l'étape PC3.
const COMPTES_DE_TIERS = comptesDeTiers(PLAN_PAR_DEFAUT)
const COMPTES_NOTES_DE_FRAIS = comptesDuDirigeant(PLAN_PAR_DEFAUT)

const ACHATS = '606100'
const VENTES = '706000'
// La cible d'une pièce ordinaire : le compte de sa catégorie. Celle de la facture d'un bien immobilisé
// porte le compte de sa nature et `immobilisation` (lib/ecritures.ts, `CibleComptable`).
const cible = (compte: string): CibleComptable => ({ compte, immobilisation: false })
const bien = (compte: string): CibleComptable => ({ compte, immobilisation: true })

// Jeu d'essai typé SANS `as` : le compilateur vérifie chaque champ contre la table.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2026-03-10', tiers: 'Transmedical',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: 'c1', sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-03-12T09:00:00Z', updated_at: '2026-03-12T09:00:00Z', ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-04-05', libelle: 'PRLV TRANSMEDICAL', montant: -120,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: '2026-04-06T09:00:00Z', encaissements_de_factures: false, ...o,
  }
}

// Débit − crédit : zéro pour une écriture qui s'équilibre.
const solde = (lignes: readonly LigneAGenerer[]) =>
  Math.round(lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100) / 100

describe('compteDeTiers', () => {
  it('range une vente en 411, un achat et une pièce « autre » en 401', () => {
    expect(compteDeTiers(piece({ type_piece: 'vente' }), '455000', false, PLAN_PAR_DEFAUT)).toBe(COMPTE_CLIENTS)
    expect(compteDeTiers(piece({ type_piece: 'achat' }), '455000', false, PLAN_PAR_DEFAUT)).toBe(COMPTE_FOURNISSEURS)
    expect(compteDeTiers(piece({ type_piece: 'autre' }), '455000', false, PLAN_PAR_DEFAUT)).toBe(COMPTE_FOURNISSEURS)
  })

  it('range une note de frais sur le compte que le dossier a choisi, quel qu’il soit', () => {
    for (const compte of ['455000', '108000', '467000'] as const) {
      expect(compteDeTiers(piece({ type_piece: 'note_frais' }), compte, false, PLAN_PAR_DEFAUT)).toBe(compte)
    }
  })

  it('doit la facture d’un bien immobilisé au 404, et elle seule', () => {
    // L'écriture d'ACQUISITION : un fournisseur d'immobilisations n'est pas un fournisseur de biens et services.
    expect(compteDeTiers(piece({ type_piece: 'achat' }), '455000', true, PLAN_PAR_DEFAUT)).toBe(COMPTE_FOURNISSEURS_IMMOBILISATIONS)
    expect(compteDeTiers(piece({ type_piece: 'autre' }), '455000', true, PLAN_PAR_DEFAUT)).toBe(COMPTE_FOURNISSEURS_IMMOBILISATIONS)
    // Une note de frais reste due au dirigeant, quel que soit ce qu'elle a payé.
    expect(compteDeTiers(piece({ type_piece: 'note_frais' }), '108000', true, PLAN_PAR_DEFAUT)).toBe('108000')
  })

  it('ne connaît que des comptes de tiers que la balance sait nommer', () => {
    for (const compte of COMPTES_DE_TIERS) expect(LIBELLES_COMPTES[compte]).toBeTruthy()
    expect(COMPTES_DE_TIERS.has(COMPTE_FOURNISSEURS_IMMOBILISATIONS)).toBe(true)
  })
})

describe('lignesFactureEngagement — la facture, à sa date, contre le compte de tiers', () => {
  it('passe un achat au débit, sa TVA au débit, et le TTC au crédit du 401', () => {
    const lignes = lignesFactureEngagement('d1', piece(), cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 100, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 120, date: '2026-03-10' }),
    ])
    expect(solde(lignes)).toBe(0)
    // Une facture ne désigne aucun mouvement : c'est ce qui la garde hors du journal de banque.
    expect(lignes.every((l) => l.ligne_bancaire_id === undefined)).toBe(true)
  })

  it('passe une vente au crédit, sa TVA collectée au crédit, et le TTC au débit du 411', () => {
    const lignes = lignesFactureEngagement('d1', piece({ type_piece: 'vente', tiers: 'CPAM' }), cible(VENTES), true, '455000', PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 20 }),
      expect.objectContaining({ compte: COMPTE_CLIENTS, sens: 'debit', montant: 120 }),
    ])
    expect(solde(lignes)).toBe(0)
  })

  it('passe le TTC en charge pour un dossier exonéré, sans ligne de TVA', () => {
    const lignes = lignesFactureEngagement('d1', piece(), cible(ACHATS), false, '455000', PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 120 }),
    ])
  })

  it('crédite le compte du dossier pour une note de frais payée par le dirigeant', () => {
    const lignes = lignesFactureEngagement('d1', piece({ type_piece: 'note_frais' }), cible(ACHATS), true, '108000', PLAN_PAR_DEFAUT)
    expect(lignes.at(-1)).toMatchObject({ compte: COMPTE_EXPLOITANT, sens: 'credit', montant: 120 })
    expect(lignes.some((l) => l.compte === COMPTE_FOURNISSEURS)).toBe(false)
  })

  // Une ligne nulle ne s'écrit pas : la base la refuse (ecritures_brouillon_montant_positif), et l'insertion d'un seul
  // tenant de la génération emporterait tout le lot avec elle.
  it('n’écrit aucune ligne nulle — une facture à 0 € n’écrit rien, un hors taxe lu à zéro laisse sa TVA', () => {
    expect(lignesFactureEngagement('d1', piece({ montant_ht: 0, montant_tva: 0, montant_ttc: 0 }), cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)).toEqual([])
    expect(lignesFactureEngagement('d1', piece({ montant_ht: 0, montant_tva: 20, montant_ttc: 20 }), cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)).toEqual([
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 20 }),
    ])
  })

  it('inverse les sens d’un avoir, les montants restant positifs', () => {
    const avoir = piece({ montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    const lignes = lignesFactureEngagement('d1', avoir, cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'credit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120 }),
    ])
  })

  it('date une pièce sans date de son dépôt, comme en trésorerie', () => {
    const lignes = lignesFactureEngagement('d1', piece({ date_piece: null }), cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)
    expect(new Set(lignes.map((l) => l.date))).toEqual(new Set([dateLocaleDe('2026-03-12T09:00:00Z')]))
  })

  it('laisse déséquilibrée une facture dont la TVA ne recoupe pas le TTC, pour que le contrôle le dise', () => {
    // Le compte de tiers porte ce qui est DÛ, le TTC ; forcer l'équilibre en y mettant HT + TVA
    // masquerait une pièce fausse sous une écriture juste en apparence.
    const lignes = lignesFactureEngagement('d1', piece({ montant_ht: 100, montant_tva: 30, montant_ttc: 120 }), cible(ACHATS), true, '455000', PLAN_PAR_DEFAUT)
    expect(lignes.at(-1)).toMatchObject({ compte: COMPTE_FOURNISSEURS, montant: 120 })
    expect(solde(lignes)).toBe(10)
  })
})

describe('lignesFactureEngagement — la facture d’un bien immobilisé', () => {
  it('passe le hors taxe au compte du bien, la TVA au 445620 et le TTC au crédit du 404', () => {
    expect(lignesFactureEngagement('d1', piece(), bien('218300'), true, '455000', PLAN_PAR_DEFAUT)).toEqual([
      expect.objectContaining({ compte: '218300', sens: 'debit', montant: 100, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_TVA_IMMOBILISATIONS, sens: 'debit', montant: 20, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS_IMMOBILISATIONS, sens: 'credit', montant: 120, date: '2026-03-10' }),
    ])
  })

  it('passe le TTC au compte du bien pour un dossier exonéré', () => {
    expect(lignesFactureEngagement('d1', piece(), bien('218300'), false, '455000', PLAN_PAR_DEFAUT)).toEqual([
      expect.objectContaining({ compte: '218300', sens: 'debit', montant: 120 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS_IMMOBILISATIONS, sens: 'credit', montant: 120 }),
    ])
  })
})

describe('lignesReglementEngagement — le règlement, au mouvement, contre la banque', () => {
  it('solde le 404 de la facture d’un bien, pas le 401', () => {
    expect(lignesReglementEngagement('d1', piece(), mouvement(), '455000', true, PLAN_PAR_DEFAUT)).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS_IMMOBILISATIONS, sens: 'debit', montant: 120, ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
    ])
  })

  it('solde le 401 d’un achat payé : débit 401, crédit 512, datés et désignés du mouvement', () => {
    const lignes = lignesReglementEngagement('d1', piece(), mouvement(), '455000', false, PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l1' }),
    ])
  })

  it('solde le 411 d’une vente encaissée : débit 512, crédit 411', () => {
    const lignes = lignesReglementEngagement('d1', piece({ type_piece: 'vente' }), mouvement({ montant: 120 }), '455000', false, PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_CLIENTS, sens: 'credit', montant: 120 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'debit', montant: 120 }),
    ])
  })

  it('lit la banque au signe du mouvement, pas au type de la pièce : un avoir remboursé entre en banque', () => {
    const lignes = lignesReglementEngagement('d1', piece(), mouvement({ montant: 30 }), '455000', false, PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 30 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'debit', montant: 30 }),
    ])
  })

  it('rembourse le dirigeant depuis le compte bancaire de l’entreprise : débit 455, crédit 512', () => {
    const lignes = lignesReglementEngagement('d1', piece({ type_piece: 'note_frais' }), mouvement({ montant: -100 }), '455000', false, PLAN_PAR_DEFAUT)
    expect(lignes).toEqual([
      expect.objectContaining({ compte: '455000', sens: 'debit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 100 }),
    ])
  })

  it('porte le montant du MOUVEMENT, pas celui de la pièce : un frais bancaire reste sur le compte de tiers', () => {
    expect(lignesReglementEngagement('d1', piece(), mouvement({ montant: -118.5 }), '455000', false, PLAN_PAR_DEFAUT).map((l) => l.montant)).toEqual([118.5, 118.5])
  })

  it('ne produit rien pour un mouvement à zéro', () => {
    expect(lignesReglementEngagement('d1', piece(), mouvement({ montant: 0 }), '455000', false, PLAN_PAR_DEFAUT)).toEqual([])
  })
})

describe('lignesEngagementPourPiece', () => {
  it('rend la facture puis un règlement par mouvement, dans l’ordre des dates', () => {
    const lignes = lignesEngagementPourPiece('d1', piece(), cible(ACHATS), true, '455000', [
      mouvement({ id: 'l2', date: '2026-05-02', montant: -70 }),
      mouvement({ id: 'l1', date: '2026-04-05', montant: -50 }),
    ], PLAN_PAR_DEFAUT)
    expect(lignes.map((l) => [l.compte, l.ligne_bancaire_id ?? null])).toEqual([
      [ACHATS, null], [COMPTE_TVA_DEDUCTIBLE, null], [COMPTE_FOURNISSEURS, null],
      [COMPTE_FOURNISSEURS, 'l1'], [COMPTE_BANQUE, 'l1'],
      [COMPTE_FOURNISSEURS, 'l2'], [COMPTE_BANQUE, 'l2'],
    ])
    expect(solde(lignes)).toBe(0)
  })
})

describe('auxiliaireDuTiers — le compte auxiliaire du FEC', () => {
  it('numérote un fournisseur à sa clé d’identité, et le nomme comme il est lu', () => {
    expect(auxiliaireDuTiers(piece({ tiers: 'Transmedical' }), COMPTE_FOURNISSEURS)).toEqual({ num: 'FTRANSMEDICAL', lib: 'Transmedical' })
    expect(auxiliaireDuTiers(piece({ tiers: 'CPAM des\nBouches-du-Rhône' }), COMPTE_CLIENTS)).toEqual({ num: 'CCPAM', lib: 'CPAM des Bouches-du-Rhône' })
  })

  it('donne le même numéro aux deux lectures d’un même fournisseur', () => {
    expect(auxiliaireDuTiers(piece({ tiers: 'Transmedical / et redevient' }), COMPTE_FOURNISSEURS)?.num).toBe('FTRANSMEDICAL')
  })

  it('range un tiers sans clé au compte « divers » plutôt que de lui en inventer une', () => {
    expect(auxiliaireDuTiers(piece({ tiers: null }), COMPTE_FOURNISSEURS)).toEqual({ num: 'FDIVERS', lib: 'Fournisseurs divers' })
    expect(auxiliaireDuTiers(piece({ tiers: 'CARTE BANCAIRE' }), COMPTE_CLIENTS)).toEqual({ num: 'CDIVERS', lib: 'Clients divers' })
  })

  it('donne aux fournisseurs d’immobilisations leurs propres auxiliaires, préfixés FI', () => {
    // Un même fournisseur peut l'être des deux sortes : son auxiliaire du 404 ne doit pas porter le
    // numéro de celui du 401, un CompAuxNum désignant un seul compte auxiliaire dans tout le fichier.
    expect(auxiliaireDuTiers(piece({ tiers: 'Transmedical' }), COMPTE_FOURNISSEURS_IMMOBILISATIONS))
      .toEqual({ num: 'FITRANSMEDICAL', lib: 'Transmedical' })
    expect(auxiliaireDuTiers(piece({ tiers: null }), COMPTE_FOURNISSEURS_IMMOBILISATIONS))
      .toEqual({ num: 'FIDIVERS', lib: 'Fournisseurs d’immobilisations divers' })
  })

  it('ne donne d’auxiliaire qu’au 401, au 404 et au 411', () => {
    for (const compte of [ACHATS, COMPTE_BANQUE, COMPTE_TVA_DEDUCTIBLE, '455000', '108000', '467000']) {
      expect(auxiliaireDuTiers(piece(), compte)).toBeNull()
    }
  })
})

describe('le modèle du dossier', () => {
  it('se lit sur les deux colonnes du dossier, et porte le plan du dossier', () => {
    expect(modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: '108000' }, PLAN_PAR_DEFAUT))
      .toEqual({ modele: { mode: 'engagement', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }, refus: null })
  })

  // LE COMPTE DU DIRIGEANT EST VALIDÉ PAR LE PLAN (étape PC3 ; conception, § 3.6) : celui de l'un des trois rôles du
  // dirigeant DANS LE PLAN du dossier, en trésorerie comme en engagement ; un autre ne fait aucun modèle, et le refus dit
  // le compte enregistré et ceux que le plan ouvre.
  it('n’admet pour le dirigeant que l’un des trois comptes que le plan lui ouvre', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      for (const compte of [plan.associe, plan.exploitant, plan.autres_debiteurs_crediteurs]) {
        for (const mode of ['tresorerie', 'engagement'] as const) {
          expect(modeleDuDossier({ mode_comptable: mode, compte_notes_de_frais: compte }, plan).modele?.compteNotesDeFrais).toBe(compte)
        }
      }
    }
    expect(modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: '455000' }, PLAN_DECALE)).toEqual({
      modele: null,
      refus: 'Le compte du dirigeant de ce dossier (455000) n’est le compte d’aucun des trois rôles que son plan comptable '
        + 'lui ouvre (455100, 108100, 467100).',
    })
    expect(modeleDuDossier({ mode_comptable: 'tresorerie', compte_notes_de_frais: '401000' }, PLAN_PAR_DEFAUT).refus)
      .toBe('Le compte du dirigeant de ce dossier (401000) n’est le compte d’aucun des trois rôles que son plan comptable '
        + 'lui ouvre (455000, 108000, 467000).')
  })

  it('propose au dirigeant les trois comptes DU PLAN, sous les mots du cabinet', () => {
    expect(comptesDuDirigeant(PLAN_DECALE).map((c) => [c.role, c.compte])).toEqual([
      ['associe', '455100'], ['exploitant', '108100'], ['autres_debiteurs_crediteurs', '467100'],
    ])
    expect(comptesDuDirigeant(PLAN_DECALE).map((c) => c.libelle)).toEqual(COMPTES_NOTES_DE_FRAIS.map((c) => c.libelle))
    expect([...comptesDeTiers(PLAN_DECALE)]).toEqual(['401100', '404100', '411100', '455100', '108100', '467100'])
  })

  it('se présente sous les noms choisis par le cabinet', () => {
    expect(LIBELLES_MODE).toEqual({ tresorerie: 'Trésorerie (BNC, 2035)', engagement: 'Engagement (BIC, IS)' })
    expect(EXPLICATIONS_MODE.engagement).toMatch(/2035 n’est pas produite/)
    // En trésorerie, rien à choisir : ce que l'exploitant a payé de sa poche passe à son compte.
    expect(EXPLICATIONS_MODE.tresorerie).toMatch(/note de frais que l’exploitant a payée de sa poche s’écrit au 108 – Compte de l’exploitant/)
  })
})

// Les corrections du cabinet (28/09/2026), gardées mot pour mot : une explication réécrite « plus
// naturellement » y reviendrait sans que rien ne le dise.
describe('les comptes d’une note de frais, tels que le cabinet les a formulés', () => {
  const texte = (compte: string) => {
    const choix = COMPTES_NOTES_DE_FRAIS.find((c) => c.compte === compte)!
    return `${choix.libelle} ${choix.explication}`
  }

  it('propose les trois comptes, le 455 en premier et recommandé', () => {
    expect(COMPTES_NOTES_DE_FRAIS.map((c) => c.compte)).toEqual(['455000', '108000', '467000'])
    expect(COMPTES_NOTES_DE_FRAIS[0].libelle).toMatch(/recommandé/)
  })

  it('dit que c’est la société qui rembourse le dirigeant, depuis son compte bancaire — jamais « la banque »', () => {
    expect(texte('455000')).toMatch(/la société rembourse le dirigeant, depuis son compte bancaire : débit 455, crédit 512/)
    for (const c of COMPTES_NOTES_DE_FRAIS) expect(`${c.libelle} ${c.explication}`).not.toMatch(/par la banque|la banque (le |la )?(rembourse|solde)/i)
  })

  it('ne dit pas du 108 que rien n’est remboursé : il retrace les apports et les prélèvements', () => {
    expect(texte('108000')).toMatch(/apports et ses prélèvements personnels/)
    expect(texte('108000')).not.toMatch(/rien n.est rembours/i)
  })

  it('ne présente jamais le 467 comme un compte d’attente', () => {
    expect(texte('467000')).toMatch(/pas associée, ou lorsqu’aucun compte plus spécifique ne convient/)
    for (const c of COMPTES_NOTES_DE_FRAIS) expect(`${c.libelle} ${c.explication}`).not.toMatch(/attente/i)
  })
})
