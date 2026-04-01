
const db = require('../db');
const fs = require('fs');
const path = require('path');

// Placeholder para ResumeProcessor e ComparisonAgent
// Estes serão implementados em src/agents/
const ResumeProcessor = require('../src/agents/ResumeProcessor');
const ComparisonAgent = require('../src/agents/ComparisonAgent');

const resumeProcessor = new ResumeProcessor();
const comparisonAgent = new ComparisonAgent();

// Função mock para simular o download do CV
// Em uma implementação real, isso leria de um armazenamento de arquivos ou URL
function download_cv(candidateName) {
    const cvsDirectory = path.join(__dirname, '..\', 'cvs');
    const expectedFileName = `${candidateName.replace(/\s+/g, '_').toLowerCase()}.txt`;
    const cvFilePath = path.join(cvsDirectory, expectedFileName);

    if (fs.existsSync(cvFilePath)) {
        console.log(`[RPA] Lendo CV do arquivo: ${cvFilePath}`);
        return fs.readFileSync(cvFilePath, 'utf8');
    } else {
        console.warn(`[RPA] CV não encontrado para ${candidateName}. Usando conteúdo genérico.`);
        return "Currículo genérico sem informações específicas para " + candidateName;
    }
}

// Função para atualizar o status do candidato no banco de dados
function updateCandidate(candidateId, updates) {
    let setClause = [];
    let params = [];
    for (const key in updates) {
        setClause.push(`${key} = ?`);
        params.push(updates[key]);
    }
    if (setClause.length === 0) return; // Nada para atualizar

    params.push(candidateId);
    db.prepare(`UPDATE candidates SET ${setClause.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...params);
    console.log(`[RPA] Candidato ${candidateId} atualizado:`, updates);
}

async function automateScreeningCycle() {
    console.log("[RPA] Iniciando ciclo de triagem automatizado...");

    const activeVacancies = db.prepare("SELECT * FROM vagas WHERE status = 'active'").all();

    for (const vacancy of activeVacancies) {
        console.log(`[RPA] Processando vaga: ${vacancy.titulo} (ID: ${vacancy.id})`);

        // Placeholder: Como obter novos candidatos?
        // Por enquanto, vamos considerar candidatos com status 'Pendente' (que não foram processados pelo agente ainda)
        // Considerar candidatos com status 'Pendente' e job_id correspondente à vaga
        const newApplicants = db.prepare("SELECT * FROM candidates WHERE job_id = ? AND status = 'Pendente'").all(vacancy.id);

        for (const candidate of newApplicants) {
            console.log(`[RPA] Processando candidato: ${candidate.name} (ID: ${candidate.id})`);

            // 1. Download CV
            const cvContent = download_cv(candidate.name);

            // 2. Extrair dados via LLM (simulado pelo ResumeProcessor)
            const extractedData = resumeProcessor.parseResume(cvContent);
            console.log(`[RPA] Dados extraídos para ${candidate.name}:`, extractedData);

                        // 3. Atualiza dados extraídos e status para 'Em Análise'
            updateCandidate(candidate.id, {
                name: extractedData.nome,
                contact: extractedData.contato,
                skills: JSON.stringify(extractedData.skills), // Armazenar como JSON string
                status: 'Em Análise',
                job_id: vacancy.id // Garante que o candidato está associado à vaga
            });

            // 4. Rodar a comparação dos agentes
            // A vaga completa é passada para que o ComparisonAgent possa usar 'requisitos', 'diferenciais', etc.
            const agentResults = await comparisonAgent.analyze(extractedData, vacancy.descricao, vacancy);
            console.log(`[RPA] Resultados da análise do agente para ${candidate.name}:`, agentResults);

            // 5. Atualiza o candidato com os resultados da análise e status final
            updateCandidate(candidate.id, {
                ai_score_total: agentResults.scoreTotal,
                ai_recomendacao: agentResults.recomendacao,
                ai_pontos_fortes: JSON.stringify(agentResults.pontosFortes), // Armazenar como JSON string
                ai_pontos_atencao: JSON.stringify(agentResults.pontosAtencao), // Armazenar como JSON string
                ai_resumo: agentResults.resumo,
                ai_dimensoes: JSON.stringify(agentResults.dimensoes), // Armazenar como JSON string
                status: 'Triado' // Novo status para indicar que a triagem da IA foi concluída
            });
        }
    }

    console.log("[RPA] Ciclo de triagem automatizado concluído.");
}

// Para execução via CLI
if (require.main === module) {
    automateScreeningCycle()
        .then(() => process.exit(0))
        .catch(err => {
            console.error("[RPA ERROR]", err);
            process.exit(1);
        });
}
