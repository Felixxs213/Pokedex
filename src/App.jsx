import { Component, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  FIRST_GENERATION_COUNT,
  formatGeneration,
  formatHeight,
  formatPercent,
  formatWeight,
  getAnimatedSprite,
  getArtworkUrl,
  getFlavorText,
  getPixelSpriteUrl,
  getRandomPokemonId,
  humanize,
  pokedexNumber,
  scanPokemon,
} from "./pokeapi.js";
import "./App.css";

/* ------------------------------------------------------------------
   1. UI CONFIG
   Values that only describe how the device looks. Anything that
   talks to PokéAPI lives over in ./pokeapi.js.
------------------------------------------------------------------ */

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
   2. SMALL PRESENTATION COMPONENTS
------------------------------------------------------------------ */

// Shown when a sprite fails to load (for example if the sprite host
// rate-limits us). A data uri cannot fail, so replacing a broken image with
// this one can never loop.
const PLACEHOLDER_SPRITE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" rx="12" fill="#e9ecf5"/>' +
      '<circle cx="48" cy="48" r="24" fill="none" stroke="#9aa4bb" stroke-width="6"/>' +
      '<path d="M24 48h48" stroke="#9aa4bb" stroke-width="6"/>' +
      '<circle cx="48" cy="48" r="8" fill="#9aa4bb"/>' +
      "</svg>"
  );

function Sprite({ src, alt, className }) {
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.src = PLACEHOLDER_SPRITE;
      }}
    />
  );
}

function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(
    (index) => parseInt(value.slice(index, index + 2), 16) / 255
  );
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  );

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Type colours range from pale yellow (Electric) to near-black, so no single
// text colour is readable on all of them. Pick white or near-black based on
// whichever gives the higher WCAG contrast against the swatch.
const DARK_TEXT = "#0d1526";

function getReadableTextColor(background) {
  const bg = relativeLuminance(background);
  const dark = relativeLuminance(DARK_TEXT);
  const onWhite = 1.05 / (bg + 0.05);
  const onDark = (bg + 0.05) / (dark + 0.05);

  return onWhite >= onDark ? "#ffffff" : DARK_TEXT;
}

function TypeBadge({ name }) {
  // Fall back to a neutral grey if PokéAPI ever sends a type we have no
  // colour for, so the badge still renders instead of crashing.
  const background = TYPE_COLORS[name] ?? "#6b7590";

  return (
    <span
      className="typeBadge"
      style={{
        backgroundColor: background,
        color: getReadableTextColor(background),
      }}
    >
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
   3. THE LCD SCREEN
------------------------------------------------------------------ */

function ScreenLoading() {
  return (
    <div className="screenState">
      <p className="screenState__title">SCANNING</p>
      <div className="scanBeam" aria-hidden="true" />
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

      <p className="screenPage__name">{humanize(pokemon.name)}</p>

      <Sprite className="screenSprite" src={sprite} alt={pokemon.name} />

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

      <p className="screenPage__name">{humanize(pokemon.name)}</p>

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

  // A short line for the screen-reader-only live region below. Sighted users
  // read the screen itself, but someone using a screen reader needs to be told
  // that a scan started and what it found.
  let liveMessage = "Pokédex idle. Press START to scan.";
  if (isLoading) {
    liveMessage = "Scanning. Tuning into life signal.";
  } else if (error) {
    liveMessage = `Signal lost. ${error}`;
  } else if (entry) {
    liveMessage =
      page === 1
        ? `Battle data for ${humanize(entry.pokemon.name)}.`
        : `Profile for ${humanize(entry.pokemon.name)}, number ${entry.pokemon.id}.`;
  }

  return (
    <div
      className="screen"
      role="group"
      aria-label="Scanner display"
    >
      <p className="srOnly" role="status" aria-live="polite">
        {liveMessage}
      </p>

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

      <div className="screen__dots" aria-hidden="true">
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
   4. INFO PANELS
------------------------------------------------------------------ */

function Panel({ title, badge, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__header">
        <h2>{title}</h2>
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
        <span className="dataGrid__label">
          {ability.ok === false ? "Ability" : `Ability · ${ability.name}`}
        </span>
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
  if (typeMatchups.ok === false) {
    return (
      <Panel title="Type Matchup" className="panel--matchups">
        <p className="muted">
          Type data could not be loaded for this Pokémon.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Type Matchup" className="panel--matchups">
      <div className="matchupGroup">
        <h3 className="matchupGroup__title matchupGroup__title--weak">
          Weak to
        </h3>
        <TypeBadgeRow names={typeMatchups.weak} />
      </div>

      <div className="matchupGroup">
        <h3 className="matchupGroup__title matchupGroup__title--resist">
          Resists
        </h3>
        <TypeBadgeRow names={typeMatchups.resistant} />
      </div>

      <div className="matchupGroup">
        <h3 className="matchupGroup__title matchupGroup__title--immune">
          Immune to
        </h3>
        <TypeBadgeRow names={typeMatchups.immune} />
      </div>
    </Panel>
  );
}

function EvolutionPanel({ evolutionChain, currentId }) {
  if (evolutionChain.length === 0) {
    return (
      <Panel title="Evolution Chain">
        <p className="muted">
          Evolution data could not be loaded for this Pokémon.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Evolution Chain"
      badge={<span className="panelBadge">{evolutionChain.length} stage</span>}
    >
      <div className="evolution">
        {evolutionChain.map((stage) => (
          <div
            key={stage.id ?? stage.name}
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
              <Sprite
                src={stage.id ? getArtworkUrl(stage.id) : PLACEHOLDER_SPRITE}
                alt=""
              />
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
              <Sprite src={getPixelSpriteUrl(entry.id)} alt="" />
              <span>{humanize(entry.name)}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------
   5. THE APP
------------------------------------------------------------------ */

function describeScanError(error) {
  if (error.name === "TimeoutError") {
    return "The archive is taking too long to answer. Press START to retry.";
  }

  return "Could not reach the archive. Press START to retry.";
}

function App() {
  const [entry, setEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [caught, setCaught] = useState([]);
  const [page, setPage] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  // Holds the scan that is currently running, so a newer scan can cancel it.
  const activeScan = useRef(null);

  function playCry(pokemon) {
    if (!soundOn) return;

    const cry = new Audio(pokemon.cries.latest);
    cry.volume = 0.3;
    // Autoplay can be blocked by the browser, and that is fine — the sound
    // is a bonus, so we ignore the rejection on purpose.
    cry.play().catch(() => {});
  }

  async function loadPokemon(id) {
    // Cancel a scan that is still in flight. Without this, a slow earlier
    // request could finish last and overwrite the newer Pokémon.
    activeScan.current?.abort();

    const controller = new AbortController();
    activeScan.current = controller;

    setIsLoading(true);
    setError("");

    try {
      const result = await scanPokemon(id, { signal: controller.signal });

      // A newer scan started while we were waiting, so drop these results.
      if (activeScan.current !== controller) return;

      setEntry(result);
      setPage(0);
      playCry(result.pokemon);
    } catch (requestError) {
      // Ignore anything from a scan we already replaced or cancelled.
      if (activeScan.current !== controller) return;
      if (requestError.name === "AbortError") return;

      setError(describeScanError(requestError));

      if (import.meta.env.DEV) {
        console.error(requestError);
      }
    } finally {
      // Only the newest scan is allowed to clear the loading state.
      if (activeScan.current === controller) {
        setIsLoading(false);
        activeScan.current = null;
      }
    }
  }

  function scanRandomPokemon() {
    loadPokemon(getRandomPokemonId());
  }

  function registerCurrentPokemon() {
    if (!entry) return;

    const { id, name } = entry.pokemon;

    // This check only decides whether to celebrate. The real de-duplication
    // happens inside the updater below.
    const alreadyRegistered = caught.some((item) => item.id === id);

    // The updater form reads the freshest `caught`, so two quick clicks can
    // never append the same Pokémon twice.
    setCaught((current) =>
      current.some((item) => item.id === id)
        ? current
        : [...current, { id, name }]
    );

    if (alreadyRegistered) return;

    // Confetti is moving decoration, so skip it for anyone who has asked
    // their system for less motion.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (!prefersReducedMotion) {
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.4 },
        colors: ["#ffd32a", "#e01b24", "#ffffff", "#2a4bd8"],
      });
    }
  }

  function goToNextPage() {
    setPage((current) => (current + 1) % SCREEN_PAGES.length);
  }

  function goToPreviousPage() {
    setPage(
      (current) => (current - 1 + SCREEN_PAGES.length) % SCREEN_PAGES.length
    );
  }

  // `hasEntry` means "we have data worth showing". It deliberately ignores
  // isLoading so the panels below the device keep their last Pokémon on
  // screen while a new scan is in flight, instead of flickering away.
  const hasEntry = Boolean(entry) && !error;
  const controlsDisabled = !hasEntry || isLoading;

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
                disabled={controlsDisabled}
                aria-label="Previous page (B)"
              >
                B
              </button>
              <button
                type="button"
                className="roundButton"
                onClick={goToNextPage}
                disabled={controlsDisabled}
                aria-label="Next page (A)"
              >
                A
              </button>
            </div>

            <button
              type="button"
              className="roundButton roundButton--small"
              onClick={registerCurrentPokemon}
              disabled={controlsDisabled}
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
            aria-pressed={soundOn}
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

/* ------------------------------------------------------------------
   6. ERROR BOUNDARY
   If something throws while React is drawing the screen, React would
   normally unmount everything and leave a blank page. An error boundary
   catches that and shows a friendly message with a way to recover.
------------------------------------------------------------------ */

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error(error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash">
          <h1 className="crash__title">The Pokédex crashed</h1>
          <p className="crash__text">
            Something went wrong while drawing the screen. Reloading usually
            fixes it.
          </p>
          <button
            type="button"
            className="pillButton pillButton--primary"
            onClick={() => window.location.reload()}
          >
            RELOAD
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
export default App;
