import { useState } from "react";
import confetti from "canvas-confetti";
import "./App.css";

/* ------------------------------------------------------------------
   1. CONFIG
   Every PokéAPI endpoint starts with the same base URL, so we keep
   it in one place and build the rest of the URLs from it.
------------------------------------------------------------------ */

const API_BASE = "https://pokeapi.co/api/v2";
const SPRITES_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const FIRST_GENERATION_COUNT = 151;

const TYPE_COLORS = {
  normal: "#a8a878",
  fire: "#f08030",
  water: "#4d90d5",
  electric: "#f7d02c",
  grass: "#63bb5b",
  ice: "#6fbfbf",
  fighting: "#ce4069",
  poison: "#ab6ac8",
  ground: "#d97845",
  flying: "#8fafe2",
  psychic: "#f97176",
  bug: "#90c12c",
  rock: "#c7b78b",
  ghost: "#5269ac",
  dragon: "#0b6dc3",
  dark: "#5a5465",
  steel: "#5a8ea1",
  fairy: "#ec8fe6",
};

const STAT_ROWS = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "special-attack", label: "Sp. Atk" },
  { key: "special-defense", label: "Sp. Def" },
  { key: "speed", label: "Speed" },
];

const SCREEN_PAGES = ["PROFILE", "BATTLE"];

/* ------------------------------------------------------------------
   2. API LAYER
   Small wrappers around fetch so the rest of the app never has to
   think about URLs or error handling.
------------------------------------------------------------------ */

async function getJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PokéAPI responded with ${response.status}`);
  }

  return response.json();
}

const getPokemon = (id) => getJson(`${API_BASE}/pokemon/${id}`);
const getSpecies = (id) => getJson(`${API_BASE}/pokemon-species/${id}`);
const getType = (name) => getJson(`${API_BASE}/type/${name}`);
const getAbility = (name) => getJson(`${API_BASE}/ability/${name}`);

/* ------------------------------------------------------------------
   3. SMALL FORMATTERS
   The API speaks in snake_case, decimetres and hectograms.
   These helpers translate that into things a human wants to read.
------------------------------------------------------------------ */

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const humanize = (text) => text.split("-").map(capitalize).join(" ");

const pokedexNumber = (id) => `#${String(id).padStart(3, "0")}`;

// The sprite files PokeAPI itself serves. Building the url ourselves saves
// us an extra request for every Pokémon we only want a picture of.
const getArtworkUrl = (id) => `${SPRITES_BASE}/other/official-artwork/${id}.png`;
const getPixelSpriteUrl = (id) => `${SPRITES_BASE}/${id}.png`;


const formatHeight = (decimetres) => `${(decimetres / 10).toFixed(1)} m`;

const formatWeight = (hectograms) => `${(hectograms / 10).toFixed(1)} kg`;

const formatGeneration = (name) => `Gen ${name.replace("generation-", "").toUpperCase()}`;

const formatPercent = (value, max) => `${Math.round((value / max) * 100)}%`;

function getFlavorText(species) {
  const englishEntries = species.flavor_text_entries.filter(
    (entry) => entry.language.name === "en"
  );

  const firstEntry = englishEntries[0];

  if (!firstEntry) {
    return "No archived field notes were found for this specimen.";
  }

  return firstEntry.flavor_text.replace(/[\n\f]/g, " ");
}

function getPrimaryAbility(pokemon) {
  const normalAbility = pokemon.abilities.find((slot) => !slot.is_hidden);
  return (normalAbility ?? pokemon.abilities[0]).ability.name;
}

function getAnimatedSprite(pokemon) {
  return (
    pokemon.sprites.versions["generation-v"]["black-white"].animated
      ?.front_default ?? pokemon.sprites.front_default
  );
}

/* ------------------------------------------------------------------
   4. ENDPOINT BUILDERS
   Each of these turns one API response into a simple shape that the
   JSX can render without digging through nested objects.
------------------------------------------------------------------ */

async function buildTypeMatchups(typeNames) {
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

  // A type can show up twice: Water Pokémon are weak to Grass but also
  // resist Water itself. Weakness wins, so we filter duplicates out.
  const isNotWeakened = (name) => !weak.has(name) && !immune.has(name);
  const isNotResisted = (name) => !weak.has(name) && !immune.has(name);

  return {
    weak: [...weak].filter(isNotWeakened),
    resistant: [...resistant].filter(isNotResisted),
    immune: [...immune],
  };
}

async function buildAbilityInfo(pokemon) {
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

function getIdFromUrl(url) {
  // PokeAPI urls look like ".../pokemon-species/25/" with a trailing slash,
  // so we drop the empty pieces before reading the last one.
  const parts = url.split("/").filter(Boolean);
  return Number(parts[parts.length - 1]);
}

function flattenEvolutionChain(node, stages = [], depth = 0) {
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

async function buildEvolutionChain(species) {
  const chainResponse = await getJson(species.evolution_chain.url);

  // The response is { id, chain: { species, evolves_to } } — the tree
  // we want lives one level down, under `chain`.
  return flattenEvolutionChain(chainResponse.chain);
}

/* ------------------------------------------------------------------
   5. THE SCAN
   One helper that grabs everything we need for a single Pokémon.
------------------------------------------------------------------ */

async function scanPokemon(id) {
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

function getRandomPokemonId() {
  return Math.floor(Math.random() * FIRST_GENERATION_COUNT) + 1;
}

/* ------------------------------------------------------------------
   6. SMALL PRESENTATION COMPONENTS
------------------------------------------------------------------ */

function TypeBadge({ name }) {
  return (
    <span className="typeBadge" style={{ backgroundColor: TYPE_COLORS[name] }}>
      {humanize(name)}
    </span>
  );
}

function TypeBadgeRow({ names }) {
  if (names.length === 0) {
    return <span className="muted">None</span>;
  }

  return (
    <div className="badgeRow">
      {names.map((name) => (
        <TypeBadge key={name} name={name} />
      ))}
    </div>
  );
}

function StatBar({ label, value }) {
  // Gen 1 base stats run from 10 up to 255, so 255 makes a full bar.
  const width = Math.min(100, (value / 255) * 100);

  return (
    <div className="statBar">
      <span className="statBar__label">{label}</span>
      <div className="statBar__track">
        <div className="statBar__fill" style={{ width: `${width}%` }} />
      </div>
      <span className="statBar__value">{value}</span>
    </div>
  );
}

function SpeakerGrille() {
  return (
    <div className="speaker" aria-hidden="true">
      {Array.from({ length: 16 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   7. THE LCD SCREEN
------------------------------------------------------------------ */

function ScreenLoading() {
  return (
    <div className="screenState">
      <p className="screenState__title">SCANNING</p>
      <div className="scanBeam" />
      <p className="screenState__hint">Tuning into life signal</p>
    </div>
  );
}

function ScreenError({ message }) {
  return (
    <div className="screenState">
      <p className="screenState__title">SIGNAL LOST</p>
      <p className="screenState__hint">{message}</p>
    </div>
  );
}

function ScreenIdle() {
  return (
    <div className="screenState">
      <p className="screenState__title">POKéDEX</p>
      <p className="screenState__hint">Press START to scan</p>
    </div>
  );
}

function ProfilePage({ pokemon }) {
  const sprite = getAnimatedSprite(pokemon);

  return (
    <div className="screenPage">
      <div className="screenPage__top">
        <span>{pokedexNumber(pokemon.id)}</span>
        <span>{pokemon.types.length} TYPE</span>
      </div>

      <h2 className="screenPage__name">{humanize(pokemon.name)}</h2>

      <img className="screenSprite" src={sprite} alt={pokemon.name} />

      <div className="screenPage__types">
        {pokemon.types.map((slot) => (
          <span key={slot.type.name} className="screenTag">
            {humanize(slot.type.name)}
          </span>
        ))}
      </div>

      <div className="screenPage__stats">
        <span>{formatHeight(pokemon.height)}</span>
        <span>{formatWeight(pokemon.weight)}</span>
      </div>
    </div>
  );
}

function BattlePage({ pokemon, typeMatchups }) {
  return (
    <div className="screenPage">
      <div className="screenPage__top">
        <span>{pokedexNumber(pokemon.id)}</span>
        <span>BATTLE</span>
      </div>

      <h2 className="screenPage__name">{humanize(pokemon.name)}</h2>

      <dl className="matchupList">
        <div>
          <dt>Weak to</dt>
          <dd>{typeMatchups.weak.map(humanize).join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Resists</dt>
          <dd>{typeMatchups.resistant.map(humanize).join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Immune to</dt>
          <dd>{typeMatchups.immune.map(humanize).join(", ") || "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

function DexScreen({ entry, page, isLoading, error }) {
  const currentPage = SCREEN_PAGES[page];

  return (
    <div className="screen">
      <div className="screen__header">
        <span>POKéDEX SCANNER</span>
        <span className="screen__page">{currentPage}</span>
      </div>

      {isLoading && <ScreenLoading />}
      {!isLoading && error && <ScreenError message={error} />}
      {!isLoading && !error && !entry && <ScreenIdle />}
      {!isLoading && !error && entry && page === 0 && (
        <ProfilePage pokemon={entry.pokemon} />
      )}
      {!isLoading && !error && entry && page === 1 && (
        <BattlePage pokemon={entry.pokemon} typeMatchups={entry.typeMatchups} />
      )}

      <div className="screen__dots">
        {SCREEN_PAGES.map((name, index) => (
          <span
            key={name}
            className={index === page ? "screen__dot isActive" : "screen__dot"}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   8. INFO PANELS
------------------------------------------------------------------ */

function Panel({ title, badge, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__header">
        <h3>{title}</h3>
        {badge}
      </header>
      {children}
    </section>
  );
}

function AboutPanel({ entry }) {
  const { pokemon, species, ability } = entry;

  const tags = [
    formatGeneration(species.generation.name),
    humanize(species.habitat?.name ?? "unknown"),
    `Catch ${formatPercent(species.capture_rate, 255)}`,
    `${pokemon.moves.length} moves`,
  ];

  if (species.is_legendary) tags.push("Legendary");
  if (species.is_mythical) tags.push("Mythical");

  return (
    <Panel title="Field Report" badge={<span className="panelBadge">No. {pokemon.id}</span>}>
      <p className="aboutText">{getFlavorText(species)}</p>

      <div className="chipRow">
        {tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <div className="dataGrid">
        <div>
          <span className="dataGrid__label">Genus</span>
          <span className="dataGrid__value">{species.genera[0]?.genus ?? "Unknown"}</span>
        </div>
        <div>
          <span className="dataGrid__label">Colour</span>
          <span className="dataGrid__value">
            {species.color ? humanize(species.color.name) : "—"}
          </span>
        </div>
        <div>
          <span className="dataGrid__label">Growth</span>
          <span className="dataGrid__value">{humanize(species.growth_rate.name)}</span>
        </div>
        <div>
          <span className="dataGrid__label">Happiness</span>
          <span className="dataGrid__value">
            {species.base_happiness}
            {species.base_happiness ? " / 255" : ""}
          </span>
        </div>
      </div>

      <div className="abilityBlock">
        <span className="dataGrid__label">Ability · {ability.name}</span>
        <p>{ability.text}</p>
      </div>
    </Panel>
  );
}

function StatsPanel({ pokemon }) {
  const stats = Object.fromEntries(
    pokemon.stats.map((entry) => [entry.stat.name, entry.base_stat])
  );

  const total = Object.values(stats).reduce((sum, value) => sum + value, 0);

  return (
    <Panel
      title="Base Stats"
      badge={<span className="panelBadge">Total {total}</span>}
    >
      {STAT_ROWS.map((row) => (
        <StatBar key={row.key} label={row.label} value={stats[row.key]} />
      ))}
    </Panel>
  );
}

function MatchupPanel({ typeMatchups }) {
  return (
    <Panel title="Type Matchup" className="panel--matchups">
      <div className="matchupGroup">
        <h4 className="matchupGroup__title matchupGroup__title--weak">
          Weak to
        </h4>
        <TypeBadgeRow names={typeMatchups.weak} />
      </div>

      <div className="matchupGroup">
        <h4 className="matchupGroup__title matchupGroup__title--resist">
          Resists
        </h4>
        <TypeBadgeRow names={typeMatchups.resistant} />
      </div>

      <div className="matchupGroup">
        <h4 className="matchupGroup__title matchupGroup__title--immune">
          Immune to
        </h4>
        <TypeBadgeRow names={typeMatchups.immune} />
      </div>
    </Panel>
  );
}

function EvolutionPanel({ evolutionChain, currentId }) {
  return (
    <Panel
      title="Evolution Chain"
      badge={<span className="panelBadge">{evolutionChain.length} stage</span>}
    >
      <div className="evolution">
        {evolutionChain.map((stage) => (
          <div
            key={stage.id}
            className="evolution__step"
            style={{ marginLeft: `${stage.depth * 26}px` }}
          >
            {stage.depth > 0 && <span className="evolution__arrow">&rarr;</span>}

            <div
              className={
                stage.id === currentId
                  ? "evolution__card isCurrent"
                  : "evolution__card"
              }
            >
              <img src={getArtworkUrl(stage.id)} alt={stage.name} />
              <span>{humanize(stage.name)}</span>
              <small>{pokedexNumber(stage.id)}</small>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RegistryPanel({ caught, onPick }) {
  const recentEntries = caught.slice(-12).reverse();

  return (
    <Panel
      title="Registered Memory"
      badge={
        <span className="panelBadge">
          {caught.length} / {FIRST_GENERATION_COUNT}
        </span>
      }
    >
      {caught.length === 0 ? (
        <p className="muted">No Pokémon registered yet. Start a scan!</p>
      ) : (
        <div className="registry">
          {recentEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="registry__chip"
              onClick={() => onPick(entry.id)}
              title={`Load ${entry.name}`}
            >
              <img src={getPixelSpriteUrl(entry.id)} alt={entry.name} />
              <span>{humanize(entry.name)}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------
   9. THE APP
------------------------------------------------------------------ */

function App() {
  const [entry, setEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [caught, setCaught] = useState([]);
  const [page, setPage] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  function playCry(pokemon) {
    if (!soundOn) return;

    const cry = new Audio(pokemon.cries.latest);
    cry.volume = 0.3;
    cry.play().catch(() => {});
  }

  async function loadPokemon(id) {
    setIsLoading(true);
    setError("");

    try {
      const result = await scanPokemon(id);
      setEntry(result);
      setPage(0);
      playCry(result.pokemon);
    } catch (requestError) {
      setError("Could not reach the archive. Press START to retry.");
      console.error(requestError);
    } finally {
      setIsLoading(false);
    }
  }

  function scanRandomPokemon() {
    loadPokemon(getRandomPokemonId());
  }

  function registerCurrentPokemon() {
    if (!entry) return;

    const alreadyRegistered = caught.some((item) => item.id === entry.pokemon.id);
    if (alreadyRegistered) return;

    setCaught([...caught, { id: entry.pokemon.id, name: entry.pokemon.name }]);

    confetti({
      particleCount: 90,
      spread: 70,
      origin: { y: 0.4 },
      colors: ["#ffd32a", "#e01b24", "#ffffff", "#2a4bd8"],
    });
  }

  function goToNextPage() {
    setPage((current) => (current + 1) % SCREEN_PAGES.length);
  }

  function goToPreviousPage() {
    setPage(
      (current) => (current - 1 + SCREEN_PAGES.length) % SCREEN_PAGES.length
    );
  }

  const hasEntry = Boolean(entry) && !isLoading && !error;

  return (
    <div className="app">
      <header className="app__header">
        <p className="app__kicker">PokéAPI · Generation I</p>
        <h1 className="app__title">Pokédex Scanner</h1>
        <p className="app__subtitle">
          Every scan pulls from five different PokéAPI endpoints. Press START
          to register a random Pokémon.
        </p>
      </header>

      <div className="dex">
        <div className="dex__top">
          <div className="dex__screenFrame">
            <DexScreen
              entry={entry}
              page={page}
              isLoading={isLoading}
              error={error}
            />
          </div>

          <div className="dex__controls">
            <SpeakerGrille />

            <div className="dex__roundButtons">
              <button
                type="button"
                className="roundButton"
                onClick={goToPreviousPage}
                disabled={!hasEntry}
                aria-label="Previous page"
              >
                B
              </button>
              <button
                type="button"
                className="roundButton"
                onClick={goToNextPage}
                disabled={!hasEntry}
                aria-label="Next page"
              >
                A
              </button>
            </div>

            <button
              type="button"
              className="roundButton roundButton--small"
              onClick={registerCurrentPokemon}
              disabled={!hasEntry}
              aria-label="Register Pokémon"
            >
              ●
            </button>
          </div>
        </div>

        <div className="dex__band">
          <button
            type="button"
            className="pillButton"
            onClick={() => setSoundOn((current) => !current)}
          >
            {soundOn ? "SOUND ON" : "SOUND OFF"}
          </button>

          <button
            type="button"
            className="pillButton pillButton--primary"
            onClick={scanRandomPokemon}
          >
            START
          </button>
        </div>

        <div className="dex__base">
          <span>REGISTERED {caught.length}</span>
          <span className="dex__baseDivider" />
          <span>PAGE {page + 1} / {SCREEN_PAGES.length}</span>
        </div>
      </div>

      <div className="app__grid">
        {hasEntry ? (
          <>
            <AboutPanel entry={entry} />
            <StatsPanel pokemon={entry.pokemon} />
            <MatchupPanel typeMatchups={entry.typeMatchups} />
            <EvolutionPanel
              evolutionChain={entry.evolutionChain}
              currentId={entry.pokemon.id}
            />
          </>
        ) : (
          <Panel title="Awaiting Scan" className="panel--empty">
            <p className="muted">
              The field report, base stats, type matchups and evolution chain
              appear here once a Pokémon has been scanned.
            </p>
          </Panel>
        )}

        <RegistryPanel caught={caught} onPick={loadPokemon} />
      </div>
    </div>
  );
}

export default App;
