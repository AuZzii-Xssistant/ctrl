use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Snippet {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub category: String,
    pub tags: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct SnippetData {
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub tags: Option<String>,
}

#[tauri::command]
pub fn get_snippets(state: State<AppState>, search: String) -> Result<Vec<Snippet>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = format!("%{}%", search.to_lowercase());
    let mut stmt = db.prepare(
        "SELECT id,title,content,category,tags,created_at FROM snippets
         WHERE ?1='' OR lower(title) LIKE ?1 OR lower(content) LIKE ?1 OR lower(category) LIKE ?1 OR lower(tags) LIKE ?1
         ORDER BY title COLLATE NOCASE"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&q], |r| {
            Ok(Snippet {
                id: r.get(0)?,
                title: r.get(1)?,
                content: r.get(2)?,
                category: r.get(3)?,
                tags: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_snippet(state: State<AppState>, data: SnippetData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO snippets (title,content,category,tags) VALUES (?1,?2,?3,?4)",
        params![
            data.title,
            data.content,
            data.category.unwrap_or_default(),
            data.tags.unwrap_or_default()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_snippet(state: State<AppState>, id: i64, data: SnippetData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE snippets SET title=?1,content=?2,category=?3,tags=?4 WHERE id=?5",
        params![
            data.title,
            data.content,
            data.category.unwrap_or_default(),
            data.tags.unwrap_or_default(),
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_snippet(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM snippets WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
