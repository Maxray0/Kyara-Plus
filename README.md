# Kyara Plus

Extension de navigateur pour [kyara.games](https://kyara.games) : prix du marché, gestion des doublons, échanges, envies, achats, alertes locales et statistiques.

Kyara Plus est un projet indépendant, non affilié à Kyara ni à ses éditeurs. L’extension utilise le compte Kyara connecté dans le navigateur et ne remplace pas le site.

## Installation

### Firefox

La fiche officielle est publiée sur [addons.mozilla.org](https://addons.mozilla.org/fr/firefox/addon/kyara-plus/). L’extension nécessite Firefox pour ordinateur 142 ou plus récent ; Firefox pour Android n’est pas pris en charge.

Après l’installation, ouvre [kyara.games](https://kyara.games), connecte-toi, puis clique sur le lanceur Kyara Plus en haut à droite de la page.

### Chrome et Edge

Il n’y a pas encore de fiche Chrome Web Store. Les builds Chrome sont destinés aux releases GitHub : télécharger l’archive, la décompresser, ouvrir `chrome://extensions`, activer le mode développeur et choisir **Charger l’extension non empaquetée**. Ce mode n’installe pas de mise à jour automatique.

## Fonctionnalités

- **Marché et collection** : prix médians, noms, séries, raretés, cartes manquantes, progression des albums et contours de rareté.
- **Doublons** : analyse de la collection, prix de vente conseillé, recyclage, annonces actives, protection des cartes et remplissage groupé des emplacements.
- **Échanges et envies** : lecture des offres, comparaison avec les prix habituels et la liste d’envies, acceptation d’un échange après confirmation.
- **Achats** : prix fixe, enchères et ordres d’achat avec plafonds de dépense.
- **Alertes locales** : cloche dans l’en-tête du site pour les envies, les bons échanges et les cartes suivies, avec liens vers l’offre précise. Aucune notification système.
- **Statistiques et activité** : progression des comptes suivis, boosters, ventes, annonces et historique.
- **Automatisations optionnelles** : Anti-AFK, ouverture de boosters et vente automatique, désactivés par défaut et sous contrôle de l’utilisateur.

Les actions manuelles qui modifient le compte demandent deux vrais clics. Les réglages, caches et historiques restent dans le stockage local du navigateur.

## Développement

Prérequis : Node.js 24 ou plus récent et pnpm 12.18.0.

```bash
pnpm install --frozen-lockfile
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
pnpm build          # build Chrome dans .output/chrome-mv3
pnpm build:firefox  # build Firefox dans .output/firefox-mv3
pnpm zip            # archive Chrome
pnpm zip:firefox    # archive Firefox
pnpm compile        # vérification TypeScript
```

## Structure

```text
src/                 code TypeScript, content scripts et styles
public/icon/         icônes et logo source
wxt.config.ts        manifeste et configuration WXT
package.json         scripts et dépendances de build
```

Le paquet Firefox est construit avec WXT/Vite ; le code source complet et les instructions de reconstruction sont fournis à AMO lors de la soumission.

## Confidentialité

L’extension n’envoie aucune donnée au développeur et n’utilise ni analytique, ni publicité, ni serveur intermédiaire. Les requêtes sont adressées uniquement à `https://kyara.games` avec la session du site. Le jeton de session reste en mémoire (`storage.session`) ; les réglages et historiques restent dans le stockage local du navigateur.

La politique de confidentialité complète est publiée sur la [fiche AMO](https://addons.mozilla.org/fr/firefox/addon/kyara-plus/).

## Licence

Ce projet est distribué sous [licence MIT](./LICENSE).

Copyright © 2026 Maxray.
