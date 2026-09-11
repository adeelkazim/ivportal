/* =============================================
   Global Vision Portal - Knowledge Base Script
   ============================================= */

let allKnowledgeBase = [];

document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    loadKnowledgeBase();
    setupSearchAndFilters();
    setupKBModal();
    setupKBSubmission();
});

function setupKBSubmission() {
    const kbForm = document.getElementById('kbSubmitForm');
    if (!kbForm) return;

    const user = getUser();
    document.getElementById('kbSubmittedBy').value = user ? `${user.Name} (${user.Role})` : '';
    document.getElementById('kbDate').value = new Date().toLocaleString();

    kbForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const title = document.getElementById('kbTitle').value.trim();
        const category = document.getElementById('kbCategory').value;
        const problem = document.getElementById('kbProblem').innerText.trim();
        const solution = document.getElementById('kbSolution').innerText.trim();

        if (!title || !category || !problem || !solution) {
            showMessage('Please fill in all fields', 'error', 'kbSubmitMessage');
            return;
        }

        try {
            await apiCall('/knowledge-base', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    category,
                    description: problem,
                    solution
                })
            });
            showMessage('Knowledge base entry added!', 'success', 'kbSubmitMessage');
            kbForm.reset();
            document.getElementById('kbProblem').innerHTML = '';
            document.getElementById('kbSolution').innerHTML = '';
            await loadKnowledgeBase();
            return;
        } catch (error) {
            let kb = JSON.parse(localStorage.getItem('knowledgeBase') || '[]');
            const newId = kb.length > 0 ? Math.max(...kb.map(a => a.id || a.ProblemID)) + 1 : mockKnowledgeBase.length + 1;
            kb.push({
                ProblemID: newId,
                Title: title,
                Category: category,
                Description: problem,
                Solution: solution,
                ViewCount: 0
            });
            localStorage.setItem('knowledgeBase', JSON.stringify(kb));
            showMessage('Knowledge base entry added (demo mode)!', 'success', 'kbSubmitMessage');
            kbForm.reset();
            await loadKnowledgeBase();
        }
    });
}

async function loadKnowledgeBase() {
    try {
        const response = await apiCall('/knowledge-base');
        allKnowledgeBase = (response && response.articles) || [];
    } catch (error) {
        let kb = [];
        try {
            kb = JSON.parse(localStorage.getItem('knowledgeBase') || '[]');
        } catch (e) {}
        allKnowledgeBase = [...mockKnowledgeBase, ...kb];
    }
    displayKnowledgeBase(allKnowledgeBase);
}

function displayKnowledgeBase(articles) {
    const container = document.getElementById('kbContainer');

    if (articles.length === 0) {
        container.innerHTML = '<p class="text-center">No articles found</p>';
        return;
    }

    container.innerHTML = articles.map(article => `
        <div class="kb-card" onclick="openKBArticle(${article.ProblemID})">
            <span class="kb-category">${article.Category}</span>
            <h3>${article.Title}</h3>
            <p>${truncateString(article.Description, 120)}</p>
            <div class="kb-meta">
                <small><strong>Views:</strong> ${article.ViewCount}</small>
            </div>
        </div>
    `).join('');
}

function setupSearchAndFilters() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (categoryFilter) categoryFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const categoryFilter = document.getElementById('categoryFilter').value;

    let filtered = allKnowledgeBase;

    if (searchTerm) {
        filtered = filtered.filter(article =>
            article.Title.toLowerCase().includes(searchTerm) ||
            article.Description.toLowerCase().includes(searchTerm) ||
            (article.Solution && article.Solution.toLowerCase().includes(searchTerm))
        );
    }

    if (categoryFilter) {
        filtered = filtered.filter(article => article.Category === categoryFilter);
    }

    displayKnowledgeBase(filtered);
}

async function openKBArticle(problemId) {
    const article = allKnowledgeBase.find(a => a.ProblemID === problemId);
    if (!article) return;

    try {
        const response = await apiCall(`/knowledge-base/${problemId}/increment-views`, { method: 'POST' });
        if (response && response.article) {
            article.ViewCount = response.article.ViewCount;
        }
    } catch (e) {
        article.ViewCount = (article.ViewCount || 0) + 1;
    }

    document.getElementById('modalTitle').textContent = article.Title;
    document.getElementById('modalCategory').textContent = `Category: ${article.Category}`;
    document.getElementById('modalProblem').textContent = article.Description;
    document.getElementById('modalSolution').textContent = article.Solution;
    document.getElementById('modalAuthor').textContent = 'Knowledge Base';
    document.getElementById('modalViews').textContent = article.ViewCount;

    openModal('kbModal');
}

function setupKBModal() {
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeModal('kbModal'));
    }
}
