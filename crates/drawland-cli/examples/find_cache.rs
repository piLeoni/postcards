//! Print the cache file for the v3 proposal card, so the web app can be tested
//! against the same Overpass reply the CLI uses.
use drawland_core::card::{overpass_query, Card};
use drawland_core::grammar::Grammar;
use drawland_core::profile::Format;

fn quote_plus(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn main() {
    let text = std::fs::read_to_string("configs/proposal/postcard.yaml").unwrap();
    let grammar = Grammar::parse(&text, Format::Yaml).unwrap();
    let card = Card::new(&grammar.card, (-122.256196, 37.8771145));
    let keys = grammar.osm_keys();
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let query = overpass_query(&card.query_polygon(), &keys, 180);
    let url = format!("https://overpass-api.de/api/interpreter?{}", quote_plus(&format!("data={query}")));
    let digest = sha1_smol::Sha1::from(url.as_str()).digest().to_string();
    println!("{digest}");
}
