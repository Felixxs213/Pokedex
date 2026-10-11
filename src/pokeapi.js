/* ------------------------------------------------------------------
   POKEAPI DATA LAYER
   Everything in this file is plain JavaScript: no React, no JSX and
   no CSS. That is on purpose — it means these functions can be
   imported and tested straight from Node with
   `node scripts/validate-pokedex.mjs`.
------------------------------------------------------------------ */

const API_BASE = "https://pokeapi.co/api/v2";
const SPRITES_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export const FIRST_GENERATION_COUNT = 151;

/* ------------------------------------------------------------------
   1. API LAYER
   Small wrappers around fetch so the rest of the app never has to
   think about urls or error handling.
------------------------------------------------------------------ */

export async function getJson(url, { signal } = {}) {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`PokéAPI responded with ${response.status}`);
  }

  return response.json();
}

export const getPokemon = (id) => getJson(`${API_BASE}/pokemon/${id}`);
export const getSpecies = (id) => getJson(`${API_BASE}/pokemon-species/${id}`);
export const getType = (name) => getJson(`${API_BASE}/type/${name}`);
export const getAbility = (name) => getJson(`${API_BASE}/ability/${name}`);

/* ------------------------------------------------------------------
   2. SMALL FORMATTERS
   The API speaks in snake_case, decimetres and hectograms. These
   helpers translate that into things a human wants to read.
------------------------------------------------------------------ */

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export const humanize = (text) => text.split("-").map(capitalize).join(" ");

export const pokedexNumber = (id) => `#${String(id).padStart(3, "0")}`;

// The sprite files PokeAPI itself serves. Building the url ourselves saves
// us an extra request for every Pokémon we only want a picture of.
export const getArtworkUrl = (id) =>
  `${SPRITES_BASE}/other/official-artwork/${id}.png`;

export const getPixelSpriteUrl = (id) => `${SPRITES_BASE}/${id}.png`;

export const formatHeight = (decimetres) => `${(decimetres / 10).toFixed(1)} m`;

export const formatWeight = (hectograms) => `${(hectograms / 10).toFixed(1)} kg`;

export const formatGeneration = (name) =>
  `Gen ${name.replace("generation-", "").toUpperCase()}`;

export const formatPercent = (value, max) => `${Math.round((value / max) * 100)}%`;

export function getFlavorText(species) {
  const englishEntries = species.flavor_text_entries.filter(
    (entry) => entry.language.name === "en"
  );

  const firstEntry = englishEntries[0];

  if (!firstEntry) {
    return "No archived field notes were found for this specimen.";
  }

  return firstEntry.flavor_text.replace(/[\n\f]/g, " ");
}

export function getPrimaryAbility(pokemon) {
  const normalAbility = pokemon.abilities.find((slot) => !slot.is_hidden);
  return (normalAbility ?? pokemon.abilities[0]).ability.name;
}

export function getAnimatedSprite(pokemon) {
  return (
    pokemon.sprites.versions["generation-v"]["black-white"].animated
      ?.front_default ?? pokemon.sprites.front_default
  );
}

/* ------------------------------------------------------------------
   3. ENDPOINT BUILDERS
   Each of these turns one API response into a simple shape that the
   JSX can render without digging through nested objects.
------------------------------------------------------------------ */

export async function buildTypeMatchups(typeNames) {
  // One request per type the Pokémon has. They are independent, so we
  // fire them all at once instead of waiting for one after another.
  const typeResponses = await Promise.all(typeNames.map(getType));

  const weak = new Set();
  const resistant = new Set();
  const immune = new Set();

  typeResponses.forEach((type) => {
    const damageRelations = type.damage_relations;

    damageRelations.double_damage_from.forEach((entry) => weak.add(entry.name));
    damageRelations.half_damage_from.forEach((entry) => resistant.add(entry.name));
    damageRelations.no_damage_from.forEach((entry) => immune.add(entry.name));
  });

  // A dual-type Pokémon can take double damage from one of its types and
  // half damage from the other, which cancels out to a normal 1x hit. So a
  // type only counts as a weakness if the *other* type does not resist it,
  // and only counts as a resistance if the other type is not weak to it.
  // Immunities always win over both.
  return {
    weak: [...weak].filter((name) => !immune.has(name) && !resistant.has(name)),
    resistant: [...resistant].filter((name) => !immune.has(name) && !weak.has(name)),
    immune: [...immune],
  };
}

export async function buildAbilityInfo(pokemon) {
  const abilityName = getPrimaryAbility(pokemon);
  const abilityData = await getAbility(abilityName);
  const englishEntry = abilityData.effect_entries.find(
    (entry) => entry.language.name === "en"
  );

  return {
    name: humanize(abilityName),
    text: englishEntry?.short_effect ?? "No effect data available.",
  };
}

export function getIdFromUrl(url) {
  // PokeAPI urls look like ".../pokemon-species/25/" with a trailing slash,
  // so we drop the empty pieces before reading the last one.
  const parts = url.split("/").filter(Boolean);
  return Number(parts[parts.length - 1]);
}

export function flattenEvolutionChain(node, stages = [], depth = 0) {
  // Every species link in the chain looks like:
  // { species: { name, url }, evolves_to: [ ...more of the same ] }
  // `depth` is 0 for the starting Pokémon and grows with every evolution,
  // which is how we know how far to indent it later.
  stages.push({
    id: getIdFromUrl(node.species.url),
    name: node.species.name,
    depth,
  });

  node.evolves_to.forEach((nextStage) => {
    flattenEvolutionChain(nextStage, stages, depth + 1);
  });

  return stages;
}

export async function buildEvolutionChain(species) {
  const chainResponse = await getJson(species.evolution_chain.url);

  // The response is { id, chain: { species, evolves_to } } — the tree
  // we want lives one level down, under `chain`.
  return flattenEvolutionChain(chainResponse.chain);
}

/* ------------------------------------------------------------------
   4. THE SCAN
   One helper that grabs everything we need for a single Pokémon.
------------------------------------------------------------------ */

export async function scanPokemon(id) {
  // Step 1: these two requests depend only on the id.
  const pokemon = await getPokemon(id);
  const species = await getSpecies(id);

  // Step 2: three more requests that only need `pokemon` / `species`,
  // so they run in parallel with Promise.all.
  const [typeMatchups, ability, evolutionChain] = await Promise.all([
    buildTypeMatchups(pokemon.types.map((slot) => slot.type.name)),
    buildAbilityInfo(pokemon),
    buildEvolutionChain(species),
  ]);

  return { pokemon, species, typeMatchups, ability, evolutionChain };
}

export function getRandomPokemonId() {
  return Math.floor(Math.random() * FIRST_GENERATION_COUNT) + 1;
}
