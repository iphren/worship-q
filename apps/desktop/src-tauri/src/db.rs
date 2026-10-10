//! The local SQLite database. The interface sends SQL through two commands; every write
//! arrives as a batch that is applied in one transaction.

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

pub const DB_FILE: &str = "worship-q.db";

pub struct AppData {
    pub conn: Mutex<Connection>,
    pub dir: PathBuf,
}

impl AppData {
    pub fn open(dir: PathBuf) -> rusqlite::Result<Self> {
        let conn = open_connection(&dir.join(DB_FILE))?;
        Ok(Self {
            conn: Mutex::new(conn),
            dir,
        })
    }

    pub fn db_path(&self) -> PathBuf {
        self.dir.join(DB_FILE)
    }
}

pub fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // FULL: a saved change must survive the laptop losing power mid-service.
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;")?;
    Ok(conn)
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

fn to_sql(value: &Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(b) => Ok(SqlValue::Integer(*b as i64)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Ok(SqlValue::Integer(i)),
            None => n
                .as_f64()
                .map(SqlValue::Real)
                .ok_or_else(|| format!("unsupported number {n}")),
        },
        Value::String(s) => Ok(SqlValue::Text(s.clone())),
        other => Err(format!("unsupported parameter {other}")),
    }
}

fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    }
}

fn bind(params: &[Value]) -> Result<Vec<SqlValue>, String> {
    params.iter().map(to_sql).collect()
}

#[tauri::command]
pub fn db_select(
    data: State<'_, AppData>,
    sql: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = data.conn.lock().map_err(|e| e.to_string())?;
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();
    let values = bind(&params.unwrap_or_default())?;
    let mut rows = statement
        .query(params_from_iter(values))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::with_capacity(columns.len());
        for (index, name) in columns.iter().enumerate() {
            let value = row.get_ref(index).map_err(|e| e.to_string())?;
            object.insert(name.clone(), from_sql(value));
        }
        result.push(object);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_batch(data: State<'_, AppData>, statements: Vec<Statement>) -> Result<(), String> {
    let mut conn = data.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for statement in &statements {
        let values = bind(&statement.params)?;
        tx.execute(&statement.sql, params_from_iter(values))
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
