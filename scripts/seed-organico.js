'use strict'
const db = require('../db')

const CANDIDATOS = {
  recepcionista: [
    {
      nome: 'Ana Paula Ferreira',
      phone: '5511991110001',
      email: 'ana.ferreira@gmail.com',
      cv: `Ana Paula Ferreira — Recepcionista
Telefone: (11) 99111-0001 | Email: ana.ferreira@gmail.com

EXPERIÊNCIA
2022–2024 · Hotel Ibis São Paulo Centro — Recepcionista
- Atendimento a hóspedes nacionais e internacionais
- Check-in/check-out, gestão de reservas no Opera PMS
- Resolução de reclamações e upgrade de quartos

2020–2022 · Pousada Canto Verde — Recepcionista Auxiliar
- Front desk, controle de caixa, emissão de NF

FORMAÇÃO
Tecnólogo em Hotelaria — SENAC SP (2020)
Inglês Intermediário — CNA (2019)

HABILIDADES
Opera PMS, Totvs, Pacote Office, Inglês B2, Espanhol Básico`
    },
    {
      nome: 'Carlos Eduardo Lima',
      phone: '5511991110002',
      email: 'carlos.lima@hotmail.com',
      cv: `Carlos Eduardo Lima
Tel: (11) 99111-0002

Profissional com 3 anos em hotelaria de alto padrão.

EXPERIÊNCIA
2021–atual · Grand Hyatt São Paulo — Guest Service Agent
- Recepção VIP, concierge, gestão de fidelidade
- Fluente em inglês e espanhol

2019–2021 · Hotel Mercure — Recepcionista
- Turno noturno, auditoria noturna

FORMAÇÃO
Bacharel em Turismo — ANHEMBI MORUMBI (2019)
Inglês Avançado, Espanhol Intermediário`
    },
    {
      nome: 'Mariana Souza',
      phone: '5511991110003',
      email: 'mariana.souza@outlook.com',
      cv: `MARIANA SOUZA
(11) 99111-0003 · mariana.souza@outlook.com

Recepcionista com experiência em redes nacionais.

Experiência:
2023–atual: Hotel Blue Tree Morumbi — Recepcionista
Principais atividades: front desk, reservas, atendimento vip

2021–2023: Mercado Livre (atendimento ao cliente)
Suporte por chat e telefone, resolução de conflitos

Formação: Técnico em Administração — ETEC (2020)
Idiomas: Inglês básico`
    },
    {
      nome: 'Roberto Alves Santos',
      phone: '5511991110004',
      email: 'roberto.alves@gmail.com',
      cv: `Roberto Alves Santos | (11) 99111-0004

Objetivo: Recepcionista de Hotel

Experiência profissional:
- 2022–2024: Íbis Budget Guarulhos — Recepcionista (turno tarde/noite)
- 2020–2022: Hotel Formule 1 — Auxiliar de Recepção

Atividades: check-in, check-out, venda de amenidades, fechamento de caixa

Formação: Ensino Médio Completo (2019)
Curso: Recepcionista de Hotel — CNA Idiomas (80h)
Idiomas: Inglês básico, sem espanhol`
    },
    {
      nome: 'Juliana Costa Mendes',
      phone: '5511991110005',
      email: 'juliana.mendes@gmail.com',
      cv: `Juliana Costa Mendes
(11) 99111-0005 | juliana.mendes@gmail.com

Resumo: Recepcionista com 5 anos de experiência em hotéis boutique e redes internacionais. Apaixonada por hospitalidade e cultura Heartist.

Experiência:
2019–2024 · SoftInn Boutique Hotel — Recepcionista Sênior
- Treinamento de novos colaboradores
- Gestão de reclamações NPS
- Fluência em inglês e francês básico

Formação: Tecnólogo em Hotelaria — Mackenzie (2018)
Certificação: Opera PMS Avançado`
    },
  ],

  chef: [
    {
      nome: 'Felipe Rodrigues Gomes',
      phone: '5511992220001',
      email: 'felipe.chef@gmail.com',
      cv: `Felipe Rodrigues Gomes — Chef de Cozinha
(11) 99222-0001

EXPERIÊNCIA
2020–2024 · Hotel Renaissance — Sous Chef
- Gestão de equipe de 12 cozinheiros
- Cardápio autoral, controle de custo e estoque
- Cozinha mediterrânea e brasileira contemporânea

2017–2020 · Restaurante D.O.M. — Cozinheiro
- Cozinha de autor, mise en place de alto padrão

FORMAÇÃO
Graduação em Gastronomia — SENAC (2016)
Estágio Internacional — Lisboa (6 meses)
Inglês: Intermediário`
    },
    {
      nome: 'Claudia Nascimento',
      phone: '5511992220002',
      email: 'claudia.nasc@hotmail.com',
      cv: `Claudia Nascimento
Tel: (11) 99222-0002
claudia.nasc@hotmail.com

Chef de Cozinha com 8 anos de experiência em hotelaria 5 estrelas.

Experiência:
2018–atual: Hilton Morumbi — Chef de Garde Manger
Criação de buffets, eventos corporativos, cardápio sazonal

2015–2018: Hotel Unique — Cozinheira Sênior

Formação: Gastronomia — ANHEMBI (2014)
Especialização: Confeitaria Francesa — Le Cordon Bleu Paris`
    },
    {
      nome: 'André Luiz Pereira',
      phone: '5511992220003',
      email: 'andre.cozinha@gmail.com',
      cv: `André Luiz Pereira
(11) 99222-0003

Objetivo: Chef de Cozinha em rede hoteleira

Experiência:
2021–2024: Sofitel São Paulo — Cozinheiro Chefe de Partida
- Responsável pela praça de grelhados
- Equipe de 4 pessoas

2018–2021: Hotel Maksoud Plaza — Cozinheiro
Formação: Técnico em Cozinha — SENAC (2017)
Inglês: Básico`
    },
    {
      nome: 'Tatiane Oliveira',
      phone: '5511992220004',
      email: 'tati.oliveira@gmail.com',
      cv: `Tatiane Oliveira | Chef Executiva
(11) 99222-0004 | tati.oliveira@gmail.com

Experiência de 10 anos em alta gastronomia.

2019–2024: Grand Hyatt São Paulo — Chef Executiva Assistente
- Gestão de 3 restaurantes do hotel
- Controle de food cost 28%
- Treinamento e avaliação de equipe (32 pessoas)

2014–2019: Restaurante Fasano — Chef de Partie
Formação: Gastronomia — SENAC (2013)
Idiomas: Inglês Avançado, Italiano Básico`
    },
    {
      nome: 'Diego Martins',
      phone: '5511992220005',
      email: 'diego.martins.chef@outlook.com',
      cv: `Diego Martins
(11) 99222-0005

Chef de Cozinha — 4 anos de experiência

2022–2024: Hotel Intercontinental — Commis Chef
2020–2022: Restaurante Spot — Assistente de Cozinha

Formação: Gastronomia — UNIP (2020)
Cursos: Sushi & Comida Asiática (40h), Fermentação Natural
Inglês: Básico`
    },
  ],

  camareira: [
    {
      nome: 'Sandra Regina Luz',
      phone: '5511993330001',
      email: 'sandra.luz@gmail.com',
      cv: `Sandra Regina Luz
(11) 99333-0001 | sandra.luz@gmail.com

Camareira com 6 anos de experiência em redes hoteleiras internacionais.

Experiência:
2018–2024: Novotel São Paulo Morumbi — Camareira
- Higienização e arrumação de 16 apartamentos/turno
- Manuseio de produtos químicos PPRA
- Atendimento a hóspedes VIP

2016–2018: Hotel Quality — Camareira

Formação: Ensino Médio Completo
Curso: Governança e Camaragem — SENAC (40h)`
    },
    {
      nome: 'Luciana Fonseca',
      phone: '5511993330002',
      email: 'luciana.fonseca@hotmail.com',
      cv: `Luciana Fonseca | (11) 99333-0002

Experiência em housekeeping de hotéis boutique.

Experiência:
2021–2024: Hotel Fasano — Camareira Sênior
- Preparação de enxoval, controle de amenidades
- Treinamento de novas camareiras

2019–2021: Pousada Sete Colinas — Camareira

Qualidades: organização, atenção a detalhes, discrição
Formação: Ensino Médio | Curso Housekeeping 60h`
    },
    {
      nome: 'Patricia Almeida',
      phone: '5511993330003',
      email: 'patricia.almeida@gmail.com',
      cv: `Patricia Almeida
(11) 99333-0003

Objetivo: Camareira

Sem experiência formal em hotelaria. Trabalhou 4 anos como auxiliar de limpeza em condomínio residencial.

Motivação: Busco transição para hotelaria, tenho disponibilidade de horários e vontade de aprender.

Formação: Ensino Médio Completo (2018)
Cursos: Primeiros Socorros (2022)`
    },
    {
      nome: 'Rosangela Silva',
      phone: '5511993330004',
      email: 'rosangela.silva@gmail.com',
      cv: `Rosangela Silva
Telefone: (11) 99333-0004

Camareira experiente com 9 anos no setor hoteleiro.

Histórico profissional:
2015–2024: Ibis São Paulo Ibirapuera — Camareira Líder
- Coordenação da equipe no turno da manhã (8 pessoas)
- Controle de estoque de amenidades
- Relatórios de manutenção

Formação: Técnico em Hospitalidade — SENAI (2014)`
    },
    {
      nome: 'Fernanda Barros',
      phone: '5511993330005',
      email: 'fernanda.barros@outlook.com',
      cv: `Fernanda Barros | (11) 99333-0005 | fernanda.barros@outlook.com

Histórico:
2022–2024: Hotel Marriott Berrini — Camareira
Atividades: arrumação, higienização, atendimento a solicitações via HotSOS

2020–2022: Ibis Budget — Camareira

Formação: Ensino Médio
Certificação: NR-07 e NR-09 (2021)`
    },
  ],
}

;(async () => {
  await db.init()

  let inseridos = 0
  let pulados   = 0

  for (const [vagaId, lista] of Object.entries(CANDIDATOS)) {
    const { VAGAS } = require('../src/data/vagas')
    const vaga = VAGAS[vagaId]
    if (!vaga) { console.log(`Vaga ${vagaId} não encontrada, pulando.`); continue }

    for (const c of lista) {
      const existing = await db.get('SELECT id FROM candidates WHERE phone = ?', [c.phone])
      if (existing) { pulados++; continue }

      await db.run(`
        INSERT INTO candidates (name, phone, job_position, job_id, source, email, cv_text, status)
        VALUES (?, ?, ?, ?, 'organico', ?, ?, 'Pendente')
      `, [c.nome, c.phone, vaga.titulo, vagaId, c.email, c.cv])

      inseridos++
      console.log(`[+] ${c.nome} → ${vaga.titulo}`)
    }
  }

  console.log(`\nPronto: ${inseridos} inseridos, ${pulados} já existiam.`)
  process.exit(0)
})()
