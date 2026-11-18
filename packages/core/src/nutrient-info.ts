import type { MainNutrientKey, MicronutrientKey } from "./nutrients.ts";

// Fiches « À quoi ça sert » (docs/conception.md, « Affichage nutritionnel ») : deux ou trois
// phrases par valeur, rédigées une fois à partir des contenus de l'Anses et de Manger Bouger,
// relues, jamais générées à la volée. Elles disent le rôle d'une valeur et où on la trouve :
// ni repère chiffré, ni objectif, ni jugement (même règle que le compagnon).

export const NUTRIENT_SOURCES = {
  ciqual: {
    label: "Anses, table de composition nutritionnelle Ciqual",
    url: "https://ciqual.anses.fr/",
  },
  anses_vitamins: {
    label: "Anses, « What are vitamins? »",
    url: "https://www.anses.fr/en/article/what-are-vitamins",
  },
  anses_minerals: {
    label: "Anses, « Minerals »",
    url: "https://www.anses.fr/en/article/minerals",
  },
  anses_references: {
    label: "Anses, références nutritionnelles en vitamines et minéraux",
    url: "https://www.anses.fr/en/content/dietary-reference-values-vitamins-and-minerals",
  },
  manger_bouger: {
    label: "Manger Bouger, « L'étiquetage obligatoire : la composition détaillée des produits »",
    url: "https://www.mangerbouger.fr/manger-mieux/s-informer-sur-les-produits-qu-on-achete/comprendre-les-informations-nutritionnelles-et-les-etiquettes/l-etiquetage-obligatoire-la-composition-detaillee-des-produits",
  },
} as const;
export type NutrientSourceKey = keyof typeof NUTRIENT_SOURCES;

export type NutrientInfo = { text: string; sources: readonly NutrientSourceKey[] };

const MAIN: readonly NutrientSourceKey[] = ["manger_bouger", "ciqual"];
const VITAMIN: readonly NutrientSourceKey[] = ["anses_vitamins", "anses_references"];
const MINERAL: readonly NutrientSourceKey[] = ["anses_minerals", "anses_references"];

export const NUTRIENT_INFO: Record<MainNutrientKey | MicronutrientKey, NutrientInfo> = {
  energy_kcal: {
    text: "L'énergie apportée par les aliments, en kilocalories. Le corps s'en sert pour fonctionner au repos (respirer, garder sa température), pour bouger et pour renouveler ses cellules. Elle vient des glucides, des lipides et des protéines.",
    sources: MAIN,
  },
  protein_g: {
    text: "Les protéines construisent et renouvellent les muscles, la peau et les os, et servent à fabriquer des enzymes, des hormones et des anticorps. On en trouve dans les produits animaux comme dans les légumineuses, les céréales et les fruits à coque.",
    sources: MAIN,
  },
  carbs_g: {
    text: "Les glucides sont la principale source d'énergie du corps, notamment pour le cerveau et les muscles. On les trouve surtout dans le pain, les céréales, les féculents, les légumineuses et les fruits.",
    sources: MAIN,
  },
  sugars_g: {
    text: "Les sucres sont les glucides les plus simples : ceux des fruits et du lait, et ceux qu'on ajoute en cuisine (sucre, miel, sirops). Ils fournissent une énergie vite disponible.",
    sources: MAIN,
  },
  fat_g: {
    text: "Les lipides sont une réserve d'énergie et entrent dans la construction des cellules. Ils transportent les vitamines A, D, E et K et apportent des acides gras que le corps ne sait pas fabriquer, comme les oméga 3 et 6.",
    sources: MAIN,
  },
  saturated_fat_g: {
    text: "Les acides gras saturés sont une famille de lipides, présente surtout dans le beurre, les fromages, les viandes et certaines huiles végétales (coco, palme). Comme les autres lipides, ils fournissent de l'énergie et participent à la structure des cellules.",
    sources: MAIN,
  },
  fiber_g: {
    text: "Les fibres viennent des végétaux et ne sont pas digérées : elles aident au transit et nourrissent les bactéries de l'intestin. On les trouve dans les céréales complètes, les légumineuses, les fruits et les légumes.",
    sources: MAIN,
  },
  salt_g: {
    text: "Le sel apporte du sodium, qui participe à l'équilibre de l'eau dans le corps et au fonctionnement des nerfs et des muscles. Une grande partie du sel vient des aliments transformés : pain, charcuterie, fromages, plats préparés.",
    sources: MAIN,
  },

  iron_mg: {
    text: "Le fer fait partie de l'hémoglobine, la protéine des globules rouges qui transporte l'oxygène dans le sang. On en trouve dans les viandes, les poissons, les légumineuses et certains légumes verts.",
    sources: MINERAL,
  },
  calcium_mg: {
    text: "Le calcium construit et renouvelle le squelette et les dents. Il intervient aussi dans la contraction des muscles et la transmission nerveuse. On le trouve dans les produits laitiers, certaines eaux minérales, les légumes verts et les fruits à coque.",
    sources: MINERAL,
  },
  magnesium_mg: {
    text: "Le magnésium participe à plus de 300 réactions du corps, dont la production d'énergie et le fonctionnement des muscles et des nerfs. Plus de la moitié se trouve dans les os. On en trouve dans les céréales complètes, les légumineuses, les fruits à coque et le chocolat.",
    sources: MINERAL,
  },
  vitamin_c_mg: {
    text: "La vitamine C protège les cellules, aide à absorber le fer des végétaux et participe aux défenses immunitaires. Le corps ne la stocke pas : elle vient des fruits et des légumes, surtout crus.",
    sources: VITAMIN,
  },
  potassium_mg: {
    text: "Le potassium participe à l'équilibre de l'eau dans les cellules et au fonctionnement des nerfs et des muscles, dont le cœur. On le trouve dans les fruits, les légumes, les légumineuses et les pommes de terre.",
    sources: MINERAL,
  },
  vitamin_d_ug: {
    text: "La vitamine D aide à fixer le calcium et le phosphore dans les os. Le corps la fabrique surtout grâce au soleil sur la peau ; l'alimentation en apporte un peu, par les poissons gras, les œufs et les produits laitiers.",
    sources: VITAMIN,
  },
  vitamin_b12_ug: {
    text: "La vitamine B12 participe à la formation des globules rouges et au fonctionnement du système nerveux. On la trouve presque uniquement dans les produits animaux : viandes, poissons, œufs, produits laitiers.",
    sources: VITAMIN,
  },
  vitamin_b9_ug: {
    text: "La vitamine B9 (folates) sert à fabriquer les cellules, en particulier les globules rouges, et joue un rôle important pendant la grossesse. On la trouve dans les légumes à feuilles vertes, les légumineuses et le foie.",
    sources: VITAMIN,
  },
  zinc_mg: {
    text: "Le zinc participe à l'activité de plus de 200 enzymes, à la croissance, à la cicatrisation et aux défenses immunitaires. On en trouve dans les viandes, les fruits de mer, les céréales complètes et les légumineuses.",
    sources: MINERAL,
  },
  vitamin_a_ug: {
    text: "La vitamine A intervient dans la vision, le renouvellement de la peau et les défenses immunitaires. Elle vient des produits animaux (foie, beurre, œufs) et, sous forme de bêta-carotène, des légumes et fruits orangés ou vert foncé.",
    sources: VITAMIN,
  },
  vitamin_e_mg: {
    text: "La vitamine E protège les cellules contre l'oxydation. On la trouve surtout dans les huiles végétales, les fruits à coque et les graines.",
    sources: VITAMIN,
  },
  vitamin_b1_mg: {
    text: "La vitamine B1 (thiamine) aide le corps à tirer de l'énergie des glucides et participe au fonctionnement des nerfs. On en trouve dans les céréales complètes, les légumineuses et le porc.",
    sources: VITAMIN,
  },
  vitamin_b2_mg: {
    text: "La vitamine B2 (riboflavine) participe à la production d'énergie à partir des aliments. On la trouve dans les produits laitiers, les œufs, les viandes et les légumes verts.",
    sources: VITAMIN,
  },
  vitamin_b3_mg: {
    text: "La vitamine B3 (niacine) participe à la production d'énergie et au bon état de la peau et du système nerveux. On en trouve dans les viandes, les poissons, les céréales complètes et les légumineuses.",
    sources: VITAMIN,
  },
  vitamin_b5_mg: {
    text: "La vitamine B5 (acide pantothénique) intervient dans l'utilisation des glucides, des lipides et des protéines. Elle est présente dans la plupart des aliments, notamment les viandes, les œufs, les céréales complètes et les champignons.",
    sources: VITAMIN,
  },
  vitamin_b6_mg: {
    text: "La vitamine B6 participe à l'utilisation des protéines, à la formation des globules rouges et au fonctionnement du système nerveux. On la trouve dans les viandes, les poissons, les céréales complètes, les légumineuses et les bananes.",
    sources: VITAMIN,
  },
  vitamin_k1_ug: {
    text: "La vitamine K1 est nécessaire à la coagulation du sang et participe à la santé des os. On la trouve surtout dans les légumes à feuilles vertes (épinards, choux, salades).",
    sources: VITAMIN,
  },
  vitamin_k2_ug: {
    text: "La vitamine K2 participe, comme la K1, à la coagulation du sang et à la santé des os. Elle est fabriquée en partie par les bactéries de l'intestin et présente dans les fromages et les aliments fermentés.",
    sources: VITAMIN,
  },
  phosphorus_mg: {
    text: "Le phosphore entre, avec le calcium, dans la construction des os et des dents, et participe à la production d'énergie des cellules. On le trouve dans les produits laitiers, les viandes, les poissons et les céréales.",
    sources: MINERAL,
  },
  iodine_ug: {
    text: "L'iode est nécessaire à la fabrication des hormones thyroïdiennes, qui règlent de nombreuses fonctions du corps. On le trouve dans les produits de la mer, les produits laitiers et le sel iodé.",
    sources: MINERAL,
  },
  selenium_ug: {
    text: "Le sélénium protège les cellules contre l'oxydation et participe au fonctionnement de la thyroïde. On en trouve dans les poissons, les fruits de mer, les viandes, les œufs et les noix du Brésil.",
    sources: MINERAL,
  },
  copper_mg: {
    text: "Le cuivre participe à la formation des globules rouges, à l'utilisation du fer et à la protection des cellules. On le trouve dans les fruits de mer, les abats, les fruits à coque et le chocolat.",
    sources: MINERAL,
  },
  manganese_mg: {
    text: "Le manganèse participe au fonctionnement de plusieurs enzymes, à la formation des os et à l'utilisation des glucides. On en trouve dans les céréales complètes, les fruits à coque, les légumineuses et le thé.",
    sources: MINERAL,
  },
  chloride_mg: {
    text: "Le chlorure, apporté surtout par le sel, participe avec le sodium à l'équilibre de l'eau dans le corps et à la digestion (acide de l'estomac).",
    sources: MINERAL,
  },
};
