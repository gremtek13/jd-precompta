import { describe, expect, it } from 'vitest'
import { ajouterJours, ajouterMois, anneeDe, anneeLocaleDe, aujourdHuiSql, cleFournisseur, comptesParMois, dateLocaleDe, dernierJourDuMois, formatDate, jourDe, moisDe, nomUnique, premierJourDuMoisCourant } from './format'

// Ces primitives existent pour une raison précise : trois calculs de dates de l'application
// passaient par `new Date(...)` puis `toISOString()`, ce qui rendait la veille du bon jour dès que
// le fuseau local est à l'est de Greenwich (minuit à Paris = 22 h UTC la veille en été). Les cas
// ci-dessous sont ceux qui échouaient réellement avant le correctif — d'où leur précision.
describe('ajouterMois', () => {
  it("ramène un quantième absent au dernier jour du mois d'arrivée", () => {
    // Convention des échéanciers de prêt. `setMonth()` rendait le 3 mars.
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28')
    expect(ajouterMois('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('tient compte des années bissextiles', () => {
    expect(ajouterMois('2024-01-31', 1)).toBe('2024-02-29')
  })

  it("garde le même quantième à travers le passage à l'heure d'été", () => {
    // Paris passe de UTC+1 à UTC+2 fin mars : l'ancien calcul rendait le 14 juillet.
    expect(ajouterMois('2026-01-15', 6)).toBe('2026-07-15')
  })

  it('franchit les fins d’année dans les deux sens', () => {
    expect(ajouterMois('2026-11-15', 3)).toBe('2027-02-15')
    expect(ajouterMois('2026-01-15', -1)).toBe('2025-12-15')
    expect(ajouterMois('2026-02-10', -6)).toBe('2025-08-10')
  })

  it('accepte un décalage nul et un recul de douze mois', () => {
    expect(ajouterMois('2026-07-04', 0)).toBe('2026-07-04')
    expect(ajouterMois('2026-05-31', -12)).toBe('2025-05-31')
  })

  it('ignore une éventuelle partie horaire', () => {
    expect(ajouterMois('2026-01-15T23:30:00Z', 1)).toBe('2026-02-15')
  })
})

describe('anneeDe, moisDe, jourDe', () => {
  it('lit le 1er janvier dans la bonne année', () => {
    // Le cas qui décide : `new Date('2026-01-01').getFullYear()` rend 2025 à New York, parce que
    // minuit UTC y est encore le 31 décembre. C'est l'année qui choisit la suite de numérotation
    // d'une facture — une suite annuelle légalement sans trou.
    expect(anneeDe('2026-01-01')).toBe(2026)
    expect(anneeDe('2026-12-31')).toBe(2026)
  })

  it('lit le mois en 1-12 et le jour sans décalage', () => {
    expect(moisDe('2026-01-01')).toBe(1)
    expect(moisDe('2026-12-31')).toBe(12)
    expect(jourDe('2026-03-10')).toBe(10)
    expect(jourDe('2026-03-01')).toBe(1)
  })

  it('accepte aussi un horodatage complet', () => {
    expect(anneeDe('2026-07-04T22:30:00Z')).toBe(2026)
    expect(moisDe('2026-07-04T22:30:00Z')).toBe(7)
    expect(jourDe('2026-07-04T22:30:00Z')).toBe(4)
  })
})

describe('anneeLocaleDe', () => {
  it('classe un horodatage dans l’année que voit l’utilisateur', () => {
    // La propriété, énoncée sans dépendre du fuseau du runner : un dépôt que l'utilisateur vit
    // comme le 1er janvier à 00 h 30 doit compter dans la nouvelle année, quel que soit le libellé
    // UTC de l'horodatage. À Paris ce moment s'écrit 2025-12-31T23:30:00Z — lire son libellé le
    // rangerait en 2025, alors que l'utilisateur vient de le déposer en 2026.
    const reveillonLocal = new Date(2026, 0, 1, 0, 30)
    const horodatage = reveillonLocal.toISOString()

    expect(anneeLocaleDe(horodatage)).toBe(2026)

    // Et là où le fuseau est à l'est de Greenwich, le libellé diverge bien — c'est toute la raison
    // d'être des deux fonctions. Ailleurs, les deux coïncident et il n'y a rien à démontrer.
    if (horodatage.startsWith('2025')) {
      expect(anneeDe(horodatage)).toBe(2025)
    }
  })

  it('coïncide avec le libellé en dehors de la bascule', () => {
    expect(anneeLocaleDe('2026-06-15T10:00:00Z')).toBe(2026)
    expect(anneeLocaleDe('2026-01-02T12:00:00Z')).toBe(2026)
  })
})

describe('dateLocaleDe', () => {
  it('rend la date civile que vit l’utilisateur', () => {
    // Sert de date de repli à une écriture ou à une date d'acquisition d'immobilisation quand la
    // pièce ne porte pas de date : prendre le libellé UTC daterait de la veille tout ce qui est
    // déposé entre minuit et 1 ou 2 h du matin, et rangerait un dépôt du Nouvel An dans
    // l'exercice précédent.
    const minuitPasse = new Date(2026, 0, 1, 0, 30)
    expect(dateLocaleDe(minuitPasse.toISOString())).toBe('2026-01-01')

    const unJourQuelconque = new Date(2026, 6, 4, 15, 0)
    expect(dateLocaleDe(unJourQuelconque.toISOString())).toBe('2026-07-04')
  })

  it('produit toujours une date SQL bien formée', () => {
    expect(dateLocaleDe(new Date(2026, 8, 5, 9, 0).toISOString())).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// UNE DATE CIVILE N'A PAS DE FUSEAU, ET `formatDate` LUI EN DONNAIT UN.
//
// La fonction qui affiche chaque date de l'application — cinquante appels, dont quarante-cinq sur
// une colonne `date` de Postgres — passait par `new Date(value).toLocaleDateString('fr-FR')`. Or
// `new Date('2026-01-01')` est minuit UTC : replacée dans le fuseau de qui regarde, elle recule
// d'un jour dès que le décalage est négatif.
//
// CE N'EST PAS UNE HYPOTHÈSE LOINTAINE. La Guadeloupe, la Martinique, la Guyane,
// Saint-Pierre-et-Miquelon et la Polynésie sont la France, et une profession de santé y est
// exactement la clientèle de cette application. Le 1er janvier s'y affichait au 31 décembre —
// l'EXERCICE PRÉCÉDENT — pendant que tous les totaux comptaient la pièce dans le bon.
//
// CES TESTS CHOISISSENT LEUR FUSEAU au lieu d'attendre celui du runner. `npm test` tourne sous
// Europe/Paris, où le défaut est rigoureusement invisible : un test écrit « normalement » serait
// resté vert avec le défaut entier, et la garantie aurait reposé sur quelqu'un pensant à lancer
// `npm run test:fuseaux`. Node relit `process.env.TZ` à chaque opération de date, donc le test
// porte sa garantie lui-même, dans n'importe quel runner.
describe('formatDate — une date civile n’a pas de fuseau', () => {
  const TZ_ORIGINE = process.env.TZ
  const sousFuseau = (tz: string, f: () => void) => {
    process.env.TZ = tz
    try { f() } finally { process.env.TZ = TZ_ORIGINE }
  }

  // LA BORNE DU HARNAIS, avant toute autre assertion : si changer `process.env.TZ` ne prenait pas,
  // tous les cas ci-dessous passeraient sans rien démontrer — la panne qui ressemble exactement au
  // succès, et que `fuseau.test.ts` existe déjà pour empêcher ailleurs.
  it('le harnais change bien de fuseau', () => {
    sousFuseau('America/Martinique', () => {
      expect(new Date('2026-01-01').toLocaleDateString('fr-FR')).toBe('31/12/2025')
    })
    sousFuseau('Europe/Paris', () => {
      expect(new Date('2026-01-01').toLocaleDateString('fr-FR')).toBe('01/01/2026')
    })
  })

  // Les cinq fuseaux français à l'ouest de Greenwich, plus deux à l'est en garde symétrique : sans
  // eux, « la date ne bouge pas » serait satisfait par une fonction qui rend n'importe quoi de
  // constant.
  const FUSEAUX_FRANCE = [
    'Europe/Paris', 'Indian/Reunion', 'Pacific/Noumea',
    'America/Guadeloupe', 'America/Martinique', 'America/Cayenne', 'America/Miquelon', 'Pacific/Tahiti',
  ]

  it('rend le même jour dans tous les fuseaux de la France', () => {
    // La liste est gardée avant d'être parcourue : réduite aux fuseaux de l'EST, elle ne
    // démontrerait plus rien tout en restant verte. Vérifié par mutation — sans cette ligne, elle
    // SURVIVAIT, la garantie retombant sur le seul cas Martinique écrit en dur plus bas.
    // Le critère EST la condition du défaut : minuit UTC — ce que vaut `new Date('2026-09-21')` —
    // y tombe-t-il la VEILLE ? Cinq des fuseaux listés doivent répondre oui.
    const ouGoutteLeDefaut = FUSEAUX_FRANCE.filter((tz) =>
      new Date('2026-09-21T00:00:00Z').toLocaleDateString('fr-CA', { timeZone: tz }) !== '2026-09-21')
    expect(ouGoutteLeDefaut.length, 'FUSEAUX_FRANCE doit exercer les DOM-TOM de l’ouest')
      .toBeGreaterThanOrEqual(5)

    for (const tz of FUSEAUX_FRANCE) {
      sousFuseau(tz, () => {
        expect(formatDate('2026-09-21'), tz).toBe('21/09/2026')
        expect(formatDate('2026-02-29' /* 2026 n'est pas bissextile : le libellé se lit tel quel */), tz)
          .toBe('29/02/2026')
      })
    }
  })

  // LE CAS QUI COÛTE : le 1er janvier franchit la frontière d'exercice. Une pièce datée de ce
  // jour-là s'affichait au 31 décembre de l'année précédente, donc dans un exercice où Clôture,
  // la 2035 et le FEC ne la comptent pas — et rien ne le disait.
  it('garde le 1er janvier dans son exercice, même aux Antilles', () => {
    sousFuseau('America/Martinique', () => {
      expect(formatDate('2026-01-01')).toBe('01/01/2026')
      expect(formatDate('2025-12-31')).toBe('31/12/2025')
    })
  })

  // GARDE SYMÉTRIQUE, et c'est elle qui empêche la correction facile — ignorer les fuseaux
  // partout. Un `created_at` est un INSTANT : son jour dépend LÉGITIMEMENT de qui le regarde, et
  // c'est la distinction qu'`anneeDe` / `anneeLocaleDe` portent déjà. Sans ce cas, « une date ne
  // bouge pas » serait satisfait par une fonction qui lirait le libellé UTC d'un horodatage.
  it('fait bien suivre le fuseau à un horodatage', () => {
    // Un dépôt vécu comme le 1er janvier à 00 h 30 à Fort-de-France s'écrit 04 h 30 UTC : son
    // libellé et sa lecture locale coïncident. À l'inverse, un dépôt du 31 décembre à 22 h là-bas
    // s'écrit déjà le 1er janvier en UTC — et c'est le 31 qu'il faut afficher.
    sousFuseau('America/Martinique', () => {
      expect(formatDate('2026-01-01T02:00:00Z')).toBe('31/12/2025')
      expect(formatDate('2026-01-01T16:00:00Z')).toBe('01/01/2026')
    })
    sousFuseau('Europe/Paris', () => {
      expect(formatDate('2025-12-31T23:30:00Z')).toBe('01/01/2026')
    })
  })

  it('rend une valeur illisible telle quelle, plutôt qu’une date plausible', () => {
    // `+012345-01` a réellement été écrit dans `pieces.date_piece` par une extraction qui lisait un
    // numéro de facture comme une année (voir CLAUDE.md, `dateFuture` compare des CHAÎNES). Le
    // remplacer par une date inventée le rendrait indétectable ; ici l'opérateur voit ce qui est
    // stocké.
    expect(formatDate('pas une date')).toBe('pas une date')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('n’a rien changé à ce que la France métropolitaine avait sous les yeux', () => {
    // Le correctif ne doit se voir NULLE PART à l'est de Greenwich : même jour, même séparateur,
    // mêmes zéros de tête qu'avec `toLocaleDateString`.
    sousFuseau('Europe/Paris', () => {
      for (const iso of ['2026-01-01', '2026-09-21', '2025-12-31', '2024-02-29']) {
        expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString('fr-FR'))
      }
    })
  })
})

describe('comptesParMois', () => {
  it('range un dépôt du 1er à minuit passé dans le bon mois', () => {
    // Les clés énumèrent des mois locaux : ranger les dépôts par leur libellé UTC attribuerait au
    // mois précédent tout ce qui est déposé le 1er entre minuit et 1 ou 2 h.
    const maintenant = new Date()
    const premierDuMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1, 0, 30)
    const compteurs = comptesParMois([premierDuMois.toISOString()], 3)
    expect(compteurs[compteurs.length - 1]).toBe(1) // le mois en cours, dernier de la série
  })

  it('ignore ce qui tombe hors de la fenêtre', () => {
    expect(comptesParMois(['2019-01-01T12:00:00Z'], 3)).toEqual([0, 0, 0])
  })
})

describe('dernierJourDuMois', () => {
  it('rend le dernier jour, février et bissextile compris', () => {
    expect(dernierJourDuMois('2026-02-01')).toBe('2026-02-28')
    expect(dernierJourDuMois('2024-02-15')).toBe('2024-02-29')
    expect(dernierJourDuMois('2026-12-03')).toBe('2026-12-31')
    expect(dernierJourDuMois('2026-04-10')).toBe('2026-04-30')
  })
})

// Ces deux-là dépendent de l'instant d'exécution. L'attendu est donc calculé avant ET après
// l'appel, et on accepte l'un ou l'autre : sans cela, un test lancé à la seconde où l'on change de
// jour échouerait sans qu'aucun code ne soit en cause — et cette suite garde le déploiement.
describe('dates du jour', () => {
  const jourLocal = (d: Date) =>
    [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

  it('nomme le mois en cours tel que le voit l’utilisateur, pas UTC', () => {
    const avant = jourLocal(new Date()).slice(0, 7)
    const obtenu = premierJourDuMoisCourant()
    const apres = jourLocal(new Date()).slice(0, 7)
    expect([`${avant}-01`, `${apres}-01`]).toContain(obtenu)
  })

  it('date aujourd’hui en heure locale', () => {
    // Entre minuit et 2 h du matin à Paris, `toISOString()` datait de la veille — une facture
    // saisie tard le soir portait donc la mauvaise date d'émission.
    const avant = jourLocal(new Date())
    const obtenu = aujourdHuiSql()
    const apres = jourLocal(new Date())
    expect([avant, apres]).toContain(obtenu)
  })
})

describe('nomUnique', () => {
  it('laisse le nom intact tant qu’il est libre', () => {
    const utilises = new Set<string>()
    expect(nomUnique('2026-03-10_EDF_120.00€', '.pdf', utilises)).toBe('2026-03-10_EDF_120.00€.pdf')
    expect(nomUnique('2026-03-11_EDF_120.00€', '.pdf', utilises)).toBe('2026-03-11_EDF_120.00€.pdf')
  })

  it('numérote les suivants en cas de collision, sans toucher au premier', () => {
    const utilises = new Set<string>()
    const noms = [1, 2, 3].map(() => nomUnique('sans_date_Transmedical_38.40€', '.pdf', utilises))
    expect(noms).toEqual([
      'sans_date_Transmedical_38.40€.pdf',
      'sans_date_Transmedical_38.40€_2.pdf',
      'sans_date_Transmedical_38.40€_3.pdf',
    ])
  })

  it('garde le suffixe avant l’extension', () => {
    // Un nom contient déjà des points (le montant), et c'est l'extension qui doit rester en dernier :
    // un fichier « ….pdf_2 » ne s'ouvrirait plus.
    const utilises = new Set(['2026-03-10_EDF_120.00€.pdf'])
    expect(nomUnique('2026-03-10_EDF_120.00€', '.pdf', utilises)).toBe('2026-03-10_EDF_120.00€_2.pdf')
  })

  it('ne coupe pas un nom sans extension au premier point venu', () => {
    // Cas d'un nom de dossier : « S.A.R.L_Martin » ne doit pas devenir « S.A.R_2.L_Martin ».
    const utilises = new Set(['S.A.R.L_Martin'])
    expect(nomUnique('S.A.R.L_Martin', '', utilises)).toBe('S.A.R.L_Martin_2')
  })

  it('n’attribue jamais deux fois le même nom, suffixes compris', () => {
    // Le piège : « x_2 » peut exister par lui-même avant que « x » n'ait besoin d'un suffixe.
    const utilises = new Set<string>()
    expect(nomUnique('x_2', '', utilises)).toBe('x_2')
    expect(nomUnique('x', '', utilises)).toBe('x')
    expect(nomUnique('x', '', utilises)).toBe('x_3')
  })
})

describe('cleFournisseur — sigles pointés', () => {
  it('recolle un sigle écrit avec des points', () => {
    // Le cas qui a motivé la règle : l'OCR rend « C.P.A.M. Marseille » sur certains bordereaux et
    // « CPAM Marseille » sur d'autres. Les deux graphies doivent donner la même identité, sinon le
    // cabinet arbitre deux fois le même organisme.
    expect(cleFournisseur('C.P.A.M. Marseille')).toBe('cpam')
    expect(cleFournisseur('CPAM Marseille')).toBe('cpam')
  })

  it('accepte le dernier point manquant', () => {
    // L'OCR perd fréquemment le point final du sigle.
    expect(cleFournisseur('C.P.A.M Marseille')).toBe('cpam')
  })

  it('ne rend plus le nom de la VILLE comme identité', () => {
    // Le vrai défaut, et il était pire qu'une absence de clé. Points aplatis en espaces, le sigle
    // explosait en lettres isolées ; le seuil de quatre caractères les éliminait toutes et la
    // fonction retenait le mot suivant. « C.P.A.M. Marseille » rendait « marseille » — l'identité
    // d'une ville, sous laquelle deux organismes différents de la même ville se confondraient.
    expect(cleFournisseur('C.P.A.M. Marseille')).not.toBe('marseille')
  })

  it('laisse la forme juridique pointée se faire écarter comme la forme collée', () => {
    // Recoller « S.A.R.L. » en « sarl » le fait retomber dans MOTS_SANS_IDENTITE, donc la clé est le
    // vrai nom. Avant, « sarl » explosé en lettres était écarté par accident, pour la mauvaise raison.
    expect(cleFournisseur('S.A.R.L. Martin')).toBe('martin')
  })

  it('ne touche pas à ce qui n’est pas un sigle', () => {
    // Un point doit suivre une lettre SEULE et être suivi immédiatement d'une lettre. Ces trois cas
    // ne remplissent pas la condition et doivent rendre exactement ce qu'ils rendaient avant.
    expect(cleFournisseur('www.edf.fr')).toBeNull()          // trois lettres avant le point
    expect(cleFournisseur('Cabinet X. Y. Martin')).toBe('martin') // une espace après le point
    expect(cleFournisseur('Orange SA')).toBe('orange')
    expect(cleFournisseur('Boulanger Marseille')).toBe('boulanger')
    expect(cleFournisseur('Transmedical / et soigner redevient')).toBe('transmedical')
    expect(cleFournisseur('CARTE BANCAIRE')).toBeNull()
  })

  it('reste soumis au seuil de quatre caractères', () => {
    // Limite connue et inchangée : « E.D.F. » devient « edf », trois caractères, donc rejeté comme
    // l'était « EDF » collé. Ce seuil est une décision à part (voir cleFournisseur), pas un effet de
    // cette règle — documenté ici pour que le jour où on l'abaisse, le cas soit déjà écrit.
    expect(cleFournisseur('E.D.F.')).toBeNull()
    expect(cleFournisseur('EDF')).toBeNull()
  })
})

describe('cleFournisseur — clés fausses', () => {
  // Une clé FAUSSE est le pire cas de cette fonction : deux tiers sans rapport deviennent le même
  // fournisseur et héritent de la même catégorie. Les trois cas ci-dessous ont été trouvés en
  // exécutant la vraie fonction sur les seize tiers réels du dossier `test` — pas imaginés.

  it("ne retient pas « villa », qui ne désigne personne", () => {
    // Rendait « villa » : deux villas différentes se seraient confondues.
    expect(cleFournisseur('VILLA ESTELLO')).toBe('estello')
  })

  it("rend null sur un nom dont AUCUN mot ne désigne quelqu'un", () => {
    // Rendait « institut », clé sous laquelle tout autre institut se serait rangé. Ici aucun mot
    // n'identifie l'organisme en particulier : null est la bonne réponse, et la pièce est traitée
    // isolément. Un faux négatif coûte un clic, une clé fausse inscrit une catégorie fausse.
    expect(cleFournisseur('Siège Institut national de la propriété industrielle')).toBeNull()
    // La virgule finale de l'OCR ne change rien — les deux graphies restent équivalentes.
    expect(cleFournisseur('Siège Institut national de la propriété industrielle,')).toBeNull()
  })

  it("rend null sur un intitulé de GARANTIE, qui n'est pas un fournisseur", () => {
    // Rendait « responsabilite ». Tout contrat RC Pro porte cet intitulé, quel que soit l'assureur :
    // la clé aurait regroupé des compagnies différentes sous un nom de produit.
    expect(cleFournisseur('RESPONSABILITÉ CIVILE PROFESSIONNELLE/PROTECTION / JURIDIQUE')).toBeNull()
  })

  it('ne mange pas les identités réelles qui suivent ces mots', () => {
    // Le risque symétrique : à force d'élargir la liste, perdre de vrais fournisseurs. Ces mots
    // sont écartés en tant que MOT, pas en tant que nom — ce qui les suit reste la clé.
    expect(cleFournisseur('Institut Pasteur')).toBe('pasteur')
    expect(cleFournisseur('Villa Schweppes')).toBe('schweppes')
    expect(cleFournisseur('Propriété Dupont')).toBe('dupont')
    expect(cleFournisseur('Société Nationale Martin')).toBe('martin')
  })

  it('laisse intacts les treize autres tiers réels du dossier', () => {
    // Non-régression mesurée : seules trois clés sur seize devaient changer.
    expect(cleFournisseur('Apple Marseille')).toBe('apple')
    expect(cleFournisseur('Restaurant DALLOYAU')).toBe('dalloyau')
    expect(cleFournisseur('Les 3 Brasseurs')).toBe('brasseurs')
    expect(cleFournisseur('OpenAI, LLC')).toBe('openai')
    expect(cleFournisseur('MACSF')).toBe('macsf')
    expect(cleFournisseur('ulys')).toBe('ulys')
    expect(cleFournisseur('Transmedical\net soigner redevient')).toBe('transmedical')
  })
})

describe('ajouterJours', () => {
  it('franchit une fin de mois et une fin d’année', () => {
    expect(ajouterJours('2026-01-31', 1)).toBe('2026-02-01')
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('recule aussi bien qu’il avance', () => {
    expect(ajouterJours('2026-03-01', -1)).toBe('2026-02-28')
    expect(ajouterJours('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('connaît le 29 février', () => {
    expect(ajouterJours('2028-02-28', 1)).toBe('2028-02-29')
    expect(ajouterJours('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('ne décale pas d’un jour au passage à l’heure d’été', () => {
    // Le piège que ce dépôt a déjà payé trois fois : `new Date('2026-03-28')` + 1 jour converti par
    // `toISOString()` rend le 28 en Europe/Paris, la nuit du changement d'heure ne faisant que
    // 23 heures. L'arithmétique en UTC y est insensible, et la suite tourne sous quatre fuseaux.
    expect(ajouterJours('2026-03-28', 1)).toBe('2026-03-29')
    expect(ajouterJours('2026-10-24', 1)).toBe('2026-10-25')
  })

  it('rend la date inchangée pour zéro jour', () => {
    expect(ajouterJours('2026-07-14', 0)).toBe('2026-07-14')
  })
})
