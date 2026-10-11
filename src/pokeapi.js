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

// If the API never answers, give up after this long instead of spinning forever.
const REQUEST_TIMEOUT_MS = 10000;

/* ------------------------------------------------------------------
   1. API LAYER
   Small wrappers around fetch so the rest of the app never has to
   think about urls or error handling.
------------------------------------------------------------------ */

export async function getJson(url, { signal } = {}) {
  // `AbortSignal.timeout` cancels the request if the server is too slow, so a
  // stuck connection can never leave the app scanning forever.
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  // The caller can also pass its own signal — we use that to cancel a scan
  // that has been replaced by a newer one. Combine both so whichever fires
  // first wins.
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(url, { signal: combinedSignal });

  if (!response.ok) {
    throw new Error(`PokéAPI responded with ${response.status}`);
  }

  return response.json();
}

export const getPokemon = (id, options) =>
  getJson(`${API_BASE}/pokemon/${id}`, options);
export const getSpecies = (id, options) =>
  getJson(`${API_BASE}/pokemon-species/${id}`, options);
export const getType = (name, options) =>
  getJson(`${API_BASE}/type/${name}`, options);
export const getAbility = (name, options) =>
  getJson(`${API_BASE}/ability/${name}`, options);

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

export async function buildTypeMatchups(typeNames, options) {
  // One request per type the Pokémon has. They are independent, so we
  // fire them all at once instead of waiting for one after another.
  // (The arrow wrapper matters: `.map(getType)` would pass the array
  // index in as `options`.)
  const typeResponses = await Promise.all(
    typeNames.map((name) => getType(name, options))
  );

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

export async function buildAbilityInfo(pokemon, options) {
  const abilityName = getPrimaryAbility(pokemon);
  const abilityData = await getAbility(abilityName, options);
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
  // so we drop the empty pieces before reading the last one. We return null
  // (rather than NaN) if the url does not end in a number.
  const parts = String(url).split("/").filter(Boolean);
  const id = Number(parts[parts.length - 1]);
  return Number.isFinite(id) ? id : null;
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

export async function buildEvolutionChain(species, options) {
  const chainResponse = await getJson(species.evolution_chain.url, options);

  // The response is { id, chain: { species, evolves_to } } — the tree
  // we want lives one level down, under `chain`.
  return flattenEvolutionChain(chainResponse.chain);
}

/* ------------------------------------------------------------------
   4. THE SCAN
   One helper that grabs everything we need for a single Pokémon.
------------------------------------------------------------------ */

export async function scanPokemon(id, options = {}) {
  // The Pokémon and its species are the core of the entry, so if either of
  // these fails there is nothing to show and the error is left to bubble up.
  const pokemon = await getPokemon(id, options);
  const species = await getSpecies(id, options);

  // The other three only need `pokemon` / `species`, so they run in parallel.
  // `allSettled` (not `all`) means one slow or failing request no longer
  // throws away the data the others already fetched.
  const [matchupsResult, abilityResult, evolutionResult] =
    await Promise.allSettled([
      buildTypeMatchups(
        pokemon.types.map((slot) => slot.type.name),
        options
      ),
      buildAbilityInfo(pokemon, options),
      buildEvolutionChain(species, options),
    ]);

  // If the caller cancelled this scan (because a newer one started), throw so
  // the caller does not apply half-finished results.
  if (options.signal?.aborted) {
    throw new DOMException("Scan aborted", "AbortError");
  }

  return {
    pokemon,
    species,
    // `ok: false` tells the matching panel to say "unavailable" instead of
    // pretending the Pokémon has no weaknesses.
    typeMatchups:
      matchupsResult.status === "fulfilled"
        ? matchupsResult.value
        : { weak: [], resistant: [], immune: [], ok: false },
    ability:
      abilityResult.status === "fulfilled"
        ? abilityResult.value
        : { name: "Unknown", text: "Ability data unavailable.", ok: false },
    // An evolution chain always has at least the Pokémon itself, so an empty
    // list means this request failed.
    evolutionChain:
      evolutionResult.status === "fulfilled" ? evolutionResult.value : [],
  };
}

export function getRandomPokemonId() {
  return Math.floor(Math.random() * FIRST_GENERATION_COUNT) + 1;
}
