import { useColorScheme } from "react-native";

// Couleurs de l'app. Pas de rouge ni de vert pour porter un sens (règle de ton de la
// conception) : l'accent est le seul repère.
const palettes = {
  light: {
    background: "#F6F1E7",
    surface: "#FFFFFF",
    text: "#1F1B16",
    textSecondary: "#6B6459",
    border: "#DDD5C5",
    accent: "#3F4E8C",
    onAccent: "#FFFFFF",
  },
  dark: {
    background: "#15130F",
    surface: "#211E19",
    text: "#F2EDE3",
    textSecondary: "#A79F92",
    border: "#3A352D",
    accent: "#9AA8E6",
    onAccent: "#15130F",
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)["light"]]: string };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export function usePalette(): Palette {
  return palettes[useColorScheme() === "dark" ? "dark" : "light"];
}
