document.addEventListener('DOMContentLoaded', async () => {
    const candidatesContainer = document.getElementById('candidates-container');
    const candidateCountSpan = document.getElementById('candidate-count');
    const vagaFilterSelect = document.getElementById('vaga-filter');
    const sortSelect = document.getElementById('sort-select');
    const searchInput = document.getElementById('search-input');
    const selectAllCheck = document.getElementById('select-all-check');
    let allCandidates = [];
    let allVagas = [];
    let selectedIds = new Set();

    const fetchCandidates = async () => {
        candidatesContainer.innerHTML = '<p class="loading">Carregando candidatos...</p>';
        try {
            const response = await fetch('/api/selecao/candidates', { headers: authHeaders() });
            allCandidates = await response.json();
            renderCandidates();
        } catch (error) {
            console.error('Erro ao buscar candidatos:', error);
            candidatesContainer.innerHTML = '<p class="error">Erro ao carregar candidatos.</p>';
        }
    };

    const fetchVagas = async () => {
        try {
            const response = await fetch('/api/vagas');
            allVagas = await response.json();
            populateVagaFilter();
        } catch (error) {
            console.error('Erro ao buscar vagas:', error);
        }
    };

    const populateVagaFilter = () => {
        vagaFilterSelect.innerHTML = '<option value="">Todas as Vagas</option>';
        allVagas.forEach(vaga => {
            const option = document.createElement('option');
            option.value = vaga.id;
            option.textContent = vaga.titulo;
            vagaFilterSelect.appendChild(option);
        });
    };

    const renderCandidates = () => {
        candidatesContainer.innerHTML = '';
        let filteredCandidates = allCandidates;

        const selectedVagaId = vagaFilterSelect.value;
        if (selectedVagaId) {
            filteredCandidates = filteredCandidates.filter(c => c.job_id === selectedVagaId);
        }

        const searchTerm = searchInput.value.toLowerCase();
        if (searchTerm) {
            filteredCandidates = filteredCandidates.filter(c =>
                c.name.toLowerCase().includes(searchTerm) ||
                (c.skills && c.skills.some(s => s.toLowerCase().includes(searchTerm)))
            );
        }

        const sortVal = sortSelect.value;
        if (sortVal === 'score-desc') {
            filteredCandidates = [...filteredCandidates].sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0));
        } else if (sortVal === 'score-asc') {
            filteredCandidates = [...filteredCandidates].sort((a, b) => (a.ai_score_total || 0) - (b.ai_score_total || 0));
        } else if (sortVal === 'name-asc') {
            filteredCandidates = [...filteredCandidates].sort((a, b) => a.name.localeCompare(b.name));
        }

        candidateCountSpan.textContent = `(${filteredCandidates.length})`;

        if (filteredCandidates.length === 0) {
            candidatesContainer.innerHTML = '<p class="no-results">Nenhum candidato encontrado com os critérios.</p>';
            return;
        }

        filteredCandidates.forEach(candidate => {
            const candidateCard = document.createElement('div');
            candidateCard.className = 'candidate-card';
            const isChecked = selectedIds.has(candidate.id);
            candidateCard.innerHTML = `
                <label class="cand-select-label" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
                  <input type="checkbox" class="cand-check" data-id="${candidate.id}" ${isChecked ? 'checked' : ''}> Selecionar
                </label>
                <h3>${candidate.name}</h3>
                <p><strong>Vaga:</strong> ${candidate.vaga_titulo || 'N/A'}</p>
                <p><strong>Status:</strong> <span class="status-${candidate.status.toLowerCase().replace(/ /g, '-')}">${candidate.status}</span></p>
                <p><strong>Experiência:</strong> ${candidate.anos_xp || 0} anos</p>
                ${candidate.ai_score_total ? `<p><strong>Score IA:</strong> ${candidate.ai_score_total}</p>` : ''}
                ${candidate.ai_recomendacao ? `<p><strong>Recomendação IA:</strong> ${candidate.ai_recomendacao}</p>` : ''}
                ${candidate.ai_resumo ? `<p><strong>Resumo IA:</strong> ${candidate.ai_resumo}</p>` : ''}
                <div class="skills">
                    <strong>Habilidades:</strong> ${candidate.skills && candidate.skills.length > 0 ? candidate.skills.map(s => `<span>${s}</span>`).join(' ') : 'N/A'}
                </div>
                <div class="actions">
                    <button class="btn-promote" data-id="${candidate.id}" data-current-status="${candidate.status}">Promover</button>
                    <button class="btn-transfer" data-id="${candidate.id}">Transferir para Humano</button>
                </div>
            `;
            candidatesContainer.appendChild(candidateCard);
        });

        document.querySelectorAll('.btn-promote').forEach(button => {
            button.addEventListener('click', async (event) => {
                const id = event.target.dataset.id;
                const currentStatus = event.target.dataset.currentStatus;
                // Lógica para determinar o próximo status (exemplo simples)
                let nextStatus = '';
                switch(currentStatus) {
                    case 'Triado': nextStatus = 'Em Entrevista'; break;
                    case 'Em Entrevista': nextStatus = 'Oferecido'; break;
                    case 'Oferecido': nextStatus = 'Contratado'; break;
                    default: nextStatus = 'Em Entrevista'; // Fallback
                }
                if (nextStatus) {
                    await promoteCandidate(id, nextStatus);
                }
            });
        });

        document.querySelectorAll('.btn-transfer').forEach(button => {
            button.addEventListener('click', async (event) => {
                const id = event.target.dataset.id;
                await transferToHuman(id);
            });
        });
    };

    const promoteCandidate = async (id, nextStatus) => {
        try {
            const response = await fetch(`/api/selecao/promote/${id}`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ nextStatus })
            });
            if (response.ok) {
                await fetchCandidates(); // Recarrega os candidatos para mostrar o status atualizado
            } else {
                const error = await response.json();
                alert(`Erro ao promover candidato: ${error.error}`);
            }
        } catch (error) {
            console.error('Erro de rede ao promover candidato:', error);
            alert('Erro de rede ao promover candidato.');
        }
    };

    const transferToHuman = async (id) => {
        if (!confirm('Tem certeza que deseja transferir este candidato para intervenção humana?')) return;
        try {
            const response = await fetch(`/api/selecao/transfer-human/${id}`, {
                method: 'POST',
                headers: authHeaders()
            });
            if (response.ok) {
                await fetchCandidates(); // Recarrega os candidatos
                alert('Candidato transferido para intervenção humana com sucesso!');
            } else {
                const error = await response.json();
                alert(`Erro ao transferir candidato: ${error.error}`);
            }
        } catch (error) {
            console.error('Erro de rede ao transferir candidato:', error);
            alert('Erro de rede ao transferir candidato.');
        }
    };

    vagaFilterSelect.addEventListener('change', renderCandidates);
    sortSelect.addEventListener('change', renderCandidates);
    searchInput.addEventListener('input', renderCandidates);

    selectAllCheck.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.cand-check');
        checkboxes.forEach(cb => {
            cb.checked = selectAllCheck.checked;
            const id = Number(cb.dataset.id);
            if (selectAllCheck.checked) selectedIds.add(id);
            else selectedIds.delete(id);
        });
    });

    candidatesContainer.addEventListener('change', e => {
        if (!e.target.classList.contains('cand-check')) return;
        const id = Number(e.target.dataset.id);
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
    });

    fetchVagas();
    fetchCandidates();
});
