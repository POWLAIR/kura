import { NOTION_PROPS } from "@kura/core";
import { describe, expect, it } from "vitest";
import { createDatabaseBody, DATABASE_TITLE, dataSourceIdOf } from "../src/notion-export";

describe("createDatabaseBody", () => {
  it("crée la base sous la page, avec les propriétés de l'export", () => {
    const body = createDatabaseBody("0123456789abcdef0123456789abcdef");
    expect(body.parent).toEqual({ type: "page_id", page_id: "0123456789abcdef0123456789abcdef" });
    expect(body.title).toEqual([{ type: "text", text: { content: DATABASE_TITLE } }]);
    expect(Object.keys(body.initial_data_source.properties).sort()).toEqual(
      Object.values(NOTION_PROPS).sort(),
    );
    expect(body.initial_data_source.properties[NOTION_PROPS.name]).toEqual({ title: {} });
    expect(body.initial_data_source.properties[NOTION_PROPS.location].select.options).toEqual([
      { name: "Placard" },
      { name: "Frigo" },
      { name: "Congélateur" },
    ]);
  });
});

describe("dataSourceIdOf", () => {
  it("lit l'id de la source de données, sans tirets", () => {
    expect(
      dataSourceIdOf({ data_sources: [{ id: "01234567-89ab-cdef-0123-456789abcdef", name: "x" }] }),
    ).toBe("0123456789abcdef0123456789abcdef");
  });

  it("refuse une réponse sans source de données", () => {
    expect(() => dataSourceIdOf({ id: "db" })).toThrow(/sans source de données/);
    expect(() => dataSourceIdOf(null)).toThrow();
  });
});
