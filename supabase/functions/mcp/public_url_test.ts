import { assertEquals } from "@std/assert";
import { publicBaseUrl } from "./public_url.ts";

Deno.test("publicBaseUrl : en ligne, l'adresse du projet telle quelle", () => {
  assertEquals(publicBaseUrl("https://abc.supabase.co"), "https://abc.supabase.co");
  assertEquals(publicBaseUrl("https://abc.supabase.co/"), "https://abc.supabase.co");
});

Deno.test("publicBaseUrl : en local, le port exposé au lieu de la passerelle interne", () => {
  assertEquals(publicBaseUrl("http://kong:8000"), "http://127.0.0.1:54321");
  assertEquals(publicBaseUrl("http://kong:8000/"), "http://127.0.0.1:54321");
});
