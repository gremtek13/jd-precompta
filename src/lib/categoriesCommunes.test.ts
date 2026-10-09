import { describe, expect, it } from 'vitest'
import { CATEGORIE_NON_MODIFIEE, categorieCommuneNonReglable, categorieReglableIci } from './categoriesCommunes'
import { fichiersDuSchema } from '../test/schema'

// QUI RÈGLE UNE CATÉGORIE D'ICI : celle du dossier, quiconque voit le dossier ; celle qui est commune à tous les cabinets
// (`dossier_id` nul), le super-administrateur seul — la policy de `categories`, éprouvée par impersonation dans
// supabase/essais/categoriesCommunes.sql. Les écrans (Écritures, Clôture) en tirent le champ ou la phrase.
describe('categorieReglableIci', () => {
  it('une catégorie du dossier se règle, super-administrateur ou non', () => {
    expect(categorieReglableIci({ dossier_id: 'd1' }, false)).toBe(true)
    expect(categorieReglableIci({ dossier_id: 'd1' }, true)).toBe(true)
  })

  it('une catégorie commune, par le super-administrateur seul', () => {
    expect(categorieReglableIci({ dossier_id: null }, true)).toBe(true)
    expect(categorieReglableIci({ dossier_id: null }, false)).toBe(false)
  })
})

describe('ce que l’écran dit', () => {
  it('nomme ce qui ne se règle pas d’ici, et qui le règle', () => {
    expect(categorieCommuneNonReglable('compte'))
      .toBe('Catégorie commune à tous les cabinets : seul l’administrateur de l’application en règle le compte.')
    expect(categorieCommuneNonReglable('poste'))
      .toBe('Catégorie commune à tous les cabinets : seul l’administrateur de l’application en règle le poste.')
    expect(CATEGORIE_NON_MODIFIEE).toMatch(/^Rien n’a été enregistré : la base n’a modifié aucune catégorie\./)
  })
})

// LA RÈGLE DE L'ÉCRAN EST CELLE DE LA BASE : la policy exportée, relue ici, ne laisse écrire une ligne commune qu'au
// super-administrateur. Si une migration la change (une catégorie par cabinet, question Q9 de la conception du plan
// comptable personnalisable), ce test tombe, et l'écran se reprend avec elle.
describe('la policy d’écriture de `categories`, telle que l’export la porte', () => {
  // La DERNIÈRE définition de chaque policy, dans l'ordre où les migrations se rejouent : c'est celle que la base porte.
  const derniere = (policy: string): string | null => {
    let trouvee: string | null = null
    for (const { texte } of fichiersDuSchema()) {
      for (const m of texte.matchAll(new RegExp(`create policy "?${policy}"? on [\\s\\S]*?;`, 'gi'))) trouvee = m[0]
    }
    return trouvee
  }

  it('ne laisse écrire une ligne commune qu’au super-administrateur', () => {
    for (const policy of ['categories_update', 'categories_write']) {
      const definition = derniere(policy)
      expect(definition, `${policy} introuvable dans l’export`).not.toBeNull()
      expect(definition!.replace(/\s+/g, ' ')).toContain('(dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id))')
    }
  })
})
