import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEVIS_CITENT_UN_CONTACT, REFUS_CONTACT_DU_DEVIS, RETENUE_CONTACT_DU_DEVIS, modelesDEnregistrementDevis, refusEnregistrementDevis,
  type EcritureDevis, type EmissionAJuger,
} from './devis'
import { fichiersDuSchema, indiceSql } from '../test/schema'

// LES DEVIS CITENT LEUR CONTACT (migration `devis_citent_un_contact`, en production depuis le 07/11/2026). Ce que ces cas
// gardent : le module redit le refus 16 bis de la migration, à sa place et sous ses mots ; son essai l'exige de la base sous
// P0002 ; la fonction lit la clé que le module écrit ; le drapeau suit l'export, qui porte la migration ; et le
// jugement avant le clic : la liste lue en entier, ou rien ne part.

const MIGRATION = readFileSync(new URL('../../supabase/schema/20261107163632_devis_citent_un_contact.sql', import.meta.url), 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/devisCitentUnContact.sql', import.meta.url), 'utf8')
const sansDoubles = (s: string) => s.replace(/''/g, "'")
const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))

function definition(texte: string, nom: string): string {
  const debut = indiceSql(texte, `create or replace function public.${nom}(`)
  if (debut < 0) throw new Error(`${nom} absente`)
  return texte.slice(debut, texte.indexOf('\n$$;', debut))
}

describe('la migration de l’export et son essai', () => {
  it('enregistrer_devis lève les refus du module, le contact entre les montants et l’IBAN', () => {
    expect(messagesSql(definition(MIGRATION, 'enregistrer_devis'))).toEqual(modelesDEnregistrementDevis(true))
    expect(modelesDEnregistrementDevis(false)).not.toContain(REFUS_CONTACT_DU_DEVIS.modele)
  })

  it('elle lit la clé `contact_id`, et les deux fonctions qui tirent une facture la reprennent', () => {
    expect(definition(MIGRATION, 'enregistrer_devis')).toContain("p_devis->>'contact_id'")
    for (const nom of ['facturer_devis', 'facturer_acompte_devis']) {
      expect(definition(MIGRATION, nom)).toContain("'contact_id', (select c.id from public.contacts c where c.id = v_devis.contact_id and c.dossier_id = p_dossier_id)")
    }
  })

  it('l’essai exige le refus de la base sous P0002 et ses mots', () => {
    const exige = `'P0002', '${REFUS_CONTACT_DU_DEVIS.modele.replace(/'/g, "''")}'`
    expect(ESSAI.split(exige).length - 1).toBeGreaterThanOrEqual(5)
  })

  it('le drapeau suit l’export : levé, la migration y est', () => {
    const exportee = fichiersDuSchema().some((f) => f.chemin.includes('devis_citent_un_contact'))
    expect(DEVIS_CITENT_UN_CONTACT).toBe(exportee)
  })
})

describe('refusEnregistrementDevis : le contact, avant le clic', () => {
  const EMISSION: EmissionAJuger = {
    dossier: { nom: 'D', siret: '12345678200010', adresse: '1 rue', forme_juridique: '5710', denomination_imprimee: 'D SAS' },
    cabinet: true,
  }
  const ecriture = (devis: Record<string, unknown>): EcritureDevis => ({
    devis: { tiers_nom: 'ESSAI', date_emission: '2026-11-06', date_validite: '2026-12-06', montant_ht: 100, montant_tva: 20, montant_ttc: 120, ...devis },
    lignes: [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    emettre: false,
  })
  const juger = (devis: Record<string, unknown>, contacts: readonly { id: string }[] | null) =>
    refusEnregistrementDevis('d1', { nouveau: true }, ecriture(devis), '2026-11-06', EMISSION, contacts)?.cle ?? null

  it('un contact du dossier passe ; un autre, ou qui n’est pas une chaîne, se refuse aux mots de la base', () => {
    expect(juger({ contact_id: 'k1' }, [{ id: 'k1' }])).toBeNull()
    expect(juger({ contact_id: 'k9' }, [{ id: 'k1' }])).toBe('contact_introuvable')
    expect(juger({ contact_id: 12 }, [{ id: '12' }])).toBe('contact_introuvable')
    const r = refusEnregistrementDevis('d1', { nouveau: true }, ecriture({ contact_id: 'k9' }), '2026-11-06', EMISSION, [])
    expect(r?.message).toBe(REFUS_CONTACT_DU_DEVIS.modele)
  })

  it('sans la liste lue en entier, une saisie qui nomme un contact est retenue ; une qui n’en nomme aucun ne demande rien', () => {
    expect(juger({ contact_id: 'k1' }, null)).toBe('contact_non_lu')
    expect(refusEnregistrementDevis('d1', { nouveau: true }, ecriture({ contact_id: 'k1' }), '2026-11-06', EMISSION)?.message)
      .toBe(RETENUE_CONTACT_DU_DEVIS)
    // Le chemin par défaut : ni liste ni contact, rien ne change.
    expect(refusEnregistrementDevis('d1', { nouveau: true }, ecriture({}), '2026-11-06', EMISSION)).toBeNull()
    expect(juger({ contact_id: null }, null)).toBeNull()
  })

  it('l’ordre de la base : des montants faux d’abord, puis le contact, puis un IBAN', () => {
    expect(juger({ contact_id: 'k9', montant_ht: 1 }, [])).toBe('montants_incoherents')
    expect(juger({ contact_id: 'k9', objet: 'FR7630006000011234567890189' }, [])).toBe('contact_introuvable')
    expect(juger({ contact_id: 'k1', objet: 'FR7630006000011234567890189' }, [{ id: 'k1' }])).toBe('iban_dans_un_texte')
  })
})
