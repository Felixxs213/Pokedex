/* ------------------------------------------------------------------
   POKEDEX VALIDATION
   Imports the real data layer from src/pokeapi.js — not a copy of it —
   so a bug like the empty "Weak to" list cannot slip through again.

   Usage:
     node scripts/validate-pokedex.mjs            # unit + all 151
     node scripts/validate-pokedex.mjs --quick    # unit + 6 Pokémon
------------------------------------------------------------------ */

import {
  buildTypeMatchups,
  flattenEvolutionChain,
  getJson,
  getIdFromUrl,
  scanPokemon,
} from "../src/pokeapi.js";

const QUICK = process.argv.includes("--quick");
const SAMPLE_IDS = [1, 6, 25, 94, 131, 133];
const CONCURRENCY = 6;

let checks = 0;
let failures = 0;

function check(label, condition, detail = "") {
  checks += 1;

  if (condition) {
    return;
  }

  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// Compares two lists of type names without caring about order.
function sameNames(actual, expected) {
  const a = [...actual].sort().join(",");
  const b = [...expected].sort().join(",");
  return a === b;
}

function hadOverlap(a, b) {
  return a.some((name) => b.includes(name));
}

// Runs `worker` over `items` a few at a time so we do not hammer the API.
async function mapWithConcurrency(items, worker) {
  const results = [];

  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const chunk = items.slice(start, start + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(worker));
    results.push(...chunkResults);
  }

  return results;
}

/* ------------------------------------------------------------------
   1. URL PARSING
------------------------------------------------------------------ */

section("getIdFromUrl");

check(
  "trailing slash is ignored",
  getIdFromUrl("https://pokeapi.co/api/v2/pokemon-species/25/") === 25,
  `got ${getIdFromUrl("https://pokeapi.co/api/v2/pokemon-species/25/")}`
);
check(
  "no trailing slash still works",
  getIdFromUrl("https://pokeapi.co/api/v2/pokemon-species/1") === 1
);
check(
  "garbage url returns null instead of NaN",
  getIdFromUrl("https://pokeapi.co/api/v2/pokemon-species/bulbasaur/") === null
);

/* ------------------------------------------------------------------
   2. GROUND TRUTH TYPE MATCHUPS
   Hand-written from the official type chart for the modern type
   relations PokeAPI reports.
------------------------------------------------------------------ */

const GROUND_TRUTH = [
  {
    id: 1,
    name: "bulbasaur",
    weak: ["flying", "fire", "ice", "psychic"],
    resistant: ["water", "grass", "electric", "fighting", "fairy"],
    immune: [],
  },
  {
    id: 4,
    name: "charmander",
    weak: ["water", "ground", "rock"],
    resistant: ["fire", "grass", "ice", "bug", "steel", "fairy"],
    immune: [],
  },
  {
    id: 6,
    name: "charizard",
    weak: ["rock", "water", "electric"],
    resistant: ["bug", "steel", "fire", "grass", "fairy", "fighting"],
    immune: ["ground"],
  },
  {
    id: 25,
    name: "pikachu",
    weak: ["ground"],
    resistant: ["flying", "steel", "electric"],
    immune: [],
  },
  {
    id: 94,
    name: "gengar",
    weak: ["ghost", "dark", "ground", "psychic"],
    resistant: ["poison", "bug", "grass", "fairy"],
    immune: ["normal", "fighting"],
  },
  {
    id: 131,
    name: "lapras",
    weak: ["grass", "electric", "fighting", "rock"],
    resistant: ["water", "ice"],
    immune: [],
  },
];

section("buildTypeMatchups (ground truth)");

for (const expected of GROUND_TRUTH) {
  const pokemon = await getJson(`https://pokeapi.co/api/v2/pokemon/${expected.id}`);
  const types = pokemon.types.map((slot) => slot.type.name);
  const result = await buildTypeMatchups(types);

  check(
    `${expected.name} weak`,
    sameNames(result.weak, expected.weak),
    `got [${result.weak}] want [${expected.weak}]`
  );
  check(
    `${expected.name} resistant`,
    sameNames(result.resistant, expected.resistant),
    `got [${result.resistant}] want [${expected.resistant}]`
  );
  check(
    `${expected.name} immune`,
    sameNames(result.immune, expected.immune),
    `got [${result.immune}] want [${expected.immune}]`
  );
}

/* ------------------------------------------------------------------
   3. EVOLUTION CHAIN SHAPE
------------------------------------------------------------------ */

section("flattenEvolutionChain");

const bulbasaurSpecies = await getJson("https://pokeapi.co/api/v2/pokemon-species/1");
const bulbasaurChain = await getJson(bulbasaurSpecies.evolution_chain.url);
const bulbasaurStages = flattenEvolutionChain(bulbasaurChain.chain);

check("bulbasaur has 3 stages", bulbasaurStages.length === 3, `got ${bulbasaurStages.length}`);
check(
  "bulbasaur depths are 0,1,2",
  bulbasaurStages.map((s) => s.depth).join(",") === "0,1,2",
  `got ${bulbasaurStages.map((s) => s.depth).join(",")}`
);
check("bulbasaur stages have finite ids", bulbasaurStages.every((s) => Number.isFinite(s.id)));

const eeveeSpecies = await getJson("https://pokeapi.co/api/v2/pokemon-species/133");
const eeveeChain = await getJson(eeveeSpecies.evolution_chain.url);
const eeveeStages = flattenEvolutionChain(eeveeChain.chain);

check("eevee has 9 stages", eeveeStages.length === 9, `got ${eeveeStages.length}`);
check(
  "eevee branches are depth 1",
  eeveeStages.filter((s) => s.depth === 1).length === 8,
  `got ${eeveeStages.filter((s) => s.depth === 1).length} branches`
);

/* ------------------------------------------------------------------
   4. FULL SWEEP
------------------------------------------------------------------ */

section(`scanPokemon sweep (${QUICK ? "sample" : "all 151"})`);

const ids = QUICK
  ? SAMPLE_IDS
  : Array.from({ length: 151 }, (_, index) => index + 1);

const sweepProblems = [];

await mapWithConcurrency(ids, async (id) => {
  try {
    const { pokemon, typeMatchups, ability, evolutionChain } = await scanPokemon(id);

    if (typeMatchups.weak.length === 0) {
      sweepProblems.push(`#${id} ${pokemon.name}: empty weakness list`);
    }
    // A resistance list may legitimately be empty — pure Normal-types
    // (Rattata, Ditto, Snorlax…) resist nothing at all.
    if (hadOverlap(typeMatchups.weak, typeMatchups.resistant)) {
      sweepProblems.push(`#${id} ${pokemon.name}: weak/resistant overlap`);
    }
    if (hadOverlap(typeMatchups.weak, typeMatchups.immune)) {
      sweepProblems.push(`#${id} ${pokemon.name}: weak/immune overlap`);
    }
    if (!ability.text) {
      sweepProblems.push(`#${id} ${pokemon.name}: missing ability text`);
    }
    if (evolutionChain.length === 0) {
      sweepProblems.push(`#${id} ${pokemon.name}: empty evolution chain`);
    }
    if (!Number.isFinite(pokemon.id) || pokemon.id !== id) {
      sweepProblems.push(`#${id} ${pokemon.name}: bad id ${pokemon.id}`);
    }
  } catch (error) {
    sweepProblems.push(`#${id} scan threw: ${error.message}`);
  }
});

for (const problem of sweepProblems) {
  failures += 1;
  console.log(`  FAIL  ${problem}`);
}
checks += ids.length;

/* ------------------------------------------------------------------
   5. DEGRADATION AND CANCELLATION
   A single failing sub-request must not sink the whole scan, and an
   aborted scan must not be applied.
------------------------------------------------------------------ */

section("degradation and cancellation");

const realFetch = globalThis.fetch;

// Pretends a specific kind of request always fails.
function breakRequests(pattern) {
  globalThis.fetch = (url, init) => {
    if (String(url).includes(pattern)) {
      return Promise.resolve(new Response("nope", { status: 500 }));
    }
    return realFetch(url, init);
  };
}

// --- one broken ability request ---
breakRequests("/ability/");
const failedAbility = await scanPokemon(25);
globalThis.fetch = realFetch;

check(
  "failed ability still returns the Pokémon",
  failedAbility.pokemon.name === "pikachu",
  `got ${failedAbility.pokemon.name}`
);
check(
  "failed ability is flagged ok:false",
  failedAbility.ability.ok === false
);
check(
  "failed ability leaves matchups intact",
  failedAbility.typeMatchups.ok !== false &&
    failedAbility.typeMatchups.weak.length > 0
);

// --- one broken type request ---
breakRequests("/type/");
const failedTypes = await scanPokemon(1);
globalThis.fetch = realFetch;

check(
  "failed type request still returns the Pokémon",
  failedTypes.pokemon.name === "bulbasaur"
);
check(
  "failed type request is flagged ok:false",
  failedTypes.typeMatchups.ok === false
);
check(
  "failed type request gives safe empty lists",
  failedTypes.typeMatchups.weak.length === 0 &&
    failedTypes.typeMatchups.resistant.length === 0
);

// --- a cancelled scan must reject, not resolve with half data ---
const controller = new AbortController();
controller.abort();

let abortedWith = "none";
try {
  await scanPokemon(25, { signal: controller.signal });
} catch (error) {
  abortedWith = error.name;
}

check(
  "pre-aborted signal rejects with AbortError",
  abortedWith === "AbortError",
  `got ${abortedWith}`
);

// --- getJson honours a caller signal ---
let jsonAbortName = "none";
try {
  await getJson("https://pokeapi.co/api/v2/pokemon/1", {
    signal: controller.signal,
  });
} catch (error) {
  jsonAbortName = error.name;
}

check(
  "getJson honours an aborted signal",
  jsonAbortName === "AbortError",
  `got ${jsonAbortName}`
);

/* ------------------------------------------------------------------
   6. SUMMARY
------------------------------------------------------------------ */

console.log(`\n${checks} checks, ${failures} failure(s)`);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("All Pokédex checks passed.");
}
