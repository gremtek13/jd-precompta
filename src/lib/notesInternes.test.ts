import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// La note interne d'une pièce ou d'un document (espace client, P0) : ce qui part vers la base — la table, la cible, la
// clé de l'upsert —, et ce que l'écran reçoit quand la base refuse. Un faux client qui journalise chaque appel, et qui
// APPLIQUE le filtre de la lecture à de vraies lignes (src/test/filtresPostgrest.ts) : une lecture qui viserait la
// mauvaise colonne rendrait la note d'une autre cible, ou aucune.
const journal = {
  appels: [] as { table: string; operation: string; args: unknown[] }[],
}
const reponses = {
  /** Les lignes de `notes_internes`. */
  notes: [] as Record<string, unknown>[],
  /** Une lecture refusée par la base : l'erreur qu'elle rend. */
  erreurLecture: null as unknown,
  ecriture: { error: null as unknown },
  /** Une lecture qui LÈVE (réseau coupé) au lieu de rendre une erreur. */
  exception: null as Error | null,
}

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => ({
        select: (colonnes: string) => {
          journal.appels.push({ table, operation: 'select', args: [colonnes] })
          const predicats: ((ligne: Record<string, unknown>) => boolean)[] = []
          const chaine = {
            eq: (colonne: string, valeur: unknown) => {
              journal.appels.push({ table, operation: 'eq', args: [colonne, valeur] })
              predicats.push(predicatEq(colonne, valeur))
              return chaine
            },
            maybeSingle: () => {
              if (reponses.exception) return Promise.reject(reponses.exception)
              if (reponses.erreurLecture) return Promise.resolve({ data: null, error: reponses.erreurLecture })
              const lignes = filtrer(reponses.notes, predicats)
              // `maybeSingle` de PostgREST : plus d'une ligne est une erreur, aucune rend `null`.
              if (lignes.length > 1) return Promise.resolve({ data: null, error: { message: 'plusieurs lignes', code: 'PGRST116' } })
              const ligne = lignes[0]
              const rendue = ligne ? Object.fromEntries(colonnes.split(',').map((c) => [c.trim(), ligne[c.trim()]])) : null
              return Promise.resolve({ data: rendue, error: null })
            },
          }
          return chaine
        },
        upsert: (ligne: unknown, options: unknown) => {
          journal.appels.push({ table, operation: 'upsert', args: [ligne, options] })
          return Promise.resolve(reponses.ecriture)
        },
      }),
    },
  }
})

const { enregistrerNoteInterne, lireNoteInterne, noteModifiee } = await import('./notesInternes')

// Une pièce et un document qui partagent un identifiant : seule la COLONNE de la cible les départage.
const NOTES = [
  { id: 'n1', dossier_id: 'd1', piece_id: 'p1', document_id: null, texte: 'À relancer en janvier.' },
  { id: 'n2', dossier_id: 'd1', piece_id: 'p2', document_id: null, texte: 'Note de la pièce p2.' },
  { id: 'n3', dossier_id: 'd1', piece_id: null, document_id: 'd7', texte: 'Note du document.' },
  { id: 'n4', dossier_id: 'd1', piece_id: null, document_id: 'p1', texte: 'Le document qui porte l’identifiant de p1.' },
]

beforeEach(() => {
  journal.appels = []
  reponses.notes = NOTES
  reponses.erreurLecture = null
  reponses.ecriture = { error: null }
  reponses.exception = null
})

describe('lireNoteInterne', () => {
  it('lit la note de sa cible, et d’elle seule', async () => {
    expect(await lireNoteInterne({ type: 'piece', id: 'p1' })).toEqual({ etat: 'lue', texte: 'À relancer en janvier.' })
    expect(journal.appels).toEqual([
      { table: 'notes_internes', operation: 'select', args: ['texte'] },
      { table: 'notes_internes', operation: 'eq', args: ['piece_id', 'p1'] },
    ])
    expect(await lireNoteInterne({ type: 'document', id: 'd7' })).toEqual({ etat: 'lue', texte: 'Note du document.' })
    expect(await lireNoteInterne({ type: 'document', id: 'p1' }))
      .toEqual({ etat: 'lue', texte: 'Le document qui porte l’identifiant de p1.' })
  })

  it('sans ligne, la note est lue et vide', async () => {
    expect(await lireNoteInterne({ type: 'piece', id: 'p9' })).toEqual({ etat: 'lue', texte: '' })
  })

  it('une lecture refusée n’est pas une note vide : elle dit sa raison', async () => {
    // Un objet nu, comme PostgREST le rend : pas une `Error` (CLAUDE.md, « Erreurs »).
    reponses.erreurLecture = { message: 'permission denied for table notes_internes', code: '42501' }
    expect(await lireNoteInterne({ type: 'piece', id: 'p1' }))
      .toEqual({ etat: 'illisible', message: 'permission denied for table notes_internes' })
    reponses.erreurLecture = {}
    expect(await lireNoteInterne({ type: 'piece', id: 'p1' }))
      .toEqual({ etat: 'illisible', message: 'La note interne n’a pas pu être lue.' })
  })

  it('ne lève jamais : une exception devient une lecture illisible, avec sa raison', async () => {
    reponses.exception = new Error('Failed to fetch')
    expect(await lireNoteInterne({ type: 'piece', id: 'p1' })).toEqual({ etat: 'illisible', message: 'Failed to fetch' })
  })
})

describe('enregistrerNoteInterne', () => {
  it('crée ou remplace la note de sa cible : l’upsert vise la contrainte unique de la cible', async () => {
    await enregistrerNoteInterne('d1', { type: 'piece', id: 'p1' }, 'Vu avec le client.')
    await enregistrerNoteInterne('d1', { type: 'document', id: 'doc-2' }, '')
    expect(journal.appels).toEqual([
      { table: 'notes_internes', operation: 'upsert', args: [{ dossier_id: 'd1', piece_id: 'p1', texte: 'Vu avec le client.' }, { onConflict: 'piece_id' }] },
      // Effacée, une note reste une ligne au texte vide : rien ne la retire.
      { table: 'notes_internes', operation: 'upsert', args: [{ dossier_id: 'd1', document_id: 'doc-2', texte: '' }, { onConflict: 'document_id' }] },
    ])
  })

  it('les cibles de l’upsert sont les contraintes uniques TOTALES de la migration', () => {
    // Un index unique partiel ne peut pas être visé par `on conflict` (CLAUDE.md) : relu dans la migration appliquée.
    const migration = readFileSync(resolve(process.cwd(), 'supabase/schema/20261009185236_notes_internes_du_cabinet.sql'), 'utf8')
    expect(migration).toContain('constraint notes_internes_piece_unique unique (piece_id),')
    expect(migration).toContain('constraint notes_internes_document_unique unique (document_id)')
    expect(migration).toContain('constraint notes_internes_une_seule_cible check (num_nonnulls(piece_id, document_id) = 1)')
    expect(migration).toContain('texte text not null,')
  })

  it('une écriture refusée lève, avec la raison de la base', async () => {
    reponses.ecriture = { error: { message: 'new row violates row-level security policy for table "notes_internes"', code: '42501' } }
    await expect(enregistrerNoteInterne('d1', { type: 'piece', id: 'p1' }, 'x'))
      .rejects.toThrow('new row violates row-level security policy for table "notes_internes"')
    reponses.ecriture = { error: {} }
    await expect(enregistrerNoteInterne('d1', { type: 'piece', id: 'p1' }, 'x'))
      .rejects.toThrow('La note interne n’a pas pu être enregistrée.')
  })
})

describe('noteModifiee', () => {
  it('rien à écrire tant que la note n’est pas lue, ni si sa lecture a échoué', () => {
    // Le champ est vide faute d'avoir lu : l'écrire effacerait la note en base.
    expect(noteModifiee(null, '')).toBe(false)
    expect(noteModifiee(null, 'tapé pendant la lecture')).toBe(false)
    expect(noteModifiee({ etat: 'illisible', message: 'refus' }, '')).toBe(false)
    expect(noteModifiee({ etat: 'illisible', message: 'refus' }, 'x')).toBe(false)
  })

  it('une note lue est à écrire dès que la saisie en diffère, effacement compris', () => {
    expect(noteModifiee({ etat: 'lue', texte: 'a' }, 'a')).toBe(false)
    expect(noteModifiee({ etat: 'lue', texte: 'a' }, 'b')).toBe(true)
    expect(noteModifiee({ etat: 'lue', texte: 'a' }, '')).toBe(true)
    expect(noteModifiee({ etat: 'lue', texte: '' }, 'nouvelle')).toBe(true)
    // Une note absente et un champ laissé vide : aucune ligne vide créée pour rien.
    expect(noteModifiee({ etat: 'lue', texte: '' }, '')).toBe(false)
  })
})
