//! Installed fonts: listing families and checking glyph coverage.

use std::collections::BTreeSet;
use std::sync::OnceLock;

fn database() -> &'static fontdb::Database {
    static FONTS: OnceLock<fontdb::Database> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// Font families installed on this computer, sorted by name.
#[tauri::command(async)]
pub fn list_font_families() -> Vec<String> {
    let mut families = BTreeSet::new();
    for face in database().faces() {
        if let Some((name, _)) = face.families.first() {
            // Names starting with a dot are private system fonts on macOS.
            if !name.starts_with('.') {
                families.insert(name.clone());
            }
        }
    }
    families.into_iter().collect()
}

/// The characters of `text` that the family has no glyph for. An unknown family reports
/// nothing, because the output then uses the fallback fonts anyway.
#[tauri::command(async)]
pub fn font_missing_chars(family: String, text: String) -> String {
    let db = database();
    let query = fontdb::Query {
        families: &[fontdb::Family::Name(&family)],
        ..fontdb::Query::default()
    };
    let Some(id) = db.query(&query) else {
        return String::new();
    };
    let wanted: BTreeSet<char> = text
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect();
    db.with_face_data(id, |data, index| {
        match ttf_parser::Face::parse(data, index) {
            Ok(face) => wanted
                .iter()
                .filter(|c| face.glyph_index(**c).is_none())
                .collect::<String>(),
            Err(_) => String::new(),
        }
    })
    .unwrap_or_default()
}
