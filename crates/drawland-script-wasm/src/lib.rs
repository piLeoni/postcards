//! The interpreter for the page, loaded only when a script has to run: a
//! profile script in, the graph it builds out, as JSON for the engine module.

use wasm_bindgen::prelude::*;

/// Run `source`; the graph as JSON, or an error carrying `line` and `column`
/// when the script position is known.
#[wasm_bindgen]
pub fn evaluate(source: &str) -> Result<String, JsValue> {
    match drawland_script::evaluate(source) {
        Ok(graph) => Ok(graph.to_json().to_string()),
        Err(e) => {
            let error = js_sys::Error::new(&e.to_string());
            if let Some(at) = e.at {
                let _ = js_sys::Reflect::set(&error, &"line".into(), &at.0.into());
                let _ = js_sys::Reflect::set(&error, &"column".into(), &at.1.into());
            }
            Err(error.into())
        }
    }
}
