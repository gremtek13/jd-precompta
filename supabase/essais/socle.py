#!/usr/bin/env python3
"""Éprouve le socle — `supabase/schema/socle/*.sql` — contre la base vivante.

POURQUOI CE FICHIER EXISTE. `supabase/schema/` porte un export des migrations, et son contrôle de
dérive compare les FICHIERS aux MIGRATIONS par empreinte agrégée. Il était vert le 22/09/2026
(58 = 58) pendant que DOUZE des 41 tables n'avaient aucun `create table` nulle part : elles ont été
créées hors `apply_migration`. Le contrôle prouvait une chose plus faible que celle qu'on lui
prêtait, et ce qu'on lui prêtait était le plan de reprise.

Le socle comble ce trou, en deux fichiers appliqués dans l'ordre de leur nom :
`1_tables_sans_migration.sql` (les douze tables) et `2_objets_sans_migration.sql` (six colonnes et
cinq objets ajoutés hors migration à des tables que les migrations créent — trouvés le 29/09/2026
par `inventaire.py`). Mais un fichier de reconstruction que rien ne confronte à la base est
exactement le plan de reprise qu'on CROIT avoir : il dérive au premier `alter table`, et son silence
est indiscernable d'un fichier juste.

COMMENT ÇA MARCHE. Les fichiers ne sont PAS écrits à la main : chaque instruction est le rendu exact
du catalogue. Ce harnais peut donc comparer AU CARACTÈRE PRÈS — à UNE conversion près, faite aussi
côté base et dite dans `socle.sql` : les fins de ligne `\r\n` du corps d'une fonction. Ne pas
normaliser davantage est ce qui le rend honnête, une comparaison indulgente finissant par tout
accepter.

    1. jouer `supabase/essais/socle.sql` (outil MCP `execute_sql`), qui rend une empreinte
    2. python3 supabase/essais/socle.py            → rend l'empreinte des fichiers
    3. les deux sont égales ⇒ le socle décrit la base ; elles diffèrent ⇒ `--detail` des deux côtés

Cet environnement n'atteint pas la base depuis un shell : les deux moitiés sont donc séparées, comme
pour `allerretour.py`. Le coût est de deux commandes ; ce qu'on achète est une reconstruction dont on
sait qu'elle est encore vraie.
"""
import hashlib
import re
import sys
from pathlib import Path

DOSSIER = Path(__file__).resolve().parents[1] / 'schema' / 'socle'


def instructions(texte: str) -> list[str]:
    """Les instructions SQL du fichier, commentaires retirés.

    On ne coupe QUE les lignes entièrement en commentaire, jamais un `--` de fin de ligne : le SQL
    fautif serait de toute façon avant, et couper là risquerait d'avaler un littéral contenant `--`.
    C'est la règle déjà posée par `retraitsStockage.test.ts` pour le scanner de `.catch(() => {})`.

    Une instruction s'arrête à un `;` suivi d'une fin de ligne, HORS d'un corps `$tag$ … $tag$` : le
    corps d'une fonction porte ses propres `;` en fin de ligne, et couper dedans ferait de chaque
    ligne de plpgsql une « instruction » — une empreinte fausse des deux côtés à la fois, donc égale.
    """
    lignes = [l for l in texte.split('\n') if not l.lstrip().startswith('--')]
    brut = '\n'.join(lignes)
    morceaux: list[str] = []
    courant = ''
    i = 0
    while i < len(brut):
        balise = re.match(r'\$\w*\$', brut[i:])
        if balise:
            fin = brut.find(balise.group(0), i + len(balise.group(0)))
            if fin < 0:
                raise ValueError(f'corps {balise.group(0)} jamais refermé')
            fin += len(balise.group(0))
            courant += brut[i:fin]
            i = fin
            continue
        if brut[i] == ';' and (i + 1 == len(brut) or brut[i + 1] == '\n' or brut[i + 1].isspace()):
            morceaux.append(courant)
            courant = ''
            i += 1
            continue
        courant += brut[i]
        i += 1
    morceaux.append(courant)
    return [m.strip() + ';' for m in morceaux if m.strip()]


def empreinte(instrs: list[str]) -> str:
    # TRIÉES : le fichier range les tables par dépendance (il doit s'appliquer dans cet ordre), la
    # base les rend par nom. Comparer l'ordre ferait échouer le contrôle pour une raison qui n'a rien
    # à voir avec son objet — et un contrôle qui crie à tort cesse d'être cru.
    return hashlib.md5('\n'.join(sorted(instrs)).encode('utf-8')).hexdigest()


def main() -> int:
    fichiers = sorted(DOSSIER.glob('*.sql'))
    if not fichiers:
        # Un dossier vide rendrait l'empreinte d'une liste vide : « rien à comparer » et « tout
        # concorde » ne doivent pas se ressembler.
        print(f'aucun fichier dans {DOSSIER}', file=sys.stderr)
        return 1
    instrs = [i for f in fichiers for i in instructions(f.read_text(encoding='utf-8'))]
    if '--detail' in sys.argv:
        for s in sorted(instrs):
            print(hashlib.md5(s.encode('utf-8')).hexdigest(), s.split('\n')[0][:90])
        return 0
    print(f'{len(fichiers)} fichiers   {len(instrs)} instructions   empreinte {empreinte(instrs)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
