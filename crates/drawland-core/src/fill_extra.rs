//! Gallery-style penfill generators wired for draw.land presets.
//!
//! Spacing multipliers match `penfill/examples/gallery.rs` so a preset's
//! `spacing` reads like the gallery's coarse row.

use penfill::dotswaves;
use penfill::geo::{Region, Strokes};
use penfill::gravel::{fill_gravel_with, GravelEdge};
use penfill::litho;
use penfill::nature;
use penfill::stipple;
use penfill::Anchor;

pub fn run(generator: &str, r: &Region, s: f64, a: f64, seed: u64, at: Anchor) -> Option<Strokes> {
    Some(match generator {
        "wave-grid" => dotswaves::fill_wave_grid(r, s * 1.5, a, at),
        "stipple-noise" => stipple::fill_stipple_noise(r, s * 0.6, s * 3.0, s * 0.25, 12.0, seed),
        "stipple-edge" => stipple::fill_stipple_edge(r, s * 0.6, s * 3.0, s * 0.25, 8.0, 0.5, seed),
        "pebbles" => nature::fill_pebbles(r, s * 1.2, seed),
        "sprouts" => nature::fill_leaves(r, s * 1.5, seed),
        "fluid-grass" => nature::fill_fluid_grass(r, s * 1.35, seed),
        "lily-pads" => nature::fill_lily_pads(r, s * 1.4, seed),
        "canopy" => nature::fill_canopy(r, s * 2.5, seed),
        "gravel-clipped" => fill_gravel_with(r, s * 2.5, seed, GravelEdge::Clipped),
        "granite" => litho::fill_granite(r, s * 1.2, seed),
        "granite-x" => litho::fill_granite2(r, s * 1.2, seed),
        "diorite" => litho::fill_diorite(r, s * 1.2, seed),
        "gabbro" => litho::fill_gabbro(r, s * 1.2, seed),
        "brackets" => litho::fill_brackets(r, s * 1.2, seed),
        "dacite" => litho::fill_dacite(r, s * 0.8, a, seed),
        "feldspar" => litho::fill_feldspar(r, s * 0.9, a, seed),
        "arena" => litho::fill_arena(r, s * 0.9, seed),
        "breccia" => litho::fill_breccia(r, s * 2.2, seed),
        "breccia-blobs" => litho::fill_breccia2(r, s * 2.0, seed),
        "shards" => litho::fill_shards(r, s * 2.0, seed),
        "conglomerate" => litho::fill_conglomerate(r, s * 1.4, seed),
        "conglomerate-flat" => litho::fill_conglomerate2(r, s * 1.4, seed),
        "drift" => litho::fill_drift(r, s * 2.0, seed),
        "beds" => litho::fill_beds(r, s * 1.4, a, seed),
        "laminae" => litho::fill_laminae(r, s * 1.4, a, seed),
        "coal" => litho::fill_coal(r, s * 1.2, a, seed),
        "gneiss" => litho::fill_gneiss(r, s * 1.6, a, seed),
        "bentonite" => litho::fill_benton(r, s * 1.4, a, seed),
        "masonry" => litho::fill_masonry(r, s * 1.0, seed),
        "ferrous" => litho::fill_ferrous(r, s * 1.0, seed),
        "amphibolite" => litho::fill_amphibolite(r, s * 1.6, seed),
        "diatom" => litho::fill_diatom(r, s * 2.0, seed),
        "coquina" => litho::fill_coquina(r, s * 2.0, seed),
        "diabase" => litho::fill_diabase(r, s * 0.6, a, seed),
        "ophitic" => litho::fill_ophitic(r, s * 0.9, a, seed),
        "fine-gravel" => litho::fill_fine_gravel(r, s * 1.5, seed),
        "coarse-stone" => litho::fill_coarse_stone(r, s * 1.6, seed),
        "mixed-rocks" => litho::fill_mixed_rocks(r, s * 1.6, seed),
        "pebble-scatter" => litho::fill_pebble_scatter(r, s * 1.7, seed),
        "cracked-earth" => litho::fill_cracked_earth(r, s * 1.4, seed),
        "grainy-soil" => litho::fill_grainy_soil(r, s * 0.55, seed),
        "erosion-lines" => litho::fill_erosion(r, s * 0.5, a, seed),
        "stone-cluster" => litho::fill_stone_cluster(r, s, seed),
        "gravelly-soil" => litho::fill_gravelly_soil(r, s, seed),
        "mulch" => litho::fill_mulch(r, s * 0.7, a, seed),
        "layered-soil" => litho::fill_layered_soil(r, s * 1.1, a, seed),
        "pebbled-soil" => litho::fill_pebbled_soil(r, s * 0.85, seed),
        "clay-soil" => litho::fill_clay_soil(r, s * 0.7, a, seed),
        "silty-soil" => litho::fill_silty_soil(r, s * 2.0, seed),
        "loose-soil" => litho::fill_fine_gravel(r, s * 0.55, seed),
        "compacted-soil" => litho::fill_erosion(r, s * 0.28, a, seed),
        "sandy-soil" => litho::fill_pebble_scatter(r, s * 0.8, seed),
        "chalky-soil" => litho::fill_chalky_soil(r, s * 1.1, seed),
        "dry-cracked-soil" => litho::fill_dry_cracked(r, s * 1.1, seed),
        "mulched-soil" => litho::fill_mulch(r, s * 0.55, a, seed),
        "organic-topsoil" => litho::fill_topsoil(r, s * 1.4, seed),
        "debris-soil" => litho::fill_shards(r, s * 1.3, seed),
        "fill" => litho::fill_fill(r, s * 0.8, a, seed),
        "lava" => litho::fill_lava(r, s * 1.4, seed),
        "hornblende" => litho::fill_hornblende(r, s * 1.4, a, seed),
        _ => return None,
    })
}
