import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONNEXIONS_HORS_PERIMETRE, HORS_PERIMETRE_DES_SECRETS, NUMEROTATION_HORS_PERIMETRE, RestaurationInterrompue,
  descriptionDuRetrait, dossierPartielDe, horsPerimetreAAfficher, messageApresRetrait, nomDuDossierPartiel,
  type DossierPartiel,
} from './restaurationInterrompue'

// RESTAU-Q2 et RESTAU-Q3 (09/11/2026) : les mots de la restauration interrompue et de ce que la sauvegarde ne porte pas.
// Que `restaurerSauvegarde` ne lève une `RestaurationInterrompue` qu'après avoir créé le dossier se garde dans
// sauvegardeDonnees.test.ts ; le bouton, ses verrous et sa confirmation dans RestaurationCard.test.tsx.

const partiel: DossierPartiel = {
  id: 'd1', nom: 'Cabinet Martin', lignesEcrites: { dossiers: 1, pieces: 2, lignes_bancaires: 0 }, partageesEcrites: 0,
}

describe('le dossier partiel', () => {
  it('ne se lit que d’une RestaurationInterrompue', () => {
    expect(dossierPartielDe(new RestaurationInterrompue('arrêt', partiel))).toBe(partiel)
    expect(dossierPartielDe(new Error('arrêt'))).toBeNull()
    expect(dossierPartielDe({ dossierPartiel: partiel })).toBeNull()
    expect(dossierPartielDe(null)).toBeNull()
  })

  it('se nomme par son nom, son identifiant à défaut', () => {
    expect(nomDuDossierPartiel(partiel)).toBe('Cabinet Martin')
    expect(nomDuDossierPartiel({ ...partiel, nom: '' })).toBe('d1')
  })

  it('la confirmation nomme le dossier, compte ce qui part, et dit ce qui reste', () => {
    const texte = descriptionDuRetrait(partiel)
    expect(texte).toMatch(/^Cette action supprime définitivement le dossier « Cabinet Martin » \(d1\)/)
    expect(texte).toMatch(/les 3 ligne\(s\) déjà réinsérées sur 2 table\(s\)\./)
    expect(texte).toMatch(/Le stockage n'est pas touché/)
    expect(texte).toMatch(/la restauration pourra repartir/)
    expect(texte).not.toMatch(/communes à tous les dossiers/)
    expect(descriptionDuRetrait({ ...partiel, partageesEcrites: 2 })).toMatch(/2 ligne\(s\) communes à tous les dossiers .* restent/)
  })

  it('le message d’après le retrait', () => {
    expect(messageApresRetrait(partiel)).toBe(
      'Dossier partiel « Cabinet Martin » retiré, avec ce que la tentative avait écrit. Le stockage n\'a pas été touché. La restauration peut repartir.',
    )
  })
})

describe('ce que la sauvegarde ne porte pas (RESTAU-Q3)', () => {
  it('nomme chaque table sans policy et ce qu’il faut refaire après', () => {
    expect(CONNEXIONS_HORS_PERIMETRE.map((l) => l.match(/`(\w+)`/)?.[1])).toEqual([
      'connexions_bancaires', 'connexions_plateformes', 'superpdp_credentials',
    ])
    for (const ligne of CONNEXIONS_HORS_PERIMETRE) expect(ligne).toMatch(/Après une restauration, /)
    expect(NUMEROTATION_HORS_PERIMETRE).toMatch(/`facture_numerotation`, `devis_numerotation`/)
    expect(NUMEROTATION_HORS_PERIMETRE).toMatch(/Rien n’est perdu : la numérotation reprend du plus haut numéro émis/)
  })

  it('la raison pour laquelle rien n’est perdu est celle du texte exporté : le plus grand du repère et du plus haut émis', () => {
    const lire = (fichier: string) => readFileSync(new URL(`../../supabase/schema/${fichier}`, import.meta.url), 'utf8')
    // `prochain_numero_facture`, dans sa dernière définition, et `enregistrer_devis` dans la sienne.
    expect(lire('20261010123950_ventes_du_client.sql')).toMatch(/v_numero := greatest\(v_compteur, v_emis\) \+ 1;/)
    expect(lire('20261107163632_devis_citent_un_contact.sql')).toMatch(/v_sequence := greatest\(v_repere, v_emis\) \+ 1;/)
  })

  it('une sauvegarde d’avant reçoit ces lignes à l’écran ; une d’après ne les reçoit pas deux fois', () => {
    expect(horsPerimetreAAfficher({ horsPerimetre: ['A'] })).toEqual(['A', ...HORS_PERIMETRE_DES_SECRETS])
    const recente = ['A', ...HORS_PERIMETRE_DES_SECRETS, 'B']
    expect(horsPerimetreAAfficher({ horsPerimetre: recente })).toEqual(recente)
  })
})
