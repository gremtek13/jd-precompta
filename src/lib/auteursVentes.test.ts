import { describe, expect, it } from 'vitest'
import {
  ACCES_EN_COURS, ACCES_SANS_OBJET, AIDE_DU_FILTRE, PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, accesDeLaLecture, emiseParLeClient,
  estLeClient, etatDuFiltre, pastilleParLeClient, type AccesDuDossier,
} from './auteursVentes'

// QUI, DES AUTEURS D'UNE VENTE, EST LE CLIENT (espace client, étape P4c). Un compte est « le client » quand il porte un
// accès client du dossier — et seulement sur une liste lue EN ENTIER. Ce que ces cas gardent : l'auteur nul n'est personne ;
// en cours, partielle, refusée ou sans objet, la liste ne reconnaît personne ; un compte inconnu n'est jamais dit « du cabinet » ;
// la pastille suit le statut (validée : `valide_par`, brouillon : `created_by`), jamais l'autre colonne.

const LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client', 'u-second'] }

describe('accesDeLaLecture', () => {
  it('entière : les comptes des accès, sans doublon ni vide', () => {
    const acces = accesDeLaLecture({
      lignes: [{ user_id: 'u-client' }, { user_id: 'u-second' }, { user_id: 'u-client' }, { user_id: null }, { user_id: '' }],
      complete: true, motif: null,
    })
    expect(acces).toEqual({ etat: 'lus', comptes: ['u-client', 'u-second'] })
  })

  it('une liste entière et vide est une liste lue : le dossier n’a pas d’accès client', () => {
    expect(accesDeLaLecture({ lignes: [], complete: true, motif: null })).toEqual({ etat: 'lus', comptes: [] })
  })

  it('partielle : le motif seul, même si des lignes sont revenues', () => {
    const acces = accesDeLaLecture({ lignes: [{ user_id: 'u-client' }], complete: false, motif: 'lecture interrompue après 1 ligne(s) : coupée' })
    expect(acces).toEqual({ etat: 'incomplets', motif: 'lecture interrompue après 1 ligne(s) : coupée' })
  })

  it('partielle sans motif : un motif tout de même', () => {
    expect(accesDeLaLecture({ lignes: [], complete: false, motif: null })).toEqual({ etat: 'incomplets', motif: 'lecture incomplète' })
  })
})

describe('estLeClient', () => {
  it('reconnaît un compte qui porte un accès, sur une liste lue en entier', () => {
    expect(estLeClient(LUS, 'u-client')).toBe(true)
    expect(estLeClient(LUS, 'u-second')).toBe(true)
  })

  it('ne reconnaît ni un autre compte, ni un accès retiré depuis', () => {
    expect(estLeClient(LUS, 'u-cabinet')).toBe(false)
    expect(estLeClient({ etat: 'lus', comptes: [] }, 'u-client')).toBe(false)
  })

  it('un auteur nul, absent ou vide n’est personne', () => {
    expect(estLeClient(LUS, null)).toBe(false)
    expect(estLeClient(LUS, undefined)).toBe(false)
    expect(estLeClient(LUS, '')).toBe(false)
    // Même une liste qui porterait un identifiant vide ne le reconnaît pas.
    expect(estLeClient({ etat: 'lus', comptes: [''] }, '')).toBe(false)
  })

  it('en cours, partielle ou sans objet : personne, pas même un compte que la liste porterait', () => {
    expect(estLeClient(ACCES_EN_COURS, 'u-client')).toBe(false)
    expect(estLeClient({ etat: 'incomplets', motif: 'coupée' }, 'u-client')).toBe(false)
    expect(estLeClient(ACCES_SANS_OBJET, 'u-client')).toBe(false)
  })
})

describe('pastilleParLeClient', () => {
  const validee = (o: { valide_par: string | null; created_by: string | null }) => ({ statut: 'validee' as const, ...o })
  const brouillon = (o: { valide_par: string | null; created_by: string | null }) => ({ statut: 'brouillon' as const, ...o })

  it('une validée se lit à `valide_par`, jamais à `created_by`', () => {
    expect(pastilleParLeClient(LUS, validee({ valide_par: 'u-client', created_by: 'u-cabinet' })))
      .toEqual({ libelle: PAR_LE_CLIENT, titre: TITRES_PAR_LE_CLIENT.validee })
    // Rédigée par le client, validée par le cabinet : c'est le cabinet qui l'a émise.
    expect(pastilleParLeClient(LUS, validee({ valide_par: 'u-cabinet', created_by: 'u-client' }))).toBeNull()
    // D'avant P2 : aucun auteur.
    expect(pastilleParLeClient(LUS, validee({ valide_par: null, created_by: 'u-client' }))).toBeNull()
  })

  it('un brouillon se lit à `created_by`, jamais à `valide_par`', () => {
    expect(pastilleParLeClient(LUS, brouillon({ valide_par: null, created_by: 'u-client' })))
      .toEqual({ libelle: PAR_LE_CLIENT, titre: TITRES_PAR_LE_CLIENT.brouillon })
    expect(pastilleParLeClient(LUS, brouillon({ valide_par: null, created_by: 'u-cabinet' }))).toBeNull()
    expect(pastilleParLeClient(LUS, brouillon({ valide_par: null, created_by: null }))).toBeNull()
    // Une valeur de `valide_par` sur un brouillon (la base la refuse) ne fait pas un brouillon « du client ».
    expect(pastilleParLeClient(LUS, brouillon({ valide_par: 'u-client', created_by: 'u-cabinet' }))).toBeNull()
  })

  it('aucune sur des accès non lus en entier', () => {
    const f = validee({ valide_par: 'u-client', created_by: 'u-client' })
    expect(pastilleParLeClient(ACCES_EN_COURS, f)).toBeNull()
    expect(pastilleParLeClient({ etat: 'incomplets', motif: 'coupée' }, f)).toBeNull()
    expect(pastilleParLeClient(ACCES_SANS_OBJET, f)).toBeNull()
  })
})

describe('emiseParLeClient', () => {
  it('les VALIDÉES (factures et avoirs) dont le client est l’auteur de la validation, rien d’autre', () => {
    expect(emiseParLeClient(LUS, { statut: 'validee', valide_par: 'u-client' })).toBe(true)
    expect(emiseParLeClient(LUS, { statut: 'validee', valide_par: 'u-cabinet' })).toBe(false)
    expect(emiseParLeClient(LUS, { statut: 'validee', valide_par: null })).toBe(false)
    expect(emiseParLeClient(LUS, { statut: 'brouillon', valide_par: 'u-client' })).toBe(false)
    expect(emiseParLeClient(ACCES_EN_COURS, { statut: 'validee', valide_par: 'u-client' })).toBe(false)
  })
})

describe('etatDuFiltre', () => {
  it('disponible sur des accès lus en entier, même sans aucun accès', () => {
    expect(etatDuFiltre(LUS)).toEqual({ disponible: true })
    expect(etatDuFiltre({ etat: 'lus', comptes: [] })).toEqual({ disponible: true })
  })

  it('grisé avec sa raison sinon : en cours, partiel avec son motif, sans objet', () => {
    expect(etatDuFiltre(ACCES_EN_COURS)).toEqual({ disponible: false, raison: 'Les accès du dossier sont en cours de lecture.' })
    const partiel = etatDuFiltre({ etat: 'incomplets', motif: 'accès refusé' })
    expect(partiel.disponible).toBe(false)
    expect(partiel.disponible === false && partiel.raison).toContain('accès refusé')
    expect(partiel.disponible === false && partiel.raison).toContain('pas été lue en entier')
    expect(etatDuFiltre(ACCES_SANS_OBJET).disponible).toBe(false)
  })

  it('l’aide dit ce que la case ne reconnaît plus : un accès retiré', () => {
    expect(AIDE_DU_FILTRE).toContain('accès retiré')
    expect(AIDE_DU_FILTRE).toContain('n’est plus reconnu')
  })
})

describe('les mots', () => {
  it('une seule mention, jamais « par le cabinet » : ce qu’on ne reconnaît pas n’est pas attribué', () => {
    const tout = JSON.stringify([PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, AIDE_DU_FILTRE])
    expect(tout).not.toMatch(/par le cabinet|du cabinet/i)
  })
})
