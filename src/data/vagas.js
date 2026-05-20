'use strict'

const db = require('../../db')

async function getVagas() {
  return db.all(`SELECT * FROM vagas WHERE status = 'active' ORDER BY titulo COLLATE NOCASE ASC`)
}

const VAGAS = {
  recepcionista: {
    titulo: 'Recepcionista de Hotel',
    marca: 'ibis · Mercure · Novotel',
    descricao: 'Atendimento ao hóspede no check-in/check-out, gestão de reservas via Opera PMS, resolução de solicitações e comunicação interdepartamental.',
    requisitos: ['Ensino médio completo', 'Comunicação clara e objetiva', 'Disponibilidade para turnos, fins de semana e feriados', 'Conhecimento básico em informática'],
    diferenciais: ['Inglês básico ou intermediário', 'Experiência com Opera PMS', 'Curso técnico em hotelaria ou turismo', 'Espanhol'],
    competencias: ['Orientação ao cliente', 'Trabalho em equipe', 'Atenção aos detalhes', 'Proatividade', 'Comunicação efetiva'],
    salario: 'R$ 1.921 – R$ 2.500',
    regime: 'CLT · Escala 6x1 · Turnos rotativos',
    perguntas: [
      'Por que você quer trabalhar em hotelaria e na Accor?',
      'Como você age quando um hóspede está insatisfeito? Dê um exemplo.',
      'Você tem disponibilidade para turnos rotativos, fins de semana e feriados?',
    ],
  },
  camareira: {
    titulo: 'Camareira / Camareiro',
    marca: 'ibis · ibis budget · Mercure',
    descricao: 'Limpeza e organização de apartamentos e áreas comuns, controle de enxoval e amenidades, registro de ocorrências na governança.',
    requisitos: ['Ensino fundamental completo', 'Boa condição física para trabalho em pé', 'Disponibilidade para turnos, fins de semana e feriados'],
    diferenciais: ['Experiência prévia em hotelaria ou serviços domésticos', 'Conhecimento de produtos de limpeza', 'Organização e atenção a detalhes'],
    competencias: ['Atenção aos detalhes', 'Organização', 'Autonomia', 'Trabalho em equipe', 'Resistência física'],
    salario: 'R$ 1.818 – R$ 2.200',
    regime: 'CLT · Escala 6x1 · Turnos',
    perguntas: [
      'Você tem experiência com serviços de limpeza, governança ou áreas correlatas?',
      'Como você garante qualidade e atenção aos detalhes no seu trabalho do dia a dia?',
      'Você tem disponibilidade para trabalhar em turnos e fins de semana?',
    ],
  },
  gerente: {
    titulo: 'Gerente Geral de Hotel',
    marca: 'Novotel · Mercure · Pullman',
    descricao: 'Gestão completa da unidade hoteleira: liderança de equipes multidepartamentais, P&L, relacionamento com proprietários e gestão da experiência do hóspede.',
    requisitos: ['Superior em Hotelaria, Administração ou áreas correlatas', 'Mínimo 3 anos em gestão hoteleira', 'Inglês avançado', 'Gestão financeira e Revenue Management'],
    diferenciais: ['MBA ou pós-graduação', 'Experiência em redes internacionais', 'Espanhol', 'Certificações em hotelaria'],
    competencias: ['Liderança inspiracional', 'Gestão financeira (P&L)', 'Orientação a resultados', 'Gestão de pessoas', 'Visão estratégica'],
    salario: 'R$ 7.000 – R$ 12.000',
    regime: 'CLT · Regime executivo',
    perguntas: [
      'Descreva sua experiência em gestão hoteleira e liderança de equipes multidepartamentais.',
      'Como você lida com pressão de metas financeiras (P&L) em operações hoteleiras?',
      'Você teria disponibilidade para eventual realocação para outras unidades Accor no Brasil?',
    ],
  },
  chef: {
    titulo: 'Chef de Cozinha',
    marca: 'Novotel · Mercure · Pullman',
    descricao: 'Desenvolvimento de cardápio, gestão da brigada de cozinha, controle de custos e desperdício, conformidade com normas ANVISA e HACCP.',
    requisitos: ['Formação técnica ou superior em Gastronomia', 'Mínimo 2 anos como Chef ou Sous-Chef', 'Conhecimento de HACCP e normas ANVISA', 'Gestão de equipes'],
    diferenciais: ['Experiência internacional', 'Inglês', 'Culinária regional brasileira ou internacional', 'Experiência em F&B hoteleiro'],
    competencias: ['Criatividade culinária', 'Liderança de brigada', 'Controle de custos', 'Organização e precisão', 'Compliance sanitário'],
    salario: 'R$ 4.000 – R$ 8.000',
    regime: 'CLT · Escala variável com fins de semana e feriados',
    perguntas: [
      'Qual é a sua especialidade culinária e como ela agrega valor à experiência do hóspede?',
      'Como você garante o cumprimento das normas HACCP e ANVISA na sua brigada?',
      'Descreva como você gerencia custos de alimentos e reduz desperdício na cozinha.',
    ],
  },
  supervisorFB: {
    titulo: 'Supervisor de Alimentos e Bebidas',
    marca: 'ibis · Mercure · Novotel',
    descricao: 'Supervisão do restaurante e bar do hotel, gestão de equipe de garçons, controle de estoque de F&B e garantia dos padrões de serviço Accor.',
    requisitos: ['Ensino médio completo', 'Mínimo 1 ano em supervisão de restaurante ou bar', 'Disponibilidade para turnos e fins de semana'],
    diferenciais: ['Curso técnico em hotelaria ou gastronomia', 'Inglês básico', 'Controle de custos e estoque'],
    competencias: ['Supervisão de equipes', 'Orientação ao cliente', 'Controle de qualidade', 'Organização', 'Comunicação'],
    salario: 'R$ 2.500 – R$ 4.000',
    regime: 'CLT · Escala 6x1',
    perguntas: [
      'Você tem experiência em supervisão de equipes de restaurante ou bar? Conte como foi.',
      'Como você garante os padrões de serviço e a satisfação dos clientes durante o turno?',
      'Você tem disponibilidade para trabalhar em turnos rotativos, incluindo fins de semana e feriados?',
    ],
  },
  manutencao: {
    titulo: 'Técnico de Manutenção',
    marca: 'ibis · Mercure · Novotel · Pullman',
    descricao: 'Manutenção preventiva e corretiva de instalações elétricas, hidráulicas e mecânicas do hotel, além de atendimento de chamados de hóspedes.',
    requisitos: ['Ensino técnico em Eletrotécnica, Mecânica ou correlatas', 'CREA ou registro profissional ativo', 'Disponibilidade para plantões e fins de semana'],
    diferenciais: ['Experiência em hotelaria', 'Conhecimento em refrigeração/HVAC', 'NR10 e NR35'],
    competencias: ['Resolução de problemas técnicos', 'Organização', 'Autonomia', 'Atenção à segurança', 'Comunicação'],
    salario: 'R$ 2.200 – R$ 4.000',
    regime: 'CLT · Plantões · 12x36 ou 6x1',
    perguntas: [
      'Quais são suas principais competências técnicas (elétrica, hidráulica, mecânica)?',
      'Você possui NR10, NR35 ou outra certificação relevante? Conte sua experiência.',
      'Como você prioriza chamados urgentes sem deixar a manutenção preventiva de lado?',
    ],
  },
  trainee: {
    titulo: 'Programa Trainee Accor',
    marca: 'Accor Group Brasil',
    descricao: 'Programa de desenvolvimento acelerado para recém-formados com rotação por departamentos-chave, mentoria sênior e formação para cargos gerenciais.',
    requisitos: ['Formação superior concluída entre 2023–2025', 'Inglês intermediário ou avançado', 'Disponibilidade para realocação pelo Brasil'],
    diferenciais: ['Segundo idioma (espanhol, francês)', 'Intercâmbio ou experiência internacional', 'Voluntáriado e liderança estudantil'],
    competencias: ['Agilidade de aprendizado', 'Liderança potencial', 'Adaptabilidade', 'Comunicação', 'Visão de negócios'],
    salario: 'Confidencial + benefícios competitivos',
    regime: 'CLT · Programa de 18 meses',
    perguntas: [
      'Por que você quer iniciar sua carreira na Accor e o que espera do Programa Trainee?',
      'Descreva uma situação onde demonstrou liderança ou iniciativa em um projeto ou grupo.',
      'Você teria disponibilidade para realocação pelo Brasil durante os 18 meses do programa?',
    ],
  },
  steward: {
    titulo: 'Steward',
    marca: 'Pullman',
    descricao: 'Lavar e limpar louça, panelas e utensilios das áreas de cozinha, executar higienização geral das dependências e instalações (equipamentos, copa, A&B), coletar e separar lixo para reciclagem, e montar/desmontar o restaurante dos colaboradores.',
    requisitos: ['Ensino fundamental completo', 'Português fluente'],
    diferenciais: ['Cursando ensino médio'],
    competencias: ['Foco no cliente', 'Espírito de equipe', 'Iniciativa e proatividade', 'Comunicação', 'Organização', 'Atenção a detalhes', 'Agilidade', 'Disciplina'],
    salario: 'R$ 2.020,00 + 3 pontos de gorjeta',
    regime: 'CLT · Escala 6x1 · 15h às 23h10',
    perguntas: [
      'Você tem experiência com limpeza e higienização em cozinha, restaurante ou área de A&B?',
      'Como você lida com o ritmo acelerado durante os picos de serviço e com múltiplas tarefas simultâneas?',
      'Você tem disponibilidade para trabalhar em turnos rotativos, fins de semana e feriados?',
    ],
  },
  chefConfeitaria: {
    titulo: 'Chef de Confeitaria',
    marca: 'Pullman · Novotel · Mercure',
    descricao: 'Liderança da confeitaria do hotel: criação e execução de sobremesas, pães e doces para café da manhã, eventos e à la carte, padronização de receitas, controle de custos e gestão da equipe de confeiteiros.',
    requisitos: ['Formação técnica ou superior em Gastronomia ou Confeitaria', 'Mínimo 2 anos como Chef de Confeitaria ou Confeiteiro Sênior', 'Conhecimento de normas HACCP e ANVISA', 'Experiência em gestão de equipe'],
    diferenciais: ['Especialização em confeitaria francesa ou patisserie', 'Experiência em hotelaria de médio/grande porte', 'Domínio de chocolate, açúcar artístico e decoração', 'Inglês básico'],
    competencias: ['Criatividade e precisão técnica', 'Liderança de equipe', 'Controle de custos e desperdício', 'Organização e higiene', 'Orientação a resultados'],
    salario: 'R$ 5.720,20',
    regime: 'CLT · Escala 6x1 · 08h às 16h20',
    perguntas: [
      'Qual é a sua especialidade em confeitaria e quais técnicas você domina (clássica, moderna, chocolate, açúcar artístico)?',
      'Como você padroniza receitas e controla custos para garantir consistência e reduzir desperdício?',
      'Descreva sua experiência liderando uma equipe de confeitaria em operação de volume.',
    ],
  },
  subChef: {
    titulo: 'Sub Chef de Cozinha',
    marca: 'Pullman · Novotel · Mercure',
    descricao: 'Suporte direto ao Chef Executivo na gestão da brigada, elaboração e execução do cardápio, controle de food cost, supervisão da mise en place e garantia dos padrões de qualidade e higiene da cozinha.',
    requisitos: ['Formação técnica ou superior em Gastronomia', 'Mínimo 2 anos em função de Sous-Chef ou líder de cozinha', 'Conhecimento de normas HACCP e ANVISA', 'Experiência em gestão de equipes de cozinha'],
    diferenciais: ['Experiência em hotel ou restaurante de alto padrão', 'Inglês básico', 'Conhecimento em food cost e controle de estoque', 'Especialização em cozinha brasileira ou internacional'],
    competencias: ['Liderança operacional', 'Organização e planejamento', 'Controle de qualidade', 'Criatividade culinária', 'Gestão sob pressão'],
    salario: 'R$ 6.500,00',
    regime: 'CLT · Escala 6x1 · 08h às 16h20',
    perguntas: [
      'Descreva sua experiência como Sous-Chef ou líder de cozinha e os principais desafios que enfrentou.',
      'Como você garante os padrões de qualidade, higiene e consistência nos pratos durante o serviço?',
      'Você tem experiência com controle de food cost e gestão de estoque? Como aplica isso no dia a dia?',
    ],
  },
  garcom: {
    titulo: 'Garçom / Garçonete',
    marca: 'Pullman',
    descricao: 'Servir alimentos e bebidas aos clientes nos Pontos de Venda (restaurante, bar, room service, banquetes e eventos), garantindo os padrões de excelência no atendimento e a plena satisfação do cliente.',
    requisitos: ['Ensino médio completo', 'Curso de boas práticas de segurança alimentar', 'Disponibilidade para turnos, fins de semana e feriados'],
    diferenciais: ['Cursando superior', 'Noções de enologia', 'Microinformática como usuário', 'Inglês intermediário'],
    competencias: ['Prazer em Servir', 'Trabalho em Equipe', 'Comunicação', 'Agilidade', 'Atenção a detalhes', 'Proatividade', 'Organização', 'Discrição', 'Coordenação motora'],
    salario: 'A consultar',
    regime: 'CLT · Escala 6x1 · Turnos rotativos',
    perguntas: [
      'Você tem experiência como garçom/garçonete em restaurante, hotel ou eventos? Conte como foi.',
      'Como você lida com clientes exigentes ou situações de pressão durante o serviço?',
      'Você tem disponibilidade para trabalhar em turnos rotativos, fins de semana e feriados?',
    ],
  },
  auxiliarCozinha: {
    titulo: 'Auxiliar de Cozinha',
    marca: 'ibis · Mercure · Novotel',
    descricao: 'Apoio à brigada na preparação e finalização de pratos, higienização de insumos, mise en place, controle de estoque de ingredientes e manutenção da organização da cozinha.',
    requisitos: ['Ensino fundamental completo', 'Disponibilidade para turnos, fins de semana e feriados', 'Boa condição física para trabalho em pé'],
    diferenciais: ['Curso técnico em gastronomia ou alimentação', 'Experiência em cozinha de restaurante, hotelaria ou catering', 'Conhecimento de boas práticas de manipulação de alimentos'],
    competencias: ['Organização', 'Agilidade', 'Trabalho em equipe', 'Atenção aos detalhes', 'Aprendizado rápido'],
    salario: 'R$ 1.600 – R$ 2.100',
    regime: 'CLT · Escala 6x1 · Turnos rotativos',
    perguntas: [
      'Você tem experiência em cozinha (restaurante, hotel, catering ou similar)? Descreva.',
      'Como você lida com o ritmo acelerado durante os picos de serviço na cozinha?',
      'Você tem disponibilidade para trabalhar em turnos rotativos, fins de semana e feriados?',
    ],
  },
}

async function getVagaById(id) {
  return db.get('SELECT * FROM vagas WHERE id = ?', [id])
}

async function createVaga(vaga) {
  const { id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime, status, perguntas } = vaga
  const result = await db.run(
    'INSERT INTO vagas (id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime, status, perguntas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, titulo, marca, descricao, JSON.stringify(requisitos || []), JSON.stringify(diferenciais || []),
     JSON.stringify(competencias || []), salario, regime, status || 'active', JSON.stringify(perguntas || [])]
  )
  return result.lastInsertRowid
}

async function updateVaga(id, fields) {
  const allowed = ['titulo', 'marca', 'descricao', 'requisitos', 'diferenciais', 'competencias', 'salario', 'regime', 'perguntas', 'status']
  const sets = []
  const vals = []
  for (const k of allowed) {
    if (fields[k] === undefined) continue
    sets.push(`${k} = ?`)
    vals.push(Array.isArray(fields[k]) ? JSON.stringify(fields[k]) : fields[k])
  }
  if (!sets.length) return
  await db.run(`UPDATE vagas SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
}

async function deleteVaga(id) {
  await db.run(`UPDATE vagas SET status = 'inactive' WHERE id = ?`, [id])
}

const PESOS = { heartist: 20, tecnico: 25, experiencia: 20, estabilidade: 20, potencial: 15 }

function calcScore(dimensoes) {
  const d = { ...dimensoes }
  if (!d.estabilidade?.score && d.disponibilidade?.score) {
    d.estabilidade = d.disponibilidade
  }
  return Math.round(
    Object.entries(PESOS).reduce((acc, [k, peso]) => {
      const score = Number(d[k]?.score) || 0
      return acc + (Math.min(10, Math.max(0, score)) * peso) / 10
    }, 0)
  )
}

function extractJSON(text) {
  if (!text) throw new Error('Resposta vazia da IA.')
  try { return JSON.parse(text) } catch (_) {}
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(stripped) } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch (_) {}
  }
  console.error('[extractJSON] falhou. Início da resposta:', text.slice(0, 200))
  throw new Error('A IA não retornou JSON válido. Tente novamente.')
}

const PROVIDERS = {
  gemini:     { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', key: () => process.env.GEMINI_API_KEY },
  groq:       { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: () => process.env.GROQ_API_KEY },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324:free', key: () => process.env.OPENROUTER_API_KEY },
}

function getProvider() {
  if (process.env.GEMINI_API_KEY)     return 'gemini'
  if (process.env.GROQ_API_KEY)       return 'groq'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return null
}

module.exports = { VAGAS, getVagas, getVagaById, createVaga, updateVaga, deleteVaga, PESOS, calcScore, extractJSON, PROVIDERS, getProvider }
