import { describe, expect, it } from "vitest";
import { claudeChatUrl } from "./claude";

describe("claudeChatUrl", () => {
  it("met la demande, encodée, dans le paramètre q", () => {
    const url = new URL(claudeChatUrl("Qu'est-ce que je mange (envie : riz & œufs) ?"));
    expect(url.origin + url.pathname).toBe("https://claude.ai/new");
    expect(url.searchParams.get("q")).toBe("Qu'est-ce que je mange (envie : riz & œufs) ?");
  });
});
