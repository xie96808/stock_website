// ========== ACADEMY ==========
import { disposeQuizCharts, startQuiz } from './quiz.js';
import { QUIZ_PATTERNS } from './patterns.js';

let patternsRendered = false;

function renderKnowledgePatterns() {
    if (patternsRendered) return;

    const categoryToTab = { kline: 'tab-kline', volume: 'tab-volume', trend: 'tab-trend' };

    QUIZ_PATTERNS.forEach(p => {
        const container = document.getElementById(categoryToTab[p.category]);
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'pattern-card';
        card.innerHTML =
            `<div class="pattern-card-top">` +
                `<span class="pattern-name">${p.name}</span>` +
                `<span class="pattern-signal ${p.signalCls}">${p.signal}</span>` +
            `</div>` +
            `<div class="pattern-illust">${p.illust}</div>`;
        // desc 用 textContent 避免 HTML 注入
        const desc = document.createElement('div');
        desc.className = 'pattern-desc';
        desc.textContent = p.desc;
        card.appendChild(desc);

        container.appendChild(card);
    });

    patternsRendered = true;
}

export function showAcademy() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('academyScreen').classList.add('active');
    // Always start at landing
    document.getElementById('academyLanding').style.display = 'block';
    document.getElementById('knowledgeZone').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
}

export function hideAcademy() {
    document.getElementById('academyScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
    disposeQuizCharts();
}

export function switchTab(btn, tabId) {
    document.querySelectorAll('.academy-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pattern-grid').forEach(g => g.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

export function enterKnowledgeZone() {
    renderKnowledgePatterns();
    document.getElementById('academyLanding').style.display = 'none';
    document.getElementById('knowledgeZone').style.display = 'block';
}

export function enterTrainingZone() {
    document.getElementById('academyLanding').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'block';
    startQuiz();
}

export function backToAcademyLanding() {
    document.getElementById('knowledgeZone').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
    document.getElementById('academyLanding').style.display = 'block';
    disposeQuizCharts();
}
