import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import {
  ETAT_DU_DOSSIER_EXPORTE, exercicesDeLaBase, lectureDeLEtat, lireLEtatDuDossier, phraseDeLExercice, SI_LA_LECTURE_MANQUE,
  statutDeLExercice, TITRE_DE_LA_CARTE, type EtatDUnExercice,
} from './etatDuDossier'
import { fichiersDuSchema } from '../test/schema'

// L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT (ligne 51.5, étape C2). Ce qui se garde ici : une réponse de la base
// qu'on ne sait pas lire ne passe jamais pour une liste ; chaque phase se dit aux mots du client, sans rien dire de plus
// que la base ; la migration de l'export (en production depuis le 07/11/2026) est celle que le module lit, et le drapeau dit ce que porte l'export.

const ligne = (p: Partial<Record<string, unknown>> = {}) => ({ annee: 2026, phase: 'pieces_attendues', valide_le: null, declaration_2035: false, ...p })
const MIGRATION = readFileSync(new URL('../../supabase/schema/20261107145111_phase_des_exercices.sql', import.meta.url), 'utf8')

describe('ce que la base rend', () => {
  it('lit les quatre phases, du plus récent au plus ancien', () => {
    expect(exercicesDeLaBase([
      ligne(), ligne({ annee: 2025, phase: 'en_revision' }), ligne({ annee: 2024, phase: 'en_cours' }),
      ligne({ annee: 2023, phase: 'validee', valide_le: '2024-05-01', declaration_2035: true }),
    ])).toEqual([
      { annee: 2026, phase: 'pieces_attendues', valideLe: null, declaration2035: false },
      { annee: 2025, phase: 'en_revision', valideLe: null, declaration2035: false },
      { annee: 2024, phase: 'en_cours', valideLe: null, declaration2035: false },
      { annee: 2023, phase: 'validee', valideLe: '2024-05-01', declaration2035: true },
    ])
    expect(exercicesDeLaBase([])).toEqual([])
  })

  it.each([
    ['pas une liste', { annee: 2026 }],
    ['une clé de plus', [ligne({ montant: 12 })]],
    ['une clé de moins', [{ annee: 2026, phase: 'en_cours', valide_le: null }]],
    ['une phase inconnue', [ligne({ phase: 'deposee' })]],
    ['une année hors des bornes', [ligne({ annee: 1999 })]],
    ['une date sur un exercice non validé', [ligne({ valide_le: '2026-01-02' })]],
    ['une 2035 hors d’un exercice validé', [ligne({ declaration_2035: true })]],
    ['un exercice validé sans date', [ligne({ phase: 'validee' })]],
    ['un jour qui n’existe pas', [ligne({ phase: 'validee', valide_le: '2026-02-30' })]],
    ['deux fois la même année', [ligne(), ligne()]],
    ['un ordre qui n’est pas celui de la base', [ligne({ annee: 2025 }), ligne()]],
  ])('refuse %s', (_cas, rendu) => {
    expect(exercicesDeLaBase(rendu)).toBeNull()
  })

  it('un refus, une réponse illisible ou une requête qui lève se signalent, sans exercice — jamais un rejet', async () => {
    expect(lectureDeLEtat({ data: null, error: { message: 'Accès refusé à ce dossier.' } }))
      .toEqual({ complete: false, motif: 'lecture refusée : Accès refusé à ce dossier.' })
    expect(lectureDeLEtat({ data: 'n’importe quoi', error: null })).toEqual({ complete: false, motif: 'réponse illisible' })
    expect(lectureDeLEtat({ data: [ligne()], error: null }))
      .toEqual({ complete: true, exercices: [{ annee: 2026, phase: 'pieces_attendues', valideLe: null, declaration2035: false }] })
    const leve = { then: () => { throw new Error('réseau coupé') } } as unknown as PromiseLike<{ data: unknown; error: unknown }>
    await expect(lireLEtatDuDossier(leve)).resolves.toEqual({ complete: false, motif: 'lecture impossible : réseau coupé' })
  })
})

describe('les mots du client', () => {
  const exercices: EtatDUnExercice[] = [
    { annee: 2026, phase: 'pieces_attendues', valideLe: null, declaration2035: false },
    { annee: 2025, phase: 'en_revision', valideLe: null, declaration2035: false },
    { annee: 2024, phase: 'en_cours', valideLe: null, declaration2035: false },
    { annee: 2023, phase: 'validee', valideLe: '2024-05-01', declaration2035: true },
    { annee: 2022, phase: 'validee', valideLe: '2023-03-02', declaration2035: false },
  ]

  it('chaque phase dit ce que la base prouve, et rien de plus', () => {
    expect(exercices.map(phraseDeLExercice)).toEqual([
      'Ton cabinet attend encore tes pièces de cette année.',
      'Ton cabinet révise tes comptes.',
      'En cours chez ton cabinet.',
      'Comptes validés le 01/05/2024, ta 2035 est enregistrée.',
      'Comptes validés le 02/03/2023.',
    ])
    expect(exercices.map(statutDeLExercice)).toEqual(['warning', 'neutral', 'neutral', 'ok', 'ok'])
    // La base ne sait rien du dépôt : jamais « déposée ».
    expect(exercices.map(phraseDeLExercice).join(' ')).not.toMatch(/dépos/i)
  })

  it('aucun mot du cabinet, aucun chiffre que la base ne rend pas', () => {
    for (const texte of [...exercices.map(phraseDeLExercice), TITRE_DE_LA_CARTE, SI_LA_LECTURE_MANQUE]) {
      expect(motsDuCabinet(texte), texte).toEqual([])
      expect(texte).not.toMatch(/€|\bcompte \d|\d+ (pièces?|mois|écritures?)/i)
    }
  })
})

describe('la migration préparée est celle que le module lit', () => {
  it('l’accès d’abord, quatre clés, exécutable par les connectés seuls, aucune table ni policy', () => {
    expect(MIGRATION).toMatch(/create function public\.phase_des_exercices\(p_dossier_id uuid\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public/)
    expect(MIGRATION).toContain("or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre'))")
    expect(MIGRATION.indexOf("raise exception 'Accès refusé à ce dossier.' using errcode = '42501'"))
      .toBeLessThan(MIGRATION.indexOf('from public.revision_conclusions'))
    expect([...MIGRATION.matchAll(/^\s+'(\w+)', /gm)].map((m) => m[1])).toEqual(['annee', 'phase', 'valide_le', 'declaration_2035'])
    expect([...MIGRATION.matchAll(/then '(\w+)'|else '(\w+)'/g)].map((m) => m[1] ?? m[2]).sort())
      .toEqual(['en_cours', 'en_revision', 'pieces_attendues', 'validee'])
    expect(MIGRATION).toContain("(v.valide_le at time zone 'Europe/Paris')::date")
    expect(MIGRATION).toContain('revoke execute on function public.phase_des_exercices(uuid) from public, anon;')
    expect(MIGRATION).toContain('grant execute on function public.phase_des_exercices(uuid) to authenticated;')
    expect(MIGRATION).not.toMatch(/create (table|policy|trigger)|alter table|\bdrop\b|\bdelete\b|\\|\r/i)
  })

  it('ETAT_DU_DOSSIER_EXPORTE si et seulement si l’export porte la fonction', () => {
    const exportee = fichiersDuSchema().some((f) => /create (or replace )?function public\.phase_des_exercices\(/.test(f.texte))
    expect(exportee, 'ETAT_DU_DOSSIER_EXPORTE ne dit plus ce que porte l’export').toBe(ETAT_DU_DOSSIER_EXPORTE)
  })
})
