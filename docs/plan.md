# Plan d'implémentation — ce qui reste à faire

> État au 2026-11-25 (phase 3 déployée), établi depuis le code, `docs/conception.md` et les issues GitHub. La conception reste la référence ; ce plan dit dans quel ordre la réaliser et ce qui n'a pas encore d'issue.

## Où on en est

| Phase | Issues | État |
|---|---|---|
| 1 — Fondations | 9 fermées | Terminée, critère rempli. |
| 2 — App de base | 13 fermées | Terminée, critère rempli. |
| 3 — Recettes | 6 fermées (#33 à #38), #79 en PR | Mergée et déployée le 2026-11-24 ; #79 confie la génération à Claude (plus d'API Anthropic) ; reste le critère de fin, à l'usage. |
| 4 — Santé | 4 ouvertes (#43 à #46) | Colonnes `source` et `external_id` prêtes, avec leur contrainte d'unicité. |
| 5 — Compagnon | 7 ouvertes (#47 à #53) | Table `companion_event` créée, jamais écrite. |

Les dix tools de la conception existent. Six ont été ajoutés en plus : `set_food_conversion`, `delete_entry`, `update_workout`, `update_weight`, `save_recipe` et `get_recipes` (serveur 0.10.0, 17 tools avec `remove_item`, et 3 prompts MCP depuis #79).

## Ce qui manquait d'issue

Les points 1, 5, 6 et 7 ont maintenant leurs issues (#42 à #53). Les points 2 et 3 restent à ajouter à #24 et #33, le point 8 reste à faire.

1. **Une API pour l'app.** La logique d'`add_items` et de `log_meal` (charger le stock et `food_ref`, décider avec `planPurchase`, écrire, idempotence) vit dans `supabase/functions/mcp/tools/`, dans une transaction Postgres. L'app, qui parle à PostgREST, ne peut pas la rejouer telle quelle en une transaction. Sans décision, #24, #26 et #27 la dupliqueraient, contre la règle « une seule source de vérité ».
2. **Retirer un article et le motif « périmé ».** Aucune fonction ne supprime un article ni n'écrit de `stock_movement` avec le motif `perime`, pourtant prévu dans l'enum.
3. **Enregistrer une recette proposée par Claude.** `cook_recipe` attend un `recipe_id` : si Claude propose lui-même la recette (question ouverte de #34), il faut un moyen de l'enregistrer.
4. **Saisie libre d'un repas dans l'app.** La conception prévoit « une saisie libre analysée par Claude » ; #27 ne couvre que la recherche Ciqual et le scan. Seul le chat de la phase 5 y répond.
5. **Toute la phase 4** : build EAS, Health Connect, tendance de poids.
6. **Toute la phase 5** : personnage Rive, calcul de l'état, événements, chat.
7. **Rappels de péremption.** La conception en parle (« les rappels portent sur le stock ») sans les placer dans la roadmap.
8. **Conception à rafraîchir** : elle annonce dix tables et dix tools ; il y a treize tables (`api_key`, `idempotent_call`, `food_conversion`) et douze tools.

## Décisions à prendre

Chacune bloque l'issue indiquée. La première option est celle que je recommande.

| # | Décision | Options | Bloque |
|---|---|---|---|
| D1 | Comment l'app appelle la logique métier | **Edge Function `api`** qui réutilise les mêmes fonctions que les tools MCP, authentifiée par le JWT Supabase · ou logique dupliquée dans l'app avec supabase-js | #42, puis #24, #26, #27 |
| D2 | Hébergement de la PWA | À choisir : EAS Hosting, Netlify, Cloudflare Pages | #32 |
| D3 | `cook_recipe` sur un article suivi en niveau ou dans une autre unité | **Ne pas décrémenter et le signaler dans la réponse** (rien n'est inventé) · ou baisser d'un cran de niveau | #33 |
| D4 | Supprimer un repas issu de `cook_recipe` | **Remettre en stock depuis les `stock_movement` liés** · ou laisser le stock et corriger à la main | #33 |
| D5 | `suggest_recipes` depuis Claude | **Renvoyer le stock trié par péremption, Claude propose, et `cook_recipe` accepte une recette à enregistrer** · ou second appel à l'API Claude depuis le serveur | #34 |
| D6 | Clé API après OAuth | **La garder pour Claude Code et les scripts** · ou la retirer | #38 |
| D7 | Séance saisie à la main puis importée de Health Connect | **Signaler le chevauchement et laisser choisir** · ou fusion automatique | #44 |
| D8 | Personnage | Valider Miso, ou Yuzu, ou Pesto | #47 |
| D9 | Historique du chat | Réglée par #79 : le chat avec Miso vit dans un projet claude.ai, l'historique reste chez Claude | #52 |
| D10 | Rappels de péremption | **Notifications locales en phase 5** · ou pas de notification du tout | #53 |

## Phase 1 — à clore

Rien à coder. Deux choses à faire à la main :

1. Le test réel de #9 depuis l'app Claude mobile : un vrai achat, un vrai repas avec des pièces (`set_food_conversion`), un résumé.
2. Le critère de fin : une semaine de suivi via Claude seul. Noter au passage ce qui gêne : ce sont les corrections à faire avant de construire l'app par-dessus.

La phase 2 ne démarre qu'ensuite.

## Phase 2 — App de base

Critère de fin : courses rangées par scan (#26).

| Ordre | Issue | Contenu | Dépend de |
|---|---|---|---|
| 1 | #23 | Squelette Expo, quatre onglets, connexion Supabase Auth, lint et typecheck dans `pnpm check` | — |
| 1 | #42 API de l'app (D1) | Déplacer `db.ts`, `log.ts` et la logique des tools dans `supabase/functions/_shared/` ; fonction `api` (JWT vérifié, CORS pour le web) exposant les mêmes opérations ; les tests des tools continuent de passer | — |
| 1 | #25 | Edge Function `off-product`, cache dans `food_ref` | — |
| 2 | #24 | Onglet Cuisine. **À ajouter à l'issue** : retirer un article, et le marquer périmé (RPC qui écrit le mouvement `perime`) | #23, #42 |
| 3 | #26 | Scan continu, validation en une transaction | #24, #25 |
| 2 | #27 | Onglet Journal | #23, #42 |
| 2 | #28 | Accueil et compagnon provisoire | #23 |
| 3 | #30 | Réglages : clés API | #23 |
| 3 | #31 | Export JSON et suppression du compte (seule fonction à détenir `service_role`) | #23 |
| libre | #29 | Export Notion (backend seul, secret `NOTION_TOKEN`) | — |
| dernier | #32 | PWA et mise en page en colonnes | #23, D2 |

Les trois lignes d'ordre 1 sont indépendantes et peuvent avancer en parallèle. #29 et #32 ne comptent pas pour le critère de fin.

Points d'attention :
- Metro et le workspace pnpm : vérifier dès #23 que `packages/core` (imports en `.ts`) se charge dans Expo, c'est le premier risque technique.
- Le scan fonctionne dans Expo Go avec `expo-camera` : pas besoin de build EAS avant la phase 4.
- Chaque nouvelle Edge Function reprend `log.ts` : ids et codes d'erreur seulement.

## Phase 3 — Recettes

Critère de fin : stock juste sans retouche.

Décisions prises le 2026-11-17 (première option recommandée chaque fois) :
- **D3** : un article suivi en niveau, ou dont l'unité ne se convertit pas, n'est pas décrémenté ; `cook_recipe` le signale (`stock.to_adjust`).
- **D4** : supprimer un repas issu de `cook_recipe` remet en stock ce qui avait été décompté (`delete_meal`).
- **D5** : depuis Claude, `suggest_recipes` renvoie le stock trié par péremption et Claude propose ; `save_recipe` (livré avec #33) enregistre la recette choisie. Depuis #79, l'app passe aussi par Claude : « Qu'est-ce que je mange ? » ouvre Claude avec la demande écrite ; plus de fonction `recipes` ni de clé Anthropic.
- **D6** : la clé API reste acceptée à côté de l'OAuth.
- **Portions** : le stock est décrémenté pour les portions cuisinées (par défaut toute la recette), le repas compte les portions mangées ; les restes ne sont pas suivis.

Ordre de réalisation (branches empilées) : #33, #34, #37, #35, #36, #38.

Après le merge de la pile, à faire à la main (détail dans chaque PR et `docs/deploiement.md`) :
1. Fait le 2026-11-24 : `supabase db push` et `pnpm functions:deploy`. Le déploiement a poussé une variable locale en secret de production (corrigé par #78).
2. Remplacé par #79 : plus de clé Anthropic. Après son merge, supprimer la fonction `recipes` en ligne et le secret `ANTHROPIC_API_KEY`, puis un premier « Qu'est-ce que je mange ? » réel (préremplissage `?q=` à vérifier sur le web et dans l'app Claude Android).
3. Fait : fiches « À quoi ça sert » (#37) relues avant le merge.
4. Dashboard Supabase : clé de signature asymétrique, serveur OAuth, Site URL de l'app web ; puis le connecteur claude.ai sans clé (#38).
5. Le critère : cuisiner plusieurs recettes d'affilée (app et Claude), puis comparer le stock réel à `get_inventory`.

| Ordre | Issue | Contenu | Dépend de |
|---|---|---|---|
| 1 | #33 | RPC `cook_recipe`, tool MCP, D3 et D4. **À ajouter** : mettre à jour les instructions du serveur (`server.ts`), qui demandent aujourd'hui à Claude de corriger le stock avec `update_item` | — |
| 1 | #37 | Fiches nutrition. La rédaction des fiches « À quoi ça sert » (sources Anses et Manger Bouger, relues) peut commencer tout de suite | — |
| 2 | #34 | Fonction `recipes` (API Claude, secret `ANTHROPIC_API_KEY`), tool `suggest_recipes`, D5 | #33 |
| 3 | #35 | Onglet Recettes et bouton « Qu'est-ce que je mange ? » sur l'Accueil | #33, #34 |
| 4 | #36 | Favoris et recettes perso | #35 |
| libre | #38 | OAuth 2.1, D6 | — |

Le critère se vérifie à l'usage : cuisiner plusieurs recettes d'affilée, puis comparer le stock réel et `get_inventory`. D3 décide en grande partie de ce résultat, puisqu'une bonne part du stock (épices, sauces) est suivie en niveau.

## Phase 4 — Santé

Critère de fin : imports sans doublon.

| Ordre | Issue | Contenu |
|---|---|---|
| 1 | #43 Build de développement EAS | `eas.json`, development build Android, signature ; l'app ne tourne plus dans Expo Go une fois le module santé ajouté |
| 2 | #44 Health Connect : séances | `react-native-health-connect`, permission de lecture des séances uniquement ; import à l'ouverture et à la demande ; `source = 'health_connect'`, `external_id` = id de l'enregistrement, insertion `on conflict do nothing` ; D7 |
| 2 | #45 Health Connect : pesées | Même mécanisme vers `body_measure`, permission de lecture du poids uniquement |
| 3 | #46 Tendance de poids lissée | Fonction pure dans `packages/core` (moyenne glissante), affichée dans le Journal ; pas de jugement ni de code couleur |

Vérification du critère : test pgTAP qui importe deux fois le même lot et compte les lignes, puis import réel relancé deux jours de suite sur le téléphone.

À vérifier avant de commencer : les exigences de Health Connect pour une app installée hors Play Store (déclaration des permissions, écran de justification).

## Phase 5 — Compagnon

Critère de fin : six états déclenchés.

| Ordre | Issue | Contenu |
|---|---|---|
| 0 | #47 Personnage et fichier Rive (D8) | Dessin et machine à états : entrées `mood`, `hunger`, déclencheurs `celebrate`, `wave`. Travail de dessin, pas de code : c'est le plus long, à lancer dès la phase 3 ou 4 |
| 1 | #48 Événements du compagnon | Écrire `companion_event` : repas cuisiné (déjà dans `cook_recipe`), première fois d'une recette, ouverture de l'app. Les séries se calculent depuis `meal`, `workout` et `body_measure` |
| 2 | #49 État du compagnon côté serveur | Fonction pure dans `packages/core` : événements + inventaire → état, `mood`, `hunger`, déclencheurs, avec l'ordre de priorité des six états ; un test par état, et un test « série interrompue : aucune pénalité » |
| 2 | #50 Répliques du compagnon | Phrases en français dans `packages/core`, relues ; test qui refuse toute mention du poids, des quantités ou des calories |
| 3 | #51 Miso dans l'app | Intégration Rive (Android et web) à la place du compagnon provisoire |
| 3 | #52 Miso dans Claude | Projet claude.ai « Kura », connecteur activé, instructions versionnées (personnalité, règles de ton) ; toucher le compagnon ouvre le projet. Pas de fonction `chat` ni de clé Anthropic (#79). Couvre aussi la saisie libre d'un repas |
| 4 | #53 Rappels de péremption (D10) | Notifications locales, sur le stock uniquement |

## À chaque issue

- `pnpm check` avant tout commit ; tests pgTAP pour chaque table ou RPC ; tests Deno pour chaque Edge Function.
- Migration : jamais modifier une migration mergée ; `supabase db push` lancé à la main après merge.
- Nouvelle fonction ou nouveau secret : `pnpm functions:deploy`, `supabase secrets set`, et `docs/deploiement.md` à jour.
- Un service externe en plus : vérifier qu'il figure dans la section Sécurité de la conception.
