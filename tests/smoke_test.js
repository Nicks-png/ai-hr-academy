#!/usr/bin/env node
/**
 * SMART HR AGENT - SMOKE TEST
 *
 * Este script testa as 3 funcionalidades principais do agente:
 * 1. Teste de Escopo (fora do escopo → transfere para humano)
 * 2. Teste de Triagem (extrai XP e salário → salva no banco)
 * 3. Teste de Intervenção (pedido de humano → desabilita IA)
 *
 * USO: node tests/smoke_test.js
 */

const db = require('../db');
const AgentService = require('../src/agents/agentService');

// Mock do WhatsApp socket para testes
class MockWASocket {
  async sendMessage(phone, text) {
    console.log(`\n📤 [MOCK WA] Enviando para ${phone}:`);
    console.log(`   "${text}"`);
  }
}

class Colors {
  static green(text) { return `\x1b[32m${text}\x1b[0m`; }
  static yellow(text) { return `\x1b[33m${text}\x1b[0m`; }
  static red(text) { return `\x1b[31m${text}\x1b[0m`; }
  static cyan(text) { return `\x1b[36m${text}\x1b[0m`; }
  static bold(text) { return `\x1b[1m${text}\x1b[0m`; }
}

async function runSmokeTest() {
  console.log('\n' + '='.repeat(60));
  console.log(Colors.bold('🤖 SMART HR AGENT - SMOKE TEST'));
  console.log('='.repeat(60) + '\n');

  const waMock = new MockWASocket();
  const agent = new AgentService(db, waMock);

  // Preparar banco: resetar candidato de teste
  const testPhone = '5511999888777';

  // Remover candidato de teste se existir (primeiro deletar mensagens devido a FK)
  const candidateExists = db.prepare('SELECT id FROM candidates WHERE phone = ?').get(testPhone);
  if (candidateExists) {
    const cid = candidateExists.id;
    db.prepare('DELETE FROM messages_sent WHERE candidate_id = ?').run(cid);
    db.prepare('DELETE FROM messages_received WHERE candidate_id = ?').run(cid);
    db.prepare('DELETE FROM candidates WHERE phone = ?').run(testPhone);
  }

  // Inserir candidato de teste
  const insertStmt = db.prepare(
    'INSERT INTO candidates (name, phone, job_position, ai_enabled) VALUES (?, ?, ?, ?)'
  );
  const info = insertStmt.run(
    'Candidato Teste',
    testPhone,
    'Desenvolvedor Fullstack',
    1
  );

  const candidateId = info.lastInsertRowid;
  console.log(`${Colors.cyan('[SETUP]')} Candidato teste criado (ID: ${candidateId}, Phone: ${testPhone})\n`);

  // ========================================
  // TESTE 1: TÓPICO FORA DO ESCOPO
  // ========================================
  console.log(Colors.yellow('\n📋 TESTE 1: Tópico Fora do Escopo'));
  console.log('-'.repeat(60));
  console.log('Pergunta: "Qual a previsão do tempo?"');
  console.log('Esperado: Transferência para humano (ai_enabled = 0)\n');

  const msg1 = {
    from: testPhone,
    text: 'Qual a previsão do tempo?'
  };

  await agent.interceptMessage(msg1);

  // Verificar se ai_enabled foi desativado
  const check1 = db.prepare('SELECT ai_enabled FROM candidates WHERE id = ?').get(candidateId);
  if (check1.ai_enabled === 0) {
    console.log(Colors.green('✅ PASSOU: ai_enabled = 0'));
  } else {
    console.log(Colors.red('❌ FALHOU: ai_enabled ainda é 1'));
  }

  // ========================================
  // TESTE 2: TRIAGEM (extrai dados)
  // ========================================
  console.log(Colors.yellow('\n\n📋 TESTE 2: Triagem Automatizada'));
  console.log('-'.repeat(60));

  // Re-habilitar IA para teste
  db.prepare('UPDATE candidates SET ai_enabled = 1 WHERE id = ?').run(candidateId);

  console.log('Sequência de mensagens:');
  console.log('  1. "Tenho 5 anos de XP"');
  console.log('  2. "Quero ganhar 8k"');
  console.log('Esperado: Salvar anos_xp=5, pretensao=8000\n');

  const msg2a = { from: testPhone, text: 'Tenho 5 anos de XP' };
  const msg2b = { from: testPhone, text: 'Quero ganhar 8k' };

  await agent.interceptMessage(msg2a);
  await agent.interceptMessage(msg2b);

  // Verificar se dados foram salvos
  const check2 = db.prepare('SELECT anos_xp, pretensao FROM candidates WHERE id = ?').get(candidateId);
  const xpOk = check2.anos_xp === 5;
  const salOk = check2.pretensao === 8000;

  if (xpOk && salOk) {
    console.log(Colors.green(`✅ PASSOU: anos_xp=${check2.anos_xp}, pretensao=${check2.pretensao}`));
  } else {
    console.log(Colors.red(`❌ FALHOU: anos_xp=${check2.anos_xp} (esperado 5), pretensao=${check2.pretensao} (esperado 8000)`));
  }

  // ========================================
  // TESTE 3: PEDIDO DE INTERVENÇÃO HUMANA
  // ========================================
  console.log(Colors.yellow('\n\n📋 TESTE 3: Pedido de Humano'));
  console.log('-'.repeat(60));
  console.log('Pergunta: "Quero falar com uma pessoa"');
  console.log('Esperado: Transferência imediata + ai_enabled = 0\n');

  const msg3 = { from: testPhone, text: 'Quero falar com uma pessoa' };
  await agent.interceptMessage(msg3);

  // Verificar se IA foi desativada
  const check3 = db.prepare('SELECT ai_enabled FROM candidates WHERE id = ?').get(candidateId);
  if (check3.ai_enabled === 0) {
    console.log(Colors.green('✅ PASSOU: ai_enabled = 0'));
  } else {
    console.log(Colors.red('❌ FALHOU: ai_enabled ainda é 1'));
  }

  // ========================================
  // LIMPEZA
  // ========================================
  // Deletar mensagens primeiro devido a FK
  db.prepare('DELETE FROM messages_sent WHERE candidate_id = ?').run(candidateId);
  db.prepare('DELETE FROM messages_received WHERE candidate_id = ?').run(candidateId);
  db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);

  // Resumo final
  console.log('\n' + '='.repeat(60));
  console.log(Colors.bold('📊 RESUMO DOS TESTES'));
  console.log('='.repeat(60));

  const tests = [
    { name: 'Fora do Escopo', passou: check1.ai_enabled === 0 },
    { name: 'Triagem Automatizada', passou: xpOk && salOk },
    { name: 'Intervenção Humana', passou: check3.ai_enabled === 0 }
  ];

  let allPassed = true;
  tests.forEach(t => {
    const status = t.passou ? Colors.green('✅ PASSOU') : Colors.red('❌ FALHOU');
    console.log(`  ${status} - ${t.name}`);
    if (!t.passou) allPassed = false;
  });

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log(Colors.green(Colors.bold('🎉 TODOS OS TESTES PASSARAM!')));
  } else {
    console.log(Colors.red(Colors.bold('⚠️  ALGUNS TESTES FALHARAM - VERIFIQUE LOGS')));
  }
  console.log('='.repeat(60) + '\n');
}

// Executar testes
runSmokeTest().catch(err => {
  console.error(Colors.red('Erro ao executar testes:'), err);
  process.exit(1);
});
