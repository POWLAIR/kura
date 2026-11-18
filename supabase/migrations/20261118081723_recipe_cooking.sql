-- « J'ai cuisiné » (issue #33). Voir docs/mcp.md.
--
-- cook_recipe fait en une transaction ce que la conception appelle le fil rouge : le repas et
-- ses aliments (portions mangées), le stock décrémenté (portions cuisinées) et les
-- événements du compagnon. delete_meal défait le stock d'un repas cuisiné avant de le
-- supprimer. Rien n'est estimé : un article suivi en niveau, ou dont l'unité ne se convertit
-- pas, n'est pas décrémenté, et la réponse le dit.

-- ---------------------------------------------------------------------------
-- Recettes : clé d'idempotence, ingrédients nommés et ordonnés
-- ---------------------------------------------------------------------------

alter table public.recipe
  add column idempotency_key text check (length(idempotency_key) between 8 and 128),
  add constraint recipe_user_id_idempotency_key_key unique (user_id, idempotency_key);

-- Ingrédient tel que dit (« gousses d'ail »), obligatoire : il s'affiche même sans food_ref.
alter table public.recipe_ingredient
  add column name text check (length(trim(name)) > 0),
  add column position smallint not null default 0;

update public.recipe_ingredient ri
set name = coalesce((select f.name from public.food_ref f where f.id = ri.food_ref_id), 'Ingrédient')
where name is null;

alter table public.recipe_ingredient alter column name set not null;

-- ---------------------------------------------------------------------------
-- stock_movement : unité du mouvement
-- ---------------------------------------------------------------------------

-- Unité de l'article au moment du mouvement (null pour un mouvement de niveau). Sert à
-- delete_meal : on ne remet pas en stock 200 g dans un article passé depuis en pièces.
alter table public.stock_movement add column unit public.quantity_unit;

-- ---------------------------------------------------------------------------
-- Conversion depuis les grammes
-- ---------------------------------------------------------------------------

-- Inverse de to_grams : pièce par le poids d'une pièce, ml par la densité. Valeur inconnue :
-- null, l'article n'est pas décrémenté.
create function public.from_grams(
  p_grams numeric,
  p_unit public.quantity_unit,
  p_piece_weight_g numeric,
  p_density_g_ml numeric
)
returns numeric
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_unit
    when 'g' then p_grams
    when 'piece' then p_grams / nullif(p_piece_weight_g, 0)
    when 'ml' then p_grams / nullif(p_density_g_ml, 0)
  end;
$$;

-- ---------------------------------------------------------------------------
-- cook_recipe
-- ---------------------------------------------------------------------------

-- p_portions_eaten : portions mangées, comptées dans le repas. p_portions_cooked : portions
-- cuisinées, décomptées du stock ; par défaut la recette entière. Les quantités d'une
-- recette valent pour recipe.servings portions.
--
-- stock : un élément par ingrédient lié à un article de l'inventaire, avec son statut :
--   decremented   décrémenté de delta (unité de l'article) ;
--   insufficient  le stock est arrivé à 0 avant la quantité de la recette ;
--   empty         l'article était déjà à 0 ;
--   level         article suivi en niveau : non décrémenté ;
--   no_quantity   ingrédient sans quantité (« sel ») : non décrémenté ;
--   no_conversion unité de la recette non convertible dans celle de l'article.
-- Rejoué (même clé), rien n'est réécrit et stock est vide.
create function public.cook_recipe(
  p_recipe_id bigint,
  p_portions_eaten numeric,
  p_idempotency_key text,
  p_portions_cooked numeric default null,
  p_eaten_at timestamptz default null
)
returns table (meal_id bigint, replayed boolean, stock jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_recipe public.recipe;
  v_cooked numeric;
  v_meal_id bigint;
  v_existing public.meal;
  v_first boolean;
  v_row record;
  v_needed numeric;
  v_current numeric;
  v_delta numeric;
  v_status text;
  v_item_unit public.quantity_unit;
  v_item_level public.stock_level;
  v_stock jsonb := '[]'::jsonb;
begin
  if p_portions_eaten is null or p_portions_eaten <= 0 then
    raise exception 'Le nombre de portions mangées doit être positif' using errcode = '22023';
  end if;
  if p_portions_cooked is not null and p_portions_cooked <= 0 then
    raise exception 'Le nombre de portions cuisinées doit être positif' using errcode = '22023';
  end if;

  select * into v_recipe from public.recipe r where r.id = p_recipe_id;
  if not found then
    raise exception 'Recette % introuvable', p_recipe_id using errcode = 'P0002';
  end if;

  v_cooked := coalesce(p_portions_cooked, v_recipe.servings);
  if p_portions_eaten > v_cooked then
    raise exception 'Plus de portions mangées (%) que de portions cuisinées (%)',
      p_portions_eaten, v_cooked using errcode = '22023';
  end if;

  v_first := not exists (select 1 from public.meal m where m.recipe_id = p_recipe_id);

  insert into public.meal (label, eaten_at, recipe_id, servings, idempotency_key)
  values (v_recipe.title, coalesce(p_eaten_at, now()), p_recipe_id, p_portions_eaten, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_meal_id;

  if v_meal_id is null then
    select * into v_existing from public.meal m where m.idempotency_key = p_idempotency_key;
    if v_existing.recipe_id is distinct from p_recipe_id then
      raise exception 'Clé d''idempotence déjà utilisée par un autre repas' using errcode = '22023';
    end if;
    return query select v_existing.id, true, '[]'::jsonb;
    return;
  end if;

  -- Aliments du repas : la part mangée, convertie comme dans log_meal (conversions de
  -- l'utilisateur, puis food_ref).
  insert into public.meal_item (meal_id, food_ref_id, name, quantity, unit, quantity_g)
  select
    v_meal_id,
    ri.food_ref_id,
    ri.name,
    ri.quantity * p_portions_eaten / v_recipe.servings,
    ri.unit,
    public.to_grams(
      ri.quantity * p_portions_eaten / v_recipe.servings,
      ri.unit,
      coalesce(c.piece_weight_g, f.piece_weight_g),
      c.density_g_ml
    )
  from public.recipe_ingredient ri
  left join public.food_ref f on f.id = ri.food_ref_id
  left join public.food_conversion c on c.food_ref_id = ri.food_ref_id and c.user_id = v_uid
  where ri.recipe_id = p_recipe_id
  order by ri.position, ri.id;

  perform public.refresh_meal(v_meal_id);

  -- Stock : la part cuisinée, dans l'unité de chaque article.
  for v_row in
    select
      ri.name,
      ri.quantity * v_cooked / v_recipe.servings as quantity,
      ri.unit,
      i.id as item_id,
      i.name as item_name,
      coalesce(rc.piece_weight_g, rf.piece_weight_g) as piece_weight_g,
      rc.density_g_ml,
      coalesce(ic.piece_weight_g, inf.piece_weight_g) as item_piece_weight_g,
      ic.density_g_ml as item_density_g_ml
    from public.recipe_ingredient ri
    join public.inventory_item i on i.id = ri.inventory_item_id
    left join public.food_ref rf on rf.id = ri.food_ref_id
    left join public.food_conversion rc on rc.food_ref_id = ri.food_ref_id and rc.user_id = v_uid
    left join public.food_ref inf on inf.id = i.food_ref_id
    left join public.food_conversion ic on ic.food_ref_id = i.food_ref_id and ic.user_id = v_uid
    where ri.recipe_id = p_recipe_id
    order by ri.position, ri.id
  loop
    v_delta := null;
    -- Relu et verrouillé à chaque ingrédient : deux ingrédients peuvent viser le même article.
    select i.quantity, i.unit, i.level into v_current, v_item_unit, v_item_level
    from public.inventory_item i where i.id = v_row.item_id for update;

    if v_item_level is not null then
      v_status := 'level';
    elsif v_row.quantity is null then
      v_status := 'no_quantity';
    else
      v_needed := case
        when v_row.unit = v_item_unit then v_row.quantity
        else public.from_grams(
          public.to_grams(v_row.quantity, v_row.unit, v_row.piece_weight_g, v_row.density_g_ml),
          v_item_unit, v_row.item_piece_weight_g, v_row.item_density_g_ml
        )
      end;
      v_needed := round(v_needed, 3);
      if v_needed is null then
        v_status := 'no_conversion';
      elsif v_current <= 0 then
        v_status := 'empty';
      else
        v_delta := least(v_current, v_needed);
        v_status := case when v_delta < v_needed then 'insufficient' else 'decremented' end;
        if v_delta > 0 then
          update public.inventory_item set quantity = quantity - v_delta where id = v_row.item_id;
          insert into public.stock_movement (inventory_item_id, delta, reason, meal_id, unit)
          values (v_row.item_id, -v_delta, 'cuisine', v_meal_id, v_item_unit);
        end if;
      end if;
    end if;

    v_stock := v_stock || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'ingredient', v_row.name,
      'item_id', v_row.item_id,
      'item', v_row.item_name,
      'status', v_status,
      'delta', v_delta,
      'unit', case when v_delta is not null then v_item_unit end
    )));
  end loop;

  -- Compagnon : des ids seulement, jamais de contenu ni de quantité.
  insert into public.companion_event (type, data)
  values ('meal_cooked', jsonb_build_object('recipe_id', p_recipe_id, 'meal_id', v_meal_id));
  if v_first then
    insert into public.companion_event (type, data)
    values ('recipe_first_cooked', jsonb_build_object('recipe_id', p_recipe_id, 'meal_id', v_meal_id));
  end if;

  return query select v_meal_id, false, v_stock;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_meal
-- ---------------------------------------------------------------------------

-- Supprime un repas ; s'il vient de cook_recipe, remet d'abord en stock ce qui avait été
-- décrémenté (mouvement inverse « manuel »). Un article passé depuis en niveau ou dans une
-- autre unité n'est pas touché : il est listé dans not_restocked.
create function public.delete_meal(p_meal_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_meal public.meal;
  v_row record;
  v_item_name text;
  v_item_unit public.quantity_unit;
  v_restocked jsonb := '[]'::jsonb;
  v_not_restocked jsonb := '[]'::jsonb;
begin
  select * into v_meal from public.meal m where m.id = p_meal_id for update;
  if not found then
    raise exception 'Repas % introuvable (déjà supprimé ?)', p_meal_id using errcode = 'P0002';
  end if;

  for v_row in
    select sm.inventory_item_id as item_id, sm.unit, -sum(sm.delta) as amount
    from public.stock_movement sm
    where sm.meal_id = p_meal_id and sm.reason = 'cuisine'
    group by sm.inventory_item_id, sm.unit
    order by sm.inventory_item_id
  loop
    select i.name, i.unit into v_item_name, v_item_unit
    from public.inventory_item i where i.id = v_row.item_id for update;

    if v_item_unit is not distinct from v_row.unit and v_row.unit is not null then
      update public.inventory_item set quantity = quantity + v_row.amount where id = v_row.item_id;
      insert into public.stock_movement (inventory_item_id, delta, reason, unit)
      values (v_row.item_id, v_row.amount, 'manuel', v_row.unit);
      v_restocked := v_restocked || jsonb_build_array(jsonb_build_object(
        'item_id', v_row.item_id, 'item', v_item_name, 'delta', v_row.amount, 'unit', v_row.unit
      ));
    else
      v_not_restocked := v_not_restocked || jsonb_build_array(jsonb_build_object(
        'item_id', v_row.item_id, 'item', v_item_name,
        'reason', case when v_item_unit is null then 'level' else 'unit_changed' end
      ));
    end if;
  end loop;

  delete from public.meal m where m.id = p_meal_id;

  return jsonb_build_object(
    'meal', jsonb_build_object('id', v_meal.id, 'label', v_meal.label, 'eaten_at', v_meal.eaten_at),
    'restocked', v_restocked,
    'not_restocked', v_not_restocked
  );
end;
$$;

-- Réservées aux utilisateurs connectés (EXECUTE est accordé à public par défaut).
revoke all on function public.from_grams(numeric, public.quantity_unit, numeric, numeric) from public, anon;
grant execute on function public.from_grams(numeric, public.quantity_unit, numeric, numeric) to authenticated;
revoke all on function public.cook_recipe(bigint, numeric, text, numeric, timestamptz) from public, anon;
grant execute on function public.cook_recipe(bigint, numeric, text, numeric, timestamptz) to authenticated;
revoke all on function public.delete_meal(bigint) from public, anon;
grant execute on function public.delete_meal(bigint) to authenticated;
