import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `supabase/functions/extract-piece/index.ts` est auto-porté (déployé à part, il ne peut rien
// importer de src/lib). `dateDepuisTexteBrut` y décide de la date d'une pièce quand Textract n'a pas
// étiqueté de champ INVOICE_RECEIPT_DATE — et une pièce sans date n'entre dans aucun pack. Ce test
// lit la *vraie* source déployée et exécute sa copie, comme le garde-fou de `parseAmount`.
//
// Volontairement fragile : renommer ou reformater ces fonctions le casse bruyamment.
function extraireDeLEdgeFunction() {
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  const morceaux: string[] = []
  // `new Function` évalue du JavaScript : toute annotation de type, y compris sur une fonction
  // interne, doit être retirée explicitement. Listées une par une plutôt que par une expression
  // générique — une regex qui « enlève les types » finirait par manger du vrai code.
  const prendre = (entete: string, signatureJs: string, internes: [string, string][] = []) => {
    const debut = source.indexOf(entete)
    expect(debut, `\`${entete}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
    const fin = source.indexOf('\n}\n', debut)
    expect(fin, `fin de \`${entete}\` introuvable`).toBeGreaterThan(debut)
    let corps = source.slice(debut, fin + 2).replace(entete, signatureJs)
    for (const [de, vers] of internes) {
      expect(corps.includes(de), `\`${de}\` introuvable dans \`${entete}\``).toBe(true)
      corps = corps.replace(de, vers)
    }
    morceaux.push(corps)
  }

  // Les constantes se recopient telles quelles : ce sont elles qui décident quels libellés comptent.
  for (const nom of ['const MOIS_PAR_NOM', 'const LIBELLE_DATE_FACTURE', 'const LIBELLE_VILLE_LE', 'const LIBELLE_AUTRE_DATE',
                     'const DATE_ISO_REGEX', 'const DATE_NUMERIQUE_REGEX', 'const DATE_TEXTUELLE_REGEX']) {
    const debut = source.indexOf(nom)
    expect(debut, `\`${nom}\` introuvable`).toBeGreaterThan(-1)
    const fin = nom === 'const MOIS_PAR_NOM' ? source.indexOf('\n}\n', debut) + 2 : source.indexOf('\n', debut) + 1
    morceaux.push(source.slice(debut, fin).replace(/: Record<string, number>/, ''))
  }

  prendre('function toIsoDate(year: number, month: number, day: number): string | null {',
          'function toIsoDate(year, month, day) {')
  prendre('function dateFuture(iso: string): boolean {', 'function dateFuture(iso) {')
  prendre('function sansAccents(s: string): string {', 'function sansAccents(s) {')
  prendre('function datesDeLaLigne(ligne: string, anneeReference: number): string[] {',
          'function datesDeLaLigne(ligne, anneeReference) {',
          [['const trouvees: string[] = []', 'const trouvees = []'],
           ['(a: number, m: number, j: number) =>', '(a, m, j) =>']])
  prendre('function candidatsAvecLigne(utiles: { ligne: string; dates: string[] }[]): string[] {',
          'function candidatsAvecLigne(utiles) {',
          [['const vus = new Set<string>()', 'const vus = new Set()'],
           ['const sortie: string[] = []', 'const sortie = []']])
  prendre('function dateDepuisTexteBrut(lignes: string[], anneeReference: number): { date: string | null; origine: OrigineDate | null; candidats: string[] } {',
          'function dateDepuisTexteBrut(lignes, anneeReference) {')
  // `parseDate` lit le champ INVOICE_RECEIPT_DATE étiqueté par Textract — un chemin distinct du
  // repli, et sans fenêtre d'années. C'est lui qui avait laissé passer une pièce datée de 2028.
  prendre('function parseDate(raw?: string): string | null {', 'function parseDate(raw) {')

  return new Function(`${morceaux.join('\n')}; return { dateDepuisTexteBrut, parseDate }`)() as {
    dateDepuisTexteBrut: (lignes: string[], anneeReference: number) =>
      { date: string | null; origine: string | null; candidats: string[] }
    parseDate: (raw?: string) => string | null
  }
}

const { dateDepuisTexteBrut, parseDate } = extraireDeLEdgeFunction()
const lire = (lignes: string[]) => dateDepuisTexteBrut(lignes, 2026)

describe('extract-piece / dateDepuisTexteBrut (copie déployée)', () => {
  it('lit une date annoncée par son libellé, au format français', () => {
    // Le défaut corrigé : Textract n'étiquette INVOICE_RECEIPT_DATE que de façon irrégulière (4 fois
    // sur 22 chez un fournisseur réel), alors que la date est bien dans le texte OCR.
    expect(lire(['TRANSMEDICAL', 'Facture n° 51310', 'Date : 31/01/2023', 'Total TTC 192,00 €']).date)
      .toBe('2023-01-31')
  })

  it('accepte les variantes d’écriture de la date de facture', () => {
    for (const ligne of [
      'Date de facture : 15/03/2023', 'Date de facturation 15.03.2023', "Date d'émission : 15-03-2023",
      'Facture du 15/03/2023', 'Facturée le 15/03/2023', 'Émise le 15/03/2023',
    ]) {
      expect(lire(['ACME', ligne, 'Total 100,00']).date, ligne).toBe('2023-03-15')
    }
  })

  it('lit une date écrite en toutes lettres, accentuée ou non', () => {
    expect(lire(['Date : 8 février 2023']).date).toBe('2023-02-08')
    expect(lire(['Date : 8 fevrier 2023']).date).toBe('2023-02-08')
    expect(lire(['Date : 1er août 2023']).date).toBe('2023-08-01')
  })

  it('lit le format JJ/MM et jamais MM/JJ', () => {
    // Le piège inverse de celui déjà corrigé dans parseDate : lire à l'américaine daterait du
    // 1er décembre une facture du 12 janvier, dans le mauvais exercice, sans que rien ne le signale.
    expect(lire(['Date : 12/01/2023']).date).toBe('2023-01-12')
  })

  it('préfère la date de facture à l’échéance quand les deux figurent', () => {
    // C'est le cas qui compte : dater la pièce du jour où elle doit être payée la range dans le mois
    // suivant — et pour une facture de décembre, dans l'exercice suivant.
    const r = lire(['Date de facture : 31/12/2023', 'Échéance : 31/01/2024', 'Total 192,00'])
    expect(r.date).toBe('2023-12-31')
  })

  it('ignore une échéance seule plutôt que de la prendre pour la date de la pièce', () => {
    const r = lire(['TRANSMEDICAL', 'À payer avant le 28/02/2023', 'Total 192,00'])
    expect(r.date).toBeNull()
  })

  it('lit la date sous son en-tête quand la mise en page est un tableau', () => {
    // Sur une facture en colonnes, l'en-tête « Date » et sa valeur ne survivent pas sur la même ligne
    // OCR — même piège que la ventilation TVA des tickets de caisse. Le document porte ici DEUX dates,
    // sinon la règle « une seule date distincte » suffirait et ce test ne prouverait rien : c'est
    // exactement ce qu'une mutation a révélé, la première version passait sans exercer cette règle.
    expect(lire(['N° Facture', 'Date', 'Échéance', '51310', '31/01/2023', '28/02/2023']).date)
      .toBe('2023-01-31')
  })

  it('ne va pas chercher une date trop loin après le libellé', () => {
    // Au-delà de quelques lignes, la date rencontrée n'a plus de rapport avec l'en-tête. Le résultat
    // n'est plus null depuis la règle de dernier recours, mais c'est bien elle qui doit trancher —
    // pas la règle du libellé, qui présenterait cette date comme lue sous « Date ».
    const loin = ['Date', 'a', 'b', 'c', 'd', 'e', 'f', '31/01/2023', '28/02/2023']
    expect(lire(loin).origine).toBe('premiere')
    // Le libellé est bien reconnu, c'est sa portée qui s'arrête : rapprochée, la valeur est lue.
    expect(lire(['Date', 'a', '31/01/2023', '28/02/2023']).origine).toBe('libelle')
  })

  it('retient la date unique d’un document qui n’annonce aucun libellé', () => {
    // Beaucoup de factures simples n'écrivent pas « Date » : si le document n'en porte qu'une, elle
    // ne peut guère être autre chose que la sienne. Aucun libellé ici — « Marseille, le … » en est
    // devenu un depuis (voir plus bas), il ne conviendrait donc plus pour exercer cette règle.
    expect(lire(['TRANSMEDICAL SARL', 'Prestation janvier', '31/01/2023', '192,00 €']).date)
      .toBe('2023-01-31')
  })

  it('lit la formule « Ville, le <date> », sans aucun libellé « Date »', () => {
    // La mise en page réelle du fournisseur : « FACTURE  N° 65233  Marseille, le 30 juin 2025 ».
    // Aucun mot « Date » nulle part, et la date en toutes lettres.
    expect(lire(['FACTURE N° 65233 Marseille, le 30 juin 2025', 'Total TTC 192,00 €']).date)
      .toBe('2025-06-30')
    // Les colonnes peuvent aussi ressortir en lignes séparées, « Marseille, le » d'un côté et la
    // valeur de l'autre. Une seconde date est nécessaire ici, sinon la règle « une seule date
    // distincte » suffirait et ce test ne prouverait rien — une mutation l'a montré.
    expect(lire(['FACTURE', 'N° 65233', 'Marseille, le', '30 juin 2025', 'Livré le 28/06/2025']).date)
      .toBe('2025-06-30')
  })

  it('tient quand le document porte une autre date que la règle d’exclusion ne connaît pas', () => {
    // Avant cette reconnaissance, la lecture ne marchait que par élimination — le document ne portant
    // qu'une seule date. Une date de livraison ou de relevé suffisait à tout faire échouer.
    for (const autre of ['Livré le 28/06/2025', 'Relevé arrêté au 25/06/2025']) {
      expect(lire(['FACTURE N° 65233 Marseille, le 30 juin 2025', autre]).date, autre).toBe('2025-06-30')
    }
  })

  it('ne prend pas n’importe quel « , le » pour une annonce de date', () => {
    // Sans le contrôle du chiffre qui suit, une formule de politesse deviendrait un libellé de date.
    // La règle de dernier recours finit par trancher, mais ce test porte sur l'autre point : cette
    // ligne ne doit pas être reconnue comme une annonce de date.
    expect(lire(['Cordialement, le service comptable', 'Prestation', '05/01/2023', '28/02/2023']).origine)
      .toBe('premiere')
    // La même tournure suivie d'un chiffre, elle, est bien un libellé.
    expect(lire(['Marseille, le 05/01/2023', 'Autre 28/02/2023']).origine).toBe('libelle')
  })

  it('retient la première date en ordre de lecture quand aucun libellé ne tranche', () => {
    // Règle de dernier recours, et c'est un vrai revirement : la version précédente rendait null.
    // Un cas réel l'a tranchée — sur huit factures d'un même fournisseur, les dates vues étaient
    // toujours, dans cet ordre : la date de facture, trois mentions légales constantes, puis
    // l'échéance. La première est la bonne à chaque fois. Une facture imprime sa date en en-tête,
    // avant ses conditions de règlement et son pied de page.
    const r = lire(['ACME', '05/01/2023', 'Prestation du mois', '28/02/2023', 'Total 100,00'])
    expect(r.date).toBe('2023-01-05')
    expect(r.origine).toBe('premiere')
  })

  it('marque la date déduite comme telle, pour qu’elle soit proposée à vérifier', () => {
    // La distinction qui permet de garder cette règle sans deviner en silence : une date lue sur un
    // libellé et une date déduite de l'ordre de lecture ne sont pas la même chose, et l'appelant
    // remonte la seconde à part.
    expect(lire(['Date : 31/01/2023', 'Échéance : 28/02/2023']).origine).toBe('libelle')
    expect(lire(['ACME', '31/01/2023', 'Total']).origine).toBe('unique')
    expect(lire(['ACME', '31/01/2023', 'Autre 15/03/2023']).origine).toBe('premiere')
  })

  it('reproduit le cas réel du fournisseur : facture, mentions légales, échéance', () => {
    // Les dates exactes remontées par le diagnostic sur 54201.pdf, dans leur ordre d'apparition.
    const r = lire([
      'TRANSMEDICAL',
      'FACTURE N° 54201  30/06/2023',
      'Prestation du mois',
      'SARL au capital de 10 000 € - RCS Marseille du 05/12/2017',
      'Paiement au 05/07/2023',
      'Agrément du 02/10/2012',
      'CGV en vigueur au 01/01/2013',
    ])
    expect(r.date).toBe('2023-06-30')
  })

  it('ne prend pas un numéro ou une référence pour une date', () => {
    // Une année aberrante trahit un faux positif : numéro de commande, référence produit, code.
    expect(lire(['Réf. 12/34/56', 'Commande 01/02/1998']).date).toBeNull()
    expect(lire(['Bon 15/08/2199']).date).toBeNull()
  })

  it('écarte une date impossible plutôt que de la corriger en silence', () => {
    expect(lire(['Date : 31/02/2023', 'Date : 45/13/2023']).date).toBeNull()
  })

  it('dit dans son diagnostic de quelle ligne vient chaque date', () => {
    // Sans la ligne source, un échec ne dit que « voici des dates » — impossible de savoir laquelle
    // était la bonne ni pourquoi la lecture a hésité. C'est précisément ce qui manquait au premier
    // diagnostic remonté sur un cas réel.
    // Les deux lignes portent un libellé d'exclusion : aucune candidate ne subsiste, donc ni la
    // règle « date unique » ni celle de dernier recours ne peuvent trancher, et c'est le diagnostic
    // qui parle.
    const r = lire(['Échéance : 31/01/2023', 'Payable le 28/02/2023'])
    expect(r.date).toBeNull()
    expect(r.candidats).toEqual([
      '2023-01-31 \u2190 Échéance : 31/01/2023',
      '2023-02-28 \u2190 Payable le 28/02/2023',
    ])
  })

  it('ne rend rien sur un document sans aucune date', () => {
    const r = lire(['TRANSMEDICAL', 'Prestation mensuelle', 'Total TTC 192,00 €'])
    expect(r.date).toBeNull()
    expect(r.candidats).toEqual([])
  })

  it('accepte une année sur deux chiffres', () => {
    expect(lire(['Date : 31/01/23']).date).toBe('2023-01-31')
  })
})

describe('extract-piece / toIsoDate (copie déployée)', () => {
  // Vérifié à travers le repli, qui est le seul point d'entrée exporté par le garde-fou.
  it('accepte le 29 février d’une année bissextile et refuse celui des autres', () => {
    expect(lire(['Date : 29/02/2024']).date).toBe('2024-02-29')
    expect(lire(['Date : 29/02/2023']).date).toBeNull()
  })

  it('refuse un 31 dans un mois de 30 jours', () => {
    // `2023-04-31` n'existe pas : Postgres refuse la ligne, et le dépôt échoue sur une erreur
    // incompréhensible plutôt que de simplement laisser la date vide.
    expect(lire(['Date : 31/04/2023']).date).toBeNull()
    expect(lire(['Date : 30/04/2023']).date).toBe('2023-04-30')
  })

  it('n’écarte pas une date récente sous prétexte de fuseau', () => {
    // La limite est « demain », pas « maintenant » : la fonction tourne en UTC alors que les pièces
    // sont datées à Paris. Sans cette marge, une facture du jour serait refusée en fin de soirée.
    // Une date dix jours en avant reste refusée — la marge est un coussin, pas une porte ouverte.
    const dans10Jours = new Date(Date.now() + 10 * 86_400_000)
    const j = String(dans10Jours.getUTCDate()).padStart(2, '0')
    const m = String(dans10Jours.getUTCMonth() + 1).padStart(2, '0')
    expect(lire([`Date : ${j}/${m}/${dans10Jours.getUTCFullYear()}`]).date).toBeNull()

    const hier = new Date(Date.now() - 86_400_000)
    const jh = String(hier.getUTCDate()).padStart(2, '0')
    const mh = String(hier.getUTCMonth() + 1).padStart(2, '0')
    expect(lire([`Date : ${jh}/${mh}/${hier.getUTCFullYear()}`]).date)
      .toBe(hier.toISOString().slice(0, 10))
  })
})

describe('extract-piece / date étiquetée par Textract (parseDate)', () => {
  // Chemin distinct du repli : quand Textract étiquette INVOICE_RECEIPT_DATE, sa valeur passe par
  // `parseDate` sans jamais traverser la fenêtre d'années de `datesDeLaLigne`. C'est par là qu'un
  // justificatif d'immatriculation est entré daté du 27/09/2028 sur un import réel.
  it('refuse une date postérieure à aujourd’hui', () => {
    expect(parseDate('27/09/2028')).toBeNull()
    expect(parseDate('2028-09-27')).toBeNull()
  })

  it('refuse le futur aussi sur le dernier recours textuel', () => {
    // Troisième chemin de `parseDate` : ni ISO ni numérique, délégué à `new Date()`. Il rendait sa
    // date sans repasser par `toIsoDate`, et contournait donc le refus. Seul `null` est affirmé ici,
    // jamais une valeur : ce recours décale la date d'un jour à l'est de Greenwich (voir plus bas),
    // mais 2099 reste dans le futur quel que soit le fuseau.
    expect(parseDate('27 August 2099')).toBeNull()
  })

  it('accepte toujours une date passée dans les formats numériques', () => {
    // Le refus du futur ne doit pas emporter les lectures normales — c'est la moitié du contrat.
    // Seuls les deux formats numériques sont vérifiés ici : eux passent par `toIsoDate`, qui
    // construit la chaîne champ par champ et ne dépend donc pas du fuseau.
    expect(parseDate('05/06/2024')).toBe('2024-06-05')
    expect(parseDate('2024-06-05')).toBe('2024-06-05')
  })

  // LES DOUZE MOIS, et pas seulement celui du cas d'origine. Avant correction, `parseDate` déléguait
  // à `new Date()`, qui reconnaît un mois à ses TROIS premières lettres EN ANGLAIS : cinq mois
  // français tombaient donc juste par collision (janvier→jan, mars→mar, septembre→sep, octobre→oct,
  // novembre→nov) et les sept autres rendaient `null`. Mesuré, pas déduit.
  //
  // C'est ce qui rend le test exhaustif nécessaire : un test sur « 30 juin 2025 » seul aurait été
  // vert avec une correction qui ne traiterait que juin, et un test sur « mars » aurait été vert
  // AVANT toute correction.
  it('lit les douze mois français en toutes lettres', () => {
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    MOIS.forEach((nom, i) => {
      const attendu = `2024-${String(i + 1).padStart(2, '0')}-15`
      expect(parseDate(`15 ${nom} 2024`), nom).toBe(attendu)
    })
  })

  // L'ACCENT SUFFISAIT À FAIRE BASCULER LE RÉSULTAT : « decembre » était lu (dec→December),
  // « décembre » perdu. L'OCR rend tantôt l'un tantôt l'autre, donc les deux doivent valoir.
  it('lit un mois accentué comme son équivalent sans accent', () => {
    expect(parseDate('15 décembre 2024')).toBe('2024-12-15')
    expect(parseDate('15 decembre 2024')).toBe('2024-12-15')
    expect(parseDate('15 février 2024')).toBe('2024-02-15')
    expect(parseDate('15 fevrier 2024')).toBe('2024-02-15')
    expect(parseDate('1er août 2024')).toBe('2024-08-01')
  })

  // LE SECOND DÉFAUT DU DERNIER RECOURS, et celui-là ne se voit QUE hors UTC. `new Date("27 August
  // 2026")` rend minuit LOCAL, que `toISOString()` reconvertissait en UTC : un jour en arrière à
  // l'est de Greenwich. Mesuré avant correction — 2026-08-26 sous Europe/Paris et Pacific/Auckland,
  // 2026-08-27 sous UTC et America/New_York. Ce test ne prouve donc quelque chose que parce que
  // `npm run test:fuseaux` le rejoue sous les quatre fuseaux.
  it('lit une date anglaise sur le calendrier civil, sans reculer d’un jour', () => {
    expect(parseDate('27 August 2026')).toBe('2026-08-27')
    expect(parseDate('August 27, 2026')).toBe('2026-08-27')
    // Le 1er du mois est le cas qui coûte cher : reculé d'un jour, il change de MOIS, et au 1er
    // janvier il change d'EXERCICE.
    expect(parseDate('1 March 2024')).toBe('2024-03-01')
    expect(parseDate('1 janvier 2024')).toBe('2024-01-01')
  })

  it('refuse toujours ce qui ne ressemble à aucune date', () => {
    // Un mot qui n'est pas un mois ne doit pas être lu comme tel — sinon la nouvelle branche
    // française rendrait une date sur n'importe quelle ligne « <nombre> <mot> <année> ».
    expect(parseDate('15 brumaire 2024')).toBeNull()
  })

  // TROUVÉ PAR LE TEST CI-DESSUS, pas cherché. `new Date()` lit « facture 12345 » comme le 1er
  // janvier de l'an 12345 — et le refus du futur ne l'arrêtait pas, parce qu'il compare des CHAÎNES :
  // « 12345-01-01 » passe pour INFÉRIEUR à « 2026-09-21 », le premier caractère décidant ('1' < '2').
  // Avant correction, ce numéro de facture ressortait donc en « +012345-01 » : la forme ISO à année
  // étendue de `toISOString()`, tronquée à dix caractères, c'est-à-dire une chaîne qui n'est plus
  // une date, écrite telle quelle dans `pieces.date_piece`.
  // Le garde-fou vit dans `toIsoDate` et non dans cette branche, pour que les trois chemins et
  // `datesDeLaLigne` en héritent d'un coup.
  it('refuse une année hors du format à quatre chiffres, que le refus du futur laissait passer', () => {
    expect(parseDate('facture 12345')).toBeNull()
    expect(parseDate('12345-01-01')).toBeNull()
    // La borne basse ferme le symétrique : une année à trois chiffres se comparerait elle aussi de
    // travers, et aucune pièce comptable n'est datée de l'an 999.
    expect(parseDate('0999-01-01')).toBeNull()
    // Et ce qui est légitime passe toujours.
    expect(parseDate('2024-06-05')).toBe('2024-06-05')
  })

  it('refuse toujours une date qui n’existe pas au calendrier', () => {
    expect(parseDate('31/04/2023')).toBeNull()
    expect(parseDate('29/02/2023')).toBeNull()
  })
})

describe('extract-piece / branchement du repli', () => {
  // Garde-fou structurel : les tests ci-dessus exercent `dateDepuisTexteBrut` isolément, ils ne
  // voient pas si le résultat est réellement utilisé. Une mutation l'a montré — débrancher le repli
  // les laissait tous passer. Vérifier le câblage par le texte est grossier, mais c'est ce qui reste
  // quand la fonction englobante ne peut pas être exécutée hors de Deno.
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  it('appelle le repli quand le modèle n’a cité aucune date', () => {
    // La SOURCE de la date a changé le 21/09/2026 — le champ étiqueté par AnalyzeExpense est devenu
    // une citation vérifiée (`retenues.date`) — mais le branchement gardé ici est le même, et pour la
    // même raison : le repli sur texte brut reste le seul recours quand le document n'imprime aucun
    // libellé reconnaissable, et c'est lui qui porte l'essentiel du travail.
    expect(source).toContain('let datePiece = parseDate(retenues.date)')
    expect(source).toContain('if (!datePiece) {')
    expect(source).toContain('const repli = dateDepuisTexteBrut(lignes, new Date().getUTCFullYear())')
    expect(source).toContain('datePiece = repli.date')
    expect(source).toContain('dateDeduite = repli.origine === "premiere"')
    expect(source).toContain('...(dateDeduite ? { _date_deduite: true } : {}),')
  })

  it('renvoie la date issue du repli, et le diagnostic quand il n’a rien pu conclure', () => {
    expect(source).toContain('date_piece: datePiece,')
    expect(source).toContain('...(datesDiag ? { _diag_dates: datesDiag } : {}),')
  })
})
