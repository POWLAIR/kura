import { describe, expect, it } from "vitest";
import type { InventoryItemView } from "./inventory-view.ts";
import {
  NOTION_PROPS,
  NOTION_SCHEMA,
  type NotionPage,
  notionProperties,
  planNotionSync,
  rowOf,
  rowOfPage,
} from "./notion-export.ts";

const rice: InventoryItemView = {
  id: 1,
  name: "Riz",
  category: "feculents",
  location: "placard",
  quantity: 1500,
  unit: "g",
  restock_threshold: 2000,
  low_stock: true,
  food: { id: 12, name: "Riz blanc, cru" },
};
const soy: InventoryItemView = {
  id: 2,
  name: "Sauce soja",
  category: "sauces",
  location: "frigo",
  level: "moitie",
  expires_on: "2026-12-24",
};

// Page telle que Notion la renvoie, construite depuis les propriétés envoyées.
function pageOf(id: string, properties: Record<string, unknown>): NotionPage {
  const read = Object.fromEntries(
    Object.entries(properties).map(([name, value]) => {
      const v = value as Record<string, unknown>;
      for (const kind of ["title", "rich_text"] as const) {
        if (kind in v) {
          const parts = v[kind] as { text: { content: string } }[];
          return [name, { [kind]: parts.map((p) => ({ plain_text: p.text.content })) }];
        }
      }
      return [name, v];
    }),
  );
  return { id, properties: read };
}

describe("rowOf et notionProperties", () => {
  it("décrit un article avec ses libellés français", () => {
    expect(rowOf(rice)).toEqual({
      id: 1,
      name: "Riz",
      location: "Placard",
      category: "Féculents",
      amount: "1,5 kg",
      expires: null,
      restock: true,
    });
    expect(rowOf(soy)).toMatchObject({ amount: "Moitié", expires: "2026-12-24", restock: false });
  });

  it("n'envoie que l'inventaire : aucune donnée de santé ni d'aliment de référence", () => {
    const properties = notionProperties(rowOf(rice));
    expect(Object.keys(properties).sort()).toEqual(Object.keys(NOTION_SCHEMA).sort());
    const sent = JSON.stringify(properties);
    expect(sent).not.toContain("Riz blanc, cru");
    expect(sent).not.toMatch(/kcal|poids|repas|séance/i);
  });

  it("se relit à l'identique depuis la page créée", () => {
    for (const item of [rice, soy]) {
      const row = rowOf(item);
      expect(rowOfPage(pageOf("p", notionProperties(row)))).toEqual(row);
    }
  });

  it("ignore une page sans id Kura", () => {
    expect(rowOfPage({ id: "p", properties: { [NOTION_PROPS.name]: { title: [] } } })).toBeNull();
  });
});

describe("planNotionSync", () => {
  it("crée tout dans une base vide", () => {
    expect(planNotionSync([rice, soy], [])).toEqual({
      create: [rowOf(rice), rowOf(soy)],
      update: [],
      trash: [],
    });
  });

  it("ne touche pas une page à jour, réécrit celle qui diffère", () => {
    const pages = [
      pageOf("page-riz", notionProperties(rowOf(rice))),
      pageOf("page-soja", notionProperties({ ...rowOf(soy), amount: "Plein" })),
    ];
    expect(planNotionSync([rice, soy], pages)).toEqual({
      create: [],
      update: [{ pageId: "page-soja", row: rowOf(soy) }],
      trash: [],
    });
  });

  it("réécrit une page modifiée à la main dans Notion : le sens unique l'emporte", () => {
    const edited = pageOf(
      "page-riz",
      notionProperties({ ...rowOf(rice), name: "Riz (corrigé dans Notion)" }),
    );
    expect(planNotionSync([rice], [edited]).update).toEqual([
      { pageId: "page-riz", row: rowOf(rice) },
    ]);
  });

  it("met à la corbeille les articles retirés, les doublons et les pages ajoutées à la main", () => {
    const pages = [
      pageOf("page-riz", notionProperties(rowOf(rice))),
      pageOf("page-riz-bis", notionProperties(rowOf(rice))),
      pageOf("page-retiree", notionProperties({ ...rowOf(soy), id: 99 })),
      { id: "page-main", properties: { [NOTION_PROPS.name]: { title: [{ plain_text: "Note" }] } } },
    ];
    expect(planNotionSync([rice], pages)).toEqual({
      create: [],
      update: [],
      trash: ["page-riz-bis", "page-main", "page-retiree"],
    });
  });
});
