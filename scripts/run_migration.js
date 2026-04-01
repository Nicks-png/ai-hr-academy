#!/usr/bin/env node
/**
 * Executa migrações do banco de dados
 * Uso: node scripts/run_migration.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'recruitment.db');
const migrationsDir = path.join(__dirname, '..', 'migrations');

const db = new Database(dbPath);

console.log(`\n🗄️  Executando migrações em: ${dbPath}\n`);

// Ler todos os arquivos .sql na pasta migrations
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort(); // Executa em ordem alfabética

if (migrationFiles.length === 0) {
  console.log('Nenhuma migração encontrada.');
  process.exit(0);
}

let applied = 0;
migrationFiles.forEach(file => {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  console.log(`📄 Executando: ${file}`);

  try {
    db.exec(sql);
    console.log(`   ✅ Sucesso\n`);
    applied++;
  } catch (err) {
    console.error(`   ❌ Erro: ${err.message}\n`);
  }
});

console.log(`\n📊 Total: ${applied}/${migrationFiles.length} migração(ões) aplicada(s).\n`);
db.close();
