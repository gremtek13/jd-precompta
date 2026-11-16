// LE DOSSIER DE DÉMONSTRATION (demande du cabinet du 16/11/2026 ; src/test/dossierDeDemonstration.ts, outils/demonstration/).
// Ce que ce test garde : le fichier passe le lecteur même de l'écran de restauration (`lireSauvegarde`), il est déterministe,
// la restauration n'a rien à refuser avant d'écrire (aucune table hors de l'ordre, aucun lien perdu, aucun compte exigé,
// aucune ligne partagée, seules références externes le cabinet et cinq catégories communes), chaque horodatage précède
// l'instant du fichier (la porte de la restauration des gardes : `v_cree < now()`), et les contrôles de l'application disent
// exactement les points VOULUS — rien de plus — pendant que la 2035 de 2025 se calcule et concorde avec les écritures.
// La restauration elle-même se joue sur une réplique (outils/demonstration/replique.mts ; HISTORIQUE.md, 16/11/2026).

import { describe, expect, it } from 'vitest'
import { cheminDuDossier } from './cheminDuDossier'
import { comptesRequis, estLignePartagee, liensPerdus, planReinsertion, referencesExternes, sansAnciennesNotes } from './sauvegarde'
import { lireSauvegarde, serialiserSauvegarde } from './sauvegardeFichier'
import type { Piece } from './types'
import {
  AUJOURD_HUI, CATEGORIES_CITEES, DOSSIER_DE_DEMONSTRATION, FAITE_LE, NOM_DE_LA_DEMONSTRATION, composerLeDossier, contenuDeLaSauvegarde,
  controlesDuDossier, resumeDuPoint, sauvegardeDeDemonstration,
} from '../test/dossierDeDemonstration'

const CABINET = 'cab10000-0000-4000-8000-000000000001'
const sauvegarde = sauvegardeDeDemonstration(CABINET)
const { contenu } = sauvegarde

describe('le fichier de la démonstration', () => {
  it('passe le lecteur de l’écran de restauration, et se compose à l’octet près deux fois', async () => {
    const texte = await serialiserSauvegarde(sauvegarde)
    const relue = await lireSauvegarde(texte)
    expect(relue.manifeste.dossierNom).toBe(NOM_DE_LA_DEMONSTRATION)
    expect(relue.manifeste.cabinetId).toBe(CABINET)
    expect(await serialiserSauvegarde(sauvegardeDeDemonstration(CABINET))).toBe(texte)
    // Le cabinet change le fichier, et lui seul.
    const autre = await serialiserSauvegarde(sauvegardeDeDemonstration('cab20000-0000-4000-8000-000000000002'))
    expect(autre).not.toBe(texte)
    expect(autre.replaceAll('cab20000-0000-4000-8000-000000000002', CABINET).replace(/"empreinte": "[0-9a-f]+"/, '')).toBe(texte.replace(/"empreinte": "[0-9a-f]+"/, ''))
  })

  it('n’a rien que la restauration refuserait avant d’écrire', () => {
    const plan = planReinsertion(contenu)
    expect(plan.tablesIgnorees).toEqual([])
    expect(plan.secondePasse.flatMap((p) => p.valeurs)).toEqual([])
    expect(sansAnciennesNotes(contenu).refus).toEqual([])
    expect(liensPerdus(contenu)).toEqual([])
    expect(comptesRequis(contenu).obligatoires).toEqual([])
    expect(plan.etapes.flatMap((e) => e.lignes.filter((l) => estLignePartagee(e.table, l)))).toEqual([])
    // Le cabinet et cinq catégories communes : la restauration vérifie qu'ils existent, avant toute écriture.
    const externes = referencesExternes(contenu)
    expect([...new Set(externes.map((x) => x.parent))].sort()).toEqual(['cabinets', 'categories'])
    expect([...new Set(externes.filter((x) => x.parent === 'categories').flatMap((x) => x.valeurs))].sort())
      .toEqual(CATEGORIES_CITEES.map((k) => k.id).sort())
    expect(externes.filter((x) => x.parent === 'cabinets').flatMap((x) => x.valeurs)).toEqual([CABINET])
  })

  it('ne porte que les tables d’un dossier tenu : aucun exercice validé, aucun accès, aucune connexion, aucune facture', () => {
    expect(Object.keys(contenu).sort()).toEqual([
      'a_nouveaux', 'comptes_bancaires', 'controles_releves_bancaires', 'cotisations_declarees', 'debuts_d_activite', 'dossiers',
      'ecritures_brouillon', 'immobilisations', 'lignes_bancaires', 'natures_immobilisation', 'operations_caisse',
      'parametres_des_cotisations', 'pieces', 'reglements_groupes', 'vehicules',
    ])
    expect(contenu.ecritures_brouillon.every((e) => e.statut === 'proposee' && e.valide_le === null && e.numero_ecriture === null)).toBe(true)
    expect(contenu.dossiers[0]).toMatchObject({ ventes_par_les_factures: false, statut_tva: 'exonere', mode_comptable: 'tresorerie' })
  })

  it('date chaque ligne avant l’instant du fichier, et range chaque fichier de pièce sous son dossier', () => {
    const horodatages = Object.values(contenu).flatMap((lignes) => lignes.flatMap((l) =>
      ['created_at', 'updated_at', 'cree_le'].map((c) => l[c]).filter((v): v is string => typeof v === 'string')))
    expect(horodatages.length).toBeGreaterThan(800)
    expect(horodatages.filter((h) => !(h < FAITE_LE))).toEqual([])
    const pieces = contenu.pieces as unknown as Piece[]
    expect(pieces.filter((p) => !cheminDuDossier(p.storage_path, DOSSIER_DE_DEMONSTRATION))).toEqual([])
    expect(new Set(pieces.map((p) => p.storage_hash)).size).toBe(pieces.length)
    expect(pieces.every((p) => /^[0-9a-f]{64}$/.test(p.storage_hash ?? ''))).toBe(true)
  })
})

describe('les contrôles de l’application sur le dossier', () => {
  const dossier = composerLeDossier()
  const controles = controlesDuDossier(contenuDeLaSauvegarde(dossier, CABINET), CATEGORIES_CITEES)

  it('chaque relevé boucle sur ses mouvements', () => {
    expect(controles.relevesEnEcart).toEqual([])
    expect(dossier.controles).toHaveLength(21)
  })

  it(`la Vue d’ensemble au ${AUJOURD_HUI} dit les points voulus, et eux seuls`, () => {
    expect(controles.checklist.filter((p) => p.nb > 0).map(resumeDuPoint)).toEqual([
      // Le relevé de juillet 2026, volontairement absent : la suite des soldes rompt entre juin et août…
      'attention releves-en-rupture (1)',
      // … et l'achat de fournitures de juillet, validé, n'a pas de paiement au relevé : son montant n'y paraît pas…
      'erreur montant-suspect (1)',
      'attention doublons-probables (1)',
      'attention confiance-basse (1)',
      // … ni d'écriture de paiement.
      'attention sans-contrepartie (1)',
      'attention lignes-non-rapprochees (4)',
    ])
    expect(controles.checklist.find((p) => p.id === 'releves-en-rupture')?.detail).toContain('du 01/06/2026 au 30/06/2026, puis du 01/08/2026 au 31/08/2026')
  })

  it('la seule pièce validée sans paiement est l’achat de juillet 2026, que le relevé absent aurait payé', () => {
    const payees = new Set([
      ...dossier.lignes.flatMap((l) => (l.piece_id ? [l.piece_id] : [])), ...dossier.reglements.map((r) => r.piece_id),
      ...dossier.operations.flatMap((o) => (o.piece_id ? [o.piece_id] : [])),
    ])
    expect(dossier.pieces.filter((p) => p.statut === 'validee' && !payees.has(p.id)).map((p) => p.nom_fichier)).toEqual(['2026-07-fournitures.pdf'])
    expect(dossier.pieces.filter((p) => p.statut === 'a_valider')).toHaveLength(4)
  })

  it('la 2035 de 2025 se calcule, et concorde avec les écritures', () => {
    // Les recettes, par une arithmétique à part : les crédits classés « Ventes / prestations » de 2025, et douze recettes
    // en espèces de 120,00.
    const recettes = dossier.lignes.filter((l) => l.date.startsWith('2025-') && l.categorie_id === CATEGORIES_CITEES[3].id)
      .reduce((s, l) => s + Math.round(l.montant * 100), 0) + 12 * 12000
    expect(Math.round(controles.declaration2025.totalRecettes * 100)).toBe(recettes)
    expect(controles.declaration2025.sansPaiementConnu).toEqual([])
    expect(controles.cases2025.AA).toBe(recettes / 100)
    expect(controles.concordance2025.concorde).toBe(true)
    expect(controles.concordance2025.ecarts).toEqual([])
    expect(controles.declaration2025.resultat).toBeGreaterThan(0)
  })

  it('2025 se validerait sans aucun préalable : le mode d’emploi le dit, la validation figeant l’exercice', () => {
    expect(controles.prealables2025).toEqual([])
    expect(controles.validable2025).toBe(true)
  })
})
