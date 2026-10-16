import postgres from "postgres";

// Accès Postgres du serveur MCP. La connexion (SUPABASE_DB_URL) ne sert en clair qu'à
// retrouver la clé API ; tout le reste passe par asUser, donc par la RLS.

type Types = { numeric: number; bigint: number };
export type Sql = postgres.Sql<Types>;
export type Tx = postgres.TransactionSql<Types>;
export type Caller = { keyId: number; userId: string };

// numeric et bigint arrivent en texte par défaut : on les lit en nombres JS. Les ids et
// les quantités de l'inventaire restent très loin de 2^53.
const asNumber = { serialize: (x: number) => String(x), parse: (x: string) => Number(x) };

export function connect(url: string): Sql {
  return postgres(url, {
    prepare: false, // compatible avec le pooler Supavisor en mode transaction
    max: 1,
    idle_timeout: 20,
    types: {
      numeric: { to: 1700, from: [1700], ...asNumber },
      bigint: { to: 20, from: [20], ...asNumber },
    },
  });
}

// Clé active correspondant au hash, et note son dernier usage.
export async function findCaller(sql: Sql, keyHash: string): Promise<Caller | null> {
  const [row] = await sql<{ id: number; user_id: string }[]>`
    update public.api_key set last_used_at = now()
    where key_hash = ${keyHash} and revoked_at is null
    returning id, user_id`;
  return row ? { keyId: row.id, userId: row.user_id } : null;
}

// Exécute fn dans une transaction avec le rôle authenticated de l'utilisateur, comme
// PostgREST pour l'app : la RLS s'applique et auth.uid() vaut userId.
export function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${claims}, true)`;
    return await fn(tx);
  }) as Promise<T>;
}
