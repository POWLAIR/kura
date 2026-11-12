-- Produits Open Food Facts mis en cache dans food_ref (issue #25).
-- La fonction off-product est seule à écrire ces lignes (source = 'off', code = EAN) ;
-- les utilisateurs connectés les lisent, comme le reste du référentiel.

alter table public.food_ref
  add column brand text,
  add column package_quantity numeric check (package_quantity > 0),
  add column package_unit public.quantity_unit check (package_unit in ('g', 'ml')),
  add column per_100_unit public.quantity_unit not null default 'g'
    check (per_100_unit in ('g', 'ml')),
  add constraint food_ref_package_check
    check ((package_quantity is null) = (package_unit is null));

comment on column public.food_ref.brand is 'Marque du produit (Open Food Facts).';
comment on column public.food_ref.package_quantity is
  'Contenance de l''emballage (Open Food Facts), dans package_unit : sert à proposer une quantité au scan.';
comment on column public.food_ref.package_unit is 'Unité de package_quantity : g ou ml.';
comment on column public.food_ref.per_100_unit is
  'Base des valeurs nutritionnelles : pour 100 g, ou pour 100 ml quand le produit se vend au volume.';
