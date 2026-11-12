import { C, Code, H, P, T, Table } from './Bits.jsx'

/**
 * For people building on draw.land rather than drawing with it: the command
 * line, the engine as a Rust library, the graph, the sibling libraries, and how
 * these pages are kept true.
 */
export const DEV_IDS = ['dev-cli', 'dev-rust', 'dev-graph', 'dev-python', 'dev-libraries', 'dev-docs']
export const DEV_TITLES = {
  'dev-cli': 'Command line',
  'dev-rust': 'Rust',
  'dev-graph': 'The graph',
  'dev-python': 'Python',
  'dev-libraries': 'The libraries',
  'dev-docs': 'These pages',
}

const REPO = 'https://github.com/piLeoni/postcards'

export default function Developers() {
  return (
    <>
      <H id="developers">For developers</H>
      <P>
        A profile is one front end to a typed graph of operations; the engine (<C>drawland-core</C>) runs the
        graph and has no I/O of its own. The web page and the command line are two hosts around it: each fetches
        what the graph reads and hands the bytes in. The architecture is mapped in the repository under{' '}
        <C>docs/architecture/</C>, starting at <C>INDEX.md</C>.
      </P>

      <H id="dev-cli" level={3}>
        Command line
      </H>
      <P>The <C>drawland</C> binary runs a profile, fetches what it reads, and writes the SVG.</P>
      <Code lang="bash">{`# A profile, and where to put it on the map.
cargo run --release -p drawland-cli -- map web/src/presets/city-grain.js --lat 37.8771 --lng -122.2562 -o map.svg

# An address, looked up with Nominatim. No profile: configs/postcard.js.
cargo run --release -p drawland-cli -- map --address "Piazza Maggiore, Bologna" -o map.svg

# The same, into exports/<address>/map.svg.
./generate.sh "Piazza Maggiore, Bologna"

# A saved graph runs as is: no interpreter, no script.
cargo run --release -p drawland-cli -- map graph.json -o map.svg`}</Code>
      <Table
        head={['Argument', 'Does']}
        rows={[
          [<C key="1">profile</C>, 'the profile script (default configs/postcard.js), or a saved graph (.json)'],
          [<C key="2">--address</C>, "where, looked up with Nominatim; overrides the profile's output"],
          [<C key="3">--lat --lng</C>, "where; overrides the profile's output"],
          [<C key="4">--dump-graph</C>, 'print the graph the profile builds, as JSON, and stop'],
          [<C key="5">-o</C>, 'output SVG (default map.svg)'],
          [<C key="5a">--slices</C>, 'for a card cut into sheets: whole, slices (r1c1, …) or both (default)'],
          [<C key="5b">--per-layer</C>, 'one SVG per top-level layer as well, <stem>-<layer>.svg: a file per pen'],
          [<C key="5c">--decimals</C>, 'coordinate decimals in the SVG, 0 to 6 (default 4)'],
          [<C key="6">--cache</C>, 'response cache (default cache/); Overpass replies are reused by any map they cover'],
          [<C key="7">--offline</C>, 'use cached responses only'],
          [<C key="8">--refresh</C>, 'fetch datasets again even when cached'],
        ]}
      />

      <H id="dev-rust" level={3}>
        Rust
      </H>
      <P>
        The engine is a library and the graph is Rust types. <C>drawland-core</C> is free of I/O: a host reads
        bytes and hands them in. A Rust program can run a JavaScript profile (<C>drawland_script::evaluate</C>{' '}
        returns the graph), build or load a graph, and run it.
      </P>
      <Code lang="toml" title="Cargo.toml">{`[dependencies]
drawland-core = { path = "../drawland/crates/drawland-core" }
drawland-script = { path = "../drawland/crates/drawland-script" }   # to run a JavaScript profile`}</Code>
      <P>
        The crates are not published on crates.io yet, and the graph is documented in its source (
        <C>crates/drawland-core/src/grammar.rs</C>, run by <C>grammar_run.rs</C>) rather than in rustdoc.{' '}
        <C>crates/drawland-cli</C> is the most complete example of a host: geocoding, Overpass, vector tiles,
        terrain and the cache around one call to the engine.
      </P>

      <H id="dev-graph" level={3}>
        The graph
      </H>
      <P>
        What the engine runs is the graph as JSON: one entry per node in typed sections (features, areas, lines,
        fills), plus the draws, the composition and the output. Each node keeps the script position that made
        it, which is how an engine error points at a line of the profile. Nobody writes it by hand, but any
        front end can emit it.
      </P>
      <Code lang="bash">{`drawland map configs/postcard.js --lat 37.8771 --lng -122.2562 --dump-graph | head -40`}</Code>

      <H id="dev-python" level={3}>
        Python
      </H>
      <P>
        There is no Python front end to draw.land. The pipeline these maps were first drawn with was Python and
        is kept in <C>reference/python/</C> to read, not to run: its per-theme logic was ported to Rust. A Python
        program can still write a profile or a graph and run it with the command line. penfill and burin-map,
        below, have Python bindings of their own.
      </P>

      <H id="dev-libraries" level={3}>
        The libraries
      </H>
      <P>
        draw.land is the first big user of a family of libraries developed alongside it, each a separate project
        with its own tests, which draw.land builds against by path (sibling checkouts in <C>../penfill</C>,{' '}
        <C>../terramask</C>, <C>../burin-map</C>).
      </P>
      <Table
        head={['Library', 'Gives draw.land', 'What']}
        rows={[
          ['terramask', 'map tiles as geometry', 'the sea, landcover, parks and buildings as polygons, mended across tile edges; elevation and depth bands'],
          ['penfill', 'pattern fills', 'the lines inside an area: every pattern in the catalogue; Python, Node and wasm bindings'],
          ['burin-map', 'pen-and-ink terrain', 'hatching and stippling of elevation, in its own language; a CLI, Python and Node bindings, a web page'],
        ]}
      />
      <P>
        They form a chain: <T>terramask</T> turns tiles into polygons and grids, <T>penfill</T> and{' '}
        <T>burin-map</T> turn shapes and surfaces into marks, and draw.land composes the marks into a layered
        sheet.
      </P>

      <H id="dev-docs" level={3}>
        These pages
      </H>
      <P>
        Everything on these pages is generated from, or checked against, the code it describes, so it cannot
        quietly go stale:
      </P>
      <Table
        head={['What', 'From', 'Kept true by']}
        rows={[
          ['Reference', <C key="1">crates/drawland-script/drawland.d.ts</C>, <C key="1b">web/scripts/build-reference.mjs; npm test fails when stale</C>],
          ['Tutorial and lite styles', <C key="2">web/src/docs/examples/*.js</C>, <C key="2b">npm test type-checks them; render-docs.sh draws them</C>],
          ['Gallery pictures', <C key="3">web/src/presets/*.js</C>, <C key="3b">web/scripts/render-docs.sh gallery</C>],
          ['Patterns page and swatches', <C key="4">penfill's catalogue</C>, <C key="4b">web/scripts/render-docs.sh patterns</C>],
          ['Pattern types in drawland.d.ts', <C key="5">penfill's catalogue</C>, <C key="5b">cargo run -p drawland-script --example write_dts; cargo test fails when stale</C>],
        ]}
      />
      <Code lang="bash">{`cargo run -p drawland-script --example write_dts   # after a pattern change in penfill
node web/scripts/build-reference.mjs     # after a change to drawland.d.ts
web/scripts/render-docs.sh                # every picture, with the CLI (OFFLINE=1: cache only)
web/scripts/render-docs.sh examples tutorial-04   # one section, the files whose name starts so`}</Code>
      <P>
        The source is on <a href={REPO}>GitHub</a>.
      </P>
    </>
  )
}
